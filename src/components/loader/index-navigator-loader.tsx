import { useEffect, useState, type CSSProperties } from 'react';
import './index-navigator-loader.scss';

type TIndexNavigatorLoaderProps = {
    isInitializing?: boolean;
    isExiting?: boolean;
};

type TMarket = {
    symbol: string;
    change: number;
};

const MARKET_START: TMarket[] = [
    { symbol: 'EURUSD', change: 0.42 },
    { symbol: 'GBPUSD', change: -0.27 },
    { symbol: 'BTCUSD', change: 1.24 },
    { symbol: 'ETHUSD', change: 1.08 },
    { symbol: 'XAUUSD', change: 0.76 },
    { symbol: 'NAS100', change: 0.63 },
];

const CANDLES = [
    { height: 38, wick: 15, delay: '0s', direction: 'up' },
    { height: 56, wick: 20, delay: '-0.4s', direction: 'down' },
    { height: 44, wick: 13, delay: '-0.8s', direction: 'up' },
    { height: 68, wick: 22, delay: '-1.2s', direction: 'up' },
    { height: 48, wick: 17, delay: '-1.6s', direction: 'down' },
    { height: 60, wick: 20, delay: '-2s', direction: 'up' },
    { height: 40, wick: 15, delay: '-2.4s', direction: 'down' },
    { height: 54, wick: 19, delay: '-2.8s', direction: 'up' },
];

const PARTICLES = Array.from({ length: 18 }, (_, index) => ({
    left: `${(index * 47 + 13) % 100}%`,
    top: `${(index * 61 + 11) % 100}%`,
    delay: `${-((index * 7) % 9)}s`,
    duration: `${7 + (index % 6)}s`,
}));

const PROGRESS_DURATION_MS = 4000;

