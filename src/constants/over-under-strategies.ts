// ─── Over/Under AI Strategy Engine — shared strategy definitions ──────────────
//
// These definitions power both the Strategy tab (education / reference) and
// the Over/Under trading engine itself, so the bot can automatically apply
// the entry filters, staking discipline, and recovery method described for
// each strategy instead of only running the fixed Over 5 / Under 4 pair.

export type StrategyId = 'dual' | 'confidence' | 'over1' | 'over2' | 'under8' | 'under7' | 'even' | 'odd';

export type RecoveryMethod = 'martingale' | 'dalembert' | 'flat';

export interface StrategyTip {
    title: string;
    body: string;
}

export interface StrategyDefinition {
    id: StrategyId;
    label: string;
    badge: string;
    badgeColor: string;
    /** API contract_type, null for the dual Over5/Under4 mode (handled separately) */
    contractType: 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | null;
    barrier: string | null;
    winProbabilityPct: number;
    risk: string;
    recovery: RecoveryMethod;
    /** Recommended base stake as a percentage of account balance */
    recommendedStakePct: number;
    /** Take-profit target in account currency units for this strategy */
    takeProfit: number;
    /** Stop-loss limit in account currency units for this strategy */
    stopLoss: number;
    /** Digits that, when they appear, should pause/skip entry (unfavourable cluster) */
    cautionDigits: number[];
    /** Max combined frequency (%) of cautionDigits over the recent window before pausing entry */
    cautionThresholdPct: number;
    intro: string;
    tips: StrategyTip[];
    note: string;
}

