import React, { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { localize } from '@deriv-com/translations';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';
import { getAuthInfo } from '@/external/deriv-core/auth/storage';
import { getAccountSocketURL } from '@/components/shared/utils/config/config';
import './copy-trading.scss';

// ── icons ────────────────────────────────────────────────────────────────────

const IconPlay = () => (
    <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor'>
        <polygon points='5 3 19 12 5 21 5 3' />
    </svg>
);
const IconStop = () => (
    <svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor'>
        <rect x='3' y='3' width='18' height='18' rx='2' />
    </svg>
);
const IconClose = () => (
    <svg width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <line x1='18' y1='6' x2='6' y2='18' />
        <line x1='6' y1='6' x2='18' y2='18' />
    </svg>
);
const IconKey = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <circle cx='7.5' cy='15.5' r='5.5' />
        <path d='M21 2l-9.6 9.6' />
        <path d='M15.5 7.5l3 3' />
    </svg>
);
const IconUsers = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' />
        <circle cx='9' cy='7' r='4' />
        <path d='M23 21v-2a4 4 0 0 0-3-3.87' />
        <path d='M16 3.13a4 4 0 0 1 0 7.75' />
    </svg>
);
const IconDemoReal = () => (
    <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <rect x='2' y='3' width='20' height='14' rx='2' />
        <path d='M8 21h8M12 17v4' />
        <path d='M9 10l2 2 4-4' />
    </svg>
);
const IconTag = () => (
    <svg width='40' height='40' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' opacity='0.35'>
        <path d='M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z' />
        <line x1='7' y1='7' x2='7.01' y2='7' />
    </svg>
);
const IconCopy = () => (
    <svg width='52' height='52' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.5' opacity='0.8'>
        <circle cx='12' cy='12' r='3' />
        <path d='M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83' />
    </svg>
);
const IconDisconnect = () => (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2.5'>
        <path d='M18.36 6.64a9 9 0 1 1-12.73 0' />
        <line x1='12' y1='2' x2='12' y2='12' />
    </svg>
);
const IconAlert = () => (
    <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
        <circle cx='12' cy='12' r='10' />
        <line x1='12' y1='8' x2='12' y2='12' />
        <line x1='12' y1='16' x2='12.01' y2='16' />
    </svg>
);
const IconEye = () => (
    <svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8'>
        <path d='M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z' />
        <circle cx='12' cy='12' r='2.8' />
    </svg>
);

// ── helpers ───────────────────────────────────────────────────────────────────

const maskToken = (t: string) => (t.length > 10 ? `${t.slice(0, 4)}...${t.slice(-4)}` : t);
const fmtBalance = (b: number, currency: string) => `${b.toFixed(2)} ${currency}`;
const fmtDate = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// ── main page ─────────────────────────────────────────────────────────────────

