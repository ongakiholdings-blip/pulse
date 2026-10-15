import OpenContractMixin from './OpenContract';

describe('multi-contract tracking', () => {
    const createEngine = () => {
        class Base {}
        const Engine = OpenContractMixin(Base);
        return new Engine();
    };

    it('recognizes all active contract IDs without matching missing IDs', () => {
        const engine = createEngine();
        engine.contractId = 202;
        engine.bulkContractIds = [201, 202];

        expect(engine.expectedContractId(201)).toBe(true);
        expect(engine.expectedContractId(202)).toBe(true);
        expect(engine.expectedContractId(203)).toBe(false);
        expect(engine.expectedContractId(undefined)).toBe(false);
    });

    it('moves to the next strategy scope only after the final bulk contract closes', () => {
        const engine = createEngine();
        engine.bulkContractIds = [];
        engine.bulkContractSellableIds = [];
        engine.bulkPurchasePending = 0;
        engine.contractId = 201;
        engine.store = { dispatch: jest.fn() };
        engine.afterPromise = jest.fn();

        engine.finishBulkPurchasesIfReady();

        expect(engine.bulkContractIds).toBeUndefined();
        expect(engine.bulkContractSellableIds).toBeUndefined();
        expect(engine.contractId).toBe('');
        expect(engine.afterPromise).toHaveBeenCalledTimes(1);
        expect(engine.store.dispatch).toHaveBeenCalledTimes(1);
    });

    it('keeps a bulk group open while more contract buys are still pending', () => {
        const engine = createEngine();
        engine.bulkContractIds = [];
        engine.bulkPurchasePending = 1;
        engine.store = { dispatch: jest.fn() };

        engine.finishBulkPurchasesIfReady();

        expect(engine.bulkContractIds).toEqual([]);
        expect(engine.store.dispatch).not.toHaveBeenCalled();
    });
});
