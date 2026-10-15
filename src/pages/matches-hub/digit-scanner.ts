export type DigitContract = 'Matches' | 'Differs';
export type SignalStrength = 'strong' | 'moderate' | 'weak';

export type DigitSignal = {
    digit: number;
    rank: number;
    /** Combined z-score: how far the digit's frequency sits above (Matches) or below (Differs) the 10% baseline. */
    score: number;
    percent: number;
    recentPercent: number;
    /** Ticks since the digit last appeared. */
    gap: number;
    strength: SignalStrength;
};

export type DigitScan = {
    sampleSize: number;
    hasEnoughData: boolean;
    signals: DigitSignal[];
    picks: DigitSignal[];
};

export type MarketScan = {
    symbol: string;
    market: string;
    score: number;
    sampleSize: number;
    picks: DigitSignal[];
};

export const MIN_SCAN_SAMPLE = 50;
const RECENT_WINDOW = 20;
const SCAN_TICK_DELAY_MS = 50;
const BASE_RATE = 0.1;

const zScore = (count: number, total: number) =>
    total ? (count / total - BASE_RATE) / Math.sqrt((BASE_RATE * (1 - BASE_RATE)) / total) : 0;

const getStrength = (score: number): SignalStrength => (score >= 2.5 ? 'strong' : score >= 1.5 ? 'moderate' : 'weak');

/**
 * Scores every digit from a last-digit history. Matches favours digits that are over-represented over both the
 * full sample and the recent window; Differs favours digits that are under-represented. The result describes the
 * observed sample only — the digits are not a prediction of future ticks.
 */
export const scoreDigits = (history: number[], contract: DigitContract, pickCount: number): DigitScan => {
    const digits = history.filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9);
    const sampleSize = digits.length;
    const recent = digits.slice(-RECENT_WINDOW);
    const counts = Array.from({ length: 10 }, () => 0);
    const recentCounts = Array.from({ length: 10 }, () => 0);
    const lastSeen = Array.from({ length: 10 }, () => -1);

    digits.forEach((digit, index) => {
        counts[digit] += 1;
        lastSeen[digit] = index;
    });
    recent.forEach(digit => {
        recentCounts[digit] += 1;
    });

    const direction = contract === 'Matches' ? 1 : -1;
    const signals = Array.from({ length: 10 }, (_, digit) => {
        const fullZ = zScore(counts[digit], sampleSize);
        const recentZ = zScore(recentCounts[digit], recent.length);
        const score = direction * (0.6 * fullZ + 0.4 * recentZ);
        return {
            digit,
            rank: 0,
            score,
            percent: sampleSize ? (counts[digit] / sampleSize) * 100 : 0,
            recentPercent: recent.length ? (recentCounts[digit] / recent.length) * 100 : 0,
            gap: lastSeen[digit] === -1 ? sampleSize : sampleSize - 1 - lastSeen[digit],
            strength: getStrength(score),
        } as DigitSignal;
    })
        .sort((a, b) => b.score - a.score || a.digit - b.digit)
        .map((signal, index) => ({ ...signal, rank: index + 1 }));

    const hasEnoughData = sampleSize >= MIN_SCAN_SAMPLE;
    const count = Math.min(5, Math.max(1, Math.trunc(pickCount) || 1));
    return { sampleSize, hasEnoughData, signals, picks: hasEnoughData ? signals.slice(0, count) : [] };
};

type TickHistoryApi = { send: (request: Record<string, unknown>) => Promise<any> };

type ScanOptions = {
    api: TickHistoryApi;
    markets: Record<string, string>;
    contract: DigitContract;
    pickCount: number;
    tickCount: number;
    selectedDigits?: number[];
    getLastDigit: (price: number | string, pipSize?: number) => number;
    onProgress?: (done: number, total: number, market: string) => void;
    signal?: AbortSignal;
};

type SingleMarketScanOptions = Omit<ScanOptions, 'markets' | 'onProgress' | 'signal'> & {
    market: string;
    symbol: string;
    onProgress?: (analyzed: number, total: number, digit: number) => void;
    analysisDelayMs?: number;
};

/** Scores one market's tick history, optionally limiting results to the user's selected digits. */
export const scanMarket = async ({
    api,
    market,
    symbol,
    contract,
    pickCount,
    tickCount,
    selectedDigits,
    getLastDigit,
    onProgress,
    analysisDelayMs = SCAN_TICK_DELAY_MS,
}: SingleMarketScanOptions): Promise<MarketScan | null> => {
    const raw = await api.send({ ticks_history: symbol, count: tickCount, end: 'latest', style: 'ticks' });
    const response = raw?.data ?? raw;
    if (response?.error) throw new Error(response.error.message ?? `Unable to load tick history for ${market}.`);
    const pipSize = response?.pip_size ?? response?.history?.pip_size;
    const history = ((response?.history?.prices ?? []) as Array<number | string>)
        .map(price => getLastDigit(price, pipSize))
        .filter(digit => Number.isInteger(digit) && digit >= 0 && digit <= 9)
        .slice(-MIN_SCAN_SAMPLE);
    const analyzedHistory: number[] = [];
    for (const [index, digit] of history.entries()) {
        analyzedHistory.push(digit);
        onProgress?.(index + 1, history.length, digit);
        if (analysisDelayMs > 0) {
            await new Promise<void>(resolve => setTimeout(resolve, analysisDelayMs));
        }
    }
    const scan = scoreDigits(analyzedHistory, contract, pickCount);
    if (!scan.hasEnoughData) return null;

    const picks = selectedDigits?.length
        ? [...new Set(selectedDigits)]
            .map(digit => scan.signals.find(signal => signal.digit === digit))
            .filter((signal): signal is DigitSignal => signal !== undefined)
        : scan.picks;
    if (!picks.length) return null;
    const score = picks.reduce((sum, pick) => sum + pick.score, 0) / picks.length;
    return { symbol, market, score, sampleSize: scan.sampleSize, picks };
};

/** Pulls tick history for each provided market and ranks markets by their selected digit signals. */
export const scanMarkets = async ({
    api,
    markets,
    contract,
    pickCount,
    tickCount,
    selectedDigits,
    getLastDigit,
    onProgress,
    signal,
}: ScanOptions): Promise<MarketScan[]> => {
    const entries = Object.entries(markets);
    let done = 0;
    const results = await Promise.all(
        entries.map(async ([market, symbol]) => {
            try {
                return await scanMarket({
                    api,
                    market,
                    symbol,
                    contract,
                    pickCount,
                    tickCount,
                    selectedDigits,
                    getLastDigit,
                    analysisDelayMs: 0,
                });
            } catch (error) {
                console.error(`[DigitScanner] ${market} failed:`, error);
                return null;
            } finally {
                done += 1;
                if (!signal?.aborted) onProgress?.(done, entries.length, market);
            }
        })
    );
    return results.filter((item): item is MarketScan => item !== null).sort((a, b) => b.score - a.score);
};