const IndexNavigatorLoader = ({ isInitializing = true, isExiting = false }: TIndexNavigatorLoaderProps) => {
    const [progress, setProgress] = useState(0);
    const [markets, setMarkets] = useState(MARKET_START);

    useEffect(() => {
        const startedAt = performance.now();
        const timer = window.setInterval(() => {
            const elapsed = performance.now() - startedAt;
            setProgress(Math.min(100, Math.round((elapsed / PROGRESS_DURATION_MS) * 100)));
        }, 40);

        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setMarkets(current =>
                current.map(market => {
                    const movement = (Math.random() - 0.5) * 0.08;
                    return { ...market, change: Math.round((market.change + movement) * 100) / 100 };
                })
            );
        }, 1200);

        return () => window.clearInterval(timer);
    }, []);

    const phase = progress < 20 ? 'boot' : progress < 45 ? 'logo' : progress < 70 ? 'orbit' : progress < 90 ? 'market' : 'ready';
    const status = progress >= 100 ? 'ACCESS GRANTED' : 'INITIALIZING SECURE SESSION';

    return (
        <main
            className={`index-navigator-loader${isExiting ? ' index-navigator-loader--exiting' : ''}`}
            aria-busy={isInitializing}
            aria-live='polite'
            data-phase={phase}
        >
            <div className='index-navigator-loader__ambient' aria-hidden='true'>
                {PARTICLES.map((particle, index) => (
                    <i
                        key={index}
                        style={{
                            left: particle.left,
                            top: particle.top,
                            animationDelay: particle.delay,
                            animationDuration: particle.duration,
                        }}
                    />
                ))}
            </div>

            <div className='index-navigator-loader__layout'>
                <header className='index-navigator-loader__topbar'>
                    <span className='index-navigator-loader__wordmark'>DBOTPULSE</span>
                    <nav aria-label='Trading platform sections'>
                        <span>TRADE</span><i /> <span>ANALYZE</span><i /> <span>GROW</span>
                    </nav>
                    <span className='index-navigator-loader__tagline'>REAL MARKETS. REAL OPPORTUNITIES.</span>
                </header>

                <section className='index-navigator-loader__core' aria-label='DBOTPULSE is loading'>
                    <div className='index-navigator-loader__markets index-navigator-loader__markets--left'>
                        {markets.slice(0, 3).map(market => (
                            <MarketCard key={market.symbol} market={market} />
                        ))}
                    </div>

                    <div className='index-navigator-loader__reactor'>
                        <div className='index-navigator-loader__globe' aria-hidden='true' />
                        <div className='index-navigator-loader__orbit index-navigator-loader__orbit--outer' aria-hidden='true' />
                        <div className='index-navigator-loader__orbit index-navigator-loader__orbit--middle' aria-hidden='true' />
                        <div className='index-navigator-loader__orbit index-navigator-loader__orbit--inner' aria-hidden='true' />
                        <div className='index-navigator-loader__logo' aria-label='DP, powered by Deriv'>
                            <span className='index-navigator-loader__logo-letters'><b>D</b><b>P</b></span>
                            <span className='index-navigator-loader__logo-name'>DBOTPULSE</span>
                            <span className='index-navigator-loader__logo-powered'>POWERED BY DERIV</span>
                        </div>
                        <div className='index-navigator-loader__chart index-navigator-loader__chart--left' aria-hidden='true'>
                            {CANDLES.map((candle, index) => <Candle key={index} candle={candle} index={index} />)}
                        </div>
                        <div className='index-navigator-loader__chart index-navigator-loader__chart--right' aria-hidden='true'>
                            {CANDLES.slice().reverse().map((candle, index) => <Candle key={index} candle={candle} index={index + 2} />)}
                        </div>
                        <div className='index-navigator-loader__platform' aria-hidden='true'>
                            <span /><span /><i />
                        </div>
                    </div>

                    <div className='index-navigator-loader__markets index-navigator-loader__markets--right'>
                        {markets.slice(3).map(market => (
                            <MarketCard key={market.symbol} market={market} />
                        ))}
                    </div>
                </section>

                <section className='index-navigator-loader__loading' aria-label='Loading progress'>
                    <div className='index-navigator-loader__brand-copy'>
                        <h1>DBOT<span>PULSE</span></h1>
                        <p>SMART TRADING <i>/</i> AUTOMATED <i>/</i> RELIABLE</p>
                    </div>
                    <div
                        className='index-navigator-loader__progress'
                        role='progressbar'
                        aria-label='Loading trading workspace'
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress}
                    >
                        <span className='index-navigator-loader__progress-fill' style={{ width: `${progress}%` }} />
                    </div>
                    <div className='index-navigator-loader__progress-meta'>
                        <span>{status}</span>
                        <strong>{progress}%</strong>
                    </div>
                </section>

                <footer className='index-navigator-loader__features' aria-hidden='true'>
                    <span><b>◉</b><strong>SMART BOTS</strong><small>Trade smarter</small></span>
                    <span><b>▥</b><strong>REAL-TIME DATA</strong><small>Stay ahead</small></span>
                    <span><b>⬡</b><strong>SECURE</strong><small>Your funds, our priority</small></span>
                    <span><b>ϟ</b><strong>BUILT FOR YOU</strong><small>Trade without limits</small></span>
                </footer>
            </div>
        </main>
    );
};

const MarketCard = ({ market }: { market: TMarket }) => (
    <div className='index-navigator-loader__market'>
        <span>{market.symbol}</span>
        <strong className={market.change < 0 ? 'is-negative' : 'is-positive'}>
            {market.change >= 0 ? '▲' : '▼'} {Math.abs(market.change).toFixed(2)}%
        </strong>
    </div>
);

const Candle = ({
    candle,
    index,
}: {
    candle: (typeof CANDLES)[number];
    index: number;
}) => (
    <span
        className={`index-navigator-loader__candle index-navigator-loader__candle--${candle.direction}`}
        style={{
            '--candle-height': `${candle.height}%`,
            '--candle-wick': `${candle.wick}%`,
            '--candle-index': index,
            animationDelay: candle.delay,
        } as CSSProperties}
    >
        <i />
    </span>
);

export default IndexNavigatorLoader;
