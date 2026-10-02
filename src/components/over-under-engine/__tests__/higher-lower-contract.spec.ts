import { formatHigherLowerBarrier, getHigherLowerContractType } from '../higher-lower-contract';

describe('Higher/Lower contract requests', () => {
    it('maps Higher to CALL and Lower to PUT', () => {
        expect(getHigherLowerContractType('higher')).toBe('HIGHER');
        expect(getHigherLowerContractType('lower')).toBe('LOWER');
    });

    it('formats a Higher barrier as a positive relative barrier', () => {
        expect(formatHigherLowerBarrier('64.640', 'HIGHER')).toBe('+64.640');
        expect(formatHigherLowerBarrier('-64.640', 'HIGHER')).toBe('+64.640');
    });

    it('formats a Lower barrier as a negative relative barrier', () => {
        expect(formatHigherLowerBarrier('64.640', 'LOWER')).toBe('-64.640');
        expect(formatHigherLowerBarrier('+64.640', 'LOWER')).toBe('-64.640');
    });

    it('rejects empty, zero, and malformed barriers', () => {
        expect(() => formatHigherLowerBarrier('', 'HIGHER')).toThrow();
        expect(() => formatHigherLowerBarrier('0', 'HIGHER')).toThrow();
        expect(() => formatHigherLowerBarrier('1e-3', 'LOWER')).toThrow();
    });
});
