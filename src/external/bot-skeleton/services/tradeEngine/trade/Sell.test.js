jest.mock('../../api/api-base', () => ({
    api_base: {
        api: {
            send: jest.fn(),
        },
    },
}));

jest.mock('../utils/broadcast', () => ({
    contractStatus: jest.fn(),
    log: jest.fn(),
}));

jest.mock('../../../utils/observer', () => ({
    observer: {
        emit: jest.fn(),
    },
}));

import { LogTypes } from '../../../constants/messages';
import { api_base } from '../../api/api-base';
import { log } from '../utils/broadcast';
import SellMixin from './Sell';
import { DURING_PURCHASE } from './state/constants';

describe('bulk contract selling', () => {
    const createEngine = () => {
        class Base {}
        const Engine = SellMixin(Base);
        const engine = new Engine();
        engine.store = {
            getState: () => ({ scope: DURING_PURCHASE }),
        };
        engine.bulkContractIds = [100, 101];
        engine.bulkContractSellableIds = [100, 101];
        engine.contractId = 101;
        engine.options = { timeMachineEnabled: false };
        engine.waitForAfter = jest.fn();
        return engine;
    };

    beforeEach(() => {
        api_base.api.send.mockReset();
        log.mockClear();
    });

    it('waits for each sold contract update before selling the next contract', async () => {
        const engine = createEngine();
        let resolveFirstStatus;
        const firstStatusRequest = new Promise(resolve => {
            resolveFirstStatus = resolve;
        });
        api_base.api.send
            .mockResolvedValueOnce({ sell: { sold_for: 2 } })
            .mockImplementationOnce(() => firstStatusRequest)
            .mockResolvedValueOnce({ sell: { sold_for: 3 } })
            .mockResolvedValueOnce({ proposal_open_contract: { is_sold: true } });

        let sellCompleted = false;
        const sellPromise = engine.sellAtMarket().then(() => {
            sellCompleted = true;
        });
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(api_base.api.send).toHaveBeenCalledTimes(2);
        expect(sellCompleted).toBe(false);

        resolveFirstStatus({ proposal_open_contract: { is_sold: true } });
        await sellPromise;

        expect(api_base.api.send).toHaveBeenCalledTimes(4);
        expect(log).toHaveBeenCalledWith(LogTypes.SELL, { sold_for: 2 });
        expect(log).toHaveBeenCalledWith(LogTypes.SELL, { sold_for: 3 });
    });
});
