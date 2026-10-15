const percentage = (count, total) => (total === 0 ? 0 : (count / total) * 100);

export const compareDigit = (digit, operator, target) => {
    switch (operator) {
        case 'lt':
            return digit < target;
        case 'lte':
            return digit <= target;
        case 'eq':
            return digit === target;
        case 'gte':
            return digit >= target;
        case 'gt':
            return digit > target;
        default:
            throw new Error(`Unsupported digit comparison: ${operator}`);
    }
};

export const getDigitFrequencyRanking = (digits, mode = 'most') => {
    const counts = Array(10).fill(0);
    digits.forEach(digit => {
        if (Number.isInteger(digit) && digit >= 0 && digit <= 9) counts[digit] += 1;
    });
    const sorted = Array.from({ length: 10 }, (_, digit) => digit).sort((a, b) => {
        const difference = mode === 'least' ? counts[a] - counts[b] : counts[b] - counts[a];
        return difference || a - b;
    });
    return sorted;
};

export const getDigitFrequency = (digits, mode = 'most') => getDigitFrequencyRanking(digits, mode)[0];

export const getDigitPercentage = (digits, mode, target) => {
    const matchingDigits = digits.filter(digit => {
        if (mode === 'even') return digit % 2 === 0;
        if (mode === 'odd') return digit % 2 !== 0;
        if (mode === 'over') return digit > target;
        if (mode === 'under') return digit < target;
        if (mode === 'match') return digit === target;
        if (mode === 'differ') return digit !== target;
        throw new Error(`Unsupported digit analysis mode: ${mode}`);
    });
    return percentage(matchingDigits.length, digits.length);
};

const getTickDirections = ticks =>
    ticks.slice(1).map((tick, index) => {
        if (tick.quote > ticks[index].quote) return 'rise';
        if (tick.quote < ticks[index].quote) return 'fall';
        return 'unchanged';
    });

export const allTicksMoveInDirection = (ticks, direction) => {
    const directions = getTickDirections(ticks);
    return directions.length > 0 && directions.every(tickDirection => tickDirection === direction);
};

export const getDirectionPercentage = (ticks, direction) => {
    const directions = getTickDirections(ticks);
    const count = directions.filter(tickDirection => tickDirection === direction).length;
    return percentage(count, directions.length);
};
