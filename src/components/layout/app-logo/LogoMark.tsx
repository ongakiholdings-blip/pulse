import { useEffect, useMemo, useState } from 'react';
import {
    getPreviewAppName,
    getPreviewLogo,
    subscribePreviewAppName,
    subscribePreviewLogo,
} from '@/utils/live-branding-store';
import { isPreviewMode } from '@/utils/is-preview-mode';
import { getAppName, LOGO_CANDIDATES } from '../../../utils/branding';

type TLogoMarkProps = {
    height?: number;
};

export const LogoMark = ({ height = 32 }: TLogoMarkProps) => {
    const [previewLogo, setPreviewLogo] = useState<string | null>(getPreviewLogo());
    const [previewAppName, setPreviewAppName] = useState<string | null>(getPreviewAppName());
    const [candidateIndex, setCandidateIndex] = useState(0);

    useEffect(() => subscribePreviewLogo(setPreviewLogo), []);
    useEffect(() => subscribePreviewAppName(setPreviewAppName), []);

    const candidates = useMemo(() => {
        const fileFallbacks = isPreviewMode() ? [] : LOGO_CANDIDATES;
        return previewLogo ? [previewLogo, ...fileFallbacks] : [...fileFallbacks];
    }, [previewLogo]);

    useEffect(() => setCandidateIndex(0), [candidates]);

    const appName = previewAppName || getAppName();
    const logoSrc = candidateIndex < candidates.length ? candidates[candidateIndex] : null;
    const badgeLetter = appName.trim().charAt(0).toUpperCase() || 'A';

    return (
        <span className='app-header__logo-mark'>
            {logoSrc ? (
                <span className='app-header__logo-img-wrapper'>
                    <img
                        data-logo
                        src={logoSrc}
                        alt={appName}
                        className='app-header__logo-img'
                        style={{ height: `${height}px` }}
                        onError={() => setCandidateIndex((index) => index + 1)}
                    />
                </span>
            ) : (
                <span
                    className='app-header__logo-badge'
                    style={{ height: `${height}px`, width: `${height}px` }}
                    aria-hidden='true'
                >
                    {badgeLetter}
                </span>
            )}
            <span className='app-header__logo-copy'>
                <span className='app-header__logo-text'>{appName}</span>
                <span className='app-header__logo-powered-by'>
                    powered by <strong>Deriv</strong>
                </span>
                <span className='app-header__tagline'>Your Deriv trading companion and trading guide</span>
            </span>
        </span>
    );
};
