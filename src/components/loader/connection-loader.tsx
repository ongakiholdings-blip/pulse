import React, { useEffect, useState } from 'react';
import './connection-loader.scss';

const PHRASES = ['Initializing…', 'Syncing markets…', 'Preparing workspace…'];
const CANDLES = [
    { left: '12%', height: 34, delay: '0s' },
    { left: '22%', height: 52, delay: '0.35s' },
    { left: '34%', height: 42, delay: '0.7s' },
    { left: '66%', height: 48, delay: '0.2s' },
    { left: '78%', height: 58, delay: '0.55s' },
    { left: '88%', height: 36, delay: '0.9s' },
];

const ConnectionLoader = () => {
    const [i, setI] = useState(0);
    const [progress, setProgress] = useState(8);

    useEffect(() => {
        const t = setInterval(() => setI(s => (s + 1) % PHRASES.length), 2400);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        const t = setInterval(() => setProgress(value => (value >= 96 ? 8 : value + 1)), 90);
        return () => clearInterval(t);
    }, []);

    return (
        <div className='conn-loader conn-loader--market' role='status' aria-live='polite'>
            <img className='conn-loader__artwork' src='/loader.jpeg' alt='' aria-hidden='true' />
            <div className='conn-loader__backdrop' aria-hidden='true' />

            <div className='conn-loader__center'>
                <div className='conn-loader__logo-shell'>
                    <div className='conn-loader__candles' aria-hidden='true'>
                        {CANDLES.map((candle, index) => (
                            <span
                                key={index}
                                className={`conn-loader__candle ${index % 3 === 0 ? 'is-red' : ''}`}
                                style={
                                    {
                                        left: candle.left,
                                        '--candle-height': `${candle.height}px`,
                                        animationDelay: candle.delay,
                                    } as React.CSSProperties
                                }
                            >
                                <i />
                            </span>
                        ))}
                    </div>
                </div>

                <div className='conn-loader__meta'>
                    <div className='conn-loader__phrase'>{PHRASES[i]}</div>
                    <div className='conn-loader__progress' aria-label={`Loading ${progress}%`}>
                        <span style={{ width: `${progress}%` }} />
                    </div>
                    <div className='conn-loader__progress-label'>{progress}%</div>
                    <div className='conn-loader__live'>
                        <span className='conn-loader__dot' />
                        <span className='conn-loader__dot' />
                        <span className='conn-loader__dot' />
                    </div>
                </div>
            </div>

            <div className='conn-loader__particles' aria-hidden='true'>
                {Array.from({ length: 10 }).map((_, idx) => (
                    <span key={idx} className={`conn-loader__pconn p-${idx}`} />
                ))}
            </div>
        </div>
    );
};

export default ConnectionLoader;
