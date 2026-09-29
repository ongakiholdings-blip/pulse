import './index-navigator-loader.scss';

type TIndexNavigatorLoaderProps = {
    isInitializing?: boolean;
};

const ECOSYSTEM_APPS = [
    { name: 'YouTube', glyph: '▶', className: 'youtube', href: 'https://www.youtube.com/@index_navigatorke' },
    { name: 'TikTok', glyph: '♪', className: 'tiktok', href: 'https://www.tiktok.com/@indexnavigator' },
    { name: 'WhatsApp', glyph: '◔', className: 'whatsapp', href: 'https://wa.me/+254115335502' },
    { name: 'Telegram', glyph: '➤', className: 'telegram', href: 'https://t.me/index_navigator' },
    {
        name: 'Instagram',
        glyph: '◎',
        className: 'instagram',
        href: 'https://www.instagram.com/index_navigator?igsi=eDE0Yzg3Z2swZHEz',
    },
    { name: 'Deriv', glyph: 'D', className: 'deriv', href: 'https://app.deriv.com' },
    { name: 'MT5', glyph: '5', className: 'mt5', href: 'https://mt5.deriv.com' },
];

const IndexNavigatorLoader = ({ isInitializing = true }: TIndexNavigatorLoaderProps) => (
    <main className='index-navigator-loader' aria-busy={isInitializing} aria-live='polite'>
        <section className='index-navigator-loader__content'>
            <div className='index-navigator-loader__topline' aria-hidden='true'>
            <span>DBOTPULSE</span>
            <span className='index-navigator-loader__topline-status'><i /> INITIALIZING</span>
            </div>
            <div className='index-navigator-loader__orb' aria-hidden='true'>
            <span className='index-navigator-loader__orb-layer index-navigator-loader__orb-layer--one' />
            <span className='index-navigator-loader__orb-layer index-navigator-loader__orb-layer--two' />
            <span className='index-navigator-loader__orb-layer index-navigator-loader__orb-layer--three' />
            <span className='index-navigator-loader__orb-waterline' />
            <span className='index-navigator-loader__orb-bubbles index-navigator-loader__orb-bubbles--one' />
            <span className='index-navigator-loader__orb-bubbles index-navigator-loader__orb-bubbles--two' />
            <span className='index-navigator-loader__orb-glow' />
            <span className='index-navigator-loader__orb-pulse index-navigator-loader__orb-pulse--one' />
            <span className='index-navigator-loader__orb-pulse index-navigator-loader__orb-pulse--two' />
            </div>
            <div className='index-navigator-loader__ecosystem'>
            {ECOSYSTEM_APPS.map(({ name, glyph, className, href }, index) => (
                <a
                    key={name}
                    className={`index-navigator-loader__app index-navigator-loader__app--${className}`}
                    href={href}
                    target='_blank'
                    rel='noreferrer'
                    aria-label={`Open ${name}`}
                    style={{ '--app-index': index } as React.CSSProperties}
                >
                    <b>{glyph}</b>
                    <small>{name}</small>
                </a>
            ))}
            </div>
            <h1>Loading<span>.</span><span>.</span><span>.</span></h1>
            <p>Preparing Deriv and MT5 trading tools</p>
            <div className='index-navigator-loader__modules' aria-hidden='true'>
            <div className='index-navigator-loader__module'>
                <span className='index-navigator-loader__module-icon'>D</span>
                <div><strong>DERIV</strong><small>Market workspace</small></div>
                <i />
            </div>
            <div className='index-navigator-loader__route'><span /></div>
            <div className='index-navigator-loader__module'>
                <span className='index-navigator-loader__module-icon'>5</span>
                <div><strong>MT5</strong><small>Terminal tools</small></div>
                <i />
            </div>
            </div>
            <div className='index-navigator-loader__footer' aria-hidden='true'>
            <span>SECURE SESSION</span>
            <span className='index-navigator-loader__footer-sparkline'><i /><i /><i /><i /><i /><i /><i /><i /></span>
            <span>BUILDING YOUR DESK</span>
            </div>
        </section>
    </main>
);

export default IndexNavigatorLoader;
