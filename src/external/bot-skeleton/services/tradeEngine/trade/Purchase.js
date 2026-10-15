import { getLocalizedErrorMessage } from '@/constants/backend-error-messages';
import { shouldStopTradingForBalance } from '@/utils/account-helpers';
import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { contractStatus, info, log } from '../utils/broadcast';
import { doUntilDone, getUUID, recoverFromError, tradeOptionToBuy } from '../utils/helpers';
import { purchaseSuccessful } from './state/actions';
import { BEFORE_PURCHASE } from './state/constants';

let delayIndex = 0;
let purchase_reference;
const MAX_BULK_PURCHASES = 10;

export default Engine =>
    class Purchase extends Engine {
        async purchaseMany(contract_types, trade_count = 1) {
            const requestedCount = Number(trade_count);
            if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_BULK_PURCHASES) {
                throw new RangeError(`The number of bulk purchases must be between 1 and ${MAX_BULK_PURCHASES}.`);
            }

            if (
                !Array.isArray(contract_types) ||
                contract_types.length === 0 ||
                contract_types.some(contract_type => typeof contract_type !== 'string' || !contract_type)
            ) {
                throw new TypeError('Valid contract types are required for a purchase.');
            }

            const contractTypes = Array.from({ length: requestedCount }, () => contract_types).flat();
            if (contractTypes.length > MAX_BULK_PURCHASES) {
                throw new RangeError(`The number of bulk purchases cannot exceed ${MAX_BULK_PURCHASES}.`);
            }
            if (contractTypes.length === 1) {
                return this.purchase(contractTypes[0]);
            }

            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const balance = this.getBalance();
            const totalTradeAmount = this.tradeOptions?.amount * contractTypes.length;
            if (shouldStopTradingForBalance(balance, totalTradeAmount)) {
                const insufficientBalanceMessage = getLocalizedErrorMessage('InsufficientBalance');
                this.observer.emit('ui.log.error', insufficientBalanceMessage);
                this.observer.emit('bot.click_stop');
                return Promise.resolve();
            }

            this.bulkContractIds = [];
            this.bulkContractSellableIds = [];
            this.bulkPurchasePending = contractTypes.length;
            this.contractId = '';
            let purchasedCount = 0;
            try {
                for (const [index, contract_type] of contractTypes.entries()) {
                    if (this.is_proposal_subscription_required) {
                        if (index > 0) {
                            this.renewProposalsOnPurchase();
                        }
                        await this.waitForProposal(contract_type);
                    }

                    const response = await this.buyContract(contract_type);
                    this.registerBulkPurchase(response, contract_type, index === 0);
                    purchasedCount += 1;
                }
            } catch (error) {
                this.bulkPurchasePending = 0;
                if (purchasedCount > 0) {
                    this.finishBulkPurchasesIfReady();
                    const message =
                        error?.error?.message ||
                        error?.message ||
                        'Bulk purchase stopped after a contract could not be purchased.';
                    this.observer.emit('ui.log.error', message);
                    return;
                }
                this.bulkContractIds = undefined;
                this.bulkContractSellableIds = undefined;
                this.contractId = '';
                throw error;
            }
            this.bulkPurchasePending = 0;
            this.finishBulkPurchasesIfReady();
        }

        async waitForProposal(contract_type) {
            const hasReadyProposal = () =>
                this.store.getState().proposalsReady &&
                this.data.proposals.some(
                    proposal =>
                        proposal.contract_type === contract_type &&
                        proposal.purchase_reference === this.getPurchaseReference()
                );

            if (hasReadyProposal()) {
                return;
            }

            await new Promise((resolve, reject) => {
                const unsubscribe = this.store.subscribe(() => {
                    if (!this.store.getState().proposalsReady) {
                        return;
                    }

                    unsubscribe();
                    try {
                        this.selectProposal(contract_type);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                });
            });
        }

        async buyContract(contract_type) {
            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);
                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });
                return doUntilDone(() => api_base.api.send({ buy: id, price: askPrice }));
            }

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });
            return doUntilDone(() => api_base.api.send(tradeOptionToBuy(contract_type, this.tradeOptions)));
        }

        registerBulkPurchase(response, contract_type, isFirstPurchase) {
            const { buy } = response;
            this.bulkContractIds.push(buy.contract_id);
            this.bulkPurchasePending -= 1;
            this.contractId = buy.contract_id;
            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });
            log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
            info({
                accountID: this.accountInfo.loginid,
                totalRuns: this.updateAndReturnTotalRuns(),
                transaction_ids: { buy: buy.transaction_id },
                contract_type,
                buy_price: buy.buy_price,
            });

            if (isFirstPurchase) {
                this.store.dispatch(purchaseSuccessful());
            }
        }

        purchase(contract_type) {
            // Prevent calling purchase twice
            if (this.store.getState().scope !== BEFORE_PURCHASE) {
                return Promise.resolve();
            }

            const balance = this.getBalance();
            const nextTradeAmount = this.tradeOptions?.amount;
            if (shouldStopTradingForBalance(balance, nextTradeAmount)) {
                const insufficientBalanceMessage = getLocalizedErrorMessage('InsufficientBalance');
                this.observer.emit('ui.log.error', insufficientBalanceMessage);
                this.observer.emit('bot.click_stop');
                return Promise.resolve();
            }

            const onSuccess = response => {
                // Don't unnecessarily send a forget request for a purchased contract.
                const { buy } = response;

                contractStatus({
                    id: 'contract.purchase_received',
                    data: buy.transaction_id,
                    buy,
                });

                this.contractId = buy.contract_id;
                this.store.dispatch(purchaseSuccessful());

                if (this.is_proposal_subscription_required) {
                    this.renewProposalsOnPurchase();
                }

                delayIndex = 0;
                log(LogTypes.PURCHASE, { transaction_id: buy.transaction_id });
                info({
                    accountID: this.accountInfo.loginid,
                    totalRuns: this.updateAndReturnTotalRuns(),
                    transaction_ids: { buy: buy.transaction_id },
                    contract_type,
                    buy_price: buy.buy_price,
                });
            };

            if (this.is_proposal_subscription_required) {
                const { id, askPrice } = this.selectProposal(contract_type);

                const action = () => api_base.api.send({ buy: id, price: askPrice });

                this.isSold = false;

                contractStatus({
                    id: 'contract.purchase_sent',
                    data: askPrice,
                });

                if (!this.options.timeMachineEnabled) {
                    return doUntilDone(action).then(onSuccess);
                }

                return recoverFromError(
                    action,
                    (errorCode, makeDelay) => {
                        // if disconnected no need to resubscription (handled by live-api)
                        if (errorCode !== 'DisconnectError') {
                            this.renewProposalsOnPurchase();
                        } else {
                            this.clearProposals();
                        }

                        const unsubscribe = this.store.subscribe(() => {
                            const { scope, proposalsReady } = this.store.getState();
                            if (scope === BEFORE_PURCHASE && proposalsReady) {
                                makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                                unsubscribe();
                            }
                        });
                    },
                    ['PriceMoved', 'InvalidContractProposal'],
                    delayIndex++
                ).then(onSuccess);
            }
            const trade_option = tradeOptionToBuy(contract_type, this.tradeOptions);
            const action = () => api_base.api.send(trade_option);

            this.isSold = false;

            contractStatus({
                id: 'contract.purchase_sent',
                data: this.tradeOptions.amount,
            });

            if (!this.options.timeMachineEnabled) {
                return doUntilDone(action).then(onSuccess);
            }

            return recoverFromError(
                action,
                (errorCode, makeDelay) => {
                    if (errorCode === 'DisconnectError') {
                        this.clearProposals();
                    }
                    const unsubscribe = this.store.subscribe(() => {
                        const { scope } = this.store.getState();
                        if (scope === BEFORE_PURCHASE) {
                            makeDelay().then(() => this.observer.emit('REVERT', 'before'));
                            unsubscribe();
                        }
                    });
                },
                ['PriceMoved', 'InvalidContractProposal'],
                delayIndex++
            ).then(onSuccess);
        }

        getPurchaseReference = () => purchase_reference;
        regeneratePurchaseReference = () => {
            purchase_reference = getUUID();
        };
    };