export const STRATEGY_DEFINITIONS: Record<Exclude<StrategyId, 'dual'>, StrategyDefinition> = {
    confidence: {
        id: 'confidence',
        label: 'Confidence Gate',
        badge: 'CONF',
        badgeColor: '#f97316',
        contractType: null,
        barrier: null,
        winProbabilityPct: 75,
        risk: 'Medium',
        recovery: 'martingale',
        recommendedStakePct: 1.5,
        takeProfit: 5,
        stopLoss: 10,
        cautionDigits: [4, 5],
        cautionThresholdPct: 35,
        intro:
            'Trade only when the remaining digit distribution outside 4 and 5 exceeds the configured confidence threshold. This keeps entries focused on the cleanest market conditions and suppresses weak 4/5-heavy cycles.',
        tips: [
            { title: '1. Measure the clean-market share', body: 'The engine sums the percentages for digits 0, 1, 2, 3, 6, 7, 8, and 9 and compares that value to your threshold. If the share of clean digits is below the required level, the bot waits instead of forcing an entry.' },
            { title: '2. Keep 4 and 5 out of the trigger', body: 'The strategy ignores 4 and 5 when calculating confidence. This avoids trading during the exact middle-digit clusters that are known to create noisy, low-quality entries.' },
            { title: '3. Use a strict threshold', body: 'Set the threshold carefully. Higher values reduce false entries but also reduce the number of trades. A moderate threshold keeps the bot selective without leaving it idle for long stretches.' },
        ],
        note: 'Confidence is computed from the combined percentage of digits excluding 4 and 5. Trade only when that percentage meets or exceeds the configured threshold.',
    },
    over1: {
        id: 'over1',
        label: 'Over 1',
        badge: '↑ > 1',
        badgeColor: '#10b981',
        contractType: 'DIGITOVER',
        barrier: '1',
        winProbabilityPct: 80,
        risk: 'Low',
        recovery: 'martingale',
        recommendedStakePct: 2,
        takeProfit: 5,
        stopLoss: 10,
        cautionDigits: [0, 1],
        cautionThresholdPct: 30,
        intro:
            'The Over 1 contract wins when the last digit of the exit tick is 2, 3, 4, 5, 6, 7, 8, or 9 — giving you an 80% base win probability. It is one of the most conservative digit trades available.',
        tips: [
            { title: '1. Use it as a base recovery layer', body: 'Because the win rate is high (~80%), Over 1 is ideal as the first step in a recovery sequence. Start with a small stake and only escalate if you hit the rare losing streak. A 3-step recovery ladder (1×, 2×, 4×) covers up to 3 consecutive losses while staying well inside most balance limits.' },
            { title: '2. Avoid during high volatility spikes', body: 'Even with 80% odds, a volatile market can produce clusters of ticks ending in 0 or 1. Monitor the Digit Frequency Analyzer — if 0 and 1 have appeared more than 30% of the last 20 ticks combined, pause and wait for the distribution to normalise before entering.' },
            { title: '3. Set a strict stop-loss in units, not money', body: 'Define your stop-loss as a number of consecutive losses (e.g. 3) rather than a dollar amount. After 3 losses in a row, stop the bot and review the digit frequency before resuming. This prevents the martingale multiplier from compounding into an unrecoverable drawdown.' },
            { title: '4. Pair with a profit-lock target', body: 'Set a take-profit at 10–15% of your session balance. Once hit, stop the bot and bank the gains. The high frequency of small wins in Over 1 means targets are reached quickly; staying too long increases the chance of a bad cluster erasing the session profit.' },
            { title: '5. Best on low-volatility synthetic indices', body: 'Volatility 10 (V10) and Volatility 10(1s) tend to produce smoother digit distributions than V75 or V100. Over 1 performs most consistently on these lower-volatility instruments where extreme ticks are rare.' },
        ],
        note: 'Win probability is approximately 80%. Always verify digit distribution before entering.',
    },
    over2: {
        id: 'over2',
        label: 'Over 2',
        badge: '↑ > 2',
        badgeColor: '#3b82f6',
        contractType: 'DIGITOVER',
        barrier: '2',
        winProbabilityPct: 70,
        risk: 'Low–Medium',
        recovery: 'martingale',
        recommendedStakePct: 1.5,
        takeProfit: 4,
        stopLoss: 8,
        cautionDigits: [0, 1, 2],
        cautionThresholdPct: 35,
        intro:
            'Over 2 wins when the last digit of the exit tick is 3 through 9 — a 70% base win probability. It offers a better payout than Over 1 while still sitting on the favourable side of the distribution.',
        tips: [
            { title: '1. Use a 2-step martingale maximum', body: 'With a 70% win rate, losing runs of 2 are common enough to plan for but runs of 4+ are rare. Cap your recovery multiplier at 2 steps (e.g. 1→2.5→6.25). Going deeper increases risk disproportionately; if you hit step 3 losses in a row, take the loss and reset to base stake.' },
            { title: '2. Exploit cold digits', body: 'Open the Digit Frequency Analyzer and look for digits 0, 1, or 2 that have appeared significantly more than the expected 10% each over the last 50 ticks. A "cold" run for those digits means the market has been unfavourable to you — but reversion is expected, making Over 2 entries more timely.' },
            { title: '3. Trade in short bursts of 10–20 contracts', body: 'Over 2 works best in short bursts rather than continuous running. Set the bot for 10–20 trades, evaluate the net result, then decide whether to continue. This limits exposure to any sustained adverse pattern while locking in gains from winning bursts.' },
            { title: '4. Scale stake to 1–2% of balance', body: 'The slightly lower win rate than Over 1 means your balance can dip faster on bad runs. Keep the base stake at 1–2% of your account balance. Use the Stake Calculator tab to compute the exact figure before starting any session.' },
            { title: '5. Cross-instrument confirmation', body: 'Before running Over 2 on one index, glance at the digit frequency on a related index. If V25 and V25(1s) both show digits 0–2 are hot, a broader pattern may be at play. Wait for one index to show a cleaner distribution before committing.' },
        ],
        note: 'Win probability is approximately 70%. Short sessions and strict stake sizing reduce variance significantly.',
    },
    under8: {
        id: 'under8',
        label: 'Under 8',
        badge: '↓ < 8',
        badgeColor: '#f59e0b',
        contractType: 'DIGITUNDER',
        barrier: '8',
        winProbabilityPct: 80,
        risk: 'Low',
        recovery: 'martingale',
        recommendedStakePct: 2,
        takeProfit: 5,
        stopLoss: 10,
        cautionDigits: [8, 9],
        cautionThresholdPct: 30,
        intro:
            'Under 8 wins when the last digit of the exit tick is 0 through 7 — an 80% base win probability, mirroring Over 1 on the lower end of the scale. It is equally conservative and suits the same recovery-first approach.',
        tips: [
            { title: '1. Mirror your Over 1 settings', body: 'Under 8 and Over 1 are near-symmetric. If your Over 1 bot uses a 2% base stake and a 3-step recovery, apply the same parameters to Under 8. Running both simultaneously on different instruments can smooth out your overall P&L curve since adverse clusters rarely affect both at the same time.' },
            { title: '2. Watch for digit 8 and 9 hot streaks', body: 'Under 8 loses only on 8 or 9. Track their combined frequency in the Digit Frequency Analyzer. If 8+9 exceed 30% of the last 30 ticks, the current tick pattern is unfavourable — pause until their frequency drops back toward the expected 20%.' },
            { title: '3. Use as a hedge against Over strategies', body: 'Under 8 naturally hedges an Over 1 position on a different instrument. When your Over 1 bot is recovering from a loss sequence, an Under 8 bot on a second instrument provides concurrent wins that offset the recovery cost — reducing the effective drawdown on your combined balance.' },
            { title: '4. Set maximum consecutive loss alerts', body: 'Even at 80%, a run of 4 consecutive losses is possible. Configure the engine to stop after 3–4 consecutive losses on Under 8, review the tick history, and only resume once the digit distribution looks normal again.' },
            { title: '5. Prioritise 1-second tick indices for volume', body: 'Volatility 10(1s) and Volatility 25(1s) generate ticks every second. For Under 8, this means faster trade resolution and more opportunities per hour. Higher volume at low stake compounds profits more quickly than slow-tick instruments — but apply the same stop-loss rules.' },
        ],
        note: 'Win probability is approximately 80%. Symmetric to Over 1 — identical risk management rules apply.',
    },
    under7: {
        id: 'under7',
        label: 'Under 7',
        badge: '↓ < 7',
        badgeColor: '#ec4899',
        contractType: 'DIGITUNDER',
        barrier: '7',
        winProbabilityPct: 70,
        risk: 'Low–Medium',
        recovery: 'martingale',
        recommendedStakePct: 1,
        takeProfit: 4,
        stopLoss: 8,
        cautionDigits: [7, 8, 9],
        cautionThresholdPct: 40,
        intro:
            'Under 7 wins when the last digit of the exit tick is 0 through 6 — a 70% base win probability, symmetric with Over 2. It offers improved payouts versus Under 8 in exchange for a slightly higher loss frequency.',
        tips: [
            { title: '1. Combine with Over 2 for a balanced session', body: 'Running Under 7 and Over 2 concurrently on two different instruments at the same base stake creates a near-balanced book: both win on the majority of ticks while their losing digits (7–9 and 0–2 respectively) rarely cluster together across different instruments. Net drawdown is typically lower than running either alone.' },
            { title: '2. Use a digit-frequency entry filter', body: 'Before each Under 7 session, check the last 30 ticks. If digits 7, 8, or 9 have appeared more than 12 times combined (>40%), skip the session. Enter only when the high digits are at or below their expected 30% combined frequency, giving you a statistically cleaner starting point.' },
            { title: '3. Apply a flat-stake approach for longer sessions', body: 'Unlike martingale recovery, a flat-stake approach on Under 7 relies purely on the 70% win rate to generate profit over volume. Set stake to 0.5–1% of balance and run 50–100 trades without multiplier escalation. The positive expected value handles profitability; the lower stake handles variance.' },
            { title: '4. Monitor payout ratio before each run', body: 'Under 7 payouts vary by instrument and market conditions. Always verify the payout is high enough that expected value (0.7 × payout − 0.3 × stake) is positive before starting. If the payout drops below ~1.30× your stake, the edge disappears — switch instruments or wait.' },
            { title: '5. Avoid stacking with Under 8 on the same instrument', body: 'Running Under 7 and Under 8 on the same instrument at the same time doubles your exposure to the same digit distribution. If a cluster of high digits hits, both bots lose simultaneously, amplifying drawdown. Always run them on different instruments or at different times to maintain diversification.' },
        ],
        note: 'Win probability is approximately 70%. Symmetric to Over 2 — apply the same stake sizing discipline.',
    },
    even: {
        id: 'even',
        label: 'Even',
        badge: '≡ EVEN',
        badgeColor: '#8b5cf6',
        contractType: 'DIGITEVEN',
        barrier: null,
        winProbabilityPct: 50,
        risk: 'Medium',
        recovery: 'dalembert',
        recommendedStakePct: 0.5,
        takeProfit: 3,
        stopLoss: 6,
        cautionDigits: [1, 3, 5, 7, 9],
        cautionThresholdPct: 55,
        intro:
            'The Even contract wins when the last digit of the exit tick is 0, 2, 4, 6, or 8 — a theoretical 50% win probability. Because the payout is close to 2× stake, profitability over time is driven entirely by edge, discipline, and streak management rather than raw win rate.',
        tips: [
            { title: "1. Never run Even without a digit frequency check first", body: 'Even and Odd are pure 50/50 contracts with no structural edge — so timing matters more than with Over/Under strategies. Enter only when even digits are at or above their expected 50% frequency over the last 50 ticks.' },
            { title: "2. Use a strict 3-step D'Alembert recovery, not martingale", body: 'Because Even is a 50/50 bet, martingale doubles your stake after every loss and can reach dangerous levels in just 5–6 bad ticks. D\'Alembert increases stake by one unit after a loss and decreases by one unit after a win, flattening the recovery curve.' },
            { title: '3. Target small profit per session — stop at +5%', body: 'With a 50% win rate, profit only comes from disciplined target-setting, not volume. Set a session profit target of 5% of your balance and stop the bot the moment it is hit.' },
            { title: '4. Alternate between Even and Odd based on recent history', body: 'If the last 10 ticks produced 7 or more even digits, switch your next session to Odd instead of Even, exploiting mean reversion in the digit distribution.' },
            { title: '5. Choose 1-second tick indices for maximum sample speed', body: 'Volatility 10(1s) and Volatility 25(1s) generate one tick per second, giving 3× more trades per session than their standard counterparts — reaching profit targets and stop-losses faster.' },
        ],
        note: 'Win probability is exactly 50%. Edge comes from entry timing, session discipline, and recovery method — not from the contract itself.',
    },
    odd: {
        id: 'odd',
        label: 'Odd',
        badge: '≢ ODD',
        badgeColor: '#f97316',
        contractType: 'DIGITODD',
        barrier: null,
        winProbabilityPct: 50,
        risk: 'Medium',
        recovery: 'dalembert',
        recommendedStakePct: 0.5,
        takeProfit: 3,
        stopLoss: 6,
        cautionDigits: [0, 2, 4, 6, 8],
        cautionThresholdPct: 55,
        intro:
            'The Odd contract wins when the last digit of the exit tick is 1, 3, 5, 7, or 9 — a theoretical 50% win probability, symmetric with Even. All Even strategies apply in mirror, with the entry filter flipped to favour odd digit frequency.',
        tips: [
            { title: '1. Enter when odd digits are running hot', body: 'Count how many of the last 50 ticks ended in an odd digit. If odd digits account for 53% or more of the sample, the current distribution slightly favours you.' },
            { title: '2. Keep base stake at 0.5% of balance — lower than Even', body: 'Odd can generate slightly longer losing streaks in practice on low-volatility indices. Keep the base stake at 0.5% of balance and only scale up after 10 consecutive winning sessions.' },
            { title: '3. Use the streak rule: stop after 4 consecutive losses', body: 'On a 50/50 contract, 4 consecutive losses have roughly a 6.25% probability per 4-trade sequence — common enough to plan for. Stop the bot completely after 4 losses in a row.' },
            { title: '4. Pair Odd on one instrument with Even on another', body: 'Running Odd on V10 and Even on V25 simultaneously creates a natural hedge since the two instruments use independent price feeds.' },
            { title: '5. Flat stake beats martingale over 100+ trades', body: 'Backtesting on Deriv synthetic indices consistently shows that flat-stake Odd trading outperforms martingale Odd trading over sessions longer than 100 trades.' },
        ],
        note: 'Win probability is exactly 50%. Mirror of Even — flip the entry filter to look for odd digit dominance in the last 50 ticks before entering.',
    },
};

