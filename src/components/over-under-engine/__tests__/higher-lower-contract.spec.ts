import { formatHigherLowerBarrier, getHigherLowerContractType } from '../higher-lower-contract';

describe('Higher/Lower contract requests', () => {
    it('maps Higher to CALL and Lower to PUT', () => {
        expect(getHigherLowerContractType('higher')).toBe('CALL');
        expect(getHigherLowerContractType('lower')).toBe('PUT');
    });

    it('formats a Higher barrier as a positive relative barrier', () => {
        expect(formatHigherLowerBarrier('64.640', 'CALL')).toBe('+64.640');
        expect(formatHigherLowerBarrier('-64.640', 'CALL')).toBe('+64.640');
    });

    it('formats a Lower barrier as a negative relative barrier', () => {
        expect(formatHigherLowerBarrier('64.640', 'PUT')).toBe('-64.640');
        expect(formatHigherLowerBarrier('+64.640', 'PUT')).toBe('-64.640');
    });

    it('rejects empty, zero, and malformed barriers', () => {
        expect(() => formatHigherLowerBarrier('', 'CALL')).toThrow();
        expect(() => formatHigherLowerBarrier('0', 'CALL')).toThrow();
        expect(() => formatHigherLowerBarrier('1e-3', 'PUT')).toThrow();
    });
});
