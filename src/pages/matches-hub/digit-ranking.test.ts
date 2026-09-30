import { MIN_DIGIT_RANKING_SAMPLE, rankObservedDigits } from './digit-ranking';

describe('rankObservedDigits', () => {
    it('returns exactly the requested number of unique recommendations', () => {
        const result = rankObservedDigits([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3);

        expect(result.recommendations).toHaveLength(3);
        expect(new Set(result.recommendations.map(item => item.digit)).size).toBe(3);
    });

    it('ranks by recency-weighted observed frequency', () => {
        const result = rankObservedDigits([1, 1, 2, 2, 2, 1, 1, 1, 1, 2], 2);

        expect(result.recommendations.map(item => item.digit)).toEqual([1, 2]);
        expect(result.rankedDigits[0].weightedPercent).toBeGreaterThan(result.rankedDigits[1].weightedPercent);
    });

    it('breaks equal-score ties by ascending digit', () => {
        const result = rankObservedDigits(Array(10).fill(7), 5);

        expect(result.recommendations.map(item => item.digit)).toEqual([7, 0, 1, 2, 3]);
    });

    it('does not recommend digits without a sufficient sample', () => {
        const result = rankObservedDigits([9, 9, 8, 8], 2);

        expect(result.hasEnoughData).toBe(false);
        expect(result.sampleSize).toBe(4);
        expect(result.recommendations).toEqual([]);
        expect(result.rankedDigits.slice(0, 2).map(item => item.digit)).toEqual([8, 9]);
    });

    it('handles empty and invalid history safely', () => {
        const result = rankObservedDigits([], 5);
        const invalidResult = rankObservedDigits([-1, 10, Number.NaN], 1);

        expect(result.sampleSize).toBe(0);
        expect(result.recommendations).toEqual([]);
        expect(result.rankedDigits[0].digit).toBe(0);
        expect(invalidResult.sampleSize).toBe(0);
    });

    it('enforces a minimum sample of ten valid ticks', () => {
        expect(MIN_DIGIT_RANKING_SAMPLE).toBe(10);
        expect(rankObservedDigits(Array(9).fill(3), 1).hasEnoughData).toBe(false);
        expect(rankObservedDigits(Array(10).fill(3), 1).hasEnoughData).toBe(true);
    });
});
