import { getRoundedNumber } from '@/components/shared';
import { api_base } from '../../api/api-base';
import { contract as broadcastContract, contractStatus } from '../utils/broadcast';
import { openContractReceived, sell } from './state/actions';

export default Engine =>
    class OpenContract extends Engine {
        observeOpenContract() {
            if (!api_base.api) return;
            const subscription = api_base.api.onMessage().subscribe(({ data }) => {
                if (data.msg_type === 'proposal_open_contract') {
                    const contract = data.proposal_open_contract;

                    if (!contract || !this.expectedContractId(contract?.contract_id)) {
                        return;
                    }

                    this.setContractFlags(contract);

                    this.data.contract = contract;
                    if (Array.isArray(this.bulkContractIds)) {
                        this.bulkContractSellableIds = this.bulkContractSellableIds.filter(
                            id => id !== contract.contract_id
                        );
                        if (!contract.is_sold && contract.is_valid_to_sell) {
                            this.bulkContractSellableIds.push(contract.contract_id);
                        }
                    }

                    broadcastContract({ accountID: api_base.account_info.loginid, ...contract });

                    const is_sold = Boolean(contract.is_sold);

                    if (is_sold) {
                        clearTimeout(this.transaction_recovery_timeout);
                        this.updateTotals(contract);
                        contractStatus({
                            id: 'contract.sold',
                            data: contract.transaction_ids.sell,
                            contract,
                        });

                        if (Array.isArray(this.bulkContractIds)) {
                            this.bulkContractIds = this.bulkContractIds.filter(id => id !== contract.contract_id);
                            this.bulkContractSellableIds = this.bulkContractSellableIds.filter(
                                id => id !== contract.contract_id
                            );
                            if (this.bulkContractIds.length > 0) {
                                this.contractId = this.bulkContractIds[this.bulkContractIds.length - 1];
                                return;
                            }
                            if (this.bulkPurchasePending > 0) {
                                this.contractId = '';
                                return;
                            }
                            this.finishBulkPurchasesIfReady();
                            return;
                        }

                        this.contractId = '';
                        if (this.afterPromise) this.afterPromise();
                        this.store.dispatch(sell());
                    } else {
                        this.store.dispatch(openContractReceived());
                    }
                }
            });
            api_base.pushSubscription(subscription);
        }

        waitForAfter() {
            return new Promise(resolve => {
                this.afterPromise = resolve;
            });
        }

        setContractFlags(contract) {
            const { is_expired, is_valid_to_sell, is_sold, entry_tick } = contract;
            this.isSold = Boolean(is_sold);
            this.isSellAvailable = !Boolean(is_sold) && Boolean(is_valid_to_sell);
            this.isExpired       = Boolean(is_expired);
            this.hasEntryTick    = Boolean(entry_tick);
        }

        expectedContractId(contractId) {
            return (
                (this.contractId && contractId === this.contractId) ||
                (Array.isArray(this.bulkContractIds) && this.bulkContractIds.includes(contractId))
            );
        }

        finishBulkPurchasesIfReady() {
            if (
                !Array.isArray(this.bulkContractIds) ||
                this.bulkContractIds.length > 0 ||
                this.bulkPurchasePending > 0
            ) {
                return;
            }

            this.bulkContractIds = undefined;
            this.bulkContractSellableIds = undefined;
            this.contractId = '';
            if (this.afterPromise) this.afterPromise();
            this.store.dispatch(sell());
        }

        getSellPrice() {
            const { bid_price: bidPrice, buy_price: buyPrice, currency } = this.data.contract;
            return getRoundedNumber(Number(bidPrice) - Number(buyPrice), currency);
        }
    };
