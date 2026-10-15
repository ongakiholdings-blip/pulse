import { MIN_SCAN_SAMPLE, scanMarket, scanMarkets, scoreDigits } from './digit-scanner';

const biased = (digit: number, length = 500) =>
    Array.from({ length }, (_, index) => (index % 3 === 0 ? digit : index % 10));

describe('scoreDigits', () => {
    it('requires a minimum sample', () => {
        const scan = scoreDigits([1, 2, 3], 'Matches', 2);
        expect(scan.hasEnoughData).toBe(false);
        expect(scan.picks).toEqual([]);
    });

    it('picks the over-represented digit for Matches', () => {
        const scan = scoreDigits(biased(7), 'Matches', 1);
        expect(scan.picks[0]).toMatchObject({ digit: 7, rank: 1, strength: 'strong' });
    });

    it('picks the under-represented digit for Differs', () => {
        const history = Array.from({ length: 500 }, (_, index) => [0, 1, 2, 3, 4, 5, 6, 7, 8][index % 9]);
        expect(scoreDigits(history, 'Differs', 1).picks[0].digit).toBe(9);
    });

    it('returns the requested number of distinct picks and reports the gap', () => {
        const history = [...biased(4, MIN_SCAN_SAMPLE + 50), 2];
        const scan = scoreDigits(history, 'Matches', 3);
        expect(new Set(scan.picks.map(pick => pick.digit)).size).toBe(3);
        expect(scan.signals.find(signal => signal.digit === 2)?.gap).toBe(0);
    });
});

describe('market scanning', () => {
    it('scans only the selected market and limits picks to the user-selected digits', async () => {
        const api = {
            send: jest.fn(async () => ({ history: { prices: biased(3) } })),
        };
        const onProgress = jest.fn();
        const result = await scanMarket({
            api,
            market: 'Volatility 100 Index',
            symbol: 'R_100',
            contract: 'Matches',
            pickCount: 5,
            tickCount: 50,
            selectedDigits: [7, 3],
            getLastDigit: price => Number(price),
            onProgress,
            analysisDelayMs: 0,
        });

        expect(api.send).toHaveBeenCalledTimes(1);
        expect(api.send).toHaveBeenCalledWith({
            ticks_history: 'R_100',
            count: 50,
            end: 'latest',
            style: 'ticks',
        });
        expect(result?.picks.map(pick => pick.digit)).toEqual([7, 3]);
        expect(result?.sampleSize).toBe(50);
        expect(onProgress).toHaveBeenCalledTimes(50);
        expect(onProgress).toHaveBeenLastCalledWith(50, 50, expect.any(Number));
    });

    it('ranks markets by their strongest picks and skips failed ones', async () => {
        const histories: Record<string, number[]> = { AAA: biased(3), BBB: Array.from({ length: 500 }, (_, i) => i % 10) };
        const api = {
            send: jest.fn(async (request: any) => {
                if (request.ticks_history === 'CCC') throw new Error('boom');
                return { history: { prices: histories[request.ticks_history] } };
            }),
        };
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const results = await scanMarkets({
            api,
            markets: { A: 'AAA', B: 'BBB', C: 'CCC' },
            contract: 'Matches',
            pickCount: 1,
            tickCount: 500,
            getLastDigit: price => Number(price),
        });
        expect(results.map(result => result.market)).toEqual(['A', 'B']);
        expect(results[0].picks[0].digit).toBe(3);
    });
});
