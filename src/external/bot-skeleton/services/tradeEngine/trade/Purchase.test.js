jest.mock('../../api/api-base', () => ({
    api_base: {
        api: {
            send: jest.fn(),
        },
    },
}));

jest.mock('../utils/broadcast', () => ({
    contractStatus: jest.fn(),
    info: jest.fn(),
    log: jest.fn(),
}));

import { api_base } from '../../api/api-base';
import PurchaseMixin from './Purchase';
import { BEFORE_PURCHASE } from './state/constants';

describe('bulk purchase engine', () => {
    const createEngine = () => {
        class Base {}
        const Engine = PurchaseMixin(Base);
        const engine = new Engine();
        let contractId = 100;
        api_base.api.send.mockImplementation(async () => ({
            buy: {
                contract_id: contractId++,
                transaction_id: contractId + 1000,
                buy_price: 1,
            },
        }));
        engine.store = {
            getState: () => ({ scope: BEFORE_PURCHASE }),
            dispatch: jest.fn(),
        };
        engine.getBalance = () => 100;
        engine.tradeOptions = {
            amount: 1,
            basis: 'stake',
            currency: 'USD',
            duration: 1,
            duration_unit: 't',
            symbol: 'R_50',
        };
        engine.options = { timeMachineEnabled: false };
        engine.observer = { emit: jest.fn() };
        engine.accountInfo = { loginid: 'CR123' };
        engine.updateAndReturnTotalRuns = jest.fn(() => 1);
        engine.finishBulkPurchasesIfReady = jest.fn();
        return engine;
    };

    beforeEach(() => {
        api_base.api.send.mockClear();
    });

    it('buys and tracks every requested contract while transitioning into the purchase scope once', async () => {
        const engine = createEngine();

        await engine.purchaseMany(['CALL', 'PUT']);

        expect(api_base.api.send).toHaveBeenCalledTimes(2);
        expect(engine.bulkContractIds).toEqual([100, 101]);
        expect(engine.bulkPurchasePending).toBe(0);
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);
        expect(engine.finishBulkPurchasesIfReady).toHaveBeenCalledTimes(1);
    });

    it('repeats a selected contract for the requested bulk count', async () => {
        const engine = createEngine();

        await engine.purchaseMany(['CALL'], 3);

        expect(api_base.api.send).toHaveBeenCalledTimes(3);
        expect(engine.bulkContractIds).toEqual([100, 101, 102]);
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid bulk counts before submitting a purchase', async () => {
        const engine = createEngine();

        await expect(engine.purchaseMany(['CALL'], 11)).rejects.toThrow(
            'The number of bulk purchases must be between 1 and 10.'
        );
        expect(api_base.api.send).not.toHaveBeenCalled();
    });

    it('reports a later buy failure while continuing to track contracts already opened', async () => {
        const engine = createEngine();
        engine.buyContract = jest
            .fn()
            .mockResolvedValueOnce({ buy: { contract_id: 100, transaction_id: 1100, buy_price: 1 } })
            .mockRejectedValueOnce(new Error('Second purchase failed'));

        await engine.purchaseMany(['CALL'], 2);

        expect(engine.bulkContractIds).toEqual([100]);
        expect(engine.bulkPurchasePending).toBe(0);
        expect(engine.observer.emit).toHaveBeenCalledWith('ui.log.error', 'Second purchase failed');
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('does not transition to the sell scope if the first bulk buy fails', async () => {
        const engine = createEngine();
        engine.buyContract = jest.fn().mockRejectedValue(new Error('Purchase failed'));

        await expect(engine.purchaseMany(['CALL', 'PUT'])).rejects.toThrow('Purchase failed');

        expect(engine.finishBulkPurchasesIfReady).not.toHaveBeenCalled();
        expect(engine.bulkContractIds).toBeUndefined();
        expect(engine.bulkContractSellableIds).toBeUndefined();
        expect(engine.contractId).toBe('');
        expect(engine.store.dispatch).not.toHaveBeenCalled();
    });
});
