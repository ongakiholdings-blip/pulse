import { useEffect, useMemo, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { contract_stages } from '@/constants/contract-stage';
import { type MarketScan, scanMarkets as runMarketScan, scoreDigits } from './digit-scanner';
import { getTradingLimitReason } from './trading-limits';
import './matches-hub.scss';

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);
const MARKETS: Record<string, string> = {
    'Volatility 10 Index': 'R_10',
    'Volatility 25 Index': 'R_25',
    'Volatility 50 Index': 'R_50',
    'Volatility 75 Index': 'R_75',
    'Volatility 100 Index': 'R_100',
    'Volatility 10 (1s) Index': '1HZ10V',
    'Volatility 15 (1s) Index': '1HZ15V',
    'Volatility 25 (1s) Index': '1HZ25V',
    'Volatility 30 (1s) Index': '1HZ30V',
    'Volatility 50 (1s) Index': '1HZ50V',
    'Volatility 75 (1s) Index': '1HZ75V',
    'Volatility 90 (1s) Index': '1HZ90V',
    'Volatility 100 (1s) Index': '1HZ100V',
};

type MatchContract = {
    id: number;
    digit: number;
    entry: string;
    exit: string;
    profit: number;
    status: string;
};

const getApiData = (message: any) => message?.data ?? message;

const getSuccessfulApiData = (message: any) => {
    const data = getApiData(message);
    if (data?.error) {
        throw new Error(data.error.message ?? 'Deriv rejected the live market request.');
    }
    return data;
};

const isAlreadySubscribedError = (error: unknown) => {
    if (error instanceof Error) return error.message.includes('already subscribed');
    return getApiData(error)?.error?.code === 'AlreadySubscribed';
};

const getWebSocketErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    const message = getApiData(error)?.error?.message;
    return typeof message === 'string' ? message : 'Unknown WebSocket error';
};

const formatQuote = (quote: number | string, pipSize?: number) => {
    const rawQuote = String(quote).trim();
    if (!Number.isFinite(pipSize) || !pipSize) return rawQuote;
    const decimalPlaces = Number.isInteger(pipSize) ? pipSize : String(pipSize).split('.')[1]?.length ?? 0;
    if (!decimalPlaces || rawQuote.includes('e')) return rawQuote;
    const [integerPart, decimalPart = ''] = rawQuote.split('.');
    return decimalPart.length >= decimalPlaces ? rawQuote : `${integerPart}.${decimalPart.padEnd(decimalPlaces, '0')}`;
};

const getLastDigit = (quote: number | string, pipSize?: number) =>
    Number(formatQuote(quote, pipSize).replace(/\D/g, '').slice(-1));

