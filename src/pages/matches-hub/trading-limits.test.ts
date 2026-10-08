import { getTradingLimitReason } from './trading-limits';

describe('getTradingLimitReason', () => {
    it('stops when realized profit reaches the take-profit limit', () => {
        expect(getTradingLimitReason(5, 10, 5)).toBe('take-profit');
        expect(getTradingLimitReason(4.99, 10, 5)).toBeNull();
    });

    it('stops when realized loss reaches the stop-loss limit', () => {
        expect(getTradingLimitReason(-10, 10, 20)).toBe('stop-loss');
        expect(getTradingLimitReason(-9.99, 10, 20)).toBeNull();
    });
});
