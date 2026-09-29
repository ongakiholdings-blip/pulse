import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogoMark } from '@/components/layout/app-logo/LogoMark';
import './devtools-guard.scss';

const DETECTION_INTERVAL = 800;
const DIMENSION_THRESHOLD = 160;
const DEVTOOLS_GUARD_ENABLED = false;
const SocialIcon = ({ name }: { name: string }) => {
    const paths: Record<string, React.ReactNode> = {
        YouTube: <path d='M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z' />,
        TikTok: <path d='M15.5 3c.4 2.1 1.6 3.6 3.5 4.2v3.1c-1.3-.1-2.5-.5-3.5-1.2v6.7a5.2 5.2 0 1 1-4.5-5.2v3.2a2.1 2.1 0 1 0 1.4 2V3h3.1z' />,
        WhatsApp: <path d='M17.5 14.4c-.3-.1-1.8-.9-2-.9-.3-.1-.5-.1-.7.1l-.9 1.2c-.2.2-.3.2-.6.1-2.3-1.1-3.8-3-4.3-3.7-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5H7.6c-.3 0-.6.1-.8.4-.3.3-1 1-1 2.5s1 2.9 1.1 3.1c.1.2 2 3.1 5 4.4 2.9 1.3 2.9.9 3.4.9.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.1-1.4-.1-.2-.3-.3-.6-.4zM12 21.5c-1.7 0-3.4-.5-4.8-1.4l-.3-.2-3.6.9 1-3.5-.2-.4A9.5 9.5 0 1 1 12 21.5z' />,
        Telegram: <path d='M22.5 2.2 1.8 10.1c-1.4.6-1.4 1.4-.3 1.8l5.3 1.7 2 6.2c.2.6.1.9.7.9.5 0 .7-.2 1-.5l2.6-2.5 5.4 4c1 .6 1.7.3 2-.9l3.5-16.4c.3-1.5-.5-2.1-1.5-1.6z' />,
        Instagram: <><rect x='3' y='3' width='18' height='18' rx='5' /><circle cx='12' cy='12' r='4' /><circle cx='17.5' cy='6.5' r='1' fill='currentColor' stroke='none' /></>,
    };

    return <svg viewBox='0 0 24 24' aria-hidden='true'>{paths[name]}</svg>;
};

const SOCIAL_LINKS = [
    { label: 'YouTube', href: 'https://www.youtube.com/@index_navigatorke' },
    { label: 'TikTok', href: 'https://www.tiktok.com/@indexnavigator' },
    { label: 'WhatsApp', href: 'https://wa.me/+254115335502' },
    { label: 'Telegram', href: 'https://t.me/index_navigator' },
    { label: 'Instagram', href: 'https://www.instagram.com/index_navigator?igsi=eDE0Yzg3Z2swZHEz' },
];

function detectDevToolsOpen(initialViewport?: { width: number; height: number; outerWidth: number; outerHeight: number }) {
    if (typeof window === 'undefined') return false;

    const widthDiff = window.outerWidth - window.innerWidth;
    const heightDiff = window.outerHeight - window.innerHeight;
    const isLarge = widthDiff > DIMENSION_THRESHOLD || heightDiff > DIMENSION_THRESHOLD;
    const viewportChangedByEmulation =
        initialViewport &&
        window.outerWidth === initialViewport.outerWidth &&
        window.outerHeight === initialViewport.outerHeight &&
        (Math.abs(window.innerWidth - initialViewport.width) > DIMENSION_THRESHOLD ||
            Math.abs(window.innerHeight - initialViewport.height) > DIMENSION_THRESHOLD);

    let isOpened = isLarge || !!viewportChangedByEmulation;

    try {
        const start = performance.now();
        // eslint-disable-next-line no-debugger
        debugger;
        const end = performance.now();
        if (end - start > 100) isOpened = true;
    } catch {
        // ignore
    }

    return isOpened;
}

const DevToolsGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [devtoolsOpen, setDevtoolsOpen] = useState(false);
    const wasOpen = useRef(false);
    const timeoutRef = useRef<number | null>(null);

    useEffect(() => {
        if (!DEVTOOLS_GUARD_ENABLED) return;

        const initialViewport = {
            width: window.innerWidth,
            height: window.innerHeight,
            outerWidth: window.outerWidth,
            outerHeight: window.outerHeight,
        };

        const check = () => {
            const open = detectDevToolsOpen(initialViewport);
            if (open && !devtoolsOpen) {
                setDevtoolsOpen(true);
            }
            if (!open && wasOpen.current) {
                window.location.reload();
            }
            wasOpen.current = open;
        };

        const intervalId = window.setInterval(check, DETECTION_INTERVAL);
        window.addEventListener('resize', check, true);
        check();

        const handleKeyDown = (event: KeyboardEvent) => {
            const keys = [
                'F12',
                'I',
                'J',
                'C',
                'U',
                'M',
            ];
            const lowerKey = event.key.toUpperCase();
            if (
                event.key === 'F12' ||
                ((event.ctrlKey || event.metaKey) && event.shiftKey && keys.includes(lowerKey)) ||
                ((event.ctrlKey || event.metaKey) && lowerKey === 'U')
            ) {
                event.preventDefault();
                setDevtoolsOpen(true);
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);

        return () => {
            window.clearInterval(intervalId);
            window.removeEventListener('resize', check, true);
            window.removeEventListener('keydown', handleKeyDown, true);
            if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        };
    }, []);

    const overlay = useMemo(
        () => (
            <main className='devtools-guard' role='alertdialog' aria-modal='true'>
                <div className='devtools-guard__inner'>
                    <div className='devtools-guard__logo'>
                        <LogoMark height={72} />
                    </div>
                    <h1>Developer tools detected</h1>
                    <p>The app is protected while developer tools are open.</p>
                    <p className='devtools-guard__instruction'>
                        Close Developer Tools completely, then reload this page. The protection will remain active until
                        the tools are closed.
                    </p>
                    <div className='devtools-guard__socials' aria-label='DBOTPULSE social links'>
                        {SOCIAL_LINKS.map(link => (
                            <a key={link.label} href={link.href} target='_blank' rel='noreferrer'>
                                <SocialIcon name={link.label} />
                                <span className='sr-only'>{link.label}</span>
                            </a>
                        ))}
                    </div>
                </div>
            </main>
        ),
        []
    );

    return <>{DEVTOOLS_GUARD_ENABLED && devtoolsOpen ? overlay : children}</>;
};

export default DevToolsGuard;