const CopyTrading = observer(() => {
    const store = useStore();
    const ct = store.copy_trading;
    const connectingLoginid = useRef('');
    const [selectedSourceLoginid, setSelectedSourceLoginid] = useState('');
    const [selectedDestinationLoginid, setSelectedDestinationLoginid] = useState('');

    const activeLoginid = store.client?.loginid || (api_base as any)?.account_info?.loginid || api_base?.account_id || '';
    const canUseLinkedAccounts = Boolean(getAuthInfo()?.access_token);
    const accountOptions = useMemo(() => {
        const seen = new Set<string>();
        const accounts = (store.client?.account_list ?? [])
            .filter(account => account.loginid && (canUseLinkedAccounts || account.loginid === activeLoginid))
            .map(account => ({
                loginid: account.loginid,
                currency: account.currency || 'USD',
                balance: account.loginid === activeLoginid
                    ? Number(store.client.balance) || account.balance || 0
                    : Number(account.balance) || 0,
                is_virtual: Boolean(account.is_virtual),
            }));

        if (activeLoginid && !accounts.some(account => account.loginid === activeLoginid)) {
            accounts.unshift({
                loginid: activeLoginid,
                currency: store.client?.currency || (api_base as any)?.account_info?.currency || 'USD',
                balance: Number(store.client?.balance) || Number((api_base as any)?.account_info?.balance) || 0,
                is_virtual: Boolean(store.client?.is_virtual),
            });
        }

        return accounts.filter(account => {
            if (seen.has(account.loginid)) return false;
            seen.add(account.loginid);
            return true;
        });
    }, [activeLoginid, canUseLinkedAccounts, store.client?.account_list, store.client?.balance, store.client?.currency, store.client?.is_virtual]);

    const formatAccountOption = (account: (typeof accountOptions)[number]) =>
        `${account.is_virtual ? localize('Demo') : localize('Real')} · ${account.loginid} · ${account.balance.toFixed(2)} ${account.currency}`;

    const handleSourceSelection = (loginid: string) => {
        setSelectedSourceLoginid(loginid);
        if (selectedDestinationLoginid === loginid) {
            setSelectedDestinationLoginid('');
            ct.removeFollower(loginid);
        }
    };

    const handleFollowerKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') ct.addFollower();
    };

    const handleConnectLeader = async () => {
        try {
            const liveApi = api_base?.api || undefined;
            const liveAccountInfo = (api_base as any)?.account_info || {};
            const targetLoginid = selectedSourceLoginid || activeLoginid;
            const account = accountOptions.find(option => option.loginid === targetLoginid);
            if (!targetLoginid || connectingLoginid.current === targetLoginid ||
                (ct.leader_status === 'connected' && ct.leader_account?.loginid === targetLoginid)) {
                return;
            }

            connectingLoginid.current = targetLoginid;
            const accountInfo = account ?? {
                loginid: targetLoginid,
                balance: Number(liveAccountInfo.balance) || 0,
                currency: liveAccountInfo.currency || store.client?.currency || 'USD',
                is_virtual: isDemoAccount(targetLoginid),
            };
            if (targetLoginid === activeLoginid && liveApi) {
                await ct.connectLeaderFromApi(liveApi, {
                    ...accountInfo,
                    balance: Number(liveAccountInfo.balance ?? accountInfo.balance) || 0,
                    currency: liveAccountInfo.currency || accountInfo.currency,
                    is_virtual: accountInfo.is_virtual ? 1 : 0,
                });
            } else {
                const websocketUrl = await getAccountSocketURL(targetLoginid);
                await ct.connectLeaderFromAccount(websocketUrl, {
                    ...accountInfo,
                    is_virtual: accountInfo.is_virtual ? 1 : 0,
                });
            }
        } catch (e) {
            console.error('Unable to connect the selected source account:', e);
        } finally {
            connectingLoginid.current = '';
        }
    };

    useEffect(() => {
        if (!selectedSourceLoginid && activeLoginid) {
            setSelectedSourceLoginid(activeLoginid);
        }
        void handleConnectLeader();
        const retryTimer = window.setInterval(() => {
            if (ct.leader_status !== 'connected' && !ct.is_running) {
                void handleConnectLeader();
            }
        }, 1000);

        return () => window.clearInterval(retryTimer);
    }, [activeLoginid, accountOptions, canUseLinkedAccounts, ct, selectedSourceLoginid, store.client]);

    const handleConnectSelectedFollower = async () => {
        const account = accountOptions.find(option => option.loginid === selectedDestinationLoginid);
        if (!account || account.loginid === (selectedSourceLoginid || activeLoginid)) return;

        setSelectedDestinationLoginid(account.loginid);
        if (account.loginid === activeLoginid && api_base?.api) {
            await ct.connectFollowerFromApi(api_base.api, {
                ...account,
                is_virtual: account.is_virtual ? 1 : 0,
            });
            return;
        }

        try {
            const websocketUrl = await getAccountSocketURL(account.loginid);
            await ct.connectFollowerFromAccount(websocketUrl, {
                ...account,
                is_virtual: account.is_virtual ? 1 : 0,
            });
        } catch (error) {
            console.error('Unable to connect the selected destination account:', error);
        }
    };

    const connectedFollowers = ct.followers.filter(f => f.status === 'connected');
    const sourceAccount = ct.leader_account;
    const hasActiveFollower = connectedFollowers.length > 0;
    const hasLoggedInSource = Boolean(activeLoginid && api_base?.api);
    const canStartCopying = !ct.is_running && ct.leader_status === 'connected' && hasActiveFollower;
    const canStartDemoToReal =
        !ct.is_running &&
        ct.leader_status === 'connected' &&
        sourceAccount?.is_virtual === true &&
        sourceAccount.loginid === (selectedSourceLoginid || activeLoginid) &&
        connectedFollowers.some(
            follower =>
                (follower.account?.loginid ?? follower.token) === selectedDestinationLoginid &&
                follower.account?.is_virtual === false
        );
    const canStop = ct.is_running;
    const connectionSummary = ct.is_running
        ? localize('Copy trading is active and listening for new trades.')
        : ct.leader_status === 'connected' && hasActiveFollower
            ? localize('Leader and follower accounts are connected. Press Start to begin copying.')
            : ct.leader_status === 'connected'
            ? localize('Logged-in account is ready. Press Start when the destination account is connected.')
                : ct.leader_status === 'connecting'
                    ? localize('Connecting your account for copy trading…')
                    : localize('Not connected yet. Connect your account to begin.');

    return (
        <div className='ct2'>
            {(ct.error_messages?.length ?? 0) > 0 && (
                <div className='ct2__toasts'>
                    {ct.error_messages.map((msg, i) => (
                        <div key={i} className='ct2__toast'>
                            <IconAlert />
                            <span className='ct2__toast-text'>{msg}</span>
                            <button
                                className='ct2__toast-close'
                                onClick={() => ct.dismissError(i)}
                                aria-label={localize('Dismiss')}
                            >
                                <IconClose />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className='ct2__panel'>
                <header className='ct2__panel-header'>
                    <div>
                        <div className='ct2__title-row'>
                            <h1>{localize('Copy Trading')}</h1>
                            <span className={`ct2__status ct2__status--${ct.is_running || ct.leader_status === 'connected' ? 'active' : 'offline'}`}>
                                <span />
                                {ct.is_running ? localize('Active') : ct.leader_status === 'connected' ? localize('Ready') : localize('Offline')}
                            </span>
                        </div>
                        <p>{localize('Replicate trades from your logged-in account to a destination account.')}</p>
                    </div>
                    <div className='ct2__start-actions'>
                        {!canStop && (
                            <>
                                <button
                                    className='ct2__start-btn ct2__start-btn--demo-real'
                                    onClick={() => void ct.startDemoToReal(selectedDestinationLoginid)}
                                    disabled={!canStartDemoToReal}
                                    title={localize('Copy trades from the selected demo source to the selected real destination')}
                                >
                                    <IconPlay /> {localize('Start Demo → Real')}
                                </button>
                                <button
                                    className='ct2__start-btn ct2__start-btn--api'
                                    onClick={() => void ct.startCopying()}
                                    disabled={!canStartCopying}
                                    title={localize('Activate copying to the destination API token')}
                                >
                                    <IconPlay /> {localize('Activate API Trades')}
                                </button>
                            </>
                        )}
                        <button
                            className={`ct2__start-btn ${ct.is_running ? 'ct2__start-btn--stop' : 'ct2__start-btn--trades'}`}
                            onClick={() => void (ct.is_running ? ct.stopCopying() : ct.startCopying())}
                            disabled={!ct.is_running && !canStartCopying}
                            title={localize('Start or stop live copy trading')}
                            aria-label={ct.is_running ? localize('Stop trades') : localize('Start trades')}
                        >
                            {ct.is_running ? <IconStop /> : <IconPlay />}
                            {ct.is_running ? localize('Stop Trades') : localize('Start Trades')}
                        </button>
                    </div>
                </header>
                <p className='ct2__connection-summary' role='status'>
                    {ct.leader_error || connectionSummary}
                </p>

                <section className='ct2__section'>
                    <div className='ct2__section-heading'>
                        <h2>{localize('Source account')}</h2>
                        {canUseLinkedAccounts && (
                            <select
                                className='ct2__account-select'
                                aria-label={localize('Select source account')}
                                value={selectedSourceLoginid || activeLoginid}
                                onChange={event => handleSourceSelection(event.target.value)}
                                disabled={ct.is_running || ct.leader_status === 'connecting'}
                            >
                                {accountOptions.map(account => (
                                    <option key={account.loginid} value={account.loginid}>
                                        {formatAccountOption(account)}
                                    </option>
                                ))}
                            </select>
                        )}
                        {ct.leader_status === 'connected' && ct.leader_account?.loginid === (selectedSourceLoginid || activeLoginid) ? (
                            <span className='ct2__leader-status'>{localize('Source connected')}</span>
                        ) : (
                            <button
                                className='ct2__connect-btn'
                                onClick={handleConnectLeader}
                                disabled={(!hasLoggedInSource && !canUseLinkedAccounts) || ct.leader_status === 'connecting' || ct.is_running}
                                title={localize('Connect the selected Deriv account as the source')}
                            >
                                {ct.leader_status === 'connecting'
                                    ? localize('Connecting…')
                                    : localize('Connect source account')}
                            </button>
                        )}
                    </div>
                    {sourceAccount ? (
                        <div className='ct2__source-account'>
                            <IconDemoReal />
                            <span>
                                <strong>{sourceAccount.loginid}</strong>
                                <small>{sourceAccount.is_virtual ? localize('Demo / DOT source') : localize('Real / ROT source')}</small>
                                <small className='ct2__source-balance'>
                                    {localize('Available balance')}: {fmtBalance(sourceAccount.balance, sourceAccount.currency)}
                                </small>
                            </span>
                        </div>
                    ) : (
                        <div className='ct2__empty-state'>{localize('Select and connect the account you want to copy trades from.')}</div>
                    )}
                    <p className='ct2__token-help'>
                        {canUseLinkedAccounts
                            ? localize('Choose a linked real or demo account. Its live balance is shown after connecting.')
                            : localize('Connect with Deriv OAuth to select linked real and demo accounts. A direct API token can only access its own account.')}
                    </p>
                </section>

                <section className='ct2__section'>
                    <div className='ct2__section-heading'>
                        <h2>{localize('Destination account')}</h2>
                        <span className='ct2__leader-status'>{localize('Trades are copied here')}</span>
                    </div>
                    <div className='ct2__token-row'>
                        <select
                            className='ct2__account-select ct2__account-select--destination'
                            aria-label={localize('Select destination account')}
                            value={selectedDestinationLoginid}
                            onChange={event => setSelectedDestinationLoginid(event.target.value)}
                            disabled={ct.is_running}
                        >
                            <option value=''>{localize('Select a linked account')}</option>
                            {accountOptions
                                .filter(account => account.loginid !== (selectedSourceLoginid || activeLoginid))
                                .map(account => (
                                    <option key={account.loginid} value={account.loginid}>
                                        {formatAccountOption(account)}
                                    </option>
                                ))}
                        </select>
                        <button
                            className='ct2__add-btn'
                            onClick={() => void handleConnectSelectedFollower()}
                            disabled={
                                !selectedDestinationLoginid ||
                                selectedDestinationLoginid === (selectedSourceLoginid || activeLoginid) ||
                                ct.is_running ||
                                ct.followers.some(follower => follower.token === selectedDestinationLoginid && follower.status === 'connected')
                            }
                        >
                            {ct.followers.some(follower => follower.token === selectedDestinationLoginid && follower.status === 'connected')
                                ? localize('Connected')
                                : localize('Connect account')}
                        </button>
                    </div>
                    <p className='ct2__token-help'>
                        {localize('Select the account that should receive copied trades. The available balance is shown in the account list.')}
                    </p>
                    <div className='ct2__token-row'>
                        <div className='ct2__token-input-wrap'>
                            <input
                                className='ct2__token-input'
                                type='text'
                                placeholder={localize('Or paste a separate destination API token')}
                                value={ct.new_follower_token}
                                onChange={e => ct.setNewFollowerToken(e.target.value)}
                                onKeyDown={handleFollowerKeyDown}
                                disabled={ct.is_running}
                            />
                            <IconEye />
                        </div>
                        <button className='ct2__add-btn' onClick={() => ct.addFollower()} disabled={!ct.new_follower_token || ct.is_running}>
                            + {localize('Add')}
                        </button>
                    </div>
                    <div className='ct2__multiplier-row'>
                        <label className='ct2__multiplier-label' htmlFor='ct2-mult'>{localize('Stake multiplier')}</label>
                        <input id='ct2-mult' className='ct2__multiplier-input' type='number' min='0.01' max='100' step='0.1'
                            value={ct.stake_multiplier} onChange={e => ct.setStakeMultiplier(parseFloat(e.target.value) || 1)}
                            disabled={ct.is_running} />
                        <span className='ct2__multiplier-hint'>{localize('1.0 copies the original stake')}</span>
                    </div>
                </section>

                <section className='ct2__section ct2__clients'>
                    <div className='ct2__section-heading'>
                        <h2>{localize('Connected Clients')}</h2>
                        <span className='ct2__client-count'>{connectedFollowers.length} <small>{ct.followers.length}</small></span>
                    </div>
                    {ct.followers.length === 0 ? (
                        <div className='ct2__empty-state'>{localize('No clients yet')}</div>
                    ) : (
                        <div className='ct2__account-list'>
                            {ct.followers.map(f => (
                                <div key={f.token} className='ct2__account-row'>
                                    <div className='ct2__account-row-left'>
                                        <span className={`ct2__acct-status-dot ct2__acct-status-dot--${f.status}`} />
                                        <div className='ct2__account-row-info'>
                                            <span className='ct2__account-row-id'>{f.account?.loginid ?? maskToken(f.token)}</span>
                                            {f.account && <span className='ct2__account-row-bal'>{fmtBalance(f.account.balance, f.account.currency)}</span>}
                                            {f.status === 'error' && <span className='ct2__account-row-status ct2__account-row-status--err'>{f.error || localize('Error')}</span>}
                                        </div>
                                    </div>
                                    {!ct.is_running && <button className='ct2__remove-btn' title={localize('Remove')} onClick={() => ct.removeFollower(f.token)}><IconClose /></button>}
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
});

export default CopyTrading;
