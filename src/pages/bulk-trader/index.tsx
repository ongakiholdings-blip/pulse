import { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { contract_stages } from '@/constants/contract-stage';
import './bulk-trader.scss';

const DIGITS = Array.from({ length: 10 }, (_, digit) => digit);
const MARKET_SYMBOLS: Record<string, string> = {
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
    'Jump 10 Index': 'JD10',
    'Jump 25 Index': 'JD25',
    'Jump 50 Index': 'JD50',
    'Jump 75 Index': 'JD75',
    'Jump 100 Index': 'JD100',
};
const MARKET_OPTIONS = Object.keys(MARKET_SYMBOLS);

const getApiData = (message: any) => message?.data ?? message;

const getDecimalPlaces = (pipSize: number | undefined) => {
    if (!Number.isFinite(pipSize) || !pipSize) return 0;
    if (Number.isInteger(pipSize) && pipSize >= 1) return pipSize;
    const value = String(pipSize);
    return value.includes('e-') ? Number(value.split('e-')[1]) : value.split('.')[1]?.length ?? 0;
};

const formatQuote = (quote: number | string, pipSize?: number) => {
    const rawQuote = String(quote).trim();
    const decimalPlaces = getDecimalPlaces(pipSize);
    if (!decimalPlaces || rawQuote.includes('e')) return rawQuote;
    const [integerPart, decimalPart = ''] = rawQuote.split('.');
    return decimalPart.length >= decimalPlaces
        ? rawQuote
        : `${integerPart}.${decimalPart.padEnd(decimalPlaces, '0')}`;
};

const tradeLabelsFor = (type: string, selectedBarrier: number) =>
    type === 'Even/Odd'
        ? { primary: 'Even', secondary: 'Odd' }
        : type === 'Matches/Differs'
            ? { primary: 'Matches', secondary: 'Differs' }
            : { primary: `Over ${selectedBarrier}`, secondary: `Under ${selectedBarrier}` };

const BulkTrader = () => {
    const [market, setMarket] = useState('Volatility 10 (1s) Index');
    const [tradeType, setTradeType] = useState('Over/Under');
    const [numberOfTicks, setNumberOfTicks] = useState('1000');
    const [tradeTicks, setTradeTicks] = useState('1');
    const [stake, setStake] = useState('0.5');
    const [bulkTrades, setBulkTrades] = useState('1');
    const [barrier, setBarrier] = useState(3);
    const [currentTick, setCurrentTick] = useState('--');
    const [currentDigit, setCurrentDigit] = useState<number | null>(null);
    const [digitHistory, setDigitHistory] = useState<number[]>([]);
    const [tradeStatus, setTradeStatus] = useState('');
    const [isTrading, setIsTrading] = useState(false);
    const [isAutoTraderOpen, setIsAutoTraderOpen] = useState(false);
    const [isAutoTrading, setIsAutoTrading] = useState(false);
    const [autoStopLoss, setAutoStopLoss] = useState('5');
    const [autoTakeProfit, setAutoTakeProfit] = useState('5');
    const [autoSide, setAutoSide] = useState<'primary' | 'secondary'>('primary');
    const subscriptionId = useRef<string | null>(null);
    const contractSubscriptions = useRef<Array<{ unsubscribe: () => void }>>([]);
    const autoCancelRef = useRef(false);
    const { client, transactions, run_panel, summary_card, ui } = useStore();
    const { connectionStatus } = useApiBase();

    useEffect(() => {
        let messageSubscription: { unsubscribe: () => void } | undefined;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let cancelled = false;
        const symbol = MARKET_SYMBOLS[market];
        const historyCount = Math.max(1, Number(numberOfTicks) || 1000);

        const startSubscription = async () => {
            try {
                const api = api_base.api as any;
                if (!api) {
                    retryTimer = setTimeout(() => void startSubscription(), 500);
                    return;
                }
                messageSubscription = api.onMessage().subscribe((message: any) => {
                    const tick = getApiData(message)?.tick;
                    if (cancelled || tick?.symbol !== symbol || tick.quote === undefined) return;
                    const quoteText = formatQuote(tick.quote, tick.pip_size ?? api_base.pip_sizes?.[symbol]);
                    const digit = Number(quoteText.replace(/\D/g, '').slice(-1));
                    if (!Number.isInteger(digit)) return;
                    setCurrentTick(quoteText);
                    setCurrentDigit(digit);
                    setDigitHistory(history => [
                        ...history,
                        digit,
                    ].slice(-historyCount));
                });
                const response = getApiData(await api.send({ ticks: symbol, subscribe: 1 }));
                if (cancelled && response?.subscription?.id) {
                    await api.send({ forget: response.subscription.id });
                    return;
                }
                subscriptionId.current = response?.subscription?.id ?? null;

                const historyResponse = getApiData(await api.send({
                    ticks_history: symbol,
                    count: historyCount,
                    end: 'latest',
                    style: 'ticks',
                }));
                if (cancelled) return;
                const prices = historyResponse?.history?.prices;
                if (Array.isArray(prices)) {
                    const historyPipSize =
                        historyResponse?.pip_size ??
                        historyResponse?.history?.pip_size ??
                        api_base.pip_sizes?.[symbol];
                    setDigitHistory(
                        prices
                            .map((price: number | string) => {
                                const priceText = formatQuote(price, historyPipSize);
                                return Number(priceText.replace(/\D/g, '').slice(-1));
                            })
                            .filter((digit: number) => Number.isInteger(digit))
                            .slice(-historyCount)
                    );
                    const latestPrice = prices[prices.length - 1];
                    if (latestPrice !== undefined) setCurrentTick(String(latestPrice));
                }
            } catch (error) {
                console.error('Bulk Trader tick subscription failed:', error);
                messageSubscription?.unsubscribe();
                messageSubscription = undefined;
                const failedSubscriptionId = subscriptionId.current;
                subscriptionId.current = null;
                if (failedSubscriptionId && api_base.api) {
                    void (api_base.api as any).send({ forget: failedSubscriptionId }).catch((cleanupError: unknown) => {
                        console.error('Bulk Trader failed tick subscription cleanup:', cleanupError);
                    });
                }
                if (!cancelled) retryTimer = setTimeout(() => void startSubscription(), 1000);
            }
        };

        setCurrentTick('--');
        setCurrentDigit(null);
        setDigitHistory([]);
        void startSubscription();
        return () => {
            cancelled = true;
            if (retryTimer) clearTimeout(retryTimer);
            messageSubscription?.unsubscribe();
            const id = subscriptionId.current;
            subscriptionId.current = null;
            if (id && api_base.api) {
                void (api_base.api as any).send({ forget: id }).catch((error: unknown) => {
                    console.error('Bulk Trader tick subscription cleanup failed:', error);
                });
            }
        };
    }, [market, numberOfTicks]);

    useEffect(() => () => {
        autoCancelRef.current = true;
        contractSubscriptions.current.forEach(subscription => subscription.unsubscribe());
        contractSubscriptions.current = [];
        if (run_panel.is_running) {
            run_panel.setIsRunning(false);
            run_panel.setContractStage(contract_stages.NOT_RUNNING);
            (ui as any)?.setAccountSwitcherDisabledMessage?.();
            (ui as any)?.setPromptHandler?.(false);
        }
    }, []);

    useEffect(() => {
        run_panel.registerAiBotStopHandler?.(() => {
            autoCancelRef.current = true;
            setIsAutoTrading(false);
            setTradeStatus('Auto Trader stopped from the transaction panel.');
            contractSubscriptions.current.forEach(subscription => subscription.unsubscribe());
            contractSubscriptions.current = [];
        });
        return () => run_panel.unregisterAiBotStopHandler?.();
    }, [run_panel]);

    const placeTrades = async (side: 'primary' | 'secondary', autoMode = false): Promise<number> => {
        const api = api_base.api as any;
        const amount = Number(stake);
        const duration = Number(tradeTicks);
        const count = Number(bulkTrades);
        const symbol = MARKET_SYMBOLS[market];
        const currency = (api_base as any).account_info?.currency || client?.currency || 'USD';
        const contractType =
            tradeType === 'Even/Odd'
                ? side === 'primary' ? 'DIGITEVEN' : 'DIGITODD'
                : tradeType === 'Matches/Differs'
                    ? side === 'primary' ? 'DIGITMATCH' : 'DIGITDIFF'
                    : side === 'primary' ? 'DIGITOVER' : 'DIGITUNDER';

        if (isTrading || (run_panel.is_running && !autoMode)) return 0;
        if (!api || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(duration) || duration < 1 ||
            !Number.isInteger(count) || count < 1) {
            setTradeStatus('Enter valid stake, trade duration, and bulk trade values.');
            return 0;
        }

        setIsTrading(true);
        setTradeStatus(`Placing ${count} ${tradeLabelsFor(tradeType, barrier)[side]} trade${count > 1 ? 's' : ''}…`);
        if (!autoMode) {
            run_panel.run_id = `run-${Date.now()}`;
            summary_card.clear();
            run_panel.setIsRunning(true);
            run_panel.setContractStage(contract_stages.STARTING);
            run_panel.toggleDrawer(true);
            (ui as any)?.setAccountSwitcherDisabledMessage?.(
                'Account switching is disabled while your bot is running. Please stop your bot before switching accounts.'
            );
            (ui as any)?.setPromptHandler?.(true);
        }

        try {
            const responses = await Promise.all(
                Array.from({ length: count }, () => api.send({
                    buy: '1',
                    price: amount,
                    parameters: {
                        amount,
                        basis: 'stake',
                        contract_type: contractType,
                        currency,
                        duration,
                        duration_unit: 't',
                        underlying_symbol: symbol,
                        ...(contractType === 'DIGITOVER' || contractType === 'DIGITUNDER' || contractType === 'DIGITMATCH' || contractType === 'DIGITDIFF'
                            ? { barrier: String(barrier) }
                            : {}),
                    },
                }))
            );

            const contracts = responses.map((response: any) => getApiData(response)?.buy?.contract_id).filter(Boolean);
            if (!contracts.length) throw new Error('No contracts were purchased');

            responses.forEach((response: any) => {
                const buy = getApiData(response)?.buy;
                if (!buy?.contract_id) return;
                transactions.onBotContractEvent({
                    ...buy,
                    contract_id: buy.contract_id,
                    contract_type: contractType,
                    barrier: String(barrier),
                    underlying_symbol: symbol,
                    currency,
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

            const contractStream = api.onMessage().subscribe((message: any) => {
                const contract = getApiData(message)?.proposal_open_contract;
                if (!contract || !contracts.includes(contract.contract_id)) return;
                transactions.onBotContractEvent(contract);
            });
            contractSubscriptions.current.push(contractStream);
            await Promise.all(contracts.map((contractId: number) => api.send({
                proposal_open_contract: 1,
                contract_id: contractId,
                subscribe: 1,
            })));

            const results = await Promise.all(contracts.map(async (contractId: number) => {
                for (;;) {
                    if (autoCancelRef.current) return 0;
                    const response = getApiData(await api.send({ proposal_open_contract: 1, contract_id: contractId }));
                    const contract = response?.proposal_open_contract;
                    if (contract) transactions.onBotContractEvent(contract);
                    if (contract?.is_sold || contract?.is_expired || ['won', 'lost', 'sold'].includes(contract?.status)) {
                        return Number(contract.profit) || 0;
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }));
            const profit = results.reduce((total, value) => total + value, 0);
            if (!autoCancelRef.current) {
                setTradeStatus(`${contracts.length} trade${contracts.length > 1 ? 's' : ''} settled. P&L ${profit.toFixed(2)}`);
            }
            return profit;
        } catch (error) {
            console.error('Bulk Trader purchase failed:', error);
            if (!autoCancelRef.current) {
                setTradeStatus(error instanceof Error ? error.message : 'Trade failed. Please check the account and stake.');
            }
            return 0;
        } finally {
            contractSubscriptions.current.forEach(subscription => subscription.unsubscribe());
            contractSubscriptions.current = [];
            if (!autoMode) {
                run_panel.setIsRunning(false);
                run_panel.setContractStage(contract_stages.NOT_RUNNING);
                (ui as any)?.setAccountSwitcherDisabledMessage?.();
                (ui as any)?.setPromptHandler?.(false);
            }
            setIsTrading(false);
        }
    };

    const startAutoTrader = async () => {
        const takeProfit = Number(autoTakeProfit);
        const stopLoss = Number(autoStopLoss);
        if (!Number.isFinite(takeProfit) || takeProfit <= 0 || !Number.isFinite(stopLoss) || stopLoss <= 0) {
            setTradeStatus('Enter positive take profit and stop loss values.');
            return;
        }
        if (isAutoTrading || isTrading) return;
        autoCancelRef.current = false;
        setIsAutoTrading(true);
        let totalProfit = 0;
        setTradeStatus('Auto Trader running…');
        run_panel.run_id = `run-${Date.now()}`;
        summary_card.clear();
        run_panel.setIsRunning(true);
        run_panel.setContractStage(contract_stages.STARTING);
        run_panel.toggleDrawer(true);
        (ui as any)?.setAccountSwitcherDisabledMessage?.(
            'Account switching is disabled while your bot is running. Please stop your bot before switching accounts.'
        );
        (ui as any)?.setPromptHandler?.(true);
        while (!autoCancelRef.current && totalProfit < takeProfit && totalProfit > -stopLoss) {
            const roundProfit = await placeTrades(autoSide, true);
            totalProfit = Number((totalProfit + roundProfit).toFixed(2));
            if (!autoCancelRef.current) setTradeStatus(`Auto Trader running — P&L ${totalProfit.toFixed(2)}`);
        }
        setIsAutoTrading(false);
        run_panel.setIsRunning(false);
        run_panel.setContractStage(contract_stages.NOT_RUNNING);
        (ui as any)?.setAccountSwitcherDisabledMessage?.();
        (ui as any)?.setPromptHandler?.(false);
        if (autoCancelRef.current) setTradeStatus(`Auto Trader stopped — P&L ${totalProfit.toFixed(2)}`);
        else if (totalProfit >= takeProfit) setTradeStatus(`Take profit reached — P&L ${totalProfit.toFixed(2)}`);
        else setTradeStatus(`Stop loss reached — P&L ${totalProfit.toFixed(2)}`);
    };

    const stopAutoTrader = () => {
        autoCancelRef.current = true;
        setIsAutoTrading(false);
        setTradeStatus('Stopping Auto Trader…');
    };

    const digitPercentages = DIGITS.map(digit => {
        const count = digitHistory.filter(value => value === digit).length;
        return digitHistory.length ? (count / digitHistory.length) * 100 : 0;
    });
    const tickHistory = digitHistory.slice(-12).map(digit => {
        if (tradeType === 'Even/Odd') return digit % 2 === 0 ? 'E' : 'O';
        if (tradeType === 'Matches/Differs') return digit === barrier ? 'M' : 'D';
        return digit > barrier ? 'O' : 'U';
    });
    const tradeLabels = tradeLabelsFor(tradeType, barrier);

    return (
        <section className='bulk-trader' aria-label='Bulk Trader'>
            <div className='bulk-trader__top-grid'>
                <p className={`bulk-trader__connection${connectionStatus === CONNECTION_STATUS.OPENED ? ' is-connected' : ''}`}>
                    <span />
                    {connectionStatus === CONNECTION_STATUS.OPENED ? 'DERIV WEBSOCKET CONNECTED' : 'CONNECTING TO DERIV'}
                </p>
                <label className='bulk-trader__field'>
                    <span>Market</span>
                    <select value={market} onChange={event => setMarket(event.target.value)}>
                        {MARKET_OPTIONS.map(option => <option key={option}>{option}</option>)}
                    </select>
                </label>
                <label className='bulk-trader__field'>
                    <span>Trade type</span>
                    <select value={tradeType} onChange={event => setTradeType(event.target.value)}>
                        <option>Over/Under</option>
                        <option>Even/Odd</option>
                        <option>Matches/Differs</option>
                    </select>
                </label>
            </div>

            <label className='bulk-trader__field bulk-trader__ticks-field'>
                <span>Number of ticks</span>
                <input min='1' type='number' value={numberOfTicks} onChange={event => setNumberOfTicks(event.target.value)} />
            </label>

            <div className='bulk-trader__market-panel'>
                <div className='bulk-trader__tick-heading'>
                    <span>Current tick</span>
                    <strong>{currentTick}</strong>
                </div>
                <p className='bulk-trader__hint'>Tap a digit below to set barrier: {barrier}</p>
                <div className='bulk-trader__digits'>
                    {DIGITS.map(digit => (
                        <button
                            className={`bulk-trader__digit${digit === barrier ? ' bulk-trader__digit--selected' : ''}${digit === currentDigit ? ' bulk-trader__digit--live' : ''}`}
                            key={digit}
                            onClick={() => setBarrier(digit)}
                            type='button'
                        >
                            <span>{digit}</span>
                            <small>{digitPercentages[digit].toFixed(2)}%</small>
                        </button>
                    ))}
                </div>
                <div className='bulk-trader__history' aria-label='Recent tick history'>
                    {tickHistory.map((result, index) => (
                        <span className={result === 'U' || result === 'O' || result === 'D' ? 'bulk-trader__history-item--under' : ''} key={`${result}-${index}`}>
                            {result}
                        </span>
                    ))}
                </div>
            </div>

            <div className='bulk-trader__settings'>
                <label className='bulk-trader__field'>
                    <span>Trade duration (ticks)</span>
                    <input min='1' type='number' value={tradeTicks} onChange={event => setTradeTicks(event.target.value)} />
                </label>
                <label className='bulk-trader__field'>
                    <span>Stake</span>
                    <input min='0' step='0.01' type='number' value={stake} onChange={event => setStake(event.target.value)} />
                </label>
                <label className='bulk-trader__field'>
                    <span>No. of bulk trades</span>
                    <input min='1' max='150' type='number' value={bulkTrades} onChange={event => setBulkTrades(event.target.value)} />
                </label>
            </div>

            <button className='bulk-trader__auto' onClick={() => setIsAutoTraderOpen(open => !open)} type='button'>
                ⚙ Auto trader
            </button>
            {isAutoTraderOpen && (
                <div className='bulk-trader__auto-widget' role='dialog' aria-label='Auto Trader settings'>
                    <div className='bulk-trader__auto-widget-header'>
                        <strong>Auto Trader</strong>
                        <button aria-label='Close Auto Trader settings' onClick={() => setIsAutoTraderOpen(false)} type='button'>×</button>
                    </div>
                    <label className='bulk-trader__field'><span>Market</span><select value={market} onChange={event => setMarket(event.target.value)}>{MARKET_OPTIONS.map(option => <option key={option}>{option}</option>)}</select></label>
                    <label className='bulk-trader__field'><span>Trade type</span><select value={tradeType} onChange={event => setTradeType(event.target.value)}><option>Over/Under</option><option>Even/Odd</option><option>Matches/Differs</option></select></label>
                    <label className='bulk-trader__field'><span>Trade side</span><select value={autoSide} onChange={event => setAutoSide(event.target.value as 'primary' | 'secondary')}><option value='primary'>{tradeLabels.primary}</option><option value='secondary'>{tradeLabels.secondary}</option></select></label>
                    <div className='bulk-trader__auto-widget-grid'>
                        <label className='bulk-trader__field'><span>Duration (ticks)</span><input min='1' type='number' value={tradeTicks} onChange={event => setTradeTicks(event.target.value)} /></label>
                        <label className='bulk-trader__field'><span>Stake</span><input min='0' step='0.01' type='number' value={stake} onChange={event => setStake(event.target.value)} /></label>
                        <label className='bulk-trader__field'><span>Bulk purchase</span><input min='1' max='150' type='number' value={bulkTrades} onChange={event => setBulkTrades(event.target.value)} /></label>
                        <label className='bulk-trader__field'><span>Stop loss</span><input min='0.01' step='0.01' type='number' value={autoStopLoss} onChange={event => setAutoStopLoss(event.target.value)} /></label>
                        <label className='bulk-trader__field'><span>Take profit</span><input min='0.01' step='0.01' type='number' value={autoTakeProfit} onChange={event => setAutoTakeProfit(event.target.value)} /></label>
                    </div>
                    <div className='bulk-trader__auto-widget-actions'>
                        <button disabled={isAutoTrading || connectionStatus !== CONNECTION_STATUS.OPENED} onClick={() => void startAutoTrader()} type='button'>Start Auto Trader</button>
                        <button disabled={!isAutoTrading} onClick={stopAutoTrader} type='button'>Stop</button>
                    </div>
                </div>
            )}
            <div className='bulk-trader__actions'>
                <button className='bulk-trader__action bulk-trader__action--over' disabled={isTrading || connectionStatus !== CONNECTION_STATUS.OPENED} onClick={() => void placeTrades('primary')} type='button'>
                    <strong>{tradeLabels.primary}</strong><small>59.10%</small>
                </button>
                <button className='bulk-trader__action bulk-trader__action--under' disabled={isTrading || connectionStatus !== CONNECTION_STATUS.OPENED} onClick={() => void placeTrades('secondary')} type='button'>
                    <strong>{tradeLabels.secondary}</strong><small>32.10%</small>
                </button>
            </div>
            {tradeStatus && <p className='bulk-trader__trade-status' role='status'>{tradeStatus}</p>}
        </section>
    );
};

export default BulkTrader;