const MatchesHub = () => {
    const [market, setMarket] = useState('Volatility 100 Index');
    const [analysisTicks, setAnalysisTicks] = useState('1000');
    const [durationTicks, setDurationTicks] = useState('1');
    const [contractType, setContractType] = useState<'Matches' | 'Differs'>('Matches');
    const [batch, setBatch] = useState<'One digit' | 'Up to 5 digits (batch)'>('One digit');
    const [aiEnabled, setAiEnabled] = useState(true);
    const [candidateCount, setCandidateCount] = useState(1);
    const [stake, setStake] = useState('1');
    const [stopLoss, setStopLoss] = useState('10');
    const [takeProfit, setTakeProfit] = useState('10');
    const [sessionProfit, setSessionProfit] = useState(0);
    const [selectedDigits, setSelectedDigits] = useState<number[]>([]);
    const [currentTick, setCurrentTick] = useState('--');
    const [digitHistory, setDigitHistory] = useState<number[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isAutoRunning, setIsAutoRunning] = useState(false);
    const [status, setStatus] = useState('Connecting to live market data…');
    const [contracts, setContracts] = useState<MatchContract[]>([]);
    const [isScanning, setIsScanning] = useState(false);
    const [scanResults, setScanResults] = useState<MarketScan[]>([]);
    const subscriptionId = useRef<string | null>(null);
    const contractIds = useRef<Set<number>>(new Set());
    const settlementWaiters = useRef(new Map<number, (profit: number) => void>());
    const autoRunActive = useRef(false);
    const isUnmounted = useRef(false);
    const liveDigits = useRef<number[]>([]);
    const { connectionStatus } = useApiBase();
    const { client, transactions, run_panel, ui } = useStore();
    const symbol = MARKETS[market];
    const currency = (api_base as any).account_info?.currency || client?.currency || 'USD';
    const historyCount = Math.min(5000, Math.max(10, Number(analysisTicks) || 1000));

    useEffect(() => {
        let messageSubscription: { unsubscribe: () => void } | undefined;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;
        let subscribedApi: any;
        liveDigits.current = [];

        const startSubscription = async () => {
            const api = api_base.api as any;
            if (!api) {
                setStatus('Waiting for the shared Deriv WebSocket…');
                retryTimer = setTimeout(() => void startSubscription(), 500);
                return;
            }

            subscribedApi = api;
            try {
                messageSubscription = api.onMessage().subscribe((message: any) => {
                    const data = getApiData(message);
                    const tick = data?.tick;
                    if (!cancelled && tick?.symbol === symbol && tick.quote !== undefined) {
                        const pipSize = tick.pip_size ?? api_base.pip_sizes?.[symbol];
                        const quote = formatQuote(tick.quote, pipSize);
                        const digit = getLastDigit(quote, pipSize);
                        if (Number.isInteger(digit)) {
                            setCurrentTick(quote);
                            liveDigits.current = [...liveDigits.current, digit].slice(-historyCount);
                            setDigitHistory(history => [...history, digit].slice(-historyCount));
                            setIsLoading(false);
                        }
                    }

                    const contract = data?.proposal_open_contract;
                    if (contract && contractIds.current.has(contract.contract_id)) {
                        transactions.onBotContractEvent(contract);
                        setContracts(current => current.map(item => (
                            item.id === contract.contract_id
                                ? {
                                    ...item,
                                    entry: String(contract.entry_tick ?? item.entry),
                                    exit: String(contract.exit_tick ?? item.exit),
                                    profit: Number(contract.profit ?? item.profit),
                                    status: contract.is_sold || contract.is_expired
                                        ? String(contract.status ?? 'settled').toUpperCase()
                                        : 'OPEN',
                                }
                                : item
                        )));
                        if (contract.is_sold || contract.is_expired) {
                            contractIds.current.delete(contract.contract_id);
                            const resolveSettlement = settlementWaiters.current.get(contract.contract_id);
                            if (resolveSettlement) {
                                settlementWaiters.current.delete(contract.contract_id);
                                resolveSettlement(Number(contract.profit ?? 0));
                            }
                            const contractSubscriptionId = data?.subscription?.id;
                            if (contractSubscriptionId) {
                                void api.send({ forget: contractSubscriptionId }).catch((error: unknown) => {
                                    console.error('[MatchesHub] Contract subscription cleanup failed:', error);
                                });
                            }
                        }
                    }
                });

                let tickResponse: any;
                try {
                    tickResponse = getSuccessfulApiData(await api.send({ ticks: symbol, subscribe: 1 }));
                } catch (error) {
                    if (!isAlreadySubscribedError(error)) throw error;
                    tickResponse = null;
                }
                if (cancelled) {
                    if (tickResponse?.subscription?.id) await api.send({ forget: tickResponse.subscription.id });
                    return;
                }
                subscriptionId.current = tickResponse?.subscription?.id ?? null;

                const historyResponse = getSuccessfulApiData(await api.send({
                    ticks_history: symbol,
                    count: historyCount,
                    end: 'latest',
                    style: 'ticks',
                }));
                if (cancelled) return;

                const prices: Array<number | string> = historyResponse?.history?.prices ?? [];
                const pipSize =
                    historyResponse?.pip_size ??
                    historyResponse?.history?.pip_size ??
                    api_base.pip_sizes?.[symbol];
                const digits = prices
                    .map(price => getLastDigit(price, pipSize))
                    .filter(Number.isInteger)
                    .slice(-historyCount);
                const liveDigitsAtHistoryResponse = [...liveDigits.current];
                const combinedDigits = [...digits, ...liveDigitsAtHistoryResponse].slice(-historyCount);
                setDigitHistory(combinedDigits);
                if (prices.length && !liveDigitsAtHistoryResponse.length) {
                    setCurrentTick(formatQuote(prices[prices.length - 1], pipSize));
                }
                setIsLoading(false);
                if (!autoRunActive.current) setStatus('Live market feed connected.');
            } catch (error) {
                console.error('[MatchesHub] Live market subscription failed:', error);
                messageSubscription?.unsubscribe();
                messageSubscription = undefined;
                const failedSubscriptionId = subscriptionId.current;
                subscriptionId.current = null;
                if (failedSubscriptionId) {
                    void api.send({ forget: failedSubscriptionId }).catch((cleanupError: unknown) => {
                        console.error('[MatchesHub] Failed tick subscription cleanup failed:', cleanupError);
                    });
                }
                if (!cancelled) {
                    const reason = getWebSocketErrorMessage(error);
                    setStatus(`Could not load live market data: ${reason} Retrying…`);
                    retryTimer = setTimeout(() => void startSubscription(), 1000);
                }
            }
        };

        setIsLoading(true);
        setCurrentTick('--');
        setDigitHistory([]);
        setStatus(connectionStatus === CONNECTION_STATUS.OPENED
            ? 'Loading live market data…'
            : 'Connecting to the shared Deriv WebSocket…');
        void startSubscription();

        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
            messageSubscription?.unsubscribe();
            const id = subscriptionId.current;
            subscriptionId.current = null;
            if (id && subscribedApi) {
                void subscribedApi.send({ forget: id }).catch((error: unknown) => {
                    console.error('[MatchesHub] Tick subscription cleanup failed:', error);
                });
            }
        };
    }, [connectionStatus, historyCount, symbol, transactions]);

    useEffect(() => {
        isUnmounted.current = false;
        return () => {
            isUnmounted.current = true;
            if (!autoRunActive.current) return;
            autoRunActive.current = false;
            settlementWaiters.current.forEach(resolve => resolve(0));
            settlementWaiters.current.clear();
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            (ui as any)?.setAccountSwitcherDisabledMessage?.();
            (ui as any)?.setPromptHandler?.(false);
        };
    }, [run_panel, ui]);

    const counts = useMemo(() => DIGITS.map(digit => digitHistory.filter(value => value === digit).length), [digitHistory]);
    const totalTicks = digitHistory.length;
    const maxCount = Math.max(1, ...counts);
    const minCount = Math.min(...counts);
    const digitRanking = useMemo(
        () => scoreDigits(digitHistory, contractType, candidateCount),
        [candidateCount, contractType, digitHistory]
    );
    const rankedDigits = useMemo(
        () => [...DIGITS].sort((a, b) => counts[b] - counts[a] || a - b),
        [counts]
    );
    const chartDigits = useMemo(
        () => [
            ...rankedDigits.slice(0, 5),
            ...DIGITS.filter(digit => !rankedDigits.slice(0, 5).includes(digit))
                .sort((a, b) => counts[a] - counts[b] || a - b),
        ],
        [counts, rankedDigits]
    );
    const recommendedDigit = rankedDigits[0];
    const liveDigit = currentTick === '--' ? null : getLastDigit(currentTick, api_base.pip_sizes?.[symbol]);
    const aiDigits = digitRanking.picks.map(item => item.digit);
    const tradeDigits = aiEnabled
        ? aiDigits
        : batch === 'One digit' ? selectedDigits.slice(0, 1) : selectedDigits;
    const activeLabel = tradeDigits.length === 0
        ? aiEnabled && !digitRanking.hasEnoughData ? 'Waiting for sufficient tick history' : 'Select a digit to trade'
        : `${contractType} ${tradeDigits.join(', ')}`;

    const scanMarkets = async () => {
        const api = api_base.api as any;
        if (!api || connectionStatus !== CONNECTION_STATUS.OPENED) {
            setStatus('The shared Deriv WebSocket is disconnected. Reconnect before scanning.');
            return;
        }
        if (isScanning) return;
        setIsScanning(true);
        setStatus(`Scanning ${Object.keys(MARKETS).length} markets�`);
        try {
            const results = await runMarketScan({
                api,
                markets: MARKETS,
                contract: contractType,
                pickCount: candidateCount,
                tickCount: historyCount,
                getLastDigit,
                onProgress: (done, total) => setStatus(`Scanning markets� ${done}/${total}`),
            });
            setScanResults(results);
            if (!results.length) {
                setStatus('Scan finished but no market returned enough tick history.');
                return;
            }
            const best = results[0];
            setAiEnabled(true);
            setMarket(best.market);
            setStatus(`Scan complete: ${best.market} � ${contractType} ${best.picks.map(pick => pick.digit).join(', ')} (score ${best.score.toFixed(1)}) across ${results.length} markets.`);
        } finally {
            setIsScanning(false);
        }
    };
    const selectDigit = (digit: number) => {
        if (batch === 'One digit') {
            setSelectedDigits([digit]);
            return;
        }
        if (selectedDigits.includes(digit)) {
            setSelectedDigits(selectedDigits.filter(selected => selected !== digit));
        } else if (selectedDigits.length >= 5) {
            setStatus('Batch mode allows up to 5 selected digits.');
        } else {
            setSelectedDigits([...selectedDigits, digit]);
        }
    };

    const tradeSelectedDigit = async () => {
        const api = api_base.api as any;
        const amount = Number(stake);
        if (!api || connectionStatus !== CONNECTION_STATUS.OPENED) {
            setStatus('The shared Deriv WebSocket is disconnected. Reconnect before trading.');
            return;
        }
        const duration = Number(durationTicks);
        const lossLimit = Number(stopLoss);
        const profitLimit = Number(takeProfit);
        if (
            tradeDigits.length === 0 ||
            !Number.isFinite(amount) ||
            amount < 0.35 ||
            !Number.isInteger(duration) ||
            duration < 1 ||
            !Number.isFinite(lossLimit) ||
            lossLimit <= 0 ||
            !Number.isFinite(profitLimit) ||
            profitLimit <= 0
        ) {
            setStatus('Choose at least one digit and enter a valid stake, duration, stop loss, and take profit.');
            return;
        }
        if (run_panel.is_running || autoRunActive.current) return;

        const runConfig = {
            amount,
            duration,
            digits: [...tradeDigits],
            contractType,
            symbol,
            lossLimit,
            profitLimit,
        };
        autoRunActive.current = true;
        setIsAutoRunning(true);
        setSessionProfit(0);
        setStatus('Starting Matches Hub run…');
        run_panel.run_id = `run-${Date.now()}`;
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
        run_panel.toggleDrawer(true);
        (ui as any)?.setAccountSwitcherDisabledMessage?.('Account switching is disabled while the Matches Hub limit run is active.');
        (ui as any)?.setPromptHandler?.(true);

        try {
            let realizedProfit = 0;
            while (autoRunActive.current) {
                setStatus(`Buying ${runConfig.digits.length} ${runConfig.contractType.toLowerCase()} contract${runConfig.digits.length === 1 ? '' : 's'}…`);
                run_panel.setContractStage(contract_stages.STARTING);
                const responses = await Promise.all(runConfig.digits.map(digit => api.send({
                    buy: '1',
                    price: runConfig.amount,
                    parameters: {
                        amount: runConfig.amount,
                        basis: 'stake',
                        contract_type: runConfig.contractType === 'Matches' ? 'DIGITMATCH' : 'DIGITDIFF',
                        currency,
                        duration: runConfig.duration,
                        duration_unit: 't',
                        underlying_symbol: runConfig.symbol,
                        barrier: String(digit),
                    },
                })));

                const buys = responses.map((response: any) => getSuccessfulApiData(response)?.buy);
                if (buys.some(buy => !buy)) throw new Error('One or more contracts could not be purchased.');

                const newContracts: MatchContract[] = buys.map((buy: any, index: number) => ({
                    id: buy.contract_id,
                    digit: runConfig.digits[index],
                    entry: String(buy.entry_tick ?? '—'),
                    exit: '—',
                    profit: 0,
                    status: 'OPEN',
                }));
                newContracts.forEach((item, index) => {
                    const buy = buys[index];
                    contractIds.current.add(item.id);
                    transactions.onBotContractEvent({
                        ...buy,
                        contract_id: item.id,
                        contract_type: runConfig.contractType === 'Matches' ? 'DIGITMATCH' : 'DIGITDIFF',
                        barrier: String(item.digit),
                        underlying_symbol: runConfig.symbol,
                        currency,
                        buy_price: buy.buy_price ?? runConfig.amount,
                        date_start: buy.date_start ?? buy.purchase_time ?? Math.floor(Date.now() / 1000),
                        status: 'open',
                        profit: 0,
                        transaction_ids: {
                            ...(buy.transaction_ids ?? {}),
                            buy: buy.transaction_id ?? buy.transaction_ids?.buy ?? item.id,
                        },
                    } as any);
                });
                setContracts(current => [...newContracts, ...current]);
                const settledContracts = Promise.all(newContracts.map(item => new Promise<number>(resolve => {
                    settlementWaiters.current.set(item.id, resolve);
                })));
                await Promise.all(newContracts.map(item => api.send({
                    proposal_open_contract: 1,
                    contract_id: item.id,
                    subscribe: 1,
                })));
                if (isUnmounted.current) {
                    settlementWaiters.current.forEach(resolve => resolve(0));
                    settlementWaiters.current.clear();
                }
                run_panel.setContractStage(contract_stages.RUNNING);
                setStatus(`Waiting for ${newContracts.length} contract${newContracts.length === 1 ? '' : 's'} to settle…`);
                const settledProfits = await settledContracts;
                realizedProfit += settledProfits.reduce((total, profit) => total + profit, 0);
                setSessionProfit(realizedProfit);

                const limitReason = getTradingLimitReason(realizedProfit, runConfig.lossLimit, runConfig.profitLimit);
                if (limitReason) {
                    autoRunActive.current = false;
                    setStatus(
                        `${limitReason === 'take-profit' ? 'Take profit' : 'Stop loss'} reached at ${realizedProfit.toFixed(2)} ${currency}. No more contracts will be opened.`
                    );
                } else if (!autoRunActive.current) {
                    setStatus(`Run stopped after open contracts settled. Session P/L: ${realizedProfit.toFixed(2)} ${currency}.`);
                }
            }
        } catch (error) {
            console.error('[MatchesHub] Trade failed:', error);
            setStatus(error instanceof Error ? error.message : 'Trade failed. Please check the account and stake.');
        } finally {
            autoRunActive.current = false;
            settlementWaiters.current.clear();
            setIsAutoRunning(false);
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            (ui as any)?.setAccountSwitcherDisabledMessage?.();
            (ui as any)?.setPromptHandler?.(false);
        }
    };

    const requestRunStop = () => {
        if (!autoRunActive.current) return;
        autoRunActive.current = false;
        setStatus('Stop requested. Waiting for open contracts to settle before ending the run.');
    };

    const requestRunStopRef = useRef(requestRunStop);
    requestRunStopRef.current = requestRunStop;

    // Lets the shared run-panel Stop button end an auto-run started here.
    useEffect(() => {
        run_panel.registerAiBotStopHandler?.(() => requestRunStopRef.current());
        return () => run_panel.unregisterAiBotStopHandler?.();
    }, [run_panel]);

    return (
        <section className='matches-hub' aria-label='Matches-HUB'>
            <div className='matches-hub__shell'>
                <header className='matches-hub__header'>
                    <div>
                        <p className='matches-hub__eyebrow'>PULSE</p>
                        <h1>♛ Pulse</h1>
                        <p className='matches-hub__connection'>
                            <span className={connectionStatus === CONNECTION_STATUS.OPENED ? 'is-connected' : ''} />
                            {connectionStatus === CONNECTION_STATUS.OPENED ? 'DERIV WEBSOCKET CONNECTED' : 'CONNECTING TO DERIV'}
                        </p>
                    </div>
                    <div className='matches-hub__digit-pills'>
                        <div><span>TOP DIGIT · {totalTicks} TICKS</span><strong>{totalTicks ? recommendedDigit : '—'}</strong></div>
                        <div><span>LIVE LAST DIGIT</span><strong>{liveDigit ?? '—'}</strong></div>
                    </div>
                </header>

                <div className='matches-hub__toolbar'>
                    <label>Market
                        <select value={market} onChange={event => setMarket(event.target.value)}>
                            {Object.keys(MARKETS).map(name => <option key={name}>{name}</option>)}
                        </select>
                    </label>
                    <label>Analysis ticks
                        <input min='10' max='5000' type='number' value={analysisTicks} onChange={event => setAnalysisTicks(event.target.value)} />
                    </label>
                    <div className='matches-hub__quote'><span>LIVE QUOTE</span><strong>{currentTick}</strong></div>
                </div>

                <div className='matches-hub__chart' aria-label='Live digit frequency chart'>
                    {chartDigits.map((digit, index) => {
                        const percentage = totalTicks ? (counts[digit] / totalTicks) * 100 : 0;
                        const height = !totalTicks
                            ? 0
                            : minCount === maxCount
                                ? 85
                                : 8 + ((counts[digit] - minCount) / (maxCount - minCount)) * 77;
                        const isFrequent = index < 5;
                        return (
                            <div className={`matches-hub__bar matches-hub__bar--${isFrequent ? 'green' : 'red'}`} key={digit}>
                                <span>{percentage.toFixed(1)}%</span>
                                <div style={{ height: `${height}%` }} />
                                <strong>{digit}</strong>
                            </div>
                        );
                    })}
                    <div className='matches-hub__chart-divider' aria-hidden='true' />
                    <div className='matches-hub__legend'>
                        <span>● Five most frequent digits</span><span>● Five least frequent digits</span>
                    </div>
                </div>

                <div className='matches-hub__direction'>
                    <button className={contractType === 'Matches' ? 'is-active' : ''} onClick={() => setContractType('Matches')} type='button'>Match selected digit</button>
                    <button className={contractType === 'Differs' ? 'is-active is-red' : 'is-red'} onClick={() => setContractType('Differs')} type='button'>Differ from selected digit</button>
                </div>

                <section className='matches-hub__trade-card'>
                    <div className='matches-hub__section-heading'>
                        <h2>Digit trade dock</h2>
                        <p>Review {market} tick history, then run your selection until the realized stop-loss or take-profit limit is reached.</p>
                    </div>
                    <fieldset className='matches-hub__run-config' disabled={isAutoRunning}>
                    <div className='matches-hub__segmented'>
                        <button className={contractType === 'Matches' ? 'is-active' : ''} onClick={() => setContractType('Matches')} type='button'>Matches</button>
                        <button className={contractType === 'Differs' ? 'is-active is-red' : ''} onClick={() => setContractType('Differs')} type='button'>Differs</button>
                    </div>
                    <div className='matches-hub__selection-mode'>
                        <span id='matches-hub-selection-mode'>Digit selection</span>
                        <div className='matches-hub__segmented' role='group' aria-labelledby='matches-hub-selection-mode'>
                            <button aria-pressed={aiEnabled} className={aiEnabled ? 'is-active' : ''} onClick={() => setAiEnabled(true)} type='button'>AI digit ranking</button>
                            <button
                                aria-pressed={!aiEnabled}
                                className={!aiEnabled ? 'is-active' : ''}
                                onClick={() => {
                                    if (aiEnabled && !selectedDigits.length) setSelectedDigits(aiDigits);
                                    setAiEnabled(false);
                                }}
                                type='button'
                            >
                                Manual selection
                            </button>
                        </div>
                    </div>
                    {aiEnabled ? (
                        <div className='matches-hub__ai-panel'>
                            <div className='matches-hub__ai-controls'>
                                <label htmlFor='matches-hub-candidate-count'>Rank top
                                    <select
                                        id='matches-hub-candidate-count'
                                        value={candidateCount}
                                        onChange={event => setCandidateCount(Number(event.target.value))}
                                    >
                                        {[1, 2, 3, 4, 5].map(count => <option key={count} value={count}>{count} {count === 1 ? 'digit' : 'digits'}</option>)}
                                    </select>
                                </label>
                                <p>{digitRanking.sampleSize} observed ticks · recency-weighted frequency</p>
                                <button
                                    className='matches-hub__scan-button'
                                    disabled={isScanning || connectionStatus !== CONNECTION_STATUS.OPENED}
                                    onClick={() => void scanMarkets()}
                                    type='button'
                                >
                                    {isScanning ? 'Scanning markets…' : `Scan markets � top ${candidateCount} digit${candidateCount === 1 ? '' : 's'}`}
                                </button>
                            </div>
                            {scanResults.length > 0 && (
                                <ol className='matches-hub__scan-results' aria-label='Market scan results'>
                                    {scanResults.slice(0, 5).map((result, index) => (
                                        <li className={result.market === market ? 'is-selected' : ''} key={result.market}>
                                            <button onClick={() => setMarket(result.market)} type='button'>
                                                <span className='matches-hub__candidate-rank'>#{index + 1}</span>
                                                <strong>{result.market}</strong>
                                                <span>{contractType} {result.picks.map(pick => pick.digit).join(', ')}</span>
                                                <small>score {result.score.toFixed(1)}</small>
                                            </button>
                                        </li>
                                    ))}
                                </ol>
                            )}
                            <ol className='matches-hub__ranked-candidates' aria-label={`Top ${candidateCount} observed digit candidates`}>
                                {digitRanking.signals.slice(0, 5).map(item => {
                                    const isSelected = digitRanking.hasEnoughData && item.rank <= candidateCount;
                                    return (
                                        <li
                                            aria-label={`Rank ${item.rank}, digit ${item.digit}, score ${item.score.toFixed(1)}, ${item.strength} signal${isSelected ? ', selected for trade' : ''}`}
                                            className={isSelected ? 'is-selected' : ''}
                                            key={item.digit}
                                        >
                                            <span className='matches-hub__candidate-rank'>#{item.rank}</span>
                                            <strong>{item.digit}</strong>
                                            <span>{item.percent.toFixed(1)}% � {item.recentPercent.toFixed(0)}% recent</span>
                                            <small>score {item.score.toFixed(1)} � {item.strength} � gap {item.gap}</small>
                                        </li>
                                    );
                                })}
                            </ol>
                            {digitRanking.hasEnoughData ? (
                                <p className='matches-hub__ai-context'>
                                    Selected {candidateCount} distinct digit{candidateCount === 1 ? '' : 's'} by {contractType === 'Matches' ? 'over-representation' : 'under-representation'} score. Scores summarize this sample; they do not predict future ticks.
                                </p>
                            ) : (
                                <p className='matches-hub__ai-context matches-hub__ai-context--notice' role='status'>
                                    Need at least 100 valid ticks before selecting ranked digits ({digitRanking.sampleSize}/100 observed).
                                </p>
                            )}
                        </div>
                    ) : (
                        <>
                            <div className='matches-hub__segmented'>
                                <button aria-pressed={batch === 'One digit'} className={batch === 'One digit' ? 'is-active' : ''} onClick={() => {
                                    setBatch('One digit');
                                    setSelectedDigits(current => current.slice(0, 1));
                                }} type='button'>One digit</button>
                                <button aria-pressed={batch === 'Up to 5 digits (batch)'} className={batch === 'Up to 5 digits (batch)' ? 'is-active' : ''} onClick={() => setBatch('Up to 5 digits (batch)')} type='button'>Select up to 5 digits</button>
                            </div>
                            <p className='matches-hub__pick-label'>
                                {batch === 'One digit'
                                    ? 'Choose one digit · live frequencies update with each tick'
                                    : `Choose up to 5 digits (${selectedDigits.length}/5 selected) · each digit opens one contract`}
                            </p>
                            <div className='matches-hub__digits'>
                                {DIGITS.map(digit => (
                                    <button
                                        className={selectedDigits.includes(digit) ? 'is-selected' : ''}
                                        key={digit}
                                        onClick={() => selectDigit(digit)}
                                        type='button'
                                        aria-pressed={selectedDigits.includes(digit)}
                                    >
                                        {digit}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                    <div className='matches-hub__inputs matches-hub__primary-inputs'>
                        <label>Stake ({currency})<input min='0.35' step='0.01' type='number' value={stake} onChange={event => setStake(event.target.value)} /></label>
                        <label>Duration (ticks)<input min='1' max='5000' type='number' value={durationTicks} onChange={event => setDurationTicks(event.target.value)} /></label>
                    </div>
                    <div className='matches-hub__inputs matches-hub__limits'>
                        <label>Stop loss ({currency})<input aria-label={`Stop loss in ${currency}`} min='0.01' step='0.01' type='number' value={stopLoss} onChange={event => setStopLoss(event.target.value)} /></label>
                        <label>Take profit ({currency})<input aria-label={`Take profit in ${currency}`} min='0.01' step='0.01' type='number' value={takeProfit} onChange={event => setTakeProfit(event.target.value)} /></label>
                    </div>
                    </fieldset>
                    <p className='matches-hub__limit-note'>Limits use realized session P/L and are checked after each selected-digit batch settles. Stop Run prevents another batch; open contracts settle normally.</p>
                    <p className='matches-hub__session-profit' aria-live='polite'>Session realized P/L: {sessionProfit.toFixed(2)} {currency}</p>
                    <button
                        className='matches-hub__trade-button'
                        disabled={isAutoRunning
                            ? !autoRunActive.current
                            : tradeDigits.length === 0 || isLoading || connectionStatus !== CONNECTION_STATUS.OPENED}
                        onClick={() => isAutoRunning ? requestRunStop() : void tradeSelectedDigit()}
                        type='button'
                    >
                        {isAutoRunning ? autoRunActive.current ? 'STOP RUN' : 'STOPPING…' : activeLabel}
                    </button>
                    <p className='matches-hub__status' role='status'>{status}</p>
                </section>

                <section className='matches-hub__contracts'>
                    <div className='matches-hub__contracts-head'>
                        <h2>Live contracts</h2>
                        <button
                            className='matches-hub__reset-button'
                            disabled={contracts.length === 0}
                            onClick={() => setContracts([])}
                            type='button'
                        >
                            Reset
                        </button>
                    </div>
                    <p>Open positions update from the shared Deriv WebSocket. Reset clears the contract history.</p>
                    <div className='matches-hub__contract-columns'>
                        <div>
                            <strong>OPEN</strong>
                            {contracts.filter(item => item.status === 'OPEN').length
                                ? contracts.filter(item => item.status === 'OPEN').map(item => (
                                    <span key={item.id}>#{item.id} · digit {item.digit} · entry {item.entry} · {item.profit.toFixed(2)} USD</span>
                                ))
                                : <span>No open contracts.</span>}
                        </div>
                        <div>
                            <strong>SETTLED</strong>
                            {contracts.filter(item => item.status !== 'OPEN').length
                                ? contracts.filter(item => item.status !== 'OPEN').map(item => (
                                    <span key={item.id}>#{item.id} · {item.status} · {item.profit.toFixed(2)} USD</span>
                                ))
                                : <span>No settled contracts.</span>}
                        </div>
                    </div>
                </section>
            </div>
        </section>
    );
};

export default MatchesHub;
