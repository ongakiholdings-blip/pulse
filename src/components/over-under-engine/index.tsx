import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-toastify';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { contract_stages } from '@/constants/contract-stage';
import {
    STRATEGY_DEFINITIONS,
    getStrategyEntryDigits,
    matchesStrategyEntrySequence,
    isWinningDigit,
    isCautionCluster,
    type StrategyId,
} from '@/constants/over-under-strategies';
import { localize } from '@deriv-com/translations';
import { botNotification, sessionCompleteNotification } from '@/components/bot-notification/bot-notification';
import ChartWrapper from '@/pages/chart/chart-wrapper';
import {
    formatHigherLowerBarrier,
    getHigherLowerContractType,
    type HigherLowerContractType,
} from './higher-lower-contract';
import './over-under-engine.scss';

// ─── constants ────────────────────────────────────────────────────────────────

const OVER_BARRIER  = '5';
const UNDER_BARRIER = '4';
const MAX_DIGITS    = 30;
const DIGIT_WINDOW  = 1000;
type MarketTradingMode = 'all' | 'selected';

function isAlternatingMiddlePair(first: number | undefined, second: number | undefined): boolean {
    return (first === 4 && second === 5) || (first === 5 && second === 4);
}

function hasPowerEntrySequence(digits: number[]): boolean {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(digit => digit < 4) || lastThree.every(digit => digit > 5);
}

export interface Market { symbol: string; label: string; short: string; code: string; }

