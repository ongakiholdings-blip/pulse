import {
    allTicksMoveInDirection,
    compareDigit,
    getDigitFrequency,
    getDigitFrequencyRanking,
    getDigitPercentage,
    getDirectionPercentage,
} from './analysis-utils';
import TicksMixin from './Ticks';

describe('tick analysis utilities', () => {
    it('compares digits using each supported comparison', () => {
        expect(compareDigit(3, 'lt', 4)).toBe(true);
        expect(compareDigit(3, 'lte', 3)).toBe(true);
        expect(compareDigit(3, 'eq', 3)).toBe(true);
        expect(compareDigit(4, 'gte', 3)).toBe(true);
        expect(compareDigit(4, 'gt', 3)).toBe(true);
        expect(() => compareDigit(3, 'invalid', 3)).toThrow('Unsupported digit comparison');
    });

    it('selects most and least frequent digits with ascending tie breaks', () => {
        expect(getDigitFrequency([2, 2, 1, 1, 1], 'most')).toBe(1);
        expect(getDigitFrequency([2, 2, 1, 1, 1], 'least')).toBe(0);
        expect(getDigitFrequency([4, 4, 7, 7], 'most')).toBe(4);
        expect(getDigitFrequencyRanking([4, 4, 7, 7], 'most').slice(0, 2)).toEqual([4, 7]);
        expect(getDigitFrequencyRanking([4, 4, 7, 7], 'least').slice(0, 2)).toEqual([0, 1]);
    });

    it('calculates even, odd, over, under, match, and differ percentages', () => {
        const digits = [0, 1, 4, 5];
        expect(getDigitPercentage(digits, 'even')).toBe(50);
        expect(getDigitPercentage(digits, 'odd')).toBe(50);
        expect(getDigitPercentage(digits, 'over', 3)).toBe(50);
        expect(getDigitPercentage(digits, 'under', 3)).toBe(50);
        expect(getDigitPercentage(digits, 'match', 5)).toBe(25);
        expect(getDigitPercentage(digits, 'differ', 5)).toBe(75);
        expect(getDigitPercentage([], 'even')).toBe(0);
    });

    it('checks consecutive tick direction and computes rise/fall percentages', () => {
        const ticks = [{ quote: 1 }, { quote: 2 }, { quote: 2 }, { quote: 1 }];
        expect(allTicksMoveInDirection(ticks.slice(0, 2), 'rise')).toBe(true);
        expect(allTicksMoveInDirection(ticks, 'rise')).toBe(false);
        expect(getDirectionPercentage(ticks, 'rise')).toBeCloseTo(33.333);
        expect(getDirectionPercentage(ticks, 'fall')).toBeCloseTo(33.333);
        expect(getDirectionPercentage([], 'rise')).toBe(0);
    });
});

describe('trade engine analysis blocks', () => {
    const createEngine = ticks => {
        const Engine = TicksMixin(class {});
        const engine = new Engine();
        engine.getTicks = jest.fn().mockResolvedValue(ticks);
        engine.getLastDigitsFromList = recentTicks => recentTicks.map(tick => tick.digit);
        return engine;
    };

    it('returns the requested digit counting back from the latest tick', async () => {
        const engine = createEngine([{ quote: 1, digit: 4 }, { quote: 2, digit: 7 }, { quote: 3, digit: 9 }]);

        await expect(engine.getNthLastDigit(2)).resolves.toBe(7);
    });

    it('runs digit condition, frequency, and percentage analysis on the selected recent window', async () => {
        const engine = createEngine([
            { quote: 1, digit: 2 },
            { quote: 2, digit: 4 },
            { quote: 3, digit: 4 },
            { quote: 4, digit: 7 },
        ]);

        await expect(engine.analyzeLastDigitsCondition(2, 'gte', 4)).resolves.toBe(true);
        await expect(engine.analyzeDigitFrequency('most', 4)).resolves.toBe(4);
        await expect(engine.analyzeDigitFrequencyRanking('most', 4)).resolves.toEqual([
            4, 2, 7, 0, 1, 3, 5, 6, 8, 9,
        ]);
        await expect(engine.analyzeDigitPercentage('even', 4)).resolves.toBe(75);
        await expect(engine.analyzeDigitPercentage('over', 4, 4)).resolves.toBe(25);
        await expect(engine.analyzeDigitPercentage('match', 4, 4)).resolves.toBe(50);
        await expect(engine.analyzeDigitPercentage('differ', 4, 4)).resolves.toBe(50);
    });

    it('analyzes consecutive rise/fall moves and their percentages', async () => {
        const engine = createEngine([
            { quote: 2, digit: 1 },
            { quote: 1, digit: 2 },
            { quote: 2, digit: 3 },
            { quote: 3, digit: 4 },
        ]);

        await expect(engine.analyzeLastTicksDirection(3, 'rise')).resolves.toBe(true);
        await expect(engine.analyzeLastTicksDirection(4, 'rise')).resolves.toBe(false);
        await expect(engine.analyzeDirectionPercentage('rise', 4)).resolves.toBeCloseTo(66.667);
        await expect(engine.analyzeDirectionPercentage('fall', 4)).resolves.toBeCloseTo(33.333);
    });

    it('rejects invalid digit values and analysis windows above available history', async () => {
        const engine = createEngine([{ quote: 1, digit: 1 }]);

        await expect(engine.analyzeLastDigitsCondition(1, 'eq', 10)).rejects.toMatchObject({
            code: 'DigitExpected',
        });
        await expect(engine.analyzeDigitFrequency('most', 1001)).rejects.toMatchObject({
            code: 'AnalysisWindowExceeded',
        });
    });
});
