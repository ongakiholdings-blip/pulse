export type DigitRanking = {
    digit: number;
    rank: number;
    observedCount: number;
    observedPercent: number;
    weightedPercent: number;
};

export type DigitRankingResult = {
    sampleSize: number;
    hasEnoughData: boolean;
    rankedDigits: DigitRanking[];
    recommendations: DigitRanking[];
};

export const MIN_DIGIT_RANKING_SAMPLE = 10;

export const rankObservedDigits = (history: number[], candidateCount: number): DigitRankingResult => {
    const count = Math.min(5, Math.max(1, Math.trunc(candidateCount) || 1));
    const validHistory = history.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const observedCounts = Array.from({ length: 10 }, () => 0);
    const weightedCounts = Array.from({ length: 10 }, () => 0);
    let totalWeight = 0;

    validHistory.forEach((digit, index) => {
        const weight = index + 1;
        observedCounts[digit] += 1;
        weightedCounts[digit] += weight;
        totalWeight += weight;
    });

    const sampleSize = validHistory.length;
    const rankedDigits = Array.from({ length: 10 }, (_, digit) => ({
        digit,
        rank: 0,
        observedCount: observedCounts[digit],
        observedPercent: sampleSize ? (observedCounts[digit] / sampleSize) * 100 : 0,
        weightedPercent: totalWeight ? (weightedCounts[digit] / totalWeight) * 100 : 0,
    }))
        .sort((left, right) => right.weightedPercent - left.weightedPercent || left.digit - right.digit)
        .map((item, index) => ({ ...item, rank: index + 1 }));
    const hasEnoughData = sampleSize >= MIN_DIGIT_RANKING_SAMPLE;

    return {
        sampleSize,
        hasEnoughData,
        rankedDigits,
        recommendations: hasEnoughData ? rankedDigits.slice(0, count) : [],
    };
};