export const MARKETS: Market[] = [
    { symbol: '1HZ10V',  label: 'Volatility 10 (1s) Index',  short: 'V10 (1s)',  code: '10\n(1s)'  },
    { symbol: '1HZ15V',  label: 'Volatility 15 (1s) Index',  short: 'V15 (1s)',  code: '15\n(1s)'  },
    { symbol: '1HZ25V',  label: 'Volatility 25 (1s) Index',  short: 'V25 (1s)',  code: '25\n(1s)'  },
    { symbol: '1HZ30V',  label: 'Volatility 30 (1s) Index',  short: 'V30 (1s)',  code: '30\n(1s)'  },
    { symbol: '1HZ50V',  label: 'Volatility 50 (1s) Index',  short: 'V50 (1s)',  code: '50\n(1s)'  },
    { symbol: '1HZ75V',  label: 'Volatility 75 (1s) Index',  short: 'V75 (1s)',  code: '75\n(1s)'  },
    { symbol: '1HZ90V',  label: 'Volatility 90 (1s) Index',  short: 'V90 (1s)',  code: '90\n(1s)'  },
    { symbol: '1HZ100V', label: 'Volatility 100 (1s) Index', short: 'V100 (1s)', code: '100\n(1s)' },
    { symbol: 'R_10',    label: 'Volatility 10 Index',        short: 'V10',       code: '10'        },
    { symbol: 'R_25',    label: 'Volatility 25 Index',        short: 'V25',       code: '25'        },
    { symbol: 'R_50',    label: 'Volatility 50 Index',        short: 'V50',       code: '50'        },
    { symbol: 'R_75',    label: 'Volatility 75 Index',        short: 'V75',       code: '75'        },
    { symbol: 'R_100',   label: 'Volatility 100 Index',       short: 'V100',      code: '100'       },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function getDecimalPlaces(pipSize: number): number {
    if (!Number.isFinite(pipSize) || pipSize <= 0) return 0;
    // api_base.pip_sizes stores the already-normalized decimal count
    // (for example 3 means three places), while some tick payloads expose
    // the increment itself (for example 0.001).
    if (Number.isInteger(pipSize) && pipSize >= 1) return pipSize;
    const asString = pipSize.toString();
    if (asString.includes('e-')) return Number(asString.split('e-')[1]);
    return asString.split('.')[1]?.length ?? 0;
}

function formatQuote(quote: number | string, pipSize?: number): string {
    const rawQuote = String(quote).trim();
    const value = Number(rawQuote);
    if (!Number.isFinite(value)) return rawQuote;

    const decimalPlaces = getDecimalPlaces(Number(pipSize));
    if (decimalPlaces === 0) return rawQuote;

    // Do not use toFixed here: it rounds a quote before the last digit is
    // read (for example 123.4567 would become 123.457). Deriv quotes already
    // carry the market precision; when a numeric quote has lost trailing
    // zeroes, pad them back without changing any supplied digits.
    const [integerPart, decimalPart = ''] = rawQuote.split('.');
    if (decimalPart.length >= decimalPlaces) return rawQuote;
    return `${integerPart}.${decimalPart.padEnd(decimalPlaces, '0')}`;
}

function getLastDigit(quote: number | string, pipSize?: number): number | null {
    const s = formatQuote(quote, pipSize);
    const lastChar = s[s.length - 1];
    const digit = Number(lastChar);
    return Number.isInteger(digit) && digit >= 0 && digit <= 9 ? digit : null;
}

function getApiData(message: any): any {
    // The Deriv API observable emits { data: response }; keeping the fallback
    // makes this component tolerant of the direct response shape used by mocks.
    return message?.data ?? message;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

function getGroupedDigitCounts(digits: number[]) {
    const under4 = digits.filter(d => d <= 3).length;
    const middle = digits.filter(d => d === 4 || d === 5).length;
    const over5 = digits.filter(d => d >= 6).length;
    return { under4, middle, over5 };
}

function evaluateDualGroupSignal(digits: number[], threshold = 70) {
    const last20 = digits.slice(-20);
    const last5 = digits.slice(-5);
    const counts = getGroupedDigitCounts(last20);
    const recent = last20.slice(-10);
    const recentCounts = getGroupedDigitCounts(recent);
    const extremeTotal = counts.under4 + counts.over5;
    const recentExtremeTotal = recentCounts.under4 + recentCounts.over5;
    const middleCount20 = counts.middle;
    const middleCount5 = last5.filter(d => d === 4 || d === 5).length;
    const middleDominant20 = middleCount20 > 6;
    const middleDominant10 = recentCounts.middle >= 5;
    const recentMiddleTrigger = middleCount5 === 1;
    const repeatedMiddleRisk = middleCount5 >= 3;
    const frequencyEdge = (extremeTotal - counts.middle) / 20;
    const recentMomentum = (recentExtremeTotal - recentCounts.middle) / 10;
    const middlePressure = counts.middle / 20;
    const underBias = (counts.under4 - counts.over5) / 20;

    const confidence = Math.max(
        0,
        Math.min(
            100,
            50 + frequencyEdge * 100 + recentMomentum * 50 + underBias * 25 - middlePressure * 80
        )
    );

    const strongAdvantage = extremeTotal > counts.middle + 6 && counts.middle <= 7;
    const recentStrength = recentExtremeTotal > recentCounts.middle + 2 && !middleDominant10;
    const shouldTrade =
        last20.length >= 20 &&
        !middleDominant20 &&
        !repeatedMiddleRisk &&
        recentMiddleTrigger &&
        strongAdvantage &&
        recentStrength &&
        confidence >= threshold;

    return {
        ...counts,
        recentUnder4: recentCounts.under4,
        recentMiddle: recentCounts.middle,
        recentOver5: recentCounts.over5,
        middleCount20,
        middleCount5,
        middleDominant20,
        middleDominant10,
        recentMiddleTrigger,
        repeatedMiddleRisk,
        confidence,
        shouldTrade,
    };
}

function evaluateConfidenceGateSignal(digits: number[], threshold = 70) {
    const recent20 = digits.slice(-20);
    const recent5 = digits.slice(-5);
    if (recent20.length < 20) {
        return {
            confidence: 0,
            shouldTrade: false,
            middleCount20: 0,
            middleCount5: 0,
            cleanDigits: 0,
            threshold,
        };
    }

    const middleCount20 = recent20.filter(d => d === 4 || d === 5).length;
    const middleCount5 = recent5.filter(d => d === 4 || d === 5).length;
    const cleanDigits = recent20.filter(d => d !== 4 && d !== 5).length;
    const confidence = (cleanDigits / recent20.length) * 100;
    const blockedByMiddle = middleCount20 > 6 || middleCount5 >= 3;
    const validEntryWindow = middleCount5 === 1;
    const shouldTrade = !blockedByMiddle && validEntryWindow && confidence >= threshold;

    return {
        confidence,
        shouldTrade,
        middleCount20,
        middleCount5,
        cleanDigits,
        threshold,
    };
}

// ─── types ────────────────────────────────────────────────────────────────────

interface EngineState {
    running:              boolean;
    baseStake:            number;
    martingale:           number;
    takeProfit:           number;
    stopLoss:             number;
    overStake:            number;
    underStake:           number;
    totalProfit:          number;
    overWins:             number;
    overLosses:           number;
    underWins:            number;
    underLosses:          number;
    overContractIds:      number[];
    underContractIds:     number[];
    overSettledIds:       number[];
    underSettledIds:      number[];
    overSettled:          boolean;
    underSettled:         boolean;
    overSubId:            string | null;
    underSubId:           string | null;
    tickSubId:            string | null;
    roundInFlight:        boolean;
    // entry-point
    useEntryMode:         boolean;
    waitingForEntry:      boolean;
    entryDigit:           number | null;
    // hidden power-engine trigger (Over 5 / Under 4 card only) — see startEngine
    powerEngineActive:    boolean;
    powerAwaitingTrigger: boolean;
    dualEntryPending:    boolean;
    // per-round profit tracking
    currentRoundOverStake:  number;
    currentRoundUnderStake: number;
    overRoundProfit:        number | null;
    underRoundProfit:       number | null;
    // dual (Over 5 / Under 4) martingale: only escalates when BOTH legs lose
    // in the same round — tracked per round, applied once at round-complete.
    overRoundAnyWin:        boolean;
    underRoundAnyWin:       boolean;
    roundCounter:           number;
    // AI strategy engine
    strategyId:             StrategyId;
    consecutiveLosses:      number;
    martingaleEnabled:      boolean;
}

function makeInitState(
    stake: number,
    martingale: number,
    tp: number,
    sl: number,
    useEntry: boolean,
    strategyId: StrategyId = 'dual',
    martingaleEnabled = true,
): EngineState {
    return {
        running: false,
        baseStake: stake,
        martingale,
        takeProfit: tp,
        stopLoss: sl,
        overStake: stake,
        underStake: stake,
        totalProfit: 0,
        overWins: 0,
        overLosses: 0,
        underWins: 0,
        underLosses: 0,
        overContractIds: [],
        underContractIds: [],
        overSettledIds: [],
        underSettledIds: [],
        overSettled: true,
        underSettled: true,
        overSubId: null,
        underSubId: null,
        tickSubId: null,
        roundInFlight: false,
        useEntryMode: useEntry,
        waitingForEntry: useEntry,
        entryDigit: null,
        powerEngineActive: false,
        powerAwaitingTrigger: false,
        dualEntryPending: false,
        currentRoundOverStake: stake,
        currentRoundUnderStake: stake,
        overRoundProfit: null,
        underRoundProfit: null,
        overRoundAnyWin: false,
        underRoundAnyWin: false,
        roundCounter: 0,
        strategyId,
        consecutiveLosses: 0,
        martingaleEnabled,
    };
}

// ─── component ────────────────────────────────────────────────────────────────

const OverUnderEngine: React.FC = observer(() => {
    const { client, chart_store, dashboard, transactions, run_panel, summary_card, ui } = useStore();

    // Config
    const [stake, setStake]           = useState('0.5');
    const [tradeDuration, setTradeDuration] = useState('1');
    // A multiplier of 1 keeps the next stake equal to the base stake.
    // Users can increase it explicitly for any selected strategy.
    const [martingale, setMartingale] = useState('1');
    const [martingaleEnabled, setMartingaleEnabled] = useState(false);
    const [takeProfit, setTakeProfit] = useState('5');
    const [stopLoss, setStopLoss]     = useState('5');
    const [bulkEnabled, setBulkEnabled] = useState(false);
    const [bulkCount, setBulkCount] = useState('3');
    const [symbol, setSymbol]         = useState('1HZ10V');
    const [marketTradingMode, setMarketTradingMode] = useState<MarketTradingMode>('all');
    const [marketOpen, setMarketOpen] = useState(false);
    const [entryMode, setEntryMode]   = useState(false);
    const [powerEngineEnabled, setPowerEngineEnabled] = useState(false);
    const [lastSignalConfidence, setLastSignalConfidence] = useState<number | null>(null);
    // AI strategy engine — 'dual' keeps the original Over 5 / Under 4 pair,
    // any other value runs a single-leg strategy using the recommendations
    // from the Strategy tab (entry filter, recovery method, stake sizing).
    const [strategyId, setStrategyId] = useState<StrategyId>('dual');
    const [strategySelected, setStrategySelected] = useState(false);
    const [higherLowerSelected, setHigherLowerSelected] = useState(false);
    const [onlyUpsDownsSelected, setOnlyUpsDownsSelected] = useState(false);
    const [higherLowerSide, setHigherLowerSide] = useState<'higher' | 'lower' | 'both'>('higher');
    const [higherLowerStake, setHigherLowerStake] = useState('2');
    const [higherLowerBarrier, setHigherLowerBarrier] = useState('');
    const [higherLowerBarrierStatus, setHigherLowerBarrierStatus] = useState('Loading market barrier…');
    const [higherLowerDuration, setHigherLowerDuration] = useState('5');
    const [higherLowerBulkEnabled, setHigherLowerBulkEnabled] = useState(false);
    const [higherLowerBulkCount, setHigherLowerBulkCount] = useState('3');
    const [higherLowerStatus, setHigherLowerStatus] = useState('Ready to buy');
    const [higherLowerRunning, setHigherLowerRunning] = useState(false);
    const [higherLowerTakeProfit, setHigherLowerTakeProfit] = useState('5');
    const [higherLowerStopLoss, setHigherLowerStopLoss] = useState('5');
    const [onlyUpsDownsStake, setOnlyUpsDownsStake] = useState('2');
    const [onlyUpsDownsDuration, setOnlyUpsDownsDuration] = useState('2');
    const [onlyUpsDownsBulkEnabled, setOnlyUpsDownsBulkEnabled] = useState(false);
    const [onlyUpsDownsBulkCount, setOnlyUpsDownsBulkCount] = useState('3');
    const [onlyUpsDownsStatus, setOnlyUpsDownsStatus] = useState('Ready to buy');
    const [onlyUpsDownsRunning, setOnlyUpsDownsRunning] = useState(false);
    const [onlyUpsDownsTakeProfit, setOnlyUpsDownsTakeProfit] = useState('5');
    const [onlyUpsDownsStopLoss, setOnlyUpsDownsStopLoss] = useState('5');
    const higherLowerStopRef = useRef(false);
    const onlyUpsDownsStopRef = useRef(false);
    const [singleWins, setSingleWins]     = useState(0);
    const [singleLosses, setSingleLosses] = useState(0);
    const [singleStake, setSingleStake]   = useState(0.5);
    const [lastSingleResult, setLastSingleResult] = useState<'won' | 'lost' | null>(null);
    const [lastSkipReason, setLastSkipReason] = useState<string | null>(null);

    // Display state
    const [isRunning, setIsRunning]                       = useState(false);
    const [statusMsg, setStatusMsg]                       = useState('Ready to trade');
    const [digits, setDigits]                             = useState<number[]>([]);
    const [digitWindow, setDigitWindow]                   = useState<number[]>([]);
    const [currentDigit, setCurrentDigit]                 = useState<number | null>(null);
    const [prices, setPrices]                             = useState<string[]>([]);
    const [totalProfit, setTotalProfit]                   = useState(0);
    const [overWins, setOverWins]                         = useState(0);
    const [overLosses, setOverLosses]                     = useState(0);
    const [underWins, setUnderWins]                       = useState(0);
    const [underLosses, setUnderLosses]                   = useState(0);
    const [overCurrentStake, setOverCurrentStake]         = useState(0.5);
    const [underCurrentStake, setUnderCurrentStake]       = useState(0.5);
    const [lastOverResult, setLastOverResult]             = useState<'won' | 'lost' | null>(null);
    const [lastUnderResult, setLastUnderResult]           = useState<'won' | 'lost' | null>(null);
    const [isWaitingEntry, setIsWaitingEntry]             = useState(false);
    const [lastEntryDigit, setLastEntryDigit]             = useState<number | null>(null);

    const [dropdownPos, setDropdownPos] = useState<{
        top: number;
        left: number;
        right: number | 'auto';
        maxHeight: number;
    } | null>(null);

    const stakeValue = Number(stake) || 0;
    const martingaleValue = Number(martingale);
    const takeProfitValue = Number(takeProfit) || 0;
    const stopLossValue = Number(stopLoss) || 0;
    const eng              = useRef<EngineState>(makeInitState(stakeValue, martingaleValue, takeProfitValue, stopLossValue, entryMode, strategyId, martingaleEnabled));
    const msgSub           = useRef<{ unsubscribe: () => void } | null>(null);
    const passiveSub       = useRef<{ unsubscribe: () => void } | null>(null);
    const passiveTickId    = useRef<string | null>(null);
    // Track which api_base.api instance the passiveSub is using so we can
    // detect when api_base.init() replaces it with a new instance (reconnect,
    // account switch, window-focus reconnect) and restart the subscription.
    const passiveApiRef    = useRef<any>(null);
    // Set to true when stopPassiveSub is called before the subscription ID has
    // arrived — signals that the next resolved ID must be immediately forgotten.
    const pendingForget    = useRef<boolean>(false);
    const fireRoundRef     = useRef<() => void>(() => {});
    // Tracks the current position in MARKETS while the engine auto-cycles
    // through every market — one trade per market, then rotates to the next.
    const marketCycleIndexRef   = useRef(0);
    const advanceMarketCycleRef = useRef<() => void>(() => {});
    const symbolRef        = useRef(symbol);
    const digitWindowRef   = useRef<number[]>([]);
    const subscriptionGenerationRef = useRef(0);
    const latestDigitRef   = useRef<number | null>(null);   // always the most recent tick digit
    const latestQuoteRef   = useRef<{ symbol: string; quote: number } | null>(null);
    const lastTickAtRef    = useRef(0);
    const marketTriggerRef = useRef<HTMLButtonElement>(null);
    const marketDropdownRef = useRef<HTMLDivElement>(null);
    useEffect(() => { symbolRef.current = symbol; }, [symbol]);

    // Close dropdown on outside click — must exclude both the trigger and the portaled dropdown
    useEffect(() => {
        if (!marketOpen) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            const inTrigger  = marketTriggerRef.current?.closest('.oue__market-selector')?.contains(target);
            const inDropdown = marketDropdownRef.current?.contains(target);
            if (!inTrigger && !inDropdown) setMarketOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [marketOpen]);

    const openMarket = useCallback(() => {
        if (isRunning) return;
        if (!marketOpen && marketTriggerRef.current) {
            const rect = marketTriggerRef.current.getBoundingClientRect();
            const MARGIN = 8;
            const isMobile = window.matchMedia('(max-width: 640px)').matches;
            const desiredHeight = Math.min(window.innerHeight * 0.7, 352);

            if (isMobile) {
                const spaceBelow = window.innerHeight - rect.bottom - MARGIN * 2;
                const spaceAbove = rect.top - MARGIN * 2;
                const openBelow = spaceBelow >= Math.min(desiredHeight, 260) || spaceBelow >= spaceAbove;
                const maxHeight = Math.max(180, Math.min(desiredHeight, openBelow ? spaceBelow : spaceAbove));

                setDropdownPos({
                    top: openBelow ? rect.bottom + MARGIN : Math.max(MARGIN, rect.top - maxHeight - MARGIN),
                    left: MARGIN,
                    right: MARGIN,
                    maxHeight,
                });
            } else {
                const DROPDOWN_W = 320; // min-width: 20rem ≈ 320px
                let left = rect.right - DROPDOWN_W;
                left = Math.max(MARGIN, Math.min(left, window.innerWidth - DROPDOWN_W - MARGIN));
                setDropdownPos({ top: rect.bottom + MARGIN, left, right: 'auto', maxHeight: 352 });
            }
        }
        setMarketOpen(o => !o);
    }, [isRunning, marketOpen]);

    // ── cleanup ───────────────────────────────────────────────────────────────

    const forgetId = useCallback((id: string | null) => {
        if (id && api_base.api) {
            try { (api_base.api as any).send({ forget: id }); } catch { /* ignore */ }
        }
    }, []);

    // ── passive tick subscription (always on when API ready) ─────────────────

    const stopPassiveSub = useCallback(() => {
        if (passiveTickId.current && api_base.api) {
            try { (api_base.api as any).send({ forget: passiveTickId.current }); } catch { /* ignore */ }
            passiveTickId.current = null;
        } else if (passiveSub.current) {
            // The subscription ID hasn't arrived yet — flag it so startPassiveSub
            // can forget the server-side subscription as soon as the ID resolves.
            pendingForget.current = true;
        }
        if (passiveSub.current) { passiveSub.current.unsubscribe(); passiveSub.current = null; }
    }, []);

    const cleanupSubs = useCallback(() => {
        const e = eng.current;
        forgetId(e.overSubId);
        forgetId(e.underSubId);
        e.overSubId  = null;
        e.underSubId = null;
        if (msgSub.current) { msgSub.current.unsubscribe(); msgSub.current = null; }
    }, [forgetId]);

    // ── stop ──────────────────────────────────────────────────────────────────

    const stopEngine = useCallback((reason: string) => {
        eng.current.running       = false;
        eng.current.roundInFlight = false;
        eng.current.waitingForEntry = false;
        cleanupSubs();
        setIsRunning(false);
        setIsWaitingEntry(false);
        setStatusMsg(reason);

        // Mirror run-panel stop: reset global running state and re-enable account switching
        run_panel.setIsRunning(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        (ui as any)?.setAccountSwitcherDisabledMessage?.();
        (ui as any)?.setPromptHandler?.(false);
    }, [cleanupSubs, run_panel, ui]);

    const getAutomaticHigherLowerBarrier = useCallback(async (
        symbol: string,
        side: 'higher' | 'lower' = 'higher',
        duration = Number(higherLowerDuration) || 5
    ): Promise<string> => {
        const contractType = getHigherLowerContractType(side);
        const currency = (api_base as any).account_info?.currency || (client as any)?.currency || 'USD';
        const response = await (api_base.api as any).send({
            proposal: 1,
            amount: Number(higherLowerStake) || 2,
            basis: 'stake',
            contract_type: contractType,
            currency,
            duration,
            duration_unit: 't',
            underlying_symbol: symbol,
        });
        const proposal = response?.proposal;
        const barrier =
            proposal?.barrier ??
            (side === 'higher' ? proposal?.high_barrier : proposal?.low_barrier);
        if (barrier === undefined || barrier === null || barrier === '') {
            throw new Error(`Deriv did not return a live ${side} barrier for this market`);
        }
        return formatHigherLowerBarrier(String(barrier), contractType);
    }, [client, higherLowerDuration, higherLowerStake]);

    useEffect(() => {
        let cancelled = false;
        const symbol = chart_store.symbol;
        if (!symbol) return () => { cancelled = true; };

        setHigherLowerBarrierStatus('Loading market barrier…');
        void getAutomaticHigherLowerBarrier(symbol, higherLowerSide === 'lower' ? 'lower' : 'higher')
            .then(barrier => {
                if (cancelled) return;
                setHigherLowerBarrier(barrier);
                setHigherLowerBarrierStatus(`Automatic barrier: ${barrier}`);
            })
            .catch(() => {
                if (cancelled) return;
                setHigherLowerBarrier('');
                setHigherLowerBarrierStatus('');
            });

        return () => { cancelled = true; };
    }, [chart_store.symbol, getAutomaticHigherLowerBarrier, higherLowerSide]);

    const finalizeDirectionalEngine = useCallback((label: string, setRunning: (value: boolean) => void, setStatus: (value: string) => void, isManualStop = false) => {
        run_panel.setIsRunning(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        (ui as any)?.setAccountSwitcherDisabledMessage?.();
        (ui as any)?.setPromptHandler?.(false);
        setRunning(false);
        if (isManualStop) {
            setStatus(`${label} stopped manually`);
        }
    }, [run_panel, ui]);

    const runDirectionalTrading = useCallback(async ({
        amount, duration, bulk, sides, barrier, takeProfit, stopLoss, setStatus, setRunning, stopRef, label,
    }: {
        amount: number; duration: number; bulk: number; sides: string[]; barrier?: string;
        takeProfit: number; stopLoss: number; setStatus: (value: string) => void; label: string;
        setRunning: (value: boolean) => void; stopRef: React.MutableRefObject<boolean>;
    }) => {
        const api = api_base.api as any;
        if (!api) return;
        stopRef.current = false;
        let pnl = 0;
        run_panel.run_id = `run-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
        run_panel.toggleDrawer(true);
        (ui as any)?.setAccountSwitcherDisabledMessage?.(
            localize('Account switching is disabled while your bot is running. Please stop your bot before switching accounts.')
        );
        (ui as any)?.setPromptHandler?.(true);
        setRunning(true);
        setStatus(`Running ${label}…`);
        while (!stopRef.current) {
            if ((takeProfit > 0 && pnl >= takeProfit) || (stopLoss > 0 && pnl <= -stopLoss)) break;
            const requests = sides.flatMap(contractType => {
                const sideBarrier =
                    barrier && (contractType === 'HIGHER' || contractType === 'LOWER')
                        ? formatHigherLowerBarrier(barrier, contractType)
                        : barrier;
                return Array.from({ length: bulk }, () => ({
                    contractType,
                    barrier: sideBarrier,
                    request: {
                        buy: '1',
                        price: amount,
                        parameters: {
                            amount,
                            basis: 'stake',
                            contract_type: contractType,
                            currency: (api_base as any).account_info?.currency || (client as any)?.currency || 'USD',
                            duration,
                            duration_unit: 't',
                            ...(sideBarrier ? { barrier: sideBarrier } : {}),
                            underlying_symbol: chart_store.symbol || '1HZ10V',
                        },
                    },
                }));
            });
            try {
                const responses = await Promise.all(requests.map(({ request }) => api.send(request)));
                const contracts = responses.map(response => response?.buy?.contract_id).filter(Boolean);
                if (!contracts.length) throw new Error('No contracts were purchased');
                responses.forEach((response, index) => {
                    const buy = response?.buy;
                    if (!buy?.contract_id) return;
                    const request = requests[index];
                    transactions.onBotContractEvent({
                        ...buy,
                        contract_id: buy.contract_id,
                        contract_type: buy.contract_type ?? request.contractType,
                        barrier: buy.barrier ?? request.barrier ?? '',
                        underlying_symbol: chart_store.symbol || '1HZ10V',
                        currency: buy.currency ?? (api_base as any).account_info?.currency ?? 'USD',
                        buy_price: buy.buy_price ?? amount,
                        date_start: buy.date_start ?? buy.purchase_time ?? Math.floor(Date.now() / 1000),
                        status: 'open',
                        profit: 0,
                        transaction_ids: {
                            ...(buy.transaction_ids ?? {}),
                            buy: buy.transaction_id ?? buy.transaction_ids?.buy ?? buy.contract_id,
                        },
                    } as any);
                });
                setStatus(`${label} running — ${contracts.length} contract(s) open | P&L ${pnl.toFixed(2)}`);
                const results = await Promise.all(contracts.map(async (contractId: number) => {
                    for (;;) {
                        if (stopRef.current) return 0;
                        const response = await api.send({ proposal_open_contract: 1, contract_id: contractId });
                        const contract = response?.proposal_open_contract;
                        if (contract?.is_sold || contract?.is_expired || ['won', 'lost', 'sold'].includes(contract?.status)) {
                            return Number(contract.profit) || 0;
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                }));
                pnl = round2(pnl + results.reduce((sum, value) => sum + value, 0));
                setStatus(`${label} running — cumulative P&L ${pnl.toFixed(2)}`);
            } catch (error: any) {
                setStatus(error?.error?.message || error?.message || `${label} failed`);
                finalizeDirectionalEngine(label, setRunning, setStatus);
                return;
            }
        }
        setRunning(false);
        run_panel.setIsRunning(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        (ui as any)?.setAccountSwitcherDisabledMessage?.();
        (ui as any)?.setPromptHandler?.(false);
        if (stopRef.current) setStatus(`${label} stopped manually — P&L ${pnl.toFixed(2)}`);
        else if (takeProfit > 0 && pnl >= takeProfit) setStatus(`${label} take profit reached: ${pnl.toFixed(2)}`);
        else if (stopLoss > 0 && pnl <= -stopLoss) setStatus(`${label} stop loss reached: ${pnl.toFixed(2)}`);
        else setStatus(`${label} stopped — P&L ${pnl.toFixed(2)}`);
    }, [chart_store.symbol, client, finalizeDirectionalEngine, run_panel, transactions, ui]);

    const buyHigherLower = useCallback(async () => {
        const amount = Number(higherLowerStake);
        const duration = Number(higherLowerDuration);
        const bulk = higherLowerBulkEnabled ? Number(higherLowerBulkCount) : 1;
        const takeProfit = Number(higherLowerTakeProfit) || 0;
        const stopLoss = Number(higherLowerStopLoss) || 0;
        if (!api_base.api) {
            setHigherLowerStatus('Not connected — please log in first');
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(duration) || duration < 1 ||
            !Number.isInteger(bulk) || bulk < 1) {
            setHigherLowerStatus('Enter valid stake, duration, and bulk values');
            return;
        }

        const sides: HigherLowerContractType[] =
            higherLowerSide === 'both'
                ? [getHigherLowerContractType('higher'), getHigherLowerContractType('lower')]
                : [getHigherLowerContractType(higherLowerSide)];
        const symbol = chart_store.symbol || '1HZ10V';
        const barrier = higherLowerBarrier.trim();
        if (!barrier || !/^[+-]?\d+(?:\.\d+)?$/.test(barrier) || Number(barrier) === 0) {
            setHigherLowerStatus('Enter a valid barrier, for example +64.64 or -64.64');
            return;
        }

        run_panel.run_id = `run-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
        run_panel.toggleDrawer(true);
        (ui as any)?.setAccountSwitcherDisabledMessage?.(
            localize('Account switching is disabled while your bot is running. Please stop your bot before switching accounts.')
        );
        (ui as any)?.setPromptHandler?.(true);

        void runDirectionalTrading({
            amount, duration, bulk, sides, barrier, takeProfit, stopLoss, setRunning: setHigherLowerRunning,
            stopRef: higherLowerStopRef,
            setStatus: setHigherLowerStatus,
            label: 'Higher/Lower',
        });
    }, [chart_store.symbol, higherLowerBarrier, higherLowerBulkCount, higherLowerBulkEnabled, higherLowerDuration, higherLowerSide, higherLowerStake, higherLowerStopLoss, higherLowerTakeProfit, runDirectionalTrading, run_panel, ui]);

    const buyOnlyUpsDowns = useCallback(async () => {
        const amount = Number(onlyUpsDownsStake);
        const duration = Number(onlyUpsDownsDuration);
        const bulk = onlyUpsDownsBulkEnabled ? Number(onlyUpsDownsBulkCount) : 1;
        const takeProfit = Number(onlyUpsDownsTakeProfit) || 0;
        const stopLoss = Number(onlyUpsDownsStopLoss) || 0;
        if (!api_base.api) {
            setOnlyUpsDownsStatus('Not connected — please log in first');
            return;
        }
        if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(duration) || duration < 1 ||
            !Number.isInteger(bulk) || bulk < 1) {
            setOnlyUpsDownsStatus('Enter valid stake, duration, and bulk values');
            return;
        }

        run_panel.run_id = `run-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
        run_panel.toggleDrawer(true);
        (ui as any)?.setAccountSwitcherDisabledMessage?.(
            localize('Account switching is disabled while your bot is running. Please stop your bot before switching accounts.')
        );
        (ui as any)?.setPromptHandler?.(true);

        void runDirectionalTrading({
            amount,
            duration,
            bulk,
            sides: ['RUNHIGH', 'RUNLOW'],
            takeProfit,
            stopLoss,
            setStatus: setOnlyUpsDownsStatus,
            setRunning: setOnlyUpsDownsRunning,
            stopRef: onlyUpsDownsStopRef,
            label: 'Only Ups / Only Downs',
        });
    }, [onlyUpsDownsBulkCount, onlyUpsDownsBulkEnabled, onlyUpsDownsDuration, onlyUpsDownsStake, onlyUpsDownsStopLoss, onlyUpsDownsTakeProfit, runDirectionalTrading, run_panel, ui]);

    // ── limits ────────────────────────────────────────────────────────────────

    const checkLimits = useCallback((): boolean => {
        const { totalProfit: profit, takeProfit: tp, stopLoss: sl } = eng.current;
        const trades = eng.current.overSettledIds.length + eng.current.underSettledIds.length;
        const won = eng.current.overWins + eng.current.underWins;
        const lost = eng.current.overLosses + eng.current.underLosses;
        if (tp > 0 && profit >= tp) {
            sessionCompleteNotification({
                profit,
                trades,
                won,
                lost,
                reason: 'take-profit',
            });
            stopEngine(`✅ Take Profit hit (+${profit.toFixed(2)})`);
            return true;
        }
        if (sl > 0 && profit <= -sl) {
            sessionCompleteNotification({
                profit,
                trades,
                won,
                lost,
                reason: 'stop-loss',
            });
            stopEngine(`🛑 Stop Loss hit (${profit.toFixed(2)})`);
            return true;
        }
        return false;
    }, [stopEngine]);

    // ── fire a round ──────────────────────────────────────────────────────────

    const fireRound = useCallback(async () => {
        const e = eng.current;
        if (!e.running || e.roundInFlight) return;

        const selectedStrategy = e.strategyId === 'dual' || e.strategyId === 'confidence' ? null : STRATEGY_DEFINITIONS[e.strategyId];

        const bulkTrades = bulkEnabled ? Number(bulkCount) : 1;

        e.roundInFlight = true;
        e.overContractIds = [];
        e.underContractIds = [];
        e.overSettledIds = [];
        e.underSettledIds = [];
        e.overSettled   = false;
        e.underSettled  = selectedStrategy ? true : false;
        e.overRoundProfit  = null;
        e.underRoundProfit = null;
        e.overRoundAnyWin  = false;
        e.underRoundAnyWin = false;
        e.currentRoundOverStake  = e.overStake;
        e.currentRoundUnderStake = e.underStake;

        setIsWaitingEntry(false);

        const currency = (api_base as any).account_info?.currency
            || (client as any).currency
            || 'USD';

        const makeBuy = (contract_type: string, barrier: string | null, amount: number) => ({
            buy: '1',
            price: amount,
            parameters: {
                amount,
                basis: 'stake',
                contract_type,
                currency,
                duration: Number(tradeDuration),
                duration_unit: 't',
                ...(barrier ? { barrier } : {}),
                underlying_symbol: symbolRef.current,
            },
        });

        const entryLabel = e.entryDigit !== null ? ` [entry: ${e.entryDigit}]` : '';
        const promptLabel = selectedStrategy
            ? `${selectedStrategy.label} strategy`
            : e.strategyId === 'confidence'
                ? 'Confidence Gate'
                : 'Over 5 + Under 4';
        setStatusMsg(`⚡ Placing ${promptLabel}${entryLabel}…`);

        try {
            const api = api_base.api as any;
            if (selectedStrategy) {
                const tradeAmount = Math.max(0.05, e.overStake);
                const buyRequests = Array.from({ length: bulkTrades }, () => makeBuy(selectedStrategy.contractType ?? 'DIGITOVER', selectedStrategy.barrier, tradeAmount));
                const buyResponses = await Promise.all(buyRequests.map(request => api.send(request)));
                const contractIds = buyResponses
                    .map((response: any) => response?.buy?.contract_id ?? null)
                    .filter((id: number | null): id is number => id !== null);

                e.overContractIds = contractIds;
                e.overSettled = contractIds.length === 0;

                const recordPendingBuy = (response: any, contract_type: string, barrier: string | null, amount: number) => {
                    const buy = response?.buy;
                    if (!buy?.contract_id) return;
                    transactions.onBotContractEvent({
                        ...buy,
                        contract_id: buy.contract_id,
                        contract_type,
                        barrier: barrier ?? '',
                        underlying_symbol: symbolRef.current,
                        currency: buy.currency ?? currency,
                        buy_price: buy.buy_price ?? amount,
                        date_start: buy.date_start ?? buy.purchase_time ?? Math.floor(Date.now() / 1000),
                        status: 'open',
                        profit: 0,
                        transaction_ids: {
                            ...(buy.transaction_ids ?? {}),
                            buy: buy.transaction_id ?? buy.transaction_ids?.buy ?? buy.contract_id,
                        },
                    } as any);
                };

                buyResponses.forEach((response: any) => recordPendingBuy(response, selectedStrategy.contractType ?? 'DIGITOVER', selectedStrategy.barrier, tradeAmount));

                if (contractIds.length > 0) {
                    const subscriptionResults = await Promise.all(contractIds.map(contractId => api.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })));
                    e.overSubId = subscriptionResults[0]?.subscription?.id ?? null;
                }
                setStatusMsg(`${selectedStrategy.label} bot is running — waiting for ${bulkTrades} trade${bulkTrades > 1 ? 's' : ''} to settle…`);
                return;
            }

            const overRequestList = Array.from({ length: bulkTrades }, () => makeBuy('DIGITOVER', OVER_BARRIER, e.overStake));
            const underRequestList = Array.from({ length: bulkTrades }, () => makeBuy('DIGITUNDER', UNDER_BARRIER, e.underStake));
            const [overResults, underResults] = await Promise.all([
                Promise.all(overRequestList.map(request => api.send(request))),
                Promise.all(underRequestList.map(request => api.send(request))),
            ]);

            const overIds = overResults
                .map((response: any) => response?.buy?.contract_id ?? null)
                .filter((id: number | null): id is number => id !== null);
            const underIds = underResults
                .map((response: any) => response?.buy?.contract_id ?? null)
                .filter((id: number | null): id is number => id !== null);

            e.overContractIds = overIds;
            e.underContractIds = underIds;
            e.overSettled = overIds.length === 0;
            e.underSettled = underIds.length === 0;

            const recordPendingBuy = (response: any, contract_type: string, barrier: string, amount: number) => {
                const buy = response?.buy;
                if (!buy?.contract_id) return;

                transactions.onBotContractEvent({
                    ...buy,
                    contract_id: buy.contract_id,
                    contract_type,
                    barrier,
                    underlying_symbol: symbolRef.current,
                    currency: buy.currency ?? currency,
                    buy_price: buy.buy_price ?? amount,
                    date_start: buy.date_start ?? buy.purchase_time ?? Math.floor(Date.now() / 1000),
                    status: 'open',
                    profit: 0,
                    transaction_ids: {
                        ...(buy.transaction_ids ?? {}),
                        buy: buy.transaction_id ?? buy.transaction_ids?.buy ?? buy.contract_id,
                    },
                } as any);
            };

            overResults.forEach((response: any) => recordPendingBuy(response, 'DIGITOVER', OVER_BARRIER, e.currentRoundOverStake));
            underResults.forEach((response: any) => recordPendingBuy(response, 'DIGITUNDER', UNDER_BARRIER, e.currentRoundUnderStake));

            if (overIds.length > 0) {
                const r = await Promise.all(overIds.map(contractId => api.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })));
                e.overSubId = r[0]?.subscription?.id ?? null;
            }
            if (underIds.length > 0) {
                const r = await Promise.all(underIds.map(contractId => api.send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })));
                e.underSubId = r[0]?.subscription?.id ?? null;
            }

            if (overIds.length === 0 && underIds.length === 0) {
                e.roundInFlight = false;
                e.powerAwaitingTrigger = e.powerEngineActive;
                setStatusMsg(e.powerEngineActive
                    ? '⚠ No contracts were opened — waiting for the next three-digit entry sequence.'
                    : '⚠ No contracts were opened — retrying.');
                if (!e.powerEngineActive) {
                    setTimeout(() => { if (eng.current.running) fireRound(); }, 1500);
                }
                return;
            }

            setStatusMsg(`Running — waiting for ${bulkTrades} bulk trade${bulkTrades > 1 ? 's' : ''} to settle…`);
        } catch (err: any) {
            const msg = err?.error?.message || err?.message || 'Buy failed';
            e.overSettled  = true;
            e.underSettled = true;
            e.roundInFlight = false;
            setStatusMsg(`⚠ ${msg}`);
            if (!e.powerEngineActive) {
                setTimeout(() => { if (eng.current.running) fireRound(); }, 1500);
            }
        }
    }, [client, stakeValue, bulkEnabled, bulkCount, tradeDuration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep fireRoundRef in sync so passiveSub's closure always calls the latest version
    useEffect(() => { fireRoundRef.current = fireRound; }, [fireRound]);

    const selectStrategy = useCallback((nextStrategy: StrategyId) => {
        setStrategyId(nextStrategy);
        setStrategySelected(true);
        const e = eng.current;
        e.strategyId = nextStrategy;
        e.entryDigit = null;
        setLastEntryDigit(null);
        // Hidden power-engine trigger only ever applies to the Over 5 / Under 4
        // card — recompute it here too, in case the strategy is switched live
        // while the engine is already running.
        const usePowerEngineNow = nextStrategy === 'dual' && powerEngineEnabled;
        e.powerEngineActive = usePowerEngineNow;
        e.powerAwaitingTrigger = usePowerEngineNow;
        e.dualEntryPending = false;
        if (e.running) {
            e.waitingForEntry = e.useEntryMode && !usePowerEngineNow;
            setIsWaitingEntry(e.useEntryMode && !usePowerEngineNow);
            setLastSkipReason(null);
            setStatusMsg(
                e.useEntryMode && !usePowerEngineNow
                    ? `👀 Switched to ${nextStrategy === 'dual' ? 'Dual Over 5 / Under 4' : STRATEGY_DEFINITIONS[nextStrategy].label} — waiting for a fresh entry trigger…`
                    : `⚡ Switched to ${nextStrategy === 'dual' ? 'Dual Over 5 / Under 4' : STRATEGY_DEFINITIONS[nextStrategy].label}`
            );
        }
    }, [powerEngineEnabled]);

    const goBackToStrategies = useCallback(() => {
        if (eng.current.running) stopEngine('Strategy selection reopened');
        setHigherLowerSelected(false);
        setOnlyUpsDownsSelected(false);
        setMarketOpen(false);
        setStrategySelected(false);
    }, [stopEngine]);

    // ── settle ────────────────────────────────────────────────────────────────

    const onSettled = useCallback((contractId: number, won: boolean, profit: number) => {
        const e = eng.current;
        const isOver  = e.overContractIds.includes(contractId);
        const isUnder = e.underContractIds.includes(contractId);
        if (!isOver && !isUnder) return;

        if (isOver && e.overSettledIds.includes(contractId)) return;
        if (isUnder && e.underSettledIds.includes(contractId)) return;

        e.totalProfit = round2(e.totalProfit + profit);
        setTotalProfit(e.totalProfit);

        // For the dual (Over 5 / Under 4) strategy, the next-round stake is
        // decided once per round (see round-complete below) so martingale only
        // escalates when BOTH legs lose together — per-contract stake updates
        // are skipped here for that strategy.
        const isDualStake = e.strategyId === 'dual';

        if (isOver) {
            e.overSettledIds = [...e.overSettledIds, contractId];
            e.overRoundProfit = (e.overRoundProfit ?? 0) + profit;
            if (won) {
                e.overWins++;
                if (!isDualStake) e.overStake = e.baseStake;
                e.overRoundAnyWin = true;
                setLastOverResult('won');
            } else {
                e.overLosses++;
                if (!isDualStake) e.overStake = e.martingaleEnabled ? round2(e.overStake * e.martingale) : e.baseStake;
                setLastOverResult('lost');
            }
            setOverWins(e.overWins);
            setOverLosses(e.overLosses);
            if (!isDualStake) setOverCurrentStake(e.overStake);
            if (e.overContractIds.length > 0 && e.overContractIds.every(id => e.overSettledIds.includes(id))) {
                e.overSettled = true;
            }
        }

        if (isUnder) {
            e.underSettledIds = [...e.underSettledIds, contractId];
            e.underRoundProfit = (e.underRoundProfit ?? 0) + profit;
            if (won) {
                e.underWins++;
                if (!isDualStake) e.underStake = e.baseStake;
                e.underRoundAnyWin = true;
                setLastUnderResult('won');
            } else {
                e.underLosses++;
                if (!isDualStake) e.underStake = e.martingaleEnabled ? round2(e.underStake * e.martingale) : e.baseStake;
                setLastUnderResult('lost');
            }
            setUnderWins(e.underWins);
            setUnderLosses(e.underLosses);
            if (!isDualStake) setUnderCurrentStake(e.underStake);
            if (e.underContractIds.length > 0 && e.underContractIds.every(id => e.underSettledIds.includes(id))) {
                e.underSettled = true;
            }
        }

        if (e.strategyId !== 'dual' && e.strategyId !== 'confidence') {
            const singleWon = won;
            const nextSingleStake = e.overStake;
            setSingleStake(nextSingleStake);
            if (singleWon) {
                setSingleWins(prev => prev + 1);
                setLastSingleResult('won');
            } else {
                setSingleLosses(prev => prev + 1);
                setLastSingleResult('lost');
            }
        }

        if (e.overSettled && e.underSettled) {
            e.roundCounter++;
            const overP   = e.overRoundProfit  ?? 0;
            const underP  = e.underRoundProfit ?? 0;
            const roundPnl = round2(overP + underP);

            // Dual (Over 5 / Under 4) martingale: escalate the stake for the
            // next round only when BOTH legs lost this round. If either leg
            // won, both stakes reset to the base stake.
            if (e.strategyId === 'dual') {
                const overLegLost  = e.overContractIds.length  > 0 && !e.overRoundAnyWin;
                const underLegLost = e.underContractIds.length > 0 && !e.underRoundAnyWin;
                const bothLost = overLegLost && underLegLost;
                if (bothLost && e.martingaleEnabled) {
                    e.overStake  = round2(e.overStake  * e.martingale);
                    e.underStake = round2(e.underStake * e.martingale);
                } else {
                    e.overStake  = e.baseStake;
                    e.underStake = e.baseStake;
                }
                setOverCurrentStake(e.overStake);
                setUnderCurrentStake(e.underStake);
            }

            e.roundInFlight = false;
            e.entryDigit    = null;

            if (checkLimits() || !e.running) return;

            if (e.powerEngineActive) {
                const sign = roundPnl >= 0 ? '+' : '';
                setStatusMsg(`✅ Round complete — P&L: ${sign}${roundPnl.toFixed(2)} | Total: ${sign}${e.totalProfit.toFixed(2)}`);
                e.powerAwaitingTrigger = true;
                advanceMarketCycleRef.current();
                const nextMarketShort = MARKETS[marketCycleIndexRef.current]?.short ?? symbolRef.current;
                setStatusMsg(
                    marketTradingMode === 'all'
                        ? `✅ Round complete — P&L: ${sign}${roundPnl.toFixed(2)} | Total: ${sign}${e.totalProfit.toFixed(2)} — watching ${nextMarketShort}`
                        : `✅ Round complete — P&L: ${sign}${roundPnl.toFixed(2)} | Total: ${sign}${e.totalProfit.toFixed(2)} — watching ${nextMarketShort} for 3 consecutive digits`
                );
                return;
            }

            // One trade per market: rotate to the next market in MARKETS before
            // the next round fires (or before entry-mode starts watching again).
            advanceMarketCycleRef.current();
            const nextMarketShort = MARKETS[marketCycleIndexRef.current]?.short ?? symbolRef.current;

            if (e.useEntryMode) {
                e.waitingForEntry = true;
                setIsWaitingEntry(true);
                setStatusMsg(`Round complete — cycling to ${nextMarketShort} and waiting for the next entry condition…`);
            } else {
                const sign = roundPnl >= 0 ? '+' : '';
                setStatusMsg(`✅ Round complete — P&L: ${sign}${roundPnl.toFixed(2)} | Total: ${sign}${e.totalProfit.toFixed(2)} — next: ${nextMarketShort}`);
                setTimeout(() => { if (eng.current.running) fireRoundRef.current(); }, 1500);
            }
        }
    }, [checkLimits, marketTradingMode, stakeValue]);

    // ── passive subscription: stream ticks as soon as a market is chosen ─────

    const startPassiveSub = useCallback(async (sym: string, resetHistory = true) => {
        if (!api_base.api) return;
        const generation = ++subscriptionGenerationRef.current;
        pendingForget.current = false; // reset before stopping so stopPassiveSub can set it fresh
        stopPassiveSub();
        if (resetHistory) {
            setDigits([]);
            setDigitWindow([]);
            setCurrentDigit(null);
            setPrices([]);
        }
        // Record which API instance this subscription is for so the health-check
        // effect can detect when api_base.init() replaces it with a new instance.
        passiveApiRef.current = api_base.api;

        passiveSub.current = (api_base.api as any).onMessage().subscribe((msg: any) => {
            const data = getApiData(msg);
            const tick = data?.msg_type === 'tick' ? data.tick : data?.tick;
            if (tick?.quote !== undefined && symbolRef.current === sym && (!tick.symbol || tick.symbol === sym)) {
                latestQuoteRef.current = { symbol: sym, quote: Number(tick.quote) };
                const pipSize = Number(tick.pip_size ?? (api_base as any).pip_sizes?.[sym]);
                const priceStr = formatQuote(tick.quote, pipSize);
                const d = getLastDigit(priceStr);
                if (d === null) return;
                latestDigitRef.current = d;
                lastTickAtRef.current = Date.now();
                setCurrentDigit(d);
                setDigits(prev  => {
                    const n = [...prev, d];
                    const next = n.length > MAX_DIGITS ? n.slice(-MAX_DIGITS) : n;
                    return next;
                });
                setDigitWindow(prev => {
                    const next = [...prev, d];
                    const bounded = next.length > DIGIT_WINDOW ? next.slice(-DIGIT_WINDOW) : next;
                    digitWindowRef.current = bounded;
                    return bounded;
                });
                setPrices(prev  => { const n = [...prev,  priceStr]; return n.length > MAX_DIGITS ? n.slice(-MAX_DIGITS) : n; });
                const nextWindow = [...digitWindowRef.current, d].slice(-DIGIT_WINDOW);
                digitWindowRef.current = nextWindow;

                // The power engine trades after three consecutive digits in
                // either extreme group: 0–3 or 6–9.
                if (eng.current.running && eng.current.powerEngineActive) {
                    if (!eng.current.roundInFlight && hasPowerEntrySequence(nextWindow)) {
                        eng.current.powerAwaitingTrigger = false;
                        eng.current.entryDigit = d;
                        setLastEntryDigit(d);
                        setLastSkipReason(null);
                        setStatusMsg(`⚡ Three consecutive ${d < 4 ? 'under 4' : 'over 5'} digits detected — opening trade…`);
                        fireRoundRef.current();
                    }
                    return;
                }

                if (eng.current.running && eng.current.useEntryMode && eng.current.waitingForEntry && !eng.current.roundInFlight) {
                    const selectedStrategy = eng.current.strategyId === 'dual' || eng.current.strategyId === 'confidence' ? null : STRATEGY_DEFINITIONS[eng.current.strategyId];
                    const recentDigits = nextWindow.slice(-6);
                    const activeEntrySignal = !selectedStrategy
                        ? (eng.current.strategyId === 'confidence'
                            ? evaluateConfidenceGateSignal(nextWindow)
                            : evaluateDualGroupSignal(nextWindow))
                        : null;
                    if (selectedStrategy) {
                        const strategyEntryDigits = getStrategyEntryDigits(eng.current.strategyId);
                        if (eng.current.strategyId !== 'over1' && eng.current.strategyId !== 'over2' && eng.current.strategyId !== 'under7' && eng.current.strategyId !== 'under8' && isCautionCluster(selectedStrategy, recentDigits)) {
                            setLastSkipReason(`Skipped ${selectedStrategy.label}: caution cluster detected (${selectedStrategy.cautionDigits.join(', ')})`);
                            setIsWaitingEntry(true);
                            return;
                        }

                        const sequenceMatched = matchesStrategyEntrySequence(eng.current.strategyId, recentDigits);
                        const shouldTrigger = eng.current.strategyId === 'over1' || eng.current.strategyId === 'over2' || eng.current.strategyId === 'under8' || eng.current.strategyId === 'under7' || eng.current.strategyId === 'even' || eng.current.strategyId === 'odd'
                            ? sequenceMatched
                            : strategyEntryDigits.includes(d);

                        if (shouldTrigger) {
                            eng.current.waitingForEntry = false;
                            eng.current.entryDigit      = d;
                            setLastEntryDigit(d);
                            setLastSkipReason(null);
                            setIsWaitingEntry(false);
                            fireRoundRef.current();
                        } else {
                            setLastSkipReason(
                                eng.current.strategyId === 'over1'
                                    ? `Waiting for 3 consecutive digits in the 0–2 bracket (any random order) — got ${d}`
                                    : eng.current.strategyId === 'over2'
                                        ? `Waiting for Over 2 entry: last 2 digits both below 2 (0 or 1) — got ${d}`
                                        : eng.current.strategyId === 'under8'
                                            ? `Waiting for Under 8 entry sequence: 3 digits from 7–9, then 3–7 — got ${d}`
                                            : eng.current.strategyId === 'under7'
                                                ? `Waiting for Under 7 entry: last 2 digits both above 7 (8 or 9) — got ${d}`
                                                : eng.current.strategyId === 'even'
                                                    ? `Waiting for Even entry: last 5 digits all odd — got ${d}`
                                                    : eng.current.strategyId === 'odd'
                                                        ? `Waiting for Odd entry: last 5 digits all even — got ${d}`
                                                        : `Waiting for ${selectedStrategy.label} entry trigger — got ${d}`
                            );
                        }
                        return;
                    }

                    if (activeEntrySignal) {
                        if (eng.current.strategyId === 'dual') {
                            if (eng.current.dualEntryPending) {
                                eng.current.dualEntryPending = false;
                                eng.current.waitingForEntry = false;
                                eng.current.entryDigit = d;
                                setLastEntryDigit(d);
                                setLastSkipReason(null);
                                setIsWaitingEntry(false);
                                fireRoundRef.current();
                            } else if (isAlternatingMiddlePair(nextWindow[nextWindow.length - 2], nextWindow[nextWindow.length - 1])) {
                                eng.current.dualEntryPending = true;
                                setLastSkipReason(`Entry sequence detected: ${nextWindow[nextWindow.length - 2]} → ${d}. Trading on the next digit.`);
                            }
                            return;
                        }

                        setLastSignalConfidence(activeEntrySignal.confidence);
                        if (activeEntrySignal.shouldTrade) {
                            eng.current.waitingForEntry = false;
                            eng.current.entryDigit      = d;
                            setLastEntryDigit(d);
                            setLastSkipReason(null);
                            setIsWaitingEntry(false);
                            const modeLabel = eng.current.strategyId === 'confidence' ? 'Confidence Gate' : 'Dual Over 5 / Under 4';
                            setStatusMsg(`Signal confidence ${activeEntrySignal.confidence.toFixed(1)}% — executing ${modeLabel} pair.`);
                            fireRoundRef.current();
                            return;
                        }

                        setLastSkipReason(
                            eng.current.strategyId === 'confidence'
                                ? `No trade — confidence ${activeEntrySignal.confidence.toFixed(1)}% is too weak, or 4/5 is still too dominant.`
                                : activeEntrySignal.middleDominant20
                                    ? `No trade — digits 4 and 5 appeared ${activeEntrySignal.middleCount20} times in the last 20 ticks, which is over the 6-tick limit.`
                                    : activeEntrySignal.repeatedMiddleRisk
                                        ? `No trade — digits 4 and 5 appeared ${activeEntrySignal.middleCount5} times in the last 5 ticks, so the entry window is blocked.`
                                        : activeEntrySignal.recentMiddleTrigger
                                            ? `Waiting for a clean dual-entry trigger: 4 or 5 must appear exactly once in the last 5 ticks. Current 5-tick middle count: ${activeEntrySignal.middleCount5}.`
                                            : `Waiting for strong extreme-group dominance: Under 4 ${activeEntrySignal.under4}/20, Middle ${activeEntrySignal.middle}/20, Over 5 ${activeEntrySignal.over5}/20, confidence ${activeEntrySignal.confidence.toFixed(1)}%.`
                        );
                        return;
                    }

                }
            }
        });

        if (resetHistory) {
            let historyResponse: any;
            try {
                historyResponse = await (api_base.api as any).send({
                    ticks_history: sym,
                    count: DIGIT_WINDOW,
                    end: 'latest',
                    style: 'ticks',
                });
            } catch {
                setStatusMsg('⚠ Unable to load live tick history');
            }
            const history = historyResponse?.history;
            const pricesFromHistory = Array.isArray(history?.prices) ? history.prices : [];
            const historyPipSize = Number(
                historyResponse?.pip_size ?? history?.pip_size ?? (api_base.api as any).pip_sizes?.[sym]
            );
            const historyQuotes = pricesFromHistory
                .map((quote: number | string) => formatQuote(quote, historyPipSize));
            const historyDigits = historyQuotes
                .map((quote: string) => getLastDigit(quote, historyPipSize))
                .filter((digit: number | null): digit is number => digit !== null);
            const latestHistoryQuote = historyQuotes[historyQuotes.length - 1];
            const latestHistoryDigit = historyDigits[historyDigits.length - 1];
            if (generation !== subscriptionGenerationRef.current || symbolRef.current !== sym) return;
            const nextWindow = historyDigits.slice(-DIGIT_WINDOW);
            digitWindowRef.current = nextWindow;
            setDigitWindow(nextWindow);
            setDigits(historyDigits.slice(-MAX_DIGITS));
            setPrices(historyQuotes.slice(-MAX_DIGITS));
            if (latestHistoryQuote !== undefined) {
                setCurrentDigit(latestHistoryDigit ?? null);
                latestDigitRef.current = latestHistoryDigit ?? null;
                lastTickAtRef.current = Date.now();
            }

            // Evaluate the freshly loaded history immediately against the
            // active entry logic. This runs every time a market is (re)loaded
            // — on first start AND every subsequent market-cycle switch — so
            // a completed 4→5 or 5→4 sequence in the just-fetched history
            // arms the next live tick without executing immediately.
            if (latestHistoryDigit !== undefined && eng.current.running && !eng.current.roundInFlight) {
                if (eng.current.powerEngineActive) {
                    eng.current.powerAwaitingTrigger = true;
                    eng.current.dualEntryPending = false;
                } else if (eng.current.useEntryMode && eng.current.waitingForEntry) {
                    const activeStrategyId = eng.current.strategyId;
                    const selectedStrategy = activeStrategyId === 'dual' || activeStrategyId === 'confidence' ? null : STRATEGY_DEFINITIONS[activeStrategyId];
                    const recentDigits = nextWindow.slice(-6);
                    const shouldTrigger = selectedStrategy
                        ? (activeStrategyId === 'over1' || activeStrategyId === 'over2' || activeStrategyId === 'under7' || !isCautionCluster(selectedStrategy, recentDigits)) &&
                            (['over1', 'over2', 'under8', 'under7', 'even', 'odd'].includes(activeStrategyId)
                                ? matchesStrategyEntrySequence(activeStrategyId, recentDigits)
                                : getStrategyEntryDigits(activeStrategyId).includes(latestHistoryDigit))
                        : (activeStrategyId === 'confidence'
                            ? evaluateConfidenceGateSignal(nextWindow).shouldTrade
                            : activeStrategyId === 'dual'
                                ? isAlternatingMiddlePair(
                                    historyDigits[historyDigits.length - 2],
                                    historyDigits[historyDigits.length - 1]
                                )
                                : getStrategyEntryDigits(activeStrategyId).includes(latestHistoryDigit));

                    if (activeStrategyId === 'dual') {
                        eng.current.dualEntryPending = shouldTrigger;
                    } else if (shouldTrigger) {
                        eng.current.waitingForEntry = false;
                        eng.current.entryDigit = latestHistoryDigit;
                        setLastEntryDigit(latestHistoryDigit);
                        setLastSkipReason(null);
                        setIsWaitingEntry(false);
                        setStatusMsg('Entry condition ready — firing round…');
                        fireRoundRef.current();
                    }
                }
            }
        }

        try {
            const r = await (api_base.api as any).send({ ticks: sym, subscribe: 1 });
            const subId = r?.subscription?.id ?? null;
            if (pendingForget.current) {
                // stopPassiveSub was called while we were waiting for this ID —
                // the Rx subscription is already gone, but the server-side
                // subscription is still live. Forget it immediately so we don't
                // accumulate duplicate server subscriptions.
                pendingForget.current = false;
                if (subId && api_base.api) {
                    try { (api_base.api as any).send({ forget: subId }); } catch { /* ignore */ }
                }
            } else {
                passiveTickId.current = subId;
            }
        } catch {
            // Do not leave a dead Rx subscription behind; the readiness poll
            // below can retry once the API connection is available.
            if (passiveSub.current) {
                passiveSub.current.unsubscribe();
                passiveSub.current = null;
            }
        }
    }, [stopPassiveSub]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── market cycling: one trade per market, then rotate to the next ────────
    // Every card now trades all markets in MARKETS instead of a single manually
    // chosen symbol — one trade per market per lap, looping continuously until
    // the take-profit/stop-loss threshold stops the engine (see checkLimits).

    const advanceMarketCycle = useCallback(() => {
        if (marketTradingMode === 'selected') return;
        marketCycleIndexRef.current = (marketCycleIndexRef.current + 1) % MARKETS.length;
        const nextMarket = MARKETS[marketCycleIndexRef.current];
        symbolRef.current = nextMarket.symbol;
        setSymbol(nextMarket.symbol);
        startPassiveSub(nextMarket.symbol, true);
    }, [marketTradingMode, startPassiveSub]);

    useEffect(() => { advanceMarketCycleRef.current = advanceMarketCycle; }, [advanceMarketCycle]);

    // ── start ─────────────────────────────────────────────────────────────────

    const startEngine = useCallback(async () => {
        if (eng.current.running) return;
        if (martingaleEnabled && (!Number.isFinite(martingaleValue) || martingaleValue <= 0)) {
            setStatusMsg('⚠ Enter a positive martingale multiplier before starting');
            return;
        }
        if (bulkEnabled && (!/^\d+$/.test(bulkCount) || Number(bulkCount) < 1)) {
            setStatusMsg('⚠ Enter a whole number of bulk purchases before starting');
            return;
        }
        if (!/^\d+$/.test(tradeDuration) || Number(tradeDuration) < 1) {
            setStatusMsg('⚠ Enter a whole number of ticks between 1 and 365');
            return;
        }
        if (Number(tradeDuration) > 365) {
            setStatusMsg('⚠ Trade duration cannot exceed 365 ticks');
            return;
        }
        if (!api_base.api) { setStatusMsg('⚠ Not connected — please log in first'); return; }

        // All-markets mode starts from the first market and rotates through the
        // list. Selected-market mode keeps the market chosen in the header.
        if (marketTradingMode === 'all') {
            marketCycleIndexRef.current = 0;
            symbolRef.current = MARKETS[0].symbol;
            setSymbol(MARKETS[0].symbol);
        } else {
            const selectedIndex = MARKETS.findIndex(market => market.symbol === symbol);
            marketCycleIndexRef.current = selectedIndex >= 0 ? selectedIndex : 0;
            symbolRef.current = symbol;
        }

        const resolvedStrategy = strategyId === 'dual' || strategyId === 'confidence' ? null : STRATEGY_DEFINITIONS[strategyId];
        // Hidden power-engine trigger: Over 5 / Under 4 card only. When active,
        // it replaces the visible entry-mode logic for this run — 4→5 or 5→4
        // arms the trade, which executes on the following digit.
        const usePowerEngine = strategyId === 'dual' && powerEngineEnabled;
        // Risk controls always come from the values entered in the active form.
        // Strategy recommendations are informational and must not replace them.
        eng.current = makeInitState(stakeValue, martingaleValue, takeProfitValue, stopLossValue, entryMode, strategyId, martingaleEnabled);
        eng.current.running = true;
        eng.current.useEntryMode = entryMode;
        eng.current.waitingForEntry = entryMode;
        eng.current.powerEngineActive = usePowerEngine;
        eng.current.powerAwaitingTrigger = usePowerEngine;
        eng.current.dualEntryPending = false;
        if (resolvedStrategy) {
            eng.current.baseStake = stakeValue;
            eng.current.overStake = stakeValue;
            eng.current.underStake = stakeValue;
            setSingleStake(stakeValue);
            setSingleWins(0);
            setSingleLosses(0);
            setLastSingleResult(null);
            setLastSkipReason(null);
        }

        setIsRunning(true);
        setTotalProfit(0);
        setOverWins(0); setOverLosses(0);
        setUnderWins(0); setUnderLosses(0);
        setOverCurrentStake(stakeValue);
        setUnderCurrentStake(stakeValue);
        setLastOverResult(null);
        setLastUnderResult(null);
        setLastEntryDigit(null);
        setIsWaitingEntry(entryMode && !usePowerEngine);
        const statusStart = resolvedStrategy
            ? (strategyId === 'over1'
                ? '👀 Watching for 3 consecutive digits in the 0–2 bracket (any random order)…'
                : strategyId === 'over2'
                    ? '👀 Watching for Over 2 entry: last 2 digits both below 2…'
                    : strategyId === 'under8'
                        ? '👀 Watching for Under 8 sequence: 7–9, 7–9, 7–9, then 3–7…'
                        : strategyId === 'under7'
                            ? '👀 Watching for Under 7 entry: last 2 digits both above 7…'
                                : strategyId === 'even'
                                    ? '👀 Watching for Even entry: last 5 digits all odd…'
                                    : strategyId === 'odd'
                                        ? '👀 Watching for Odd entry: last 5 digits all even…'
                                        : `👀 Watching for ${resolvedStrategy.label} trigger ${getStrategyEntryDigits(strategyId).join(', ')}…`)
            : usePowerEngine
                ? 'Connecting…'
                : entryMode
                    ? '👀 Dual entry window: block if 4/5 >6 in 20 or >=3 in 5; trade only when 4/5 appears once in 5…'
                    : 'Connecting…';
        setStatusMsg(statusStart);

        // Mirror run-panel start: activate global running state, open drawer, disable account switching
        run_panel.run_id = `run-${Date.now()}`;
        summary_card.clear();
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
        run_panel.toggleDrawer(true);
        (ui as any)?.setAccountSwitcherDisabledMessage?.(
            localize('Account switching is disabled while your bot is running. Please stop your bot before switching accounts.')
        );
        (ui as any)?.setPromptHandler?.(true);

        // msgSub handles contract results only — ticks are in passiveSub
        if (msgSub.current) msgSub.current.unsubscribe();
        msgSub.current = (api_base.api as any).onMessage().subscribe((msg: any) => {
            const data = getApiData(msg);
            if (data?.msg_type === 'proposal_open_contract' && data.proposal_open_contract) {
                const poc = data.proposal_open_contract;
                if (poc.status === 'won' || poc.status === 'lost') {
                    // Push settled contract into the shared Transactions widget
                    transactions.onBotContractEvent(poc);
                    onSettled(poc.contract_id, poc.status === 'won', parseFloat(poc.profit ?? '0'));
                }
            }
        });

        try {
            if (!entryMode && !usePowerEngine) {
                setStatusMsg('Connected — firing first round…');
                await fireRound();
            }

            // Reset the tick history for the freshly cycled starting market and
            // ensure its subscription is live for the engine. startPassiveSub
            // itself evaluates the loaded history against the active entry
            // logic (entry mode or the hidden power engine) and fires
            // immediately if a trigger is already present, so no separate
            // follow-up check is needed here.
            await startPassiveSub(symbolRef.current, true);
        } catch (err: any) {
            stopEngine(`⚠ ${err?.error?.message || err?.message || 'Failed to start'}`);
        }
    }, [stakeValue, martingaleValue, martingaleEnabled, takeProfitValue, stopLossValue, entryMode, strategyId, powerEngineEnabled, bulkEnabled, bulkCount, fireRound, marketTradingMode, onSettled, startPassiveSub, stopEngine, symbol, transactions, run_panel, summary_card, ui]);

    // Start passive ticks whenever the selected symbol changes (or on first
    // mount). The engine can render before authentication finishes, so retry
    // until api_base has a live API instead of permanently showing an empty
    // digit strip.
    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const ensureSubscription = () => {
            if (cancelled) return;
            if (!api_base.api) {
                retryTimer = setTimeout(ensureSubscription, 500);
                return;
            }
            // Always restart when `symbol` changes. The previous subscription
            // can still be active, so checking passiveSub.current here would
            // leave the old market streaming after a selection change.
            startPassiveSub(symbol);
        };

        ensureSubscription();
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
        };
    }, [symbol, startPassiveSub]);

    // Health-check: restart the passive subscription whenever api_base.api is
    // replaced by a new instance (happens on reconnect, account switch, or the
    // window-focus reconnect triggered by reconnectIfNotConnected). The
    // ensureSubscription effect above only catches the initial mount / symbol
    // change; it cannot detect a mid-session API instance swap because
    // passiveSub.current is still non-null (pointing to the old instance).
    useEffect(() => {
        const checkHealth = () => {
            const apiChanged = api_base.api && passiveApiRef.current !== api_base.api;
            if ((apiChanged || !passiveSub.current) && api_base.api) {
                startPassiveSub(symbolRef.current);
            }
        };

        // Poll every 3 s — cheap enough and fast enough to recover within a
        // few seconds after a reconnect.
        const interval = setInterval(checkHealth, 3000);
        // Also fire immediately on window focus: that is exactly when
        // api_base.reconnectIfNotConnected() runs and may swap the instance.
        window.addEventListener('focus', checkHealth);

        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', checkHealth);
        };
    }, [startPassiveSub]);

    // Recover a stalled stream as well as a disconnected stream. The API
    // object can remain present while a server-side subscription has stopped.
    useEffect(() => {
        const interval = setInterval(() => {
            if (api_base.api && passiveSub.current && lastTickAtRef.current > 0 &&
                Date.now() - lastTickAtRef.current > 7000) {
                startPassiveSub(symbolRef.current, false);
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [startPassiveSub]);

    // Teardown on unmount — kill everything including the passive subscription
    useEffect(() => () => {
        eng.current.running = false;
        cleanupSubs();
        stopPassiveSub();
    }, [cleanupSubs, stopPassiveSub]);

    // Register this engine's stop handler with the shared run-panel Stop
    // button (Transactions panel / toolbar) so clicking Stop there also stops
    // the active AI bot strategy. Registration only exists while this
    // component is mounted, which only happens while the AI Bots tab is active.
    useEffect(() => {
        (run_panel as any).registerAiBotStopHandler?.(() => {
            if (eng.current.running) {
                stopEngine('Stopped from Transactions panel');
            }
            if (higherLowerRunning) {
                higherLowerStopRef.current = true;
                setHigherLowerStatus('Stopping after current contracts settle…');
            }
            if (onlyUpsDownsRunning) {
                onlyUpsDownsStopRef.current = true;
                setOnlyUpsDownsStatus('Stopping after current contracts settle…');
            }
        });
        return () => {
            (run_panel as any).unregisterAiBotStopHandler?.();
        };
    }, [higherLowerRunning, onlyUpsDownsRunning, run_panel, setHigherLowerStatus, setOnlyUpsDownsStatus, stopEngine]);

    // ── render ────────────────────────────────────────────────────────────────

    const currency    = (client as any)?.currency || 'USD';
    const totalRounds = Math.max(overWins + overLosses, underWins + underLosses);
    const latestPrice = prices.length > 0 ? prices[prices.length - 1] : null;
    const latestPriceBody = latestPrice ? latestPrice.slice(0, -1) : '';
    const latestPriceDigit = latestPrice ? latestPrice.slice(-1) : '';
    const profitPct   = (n: number, total: number) => total > 0 ? Math.round((n / total) * 100) : 0;
    const activeMarket = MARKETS.find(m => m.symbol === symbol) ?? MARKETS[0];
    const higherLowerMarket = MARKETS.find(m => m.symbol === chart_store.symbol);
    const digitCounts = Array.from({ length: 10 }, (_, digit) => digitWindow.filter(value => value === digit).length);
    const digitPercentages = digitCounts.map(count => digitWindow.length > 0 ? (count / digitWindow.length) * 100 : 0);
    const isDualStrategyMode = strategyId === 'dual' || strategyId === 'confidence';
    const isSingleStrategyMode = !isDualStrategyMode;
    const activeStrategyDef = isSingleStrategyMode ? STRATEGY_DEFINITIONS[strategyId] : null;

    return (
        <div className='oue'>
            {!strategySelected && !higherLowerSelected && !onlyUpsDownsSelected && (
                <section className='oue__strategy-picker' aria-labelledby='oue-strategy-picker-title'>
                    <div className='oue__strategy-picker-header'>
                        <span className='oue__title-icon'>🤖</span>
                        <div>
                            <h1 id='oue-strategy-picker-title'>AI BOTS</h1>
                            <p>Select a strategy to open its complete trading workspace.</p>
                        </div>
                    </div>
                    <div className='oue__strategy-cards' role='list' aria-label='AI bot strategies'>
                        <button
                            type='button'
                            role='listitem'
                            className='oue__strategy-card oue__strategy-card--hot'
                            onClick={() => selectStrategy('dual')}
                        >
                            <span className='oue__strategy-card-hot' aria-label='Hot advanced bot'>
                                🔥 HOT
                            </span>
                            <span className='oue__strategy-card-badge'>↕</span>
                            <span className='oue__strategy-card-content'>
                                <span className='oue__strategy-card-title'>Over 5 / Under 4</span>
                                <span className='oue__strategy-card-meta'>OVER 5 + UNDER 4 · BALANCED</span>
                                <span className='oue__strategy-card-description'>Trade both sides of the digit range with the original paired AI bot.</span>
                            </span>
                            <span className='oue__strategy-card-action'>OPEN</span>
                        </button>
                        {([
                            { id: 'over2', badge: '↑', title: 'OVER 2', meta: 'DIGIT 3–9 · 70% WIN', description: 'Trades Over 2 when the last 2 digits are both below 2, with live digit frequency percentages.' },
                            { id: 'under7', badge: '↓', title: 'UNDER 7', meta: 'DIGIT 0–6 · 70% WIN', description: 'Trades Under 7 when the last 2 digits are both above 7, with live digit frequency percentages.' },
                            { id: 'even', badge: '2', title: 'EVEN', meta: 'DIGIT 0,2,4,6,8 · 50% WIN', description: 'Trades Even when the last 5 digits are all odd, with live digit frequency percentages.' },
                            { id: 'odd', badge: '1', title: 'ODD', meta: 'DIGIT 1,3,5,7,9 · 50% WIN', description: 'Trades Odd when the last 5 digits are all even, with live digit frequency percentages.' },
                        ] as const).map(card => (
                            <button
                                key={card.id}
                                type='button'
                                role='listitem'
                                className='oue__strategy-card'
                                aria-label={`Open ${card.title} workspace`}
                                onClick={() => selectStrategy(card.id)}
                            >
                                <span className='oue__strategy-card-badge'>{card.badge}</span>
                                <span className='oue__strategy-card-content'>
                                    <span className='oue__strategy-card-title'>{card.title}</span>
                                    <span className='oue__strategy-card-meta'>{card.meta}</span>
                                    <span className='oue__strategy-card-description'>{card.description}</span>
                                </span>
                                <span className='oue__strategy-card-action'>OPEN</span>
                            </button>
                        ))}
                        <button
                            type='button'
                            role='listitem'
                            className='oue__strategy-card oue__strategy-card--new oue__strategy-card--only-ups-downs'
                            aria-label='Open Only Ups Only Downs workspace'
                            onClick={() => setOnlyUpsDownsSelected(true)}
                        >
                            <span className='oue__strategy-card-badge'>↕</span>
                            <span className='oue__strategy-card-content'>
                                <span className='oue__strategy-card-title'>ONLY UPS / ONLY DOWNS</span>
                                <span className='oue__strategy-card-meta'>ONLY UPS + ONLY DOWNS · BOTH ONLY</span>
                                <span className='oue__strategy-card-description'>Trade Only Ups and Only Downs contracts together without a barrier.</span>
                            </span>
                            <span className='oue__strategy-card-action'>OPEN</span>
                        </button>
                    </div>
                </section>
            )}

            {higherLowerSelected && !strategySelected && (
                <section className='oue__higher-lower-workspace' aria-labelledby='oue-higher-lower-title'>
                    <button type='button' className='oue__back-to-strategies' onClick={goBackToStrategies}>
                        <span aria-hidden='true'>←</span>
                        Back to strategies
                    </button>
                    <div className='oue__higher-lower-header'>
                        <div>
                            <h1 id='oue-higher-lower-title'>HIGHER / LOWER</h1>
                            <p>Market chart workspace for the Higher / Lower strategy.</p>
                        </div>
                    </div>
                    <div className='oue__higher-lower-chart'>
                        <ChartWrapper show_digits_stats={false} />
                    </div>
                    <div className='oue__higher-lower-controls'>
                        <div className='oue__higher-lower-market' role='status' aria-live='polite'>
                            <span className='oue__higher-lower-market-dot' aria-hidden='true' />
                            <span>Active market</span>
                            <strong>{higherLowerMarket?.label ?? chart_store.symbol ?? 'Loading market…'}</strong>
                            <span className='oue__higher-lower-market-confirmed'>Chart synced</span>
                        </div>
                        <div className='oue__higher-lower-sides' role='group' aria-label='Contract direction'>
                            {(['higher', 'lower', 'both'] as const).map(side => (
                                <button
                                    key={side}
                                    type='button'
                                    className={higherLowerSide === side ? 'oue__higher-lower-side oue__higher-lower-side--active' : 'oue__higher-lower-side'}
                                    onClick={() => setHigherLowerSide(side)}
                                >
                                    {side[0].toUpperCase() + side.slice(1)}
                                </button>
                            ))}
                        </div>
                        <label className='oue__field'>
                            <span>Stake ({currency})</span>
                            <input className='oue__input' type='number' min='0.35' step='0.05' value={higherLowerStake} onChange={event => setHigherLowerStake(event.target.value)} />
                        </label>
                        <label className='oue__field'>
                            <span>Barrier</span>
                            <input
                                className='oue__input'
                                type='text'
                                inputMode='decimal'
                                placeholder='e.g. +64.64 or -64.64'
                                value={higherLowerBarrier}
                                onChange={event => {
                                    setHigherLowerBarrier(event.target.value);
                                }}
                                disabled={higherLowerRunning}
                                aria-describedby='oue-higher-lower-barrier-status'
                            />
                            <small id='oue-higher-lower-barrier-status' className='oue__field-help'>
                                {higherLowerBarrierStatus}
                            </small>
                        </label>
                        <label className='oue__field'>
                            <span>Duration (ticks)</span>
                            <input className='oue__input' type='number' min='1' step='1' value={higherLowerDuration} onChange={event => setHigherLowerDuration(event.target.value)} />
                        </label>
                        <label className='oue__field'>
                            <span>Take profit ({currency})</span>
                            <input className='oue__input' type='number' min='0' step='0.01' value={higherLowerTakeProfit} onChange={event => setHigherLowerTakeProfit(event.target.value)} />
                        </label>
                        <label className='oue__field'>
                            <span>Stop loss ({currency})</span>
                            <input className='oue__input' type='number' min='0' step='0.01' value={higherLowerStopLoss} onChange={event => setHigherLowerStopLoss(event.target.value)} />
                        </label>
                        <label className='oue__entry-toggle'>
                            <span className='oue__entry-toggle-label'>Bulk purchase</span>
                            <div
                                className={`oue__toggle${higherLowerBulkEnabled ? ' oue__toggle--on' : ''}`}
                                onClick={() => setHigherLowerBulkEnabled(value => !value)}
                                role='switch'
                                aria-checked={higherLowerBulkEnabled}
                                tabIndex={0}
                                onKeyDown={event => {
                                    if (event.key === ' ' || event.key === 'Enter') setHigherLowerBulkEnabled(value => !value);
                                }}
                            >
                                <div className='oue__toggle-thumb' />
                            </div>
                        </label>
                        {higherLowerBulkEnabled && (
                            <label className='oue__field'>
                                <span>Bulk count</span>
                                <input className='oue__input' type='number' min='1' step='1' value={higherLowerBulkCount} onChange={event => setHigherLowerBulkCount(event.target.value)} />
                            </label>
                        )}
                        <button
                            type='button'
                            className={`oue__higher-lower-buy${higherLowerRunning ? ' oue__higher-lower-buy--stop' : ''}`}
                            onClick={() => {
                                if (higherLowerRunning) {
                                    higherLowerStopRef.current = true;
                                    setHigherLowerStatus('Stopping after current contracts settle…');
                                } else {
                                    void buyHigherLower();
                                }
                            }}
                        >
                            {higherLowerRunning ? 'Stop Engine' : 'Start Engine'}
                        </button>
                        <span className='oue__higher-lower-status' role='status'>{higherLowerStatus}</span>
                    </div>
                </section>
            )}

            {onlyUpsDownsSelected && !strategySelected && (
                <section className='oue__higher-lower-workspace oue__only-ups-downs-workspace' aria-labelledby='oue-only-ups-downs-title'>
                    <button type='button' className='oue__back-to-strategies' onClick={goBackToStrategies}>
                        <span aria-hidden='true'>←</span>
                        Back to strategies
                    </button>
                    <div className='oue__higher-lower-header'>
                        <div>
                            <h1 id='oue-only-ups-downs-title'>ONLY UPS / ONLY DOWNS</h1>
                            <p>Both upward and downward contracts are purchased together.</p>
                        </div>
                    </div>
                    <div className='oue__higher-lower-chart'>
                        <ChartWrapper show_digits_stats={false} />
                    </div>
                    <div className='oue__higher-lower-controls oue__only-ups-downs-controls'>
                        <div className='oue__higher-lower-market' role='status' aria-live='polite'>
                            <span className='oue__higher-lower-market-dot' aria-hidden='true' />
                            <span>Active market</span>
                            <strong>{higherLowerMarket?.label ?? chart_store.symbol ?? 'Loading market…'}</strong>
                            <span className='oue__higher-lower-market-confirmed'>Chart synced</span>
                        </div>
                        <div className='oue__only-ups-downs-contract-note'>Trading both: Only Ups + Only Downs</div>
                        <label className='oue__field'>
                            <span>Stake ({currency})</span>
                            <input className='oue__input' type='number' min='0.35' step='0.05' value={onlyUpsDownsStake} onChange={event => setOnlyUpsDownsStake(event.target.value)} />
                        </label>
                        <label className='oue__field'>
                            <span>Duration (ticks)</span>
                            <input className='oue__input' type='number' min='1' step='1' value={onlyUpsDownsDuration} onChange={event => setOnlyUpsDownsDuration(event.target.value)} />
                        </label>
                        <label className='oue__field'>
                            <span>Take profit ({currency})</span>
                            <input className='oue__input' type='number' min='0' step='0.01' value={onlyUpsDownsTakeProfit} onChange={event => setOnlyUpsDownsTakeProfit(event.target.value)} />
                        </label>
                        <label className='oue__field'>
                            <span>Stop loss ({currency})</span>
                            <input className='oue__input' type='number' min='0' step='0.01' value={onlyUpsDownsStopLoss} onChange={event => setOnlyUpsDownsStopLoss(event.target.value)} />
                        </label>
                        <label className='oue__entry-toggle'>
                            <span className='oue__entry-toggle-label'>Bulk purchase</span>
                            <div
                                className={`oue__toggle${onlyUpsDownsBulkEnabled ? ' oue__toggle--on' : ''}`}
                                onClick={() => setOnlyUpsDownsBulkEnabled(value => !value)}
                                role='switch'
                                aria-checked={onlyUpsDownsBulkEnabled}
                                tabIndex={0}
                                onKeyDown={event => {
                                    if (event.key === ' ' || event.key === 'Enter') setOnlyUpsDownsBulkEnabled(value => !value);
                                }}
                            >
                                <div className='oue__toggle-thumb' />
                            </div>
                        </label>
                        {onlyUpsDownsBulkEnabled && (
                            <label className='oue__field'>
                                <span>Bulk count</span>
                                <input className='oue__input' type='number' min='1' step='1' value={onlyUpsDownsBulkCount} onChange={event => setOnlyUpsDownsBulkCount(event.target.value)} />
                            </label>
                        )}
                        <button
                            type='button'
                            className={`oue__higher-lower-buy${onlyUpsDownsRunning ? ' oue__higher-lower-buy--stop' : ''}`}
                            onClick={() => {
                                if (onlyUpsDownsRunning) {
                                    onlyUpsDownsStopRef.current = true;
                                    setOnlyUpsDownsStatus('Stopping after current contracts settle…');
                                } else {
                                    void buyOnlyUpsDowns();
                                }
                            }}
                        >
                            {onlyUpsDownsRunning ? 'Stop Engine' : 'Start Engine'}
                        </button>
                        <span className='oue__higher-lower-status' role='status'>{onlyUpsDownsStatus}</span>
                    </div>
                </section>
            )}

            {strategySelected && (<>
                <button type='button' className='oue__back-to-strategies' onClick={goBackToStrategies}>
                    <span aria-hidden='true'>←</span>
                    Back to strategies
                </button>

                {/* ── digit strip ── */}
                <div className='oue__header'>
                <div className='oue__title'>
                    <span className='oue__title-icon'>🤖</span>
                    <span>{isSingleStrategyMode ? `${activeStrategyDef?.label.toUpperCase()} AI BOT` : strategyId === 'confidence' ? 'CONFIDENCE GATE AI BOT' : 'AI BOTS'}</span>

                    {/* entry-mode indicator badge */}
                    {entryMode && (
                        <span className='oue__entry-badge'>
                            {isSingleStrategyMode
                                ? strategyId === 'over1'
                                    ? <>Entry: <strong>3 consecutive digits in 0–2 bracket</strong></>
                                    : strategyId === 'over2'
                                        ? <>Entry: <strong>last 2 digits &lt; 2</strong></>
                                        : strategyId === 'under8'
                                            ? <>Entry: <strong>7–9, 7–9, 7–9 → 3–7</strong></>
                                            : strategyId === 'under7'
                                                ? <>Entry: <strong>last 2 digits &gt; 7</strong></>
                                                        : strategyId === 'even'
                                                            ? <>Entry: <strong>last 5 digits all odd</strong></>
                                                            : strategyId === 'odd'
                                                                ? <>Entry: <strong>last 5 digits all even</strong></>
                                                                : <>Entry: <strong>{getStrategyEntryDigits(strategyId).join(', ')}</strong></>
                                : <>Entry: <strong>4</strong> or <strong>5</strong></>}
                            {isWaitingEntry && <span className='oue__entry-pulse' />}
                        </span>
                    )}

                    {/* D-Circles shortcut */}
                    <button
                        className='oue__dcircles-btn'
                        onClick={() => (dashboard as any).setDCirclesModalVisibility()}
                        type='button'
                        title='Open D-Circles analysis tool'
                    >
                        ◎ D-Circles
                    </button>

                    {/* market selector */}
                    <div className={`oue__market-selector oue__market-selector--header${marketOpen ? ' oue__market-selector--open' : ''}`}>
                        <button
                            ref={marketTriggerRef}
                            className='oue__market-trigger oue__market-trigger--header'
                            onClick={openMarket}
                            disabled={isRunning}
                            type='button'
                            title={
                                isRunning && marketTradingMode === 'all'
                                    ? 'Cycling through all markets — one trade per market'
                                    : 'Change market'
                            }
                        >
                            {isRunning && <span className='oue__entry-pulse' aria-hidden='true' />}
                            <span className='oue__market-trigger-badge' aria-hidden='true'>
                                {activeMarket.code.split('\n')[0]}
                            </span>
                            <span className='oue__market-trigger-copy'>
                                <span className='oue__market-trigger-label'>Market</span>
                                <span className='oue__market-trigger-short'>
                                    {isRunning ? '↻ ' : ''}{activeMarket.short}
                                </span>
                            </span>
                            <span className={`oue__market-chevron${marketOpen ? ' oue__market-chevron--open' : ''}`}>▼</span>
                        </button>
                        {marketOpen && dropdownPos && createPortal(
                            <div
                                ref={marketDropdownRef}
                                className='oue__market-dropdown'
                                style={{
                                    top: dropdownPos.top,
                                    left: dropdownPos.left,
                                    right: dropdownPos.right,
                                    maxHeight: dropdownPos.maxHeight,
                                    transform: 'none',
                                }}
                            >
                                <div className='oue__market-category'>CONTINUOUS INDICES</div>
                                <div className='oue__market-list'>
                                    {MARKETS.map(m => {
                                        const isActive = symbol === m.symbol;
                                        const [codeMain, codeSub] = m.code.split('\n');
                                        return (
                                            <button
                                                key={m.symbol}
                                                className={`oue__market-row${isActive ? ' oue__market-row--active' : ''}`}
                                                onClick={() => { setSymbol(m.symbol); setMarketOpen(false); }}
                                                disabled={isRunning}
                                                type='button'
                                            >
                                                <span className='oue__market-code'>
                                                    <span className='oue__market-code-main'>{codeMain}</span>
                                                    {codeSub && <span className='oue__market-code-sub'>{codeSub}</span>}
                                                </span>
                                                <span className='oue__market-name'>{m.label}</span>
                                                {isActive && <span className='oue__market-active-icon'>⚡</span>}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>,
                            document.body
                        )}
                    </div>
                </div>

                <div className='oue__course-price-row'>
                    <div className='oue__course-price'>
                        {latestPrice ? (
                            <span>
                                <span className='oue__course-price-body'>{latestPriceBody}</span>
                                <span className='oue__course-price-digit'>{latestPriceDigit}</span>
                            </span>
                        ) : (
                            <span className='oue__course-price-empty'>—</span>
                        )}
                    </div>

                    <div className='oue__course-window'>
                        <span>WINDOW</span>
                        <strong>{DIGIT_WINDOW}</strong>
                        <span>TICKS</span>
                    </div>
                </div>

                <div className='oue__digit-course' aria-label={`Digit distribution over ${digitWindow.length} ticks`}>
                    <div className='oue__digit-course-grid'>
                        {digitCounts.map((count, digit) => {
                            const isCurrent = currentDigit === digit;
                            return (
                                <div
                                    className={`oue__course-digit${isCurrent ? ' oue__course-digit--current' : ''}`}
                                    key={digit}
                                    aria-current={isCurrent ? 'true' : undefined}
                                    aria-label={`Digit ${digit}: ${digitPercentages[digit].toFixed(1)} percent, ${count} ticks${isCurrent ? ', latest generated digit' : ''}`}
                                >
                                    {isCurrent && <span className='oue__course-cursor' aria-hidden='true'>▼</span>}
                                    <span className='oue__course-digit-value'>{digit}</span>
                                    <span className='oue__course-digit-percent'>{digitPercentages[digit].toFixed(1)}%</span>
                                    <span className='oue__course-digit-count'>{count}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className='oue__digit-legend'>
                    <span className='oue__legend-dot oue__legend-dot--over'/>Over 5 (6–9)
                    {entryMode && <><span className='oue__legend-dot oue__legend-dot--entry'/>Entry (4–5)</>}
                    <span className='oue__legend-dot oue__legend-dot--neutral'/>Neutral
                    <span className='oue__legend-dot oue__legend-dot--under'/>Under 4 (0–3)
                </div>

                <div className='oue__latest-digit' aria-live='polite'>
                    <span className='oue__latest-digit-label'>Latest digit</span>
                    <strong>{currentDigit ?? '—'}</strong>
                </div>

                {/* waiting-for-entry status */}
                {isWaitingEntry && (
                    <div className='oue__entry-waiting'>
                        <span className='oue__entry-waiting-dot' />
                        {isSingleStrategyMode
                            ? strategyId === 'over1'
                                ? <>Watching for <strong>3 consecutive digits in the 0–2 bracket</strong> before the next Over 1 trade…</>
                                : strategyId === 'over2'
                                    ? <>Watching for <strong>2 consecutive digits below 2 (0 or 1)</strong> before the next Over 2 trade…</>
                                    : strategyId === 'under8'
                                        ? <>Watching for the sequence <strong>7–9, 7–9, 7–9 → 3–7</strong> before the next Under 8 trade…</>
                                        : strategyId === 'under7'
                                            ? <>Watching for <strong>2 consecutive digits above 7 (8 or 9)</strong> before the next Under 7 trade…</>
                                                : strategyId === 'even'
                                                    ? <>Watching for <strong>5 consecutive odd digits</strong> before the next Even trade…</>
                                                    : strategyId === 'odd'
                                                        ? <>Watching for <strong>5 consecutive even digits</strong> before the next Odd trade…</>
                                                        : `Watching for ${activeStrategyDef?.label} trigger digit${getStrategyEntryDigits(strategyId).length > 1 ? 's' : ''} ${getStrategyEntryDigits(strategyId).join(', ')}…`
                            : <>Watching for <strong>4 → 5</strong> or <strong>5 → 4</strong>, then trading on the next digit…</>}
                        {lastEntryDigit !== null && (
                            <span className='oue__entry-last'>Last entry: <strong>{lastEntryDigit}</strong></span>
                        )}
                        {digits.length > 0 && (
                            <span className='oue__entry-recent'>Recent: {digits.slice(-6).join(' ')}</span>
                        )}
                    </div>
                )}
            </div>

            <div className='oue__strategy-panel'>
                <div className='oue__strategy-header'>
                    <span className='oue__strategy-label'>Strategy</span>
                    <span className='oue__strategy-pill'>
                        {strategyId === 'dual' ? 'Dual Over/Under' : STRATEGY_DEFINITIONS[strategyId].label}
                    </span>
                </div>
                {strategyId !== 'dual' && (
                    <div className='oue__single-stats'>
                        <span>Wins: <strong>{singleWins}</strong></span>
                        <span>Losses: <strong>{singleLosses}</strong></span>
                        <span>Stake: <strong>{singleStake.toFixed(2)}</strong></span>
                        {lastSingleResult && <span>Last: <strong>{lastSingleResult}</strong></span>}
                    </div>
                )}
                {lastSkipReason && <div className='oue__strategy-skip'>{lastSkipReason}</div>}
                {strategyId === 'dual' && lastSignalConfidence !== null && (
                    <div className='oue__strategy-skip'>Signal confidence: <strong>{lastSignalConfidence.toFixed(1)}%</strong></div>
                )}
            </div>

            {/* ── strategy cards ── */}
            {isSingleStrategyMode ? (
                <div className='oue__panel oue__panel--single'>
                    <div className='oue__panel-top'>
                        <span className='oue__panel-name'>{activeStrategyDef?.label.toUpperCase()}</span>
                        <span className='oue__panel-win-pct'>{profitPct(singleWins, singleWins + singleLosses)}% win</span>
                    </div>
                    <div className='oue__panel-subtitle'>
                        {activeStrategyDef?.contractType === 'DIGITEVEN' && 'Digit must be even (0, 2, 4, 6, 8)'}
                        {activeStrategyDef?.contractType === 'DIGITODD' && 'Digit must be odd (1, 3, 5, 7, 9)'}
                        {activeStrategyDef?.contractType === 'DIGITOVER' && `Digit must be ${activeStrategyDef.barrier ? `greater than ${activeStrategyDef.barrier}` : 'above the selected barrier'}`}
                        {activeStrategyDef?.contractType === 'DIGITUNDER' && `Digit must be ${activeStrategyDef.barrier ? `less than ${activeStrategyDef.barrier}` : 'below the selected barrier'}`}
                    </div>
                    <div className='oue__wl-row'>
                        <div className='oue__wl oue__wl--win'>
                            <span className='oue__wl-num'>{singleWins}</span>
                            <span className='oue__wl-label'>WINS</span>
                        </div>
                        <div className='oue__wl-divider' />
                        <div className='oue__wl oue__wl--loss'>
                            <span className='oue__wl-num'>{singleLosses}</span>
                            <span className='oue__wl-label'>LOSSES</span>
                        </div>
                    </div>
                    <div className='oue__panel-stats'>
                        <div className='oue__stat'><span className='oue__stat-label'>Stake</span><span className='oue__stat-val'>{singleStake.toFixed(2)}</span></div>
                    </div>
                    {lastSingleResult && <div className={`oue__badge oue__badge--${lastSingleResult}`}>{lastSingleResult === 'won' ? '✓ WIN' : '✗ LOSS'}</div>}
                </div>
            ) : (
                <div className='oue__panels'>
                    <div className={`oue__panel oue__panel--over${lastOverResult ? ` oue__panel--${lastOverResult}` : ''}`}>
                        <div className='oue__panel-top'>
                            <span className='oue__panel-name'>OVER 5</span>
                            <span className='oue__panel-win-pct'>{profitPct(overWins, overWins + overLosses)}% win</span>
                        </div>
                        <div className='oue__panel-subtitle'>Digit must be 6, 7, 8, or 9</div>
                        <div className='oue__wl-row'>
                            <div className='oue__wl oue__wl--win'>
                                <span className='oue__wl-num'>{overWins}</span>
                                <span className='oue__wl-label'>WINS</span>
                            </div>
                            <div className='oue__wl-divider' />
                            <div className='oue__wl oue__wl--loss'>
                                <span className='oue__wl-num'>{overLosses}</span>
                                <span className='oue__wl-label'>LOSSES</span>
                            </div>
                        </div>
                        <div className='oue__panel-stats'>
                            <div className='oue__stat'><span className='oue__stat-label'>Stake</span><span className='oue__stat-val'>{overCurrentStake.toFixed(2)}</span></div>
                        </div>
                        {lastOverResult && <div className={`oue__badge oue__badge--${lastOverResult}`}>{lastOverResult === 'won' ? '✓ WIN' : '✗ LOSS'}</div>}
                    </div>

                    <div className={`oue__panel oue__panel--under${lastUnderResult ? ` oue__panel--${lastUnderResult}` : ''}`}>
                        <div className='oue__panel-top'>
                            <span className='oue__panel-name'>UNDER 4</span>
                            <span className='oue__panel-win-pct'>{profitPct(underWins, underWins + underLosses)}% win</span>
                        </div>
                        <div className='oue__panel-subtitle'>Digit must be 0, 1, 2, or 3</div>
                        <div className='oue__wl-row'>
                            <div className='oue__wl oue__wl--win'>
                                <span className='oue__wl-num'>{underWins}</span>
                                <span className='oue__wl-label'>WINS</span>
                            </div>
                            <div className='oue__wl-divider' />
                            <div className='oue__wl oue__wl--loss'>
                                <span className='oue__wl-num'>{underLosses}</span>
                                <span className='oue__wl-label'>LOSSES</span>
                            </div>
                        </div>
                        <div className='oue__panel-stats'>
                            <div className='oue__stat'><span className='oue__stat-label'>Stake</span><span className='oue__stat-val'>{underCurrentStake.toFixed(2)}</span></div>
                        </div>
                        {lastUnderResult && <div className={`oue__badge oue__badge--${lastUnderResult}`}>{lastUnderResult === 'won' ? '✓ WIN' : '✗ LOSS'}</div>}
                    </div>
                </div>
            )}

            {/* ── summary bar ── */}
            <div className='oue__summary'>
                <div className='oue__pnl'>
                    <span className='oue__pnl-label'>Total P&amp;L</span>
                    <span className={`oue__pnl-val${totalProfit > 0 ? ' oue__pnl-val--pos' : totalProfit < 0 ? ' oue__pnl-val--neg' : ''}`}>
                        {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)} {currency}
                    </span>
                </div>

                <div className='oue__live-price'>
                    <span className='oue__live-price-label'>Live Price</span>
                    {latestPrice ? (
                        <span className='oue__live-price-val'>
                            <span className='oue__live-price-body'>{latestPriceBody}</span>
                            <span className='oue__live-price-digit'>{latestPriceDigit}</span>
                        </span>
                    ) : (
                        <span className='oue__live-price-empty'>—</span>
                    )}
                </div>

                <div className='oue__rounds'><span className='oue__rounds-label'>Rounds</span><span className='oue__rounds-val'>{totalRounds}</span></div>
                <div className='oue__rounds'><span className='oue__rounds-label'>Market</span><span className='oue__rounds-val' style={{ fontSize: '1.1rem' }}>{activeMarket.short}</span></div>
            </div>


            {/* ── controls ── */}
            <div className='oue__controls'>
                <fieldset className='oue__market-mode'>
                    <legend>Markets to trade</legend>
                    <label className={`oue__market-mode-option${marketTradingMode === 'all' ? ' oue__market-mode-option--active' : ''}`}>
                        <input
                            type='radio'
                            name='market-trading-mode'
                            value='all'
                            checked={marketTradingMode === 'all'}
                            onChange={() => setMarketTradingMode('all')}
                            disabled={isRunning}
                        />
                        <span className='oue__market-mode-option-icon' aria-hidden='true'>↻</span>
                        <span className='oue__market-mode-option-copy'>
                            <strong>All markets</strong>
                            <small>Rotate through every market</small>
                        </span>
                    </label>
                    <label className={`oue__market-mode-option${marketTradingMode === 'selected' ? ' oue__market-mode-option--active' : ''}`}>
                        <input
                            type='radio'
                            name='market-trading-mode'
                            value='selected'
                            checked={marketTradingMode === 'selected'}
                            onChange={() => setMarketTradingMode('selected')}
                            disabled={isRunning}
                        />
                        <span className='oue__market-mode-option-icon' aria-hidden='true'>◎</span>
                        <span className='oue__market-mode-option-copy'>
                            <strong>Selected market</strong>
                            <small>Stay on {activeMarket.short}</small>
                        </span>
                    </label>
                    <small>
                        {marketTradingMode === 'all'
                            ? 'The engine rotates through every market after each round.'
                            : `The engine stays on ${activeMarket.short} until you stop it.`}
                    </small>
                </fieldset>
                <div className='oue__config'>
                    <label className='oue__field'>
                        <span>Trade duration (ticks)</span>
                        <input
                            type='number'
                            min='1'
                            max='365'
                            step='1'
                            value={tradeDuration}
                            onChange={e => setTradeDuration(e.target.value)}
                            disabled={isRunning}
                            className='oue__input'
                            aria-describedby='oue-trade-duration-help'
                        />
                        <small id='oue-trade-duration-help' className='oue__field-help'>
                            Each contract stays open for this many ticks.
                        </small>
                    </label>
                    <label className='oue__field'>
                        <span>Stake ({currency})</span>
                        <input
                            type='number'
                            min='0'
                            step='0.05'
                            value={stake}
                            onChange={e => setStake(e.target.value === '' ? '' : e.target.value)}
                            disabled={isRunning}
                            className='oue__input'
                        />
                    </label>
                    <label className='oue__field'>
                        <span>Take Profit</span>
                        <input
                            type='number'
                            min='0'
                            step='0.5'
                            value={takeProfit}
                            onChange={e => setTakeProfit(e.target.value === '' ? '' : e.target.value)}
                            disabled={isRunning}
                            className='oue__input'
                        />
                    </label>
                    <label className='oue__field'>
                        <span>Stop Loss</span>
                        <input
                            type='number'
                            min='0'
                            step='0.5'
                            value={stopLoss}
                            onChange={e => setStopLoss(e.target.value === '' ? '' : e.target.value)}
                            disabled={isRunning}
                            className='oue__input'
                        />
                    </label>
                </div>

                <label className='oue__entry-toggle'>
                    <span className='oue__entry-toggle-label'>Use Martingale</span>
                    <div
                        className={`oue__toggle${martingaleEnabled ? ' oue__toggle--on' : ''}`}
                        onClick={() => !isRunning && setMartingaleEnabled(value => !value)}
                        role='switch'
                        aria-checked={martingaleEnabled}
                        aria-disabled={isRunning}
                        tabIndex={0}
                        onKeyDown={e => {
                            if (!isRunning && (e.key === ' ' || e.key === 'Enter')) {
                                setMartingaleEnabled(value => !value);
                            }
                        }}
                    >
                        <div className='oue__toggle-thumb' />
                    </div>
                </label>

                {martingaleEnabled && (
                    <label className='oue__field'>
                        <span>Martingale multiplier</span>
                        <input
                            type='number'
                            min='1'
                            step='0.1'
                            value={martingale}
                            onChange={e => setMartingale(e.target.value)}
                            disabled={isRunning}
                            className='oue__input'
                        />
                    </label>
                )}

                <label className='oue__entry-toggle'>
                    <span className='oue__entry-toggle-label'>
                        Bulk purchase
                    </span>
                    <div
                        className={`oue__toggle${bulkEnabled ? ' oue__toggle--on' : ''}`}
                        onClick={() => !isRunning && setBulkEnabled(v => !v)}
                        role='switch'
                        aria-checked={bulkEnabled}
                        aria-disabled={isRunning}
                        tabIndex={0}
                        onKeyDown={e => { if (!isRunning && (e.key === ' ' || e.key === 'Enter')) setBulkEnabled(v => !v); }}
                    >
                        <div className='oue__toggle-thumb' />
                    </div>
                </label>

                {bulkEnabled && (
                    <label className='oue__field'>
                        <span>Bulk count</span>
                        <input
                            type='number'
                            min='1'
                            step='1'
                            value={bulkCount}
                            onChange={e => setBulkCount(e.target.value)}
                            disabled={isRunning}
                            className='oue__input'
                        />
                    </label>
                )}

                <label className='oue__entry-toggle'>
                    <span className='oue__entry-toggle-label'>
                        Entry Point Power Engine
                        <small className='oue__entry-toggle-hint'>Enable advanced entry-point controls</small>
                    </span>
                    <div
                        className={`oue__toggle${powerEngineEnabled ? ' oue__toggle--on' : ''}`}
                        onClick={() => !isRunning && setPowerEngineEnabled(value => !value)}
                        role='switch'
                        aria-checked={powerEngineEnabled}
                        aria-disabled={isRunning}
                        tabIndex={0}
                        onKeyDown={e => {
                            if (!isRunning && (e.key === ' ' || e.key === 'Enter')) {
                                setPowerEngineEnabled(value => !value);
                            }
                        }}
                    >
                        <div className='oue__toggle-thumb' />
                    </div>
                </label>

                <div className='oue__action'>
                    <div className={`oue__status${isRunning ? ' oue__status--running' : ''}`}>
                        {isRunning && <span className='oue__pulse' />}
                        {statusMsg}
                    </div>
                    {!isRunning ? (
                        <button className='oue__btn oue__btn--start' onClick={startEngine}>▶&nbsp;START ENGINE</button>
                    ) : (
                        <button className='oue__btn oue__btn--stop' onClick={() => stopEngine('Stopped by user')}>■&nbsp;STOP</button>
                    )}
                </div>
            </div>
            </>)}
        </div>
    );
});

export default OverUnderEngine;
