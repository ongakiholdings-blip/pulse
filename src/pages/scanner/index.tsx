import { useEffect, useRef, useState } from 'react';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import { useApiBase } from '@/hooks/useApiBase';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { scanMarkets, ScanMode, ScanProgress, UnifiedScanOutput } from '@/components/ai-scanner/ai-scanner-service';
import './scanner.scss';

const replaceNavigatorNumber = (xml: string, varId: string, value: number) => {
    const escaped = varId.replace(/[.*+?^${}()|[\]\\`]/g, '\\$&');
    return xml.replace(
        new RegExp(`(id="${escaped}"[^<]*<\\/field>[\\s\\S]*?<field name="NUM">)[\\d.]+(?=<\\/field>)`),
        `$1${value}`
    );
};

const Scanner = () => {
    const store = useStore();
    const { connectionStatus } = useApiBase();
    const [scanMode, setScanMode] = useState<ScanMode>('overunder');
    const [stake, setStake] = useState('0.5');
    const [martingale, setMartingale] = useState('2.5');
    const [takeProfit, setTakeProfit] = useState('5');
    const [stopLoss, setStopLoss] = useState('8');
    const [output, setOutput] = useState<UnifiedScanOutput | null>(null);
    const [selectedResult, setSelectedResult] = useState<UnifiedScanOutput['best'] | null>(null);
    const [progress, setProgress] = useState<ScanProgress | null>(null);
    const [status, setStatus] = useState('Ready to scan all supported strategies.');
    const [isScanning, setIsScanning] = useState(false);
    const [abortController, setAbortController] = useState<AbortController | null>(null);
    const scanAlarmRef = useRef<HTMLAudioElement | null>(null);

    const stopScanAlarm = () => {
        const alarm = scanAlarmRef.current;
        if (!alarm) return;
        alarm.pause();
        alarm.currentTime = 0;
        scanAlarmRef.current = null;
    };

    const startScanAlarm = () => {
        stopScanAlarm();
        const alarm = document.getElementById('job-done') as HTMLAudioElement | null;
        if (!alarm) {
            console.warn('[Scanner] Scan alarm audio element is unavailable.');
            return;
        }
        alarm.loop = true;
        alarm.currentTime = 0;
        scanAlarmRef.current = alarm;
        void alarm.play().catch(error => {
            console.warn('[Scanner] Scan alarm could not start:', error);
        });
    };

    useEffect(() => stopScanAlarm, []);

    const strategyLabel = {
        overunder: 'Over / Under',
        overunder1: 'Over / Under',
        overunder2: 'Over / Under',
        evenodd: 'Even / Odd',
        risefall: 'Rise / Fall',
        matchesdiffers: 'Matches / Differs',
    }[scanMode];

    const buildNavigatorBot = async () => {
        if (!output?.best) return;
        const xmlModule = await import('../../xml/default_navigator.xml');
        let xml = xmlModule.default;
        const best = selectedResult ?? output.best;
        const purchase = best.tradeType.startsWith('Under')
            ? 'DIGITUNDER'
            : best.tradeType.startsWith('Over')
                ? 'DIGITOVER'
                : best.tradeType.startsWith('Odd')
                    ? 'DIGITODD'
                    : best.tradeType.startsWith('Rise')
                        ? 'CALL'
                        : best.tradeType.startsWith('Fall')
                            ? 'PUT'
                            : best.tradeType.startsWith('Matches')
                                ? 'DIGITMATCH'
                                : 'DIGITDIFF';
        const tradeType = ['Rise', 'Fall'].some(direction => best.tradeType.startsWith(direction))
            ? 'callput'
            : scanMode === 'evenodd'
                ? 'evenodd'
                : scanMode === 'matchesdiffers'
                    ? 'matchesdiffers'
                    : scanMode === 'risefall'
                        ? 'callput'
                        : 'overunder';

        xml = xml.replace(/(<field name="SYMBOL_LIST">)[^<]+/, `$1${best.symbol}`);
        xml = xml.replace(/(<field name="TRADETYPE_LIST">)[^<]+/, `$1${tradeType}`);
        xml = xml.replace(/(<field name="PURCHASE_LIST">)[^<]+/g, `$1${purchase}`);
        const predictionMatch = best.tradeType.match(/\s(\d+)$/);
        if (predictionMatch && (tradeType === 'overunder' || tradeType === 'matchesdiffers')) {
            const prediction = predictionMatch[1];
            xml = xml.replace(
                /(<block type="trade_definition_tradeoptions"[\s\S]*?<mutation xmlns="http:\/\/www\.w3\.org\/1999\/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction=")false("><\/mutation>)/,
                `$1true$2<value name="PREDICTION"><shadow type="math_number_positive"><field name="NUM">${prediction}</field></shadow></value>`
            );
        }
        xml = replaceNavigatorNumber(xml, 'xd#F6X!PKV4M@A!Ya@5R', Number(stake));
        xml = replaceNavigatorNumber(xml, 'I=[4-i8Yh!8yyyJ@i`3I', Number(martingale));
        xml = replaceNavigatorNumber(xml, '1:(EhN=[H:b-?Xr#{Df+', Number(takeProfit));
        xml = replaceNavigatorNumber(xml, 'rXm$y.Rn8Ec_$@!MDo^e', Number(stopLoss));

        store.dashboard.setActiveTab(DBOT_TABS.BOT_BUILDER);
        const workspace = (window as any).Blockly?.derivWorkspace;
        const loadBot = async (targetWorkspace: any) => load({
            block_string: xml,
            workspace: targetWorkspace,
            file_name: 'DEFAULT NAVIGATOR',
            from: save_types.LOCAL,
            show_snackbar: true,
            drop_event: undefined,
            strategy_id: undefined,
            showIncompatibleStrategyDialog: undefined,
        });
        if (workspace) await loadBot(workspace);
        else await new Promise<void>(resolve => setTimeout(async () => {
            const delayedWorkspace = (window as any).Blockly?.derivWorkspace;
            if (delayedWorkspace) await loadBot(delayedWorkspace);
            resolve();
        }, 800));
    };

    const handleLoadBot = async (runImmediately: boolean) => {
        try {
            await buildNavigatorBot();
            if (runImmediately) setTimeout(() => store.run_panel.onRunButtonClick?.(), 600);
        } catch (error) {
            console.error('[Scanner] Failed to load Default Navigator:', error);
            setStatus('Unable to load Default Navigator. Check the bot template.');
        }
    };

    const handleScan = async () => {
        if (isScanning) {
            abortController?.abort();
            stopScanAlarm();
            setIsScanning(false);
            setStatus('Scan stopped by user.');
            return;
        }
        if (connectionStatus !== CONNECTION_STATUS.OPENED || !api_base.api) {
            setStatus('The shared Deriv WebSocket is disconnected. Wait for it to reconnect before scanning.');
            return;
        }

        const controller = new AbortController();
        setAbortController(controller);
        startScanAlarm();
        setIsScanning(true);
        setOutput(null);
        setSelectedResult(null);
        setProgress(null);
        setStatus(`Scanning all markets for ${strategyLabel} pressure…`);

        try {
            const result = await scanMarkets(scanMode, 3000, currentProgress => {
                setProgress(currentProgress);
                setStatus(`Scanning ${currentProgress.symbol} (${currentProgress.index + 1}/${currentProgress.total})…`);
            }, controller.signal);
            if (!controller.signal.aborted) {
                setOutput(result);
                setSelectedResult(result.best);
                setStatus(`Best market found: ${result.best.name} — ${result.best.tradeType} at ${result.best.percentage}.`);
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                console.error('[Scanner] Market scan failed:', error);
                setStatus('Scan failed. Check the connection and try again.');
            }
        } finally {
            stopScanAlarm();
            setIsScanning(false);
            setAbortController(null);
        }
    };

    return (
        <section className='scanner-page' aria-label='Digit Scanner'>
            <div className='scanner-page__shell'>
                <p className='scanner-page__eyebrow'>PULSE AI SCANNER</p>
                <h1>Analysis Dashboard - Digit Scanner</h1>
                <p className={`scanner-page__connection${connectionStatus === CONNECTION_STATUS.OPENED ? ' is-connected' : ''}`}>
                    <span />
                    {connectionStatus === CONNECTION_STATUS.OPENED ? 'DERIV WEBSOCKET CONNECTED' : 'CONNECTING TO DERIV'}
                </p>

                <div className='scanner-page__controls'>
                    <label>
                        <span>Contract set</span>
                        <select value={scanMode} onChange={event => setScanMode(event.target.value as ScanMode)} disabled={isScanning}>
                            <option value='overunder'>Market — Over / Under (all barriers)</option>
                            <option value='evenodd'>Market — Even / Odd</option>
                            <option value='risefall'>Market — Rise / Fall</option>
                            <option value='matchesdiffers'>Market — Matches / Differs</option>
                        </select>
                    </label>
                    <label>
                        <span>Stake</span>
                        <input min='0.35' step='0.01' type='number' value={stake} onChange={event => setStake(event.target.value)} disabled={isScanning} />
                    </label>
                    <label><span>Martingale</span><input min='1' step='0.1' type='number' value={martingale} onChange={event => setMartingale(event.target.value)} disabled={isScanning} /></label>
                    <label><span>Take profit</span><input min='0.01' step='0.01' type='number' value={takeProfit} onChange={event => setTakeProfit(event.target.value)} disabled={isScanning} /></label>
                    <label><span>Stop loss</span><input min='0.01' step='0.01' type='number' value={stopLoss} onChange={event => setStopLoss(event.target.value)} disabled={isScanning} /></label>
                </div>

                <div className='scanner-page__panel'>
                    <div className='scanner-page__panel-header'>
                        <span>MARKETS</span>
                        <strong>{progress ? `${progress.index + 1}/${progress.total}` : 'Waiting for scan data.'}</strong>
                    </div>
                    <div className='scanner-page__log' role='log' aria-live='polite'>
                        <p><b>[INFO]</b> Authenticating AI market matrix…</p>
                        <p><b>[OK]</b> Synthetic stream linked</p>
                        <p><b>[INFO]</b> Scanning volatility clusters…</p>
                        <p><b>[WARNING]</b> Signal pressure is recalculating</p>
                        <p><b>[INFO]</b> Checking last digit sequence…</p>
                        {progress && <p><b>[SCAN]</b> {progress.symbol} is being evaluated</p>}
                    </div>
                </div>

                {output && (
                    <>
                        <div className='scanner-page__result'>
                            <div><span>SELECTED MARKET</span><strong>{(selectedResult ?? output.best).name}</strong></div>
                            <div><span>SIGNAL</span><strong>{(selectedResult ?? output.best).tradeType}</strong></div>
                            <div><span>WIN RATE</span><strong>{(selectedResult ?? output.best).percentage}</strong></div>
                            <div><span>ENTRY DIGIT</span><strong>{(selectedResult ?? output.best).entryPoint ?? '—'}</strong></div>
                        </div>
                        <div className='scanner-page__market-list'>
                            <div className='scanner-page__market-list-header'>
                                <span>ALL MARKETS EVALUATED</span>
                                <strong>{output.all.length} AVAILABLE</strong>
                            </div>
                            {output.all.map(result => (
                                <button
                                    className={`scanner-page__market-row${result.symbol === (selectedResult ?? output.best).symbol ? ' scanner-page__market-row--selected' : ''}`}
                                    key={result.symbol}
                                    onClick={() => setSelectedResult(result)}
                                    type='button'
                                >
                                    <span className='scanner-page__market-rank'>#{output.all.indexOf(result) + 1}</span>
                                    <span className='scanner-page__market-name'>{result.name}</span>
                                    <span className='scanner-page__market-signal'>{result.tradeType}</span>
                                    <span className='scanner-page__market-rate'>{result.percentage}</span>
                                    <span className='scanner-page__market-score'>EDGE {(result.score * 100).toFixed(1)}%</span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                <div className='scanner-page__status'>
                    <b>{isScanning ? 'SCANNING' : 'STANDBY'}</b> {status}
                </div>

                <button
                    className='scanner-page__scan-button'
                    disabled={!isScanning && connectionStatus !== CONNECTION_STATUS.OPENED}
                    onClick={() => void handleScan()}
                    type='button'
                >
                    {isScanning ? 'STOP SCAN' : `SCAN FOR BEST MARKET — ${strategyLabel.toUpperCase()}`}
                </button>
                <div className='scanner-page__bot-actions'>
                    <button disabled={!output || isScanning} onClick={() => void handleLoadBot(false)} type='button'>LOAD BOT</button>
                    <button disabled={!output || isScanning} onClick={() => void handleLoadBot(true)} type='button'>LOAD &amp; RUN</button>
                </div>

                <p className='scanner-page__meta'>Stake {stake} · Analysis window 3,000 ticks</p>
            </div>
        </section>
    );
};

export default Scanner;