export const STRATEGY_ORDER: Exclude<StrategyId, 'dual'>[] = ['over1', 'over2', 'under8', 'under7', 'even', 'odd'];

export function getStrategyEntryDigits(id: StrategyId): number[] {
    switch (id) {
        case 'dual': return [4, 5];
        case 'over1': return [1, 3, 4, 5, 6];
        case 'over2': return [2];
        case 'under8': return [8];
        case 'under7': return [7];
        case 'even': return [0, 2, 4, 6, 8];
        case 'odd': return [1, 3, 5, 7, 9];
        default: return [4, 5];
    }
}

export function matchesStrategyEntrySequence(id: StrategyId, recentDigits: number[]): boolean {
    if (recentDigits.length < 2) return false;
    const prev = recentDigits[recentDigits.length - 2];
    const current = recentDigits[recentDigits.length - 1];

    switch (id) {
        case 'confidence':
            return false;
        case 'over1': {
            if (recentDigits.length < 3) return false;
            const lastThree = recentDigits.slice(-3);
            return lastThree.every(d => d >= 0 && d <= 2);
        }
        case 'over2':
            return prev < 2 && current < 2;
        case 'under8':
            if (recentDigits.length < 4) return false;
            {
                const lastFour = recentDigits.slice(-4);
                return lastFour.slice(0, 3).every(d => [7, 8, 9].includes(d))
                    && [3, 4, 5, 6, 7].includes(lastFour[3]);
            }
        case 'under7':
            return prev > 7 && current > 7;
        case 'even': {
            if (recentDigits.length < 3) return false;
            return recentDigits.slice(-3).every(d => d % 2 === 1);
        }
        case 'odd': {
            if (recentDigits.length < 3) return false;
            return recentDigits.slice(-3).every(d => d % 2 === 0);
        }
        default:
            return false;
    }
}

/** Returns true if the digit is a "winning" digit for the given strategy. */
export function isWinningDigit(id: Exclude<StrategyId, 'dual'>, digit: number): boolean {
    switch (id) {
        case 'confidence': return digit !== 4 && digit !== 5;
        case 'over1': return digit > 1;
        case 'over2': return digit > 2;
        case 'under8': return digit < 8;
        case 'under7': return digit < 7;
        case 'even': return digit % 2 === 0;
        case 'odd': return digit % 2 === 1;
        default: return false;
    }
}

/** Checks whether recent tick digits show an unfavourable cluster that should pause entry. */
export function isCautionCluster(def: StrategyDefinition, recentDigits: number[]): boolean {
    if (recentDigits.length === 0) return false;
    const hits = recentDigits.filter(d => def.cautionDigits.includes(d)).length;
    return (hits / recentDigits.length) * 100 > def.cautionThresholdPct;
}
