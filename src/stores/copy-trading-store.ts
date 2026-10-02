import { action, makeObservable, observable, runInAction } from 'mobx';
import { CopyAccount, CopyTradeLog, CopyTradingService } from '@/services/copy-trading.service';
import type { DerivAccount } from '@/services/derivws-accounts.service';
import { isDemoAccount } from '@/utils/account-helpers';
import { getMarketingDemoLoginid, isMarketingCR } from '@/utils/marketing-balance';
import { api_base } from '@/external/bot-skeleton/services/api/api-base';

export type FollowerEntry = {
    token: string;
    account: CopyAccount | null;
    status: 'pending' | 'connected' | 'error';
    error: string;
    authMethod?: 'token' | 'api' | 'account';
};

export function resolveAutoFollowerToken({
    currentLoginid,
    isVirtualAccount,
    storedDirectToken,
    storedAccountType,
}: {
    currentLoginid: string;
    isVirtualAccount?: boolean;
    storedDirectToken?: string;
    storedAccountType?: string | null;
}): string | null {
    const token = (storedDirectToken || '').trim();
    const accountType = (storedAccountType || '').trim().toLowerCase();
    const isDemoCurrentAccount = !!isVirtualAccount || isDemoAccount(currentLoginid);

    if (!token) return null;

    if (isDemoCurrentAccount && accountType === 'real') return token;
    if (!isDemoCurrentAccount && accountType === 'demo') return token;
    return null;
}

export function resolvePairedAccountInfo({
    currentLoginid,
    isVirtualAccount,
    accounts,
}: {
    currentLoginid: string;
    isVirtualAccount?: boolean;
    accounts: DerivAccount[] | null;
}): CopyAccount | null {
    if (!accounts?.length) return null;

    const isDemoCurrentAccount = !!isVirtualAccount || isDemoAccount(currentLoginid);
    const preferredType = isDemoCurrentAccount ? 'real' : 'demo';
    const pairedLoginid = isMarketingCR(currentLoginid)
        ? getMarketingDemoLoginid(currentLoginid)
        : null;
    const matchedAccount = accounts.find(account => {
        if (account.account_id === currentLoginid) return false;
        if (pairedLoginid && account.account_id === pairedLoginid) return true;
        return account.account_type === preferredType;
    });

    if (!matchedAccount) return null;

    return {
        token: matchedAccount.account_id,
        loginid: matchedAccount.account_id,
        balance: parseFloat(matchedAccount.balance) || 0,
        currency: matchedAccount.currency || 'USD',
        is_virtual: matchedAccount.account_type === 'demo',
    };
}

export default class CopyTradingStore {
    // ── leader ──────────────────────────────────────────────────────────────
    leader_token = '';
    leader_account: CopyAccount | null = null;
    leader_status: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
    leader_error = '';

    // ── followers ────────────────────────────────────────────────────────────
    followers: FollowerEntry[] = [];
    new_follower_token = '';

    // ── run state ────────────────────────────────────────────────────────────
    is_running = false;
    stake_multiplier = 1;

    // ── trade log ────────────────────────────────────────────────────────────
    trade_log: CopyTradeLog[] = [];

    // ── service errors (shown in UI) ──────────────────────────────────────────
    error_messages: string[] = [];

    // ── internal ─────────────────────────────────────────────────────────────
    private service: CopyTradingService | null = null;
    private followerApiInstance: any = null;
    private followerAccountInfo: any = null;
    private leaderApiInstance: any = null;
    private leaderAccountInfo: any = null;
    private leaderConnectionMethod: 'token' | 'api' | 'account' = 'token';
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private copySessionVersion = 0;
    private copyTargetLoginids: string[] | null = null;

    constructor() {
        makeObservable(this, {
            leader_token: observable,
            leader_account: observable,
            leader_status: observable,
            leader_error: observable,
            followers: observable,
            new_follower_token: observable,
            is_running: observable,
            stake_multiplier: observable,
            trade_log: observable,
            error_messages: observable,

            setLeaderToken: action,
            connectLeader: action,
            disconnectLeader: action,
            setNewFollowerToken: action,
            addFollower: action,
            connectFollowerFromApi: action,
            removeFollower: action,
            startCopying: action,
            stopCopying: action,
            setStakeMultiplier: action,
            clearLog: action,
            dismissError: action,
        });

        if (typeof window !== 'undefined') {
            window.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible' && this.leader_status === 'error' && this.leaderApiInstance) {
                    this.scheduleReconnect();
                }
            });
        }
    }

    // ── actions ───────────────────────────────────────────────────────────────

    setLeaderToken = (token: string) => {
        this.leader_token = token.trim();
    };

    connectLeader = async () => {
        if (!this.leader_token) return;
        this.leader_status = 'connecting';
        this.leader_error = '';
        this.leader_account = null;
        this.leaderConnectionMethod = 'token';
        try {
            this.ensureService();
            const account = await this.service!.connectLeader(
                this.leader_token,
                action((_loginid: string) => {
                    this.leader_status = 'error';
                    this.leader_error = 'Leader connection lost — reconnecting…';
                    if (this.is_running) {
                        this.service?.stopCopying();
                    }
                })
            );
            runInAction(() => {
                this.leader_account = account;
                this.leader_status = 'connected';
            });
        } catch (e: any) {
            runInAction(() => {
                this.leader_status = 'error';
                this.leader_error = e?.message ?? 'Connection failed';
            });
        }
    };

    /**
     * Auto-detect and use the app's current authorized API session as leader.
     * This will only attach if the current session is available (e.g. via
     * `api_base`), and will set the leader_account accordingly.
     */
    connectLeaderFromApi = async (api_instance: any, account_info: any) => {
        this.leader_status = 'connecting';
        this.leader_error = '';
        this.leader_account = null;
        this.leaderApiInstance = api_instance;
        this.leaderAccountInfo = account_info;
        this.leaderConnectionMethod = 'api';
        try {
            this.ensureService();
            const account = await this.service!.connectLeaderFromApi(api_instance, account_info, action((_loginid: string) => {
                this.leader_status = 'error';
                this.leader_error = 'Leader connection lost — reconnecting…';
                if (this.is_running) {
                    this.service?.stopCopying();
                }
                this.scheduleReconnect();
            }));

            runInAction(() => {
                this.leader_account = account;
                this.leader_status = 'connected';
                // store leader_token as marker (not a real API token)
                this.leader_token = account.loginid || '';
            });
        } catch (e: any) {
            runInAction(() => {
                this.leader_status = 'error';
                this.leader_error = e?.message ?? 'Connection failed';
            });
        }
    };

    connectLeaderFromAccount = async (
        websocketUrl: string,
        accountInfo: { loginid: string; balance?: number; currency?: string; is_virtual?: number }
    ) => {
        this.leader_status = 'connecting';
        this.leader_error = '';
        this.leader_account = null;
        this.leaderApiInstance = null;
        this.leaderAccountInfo = accountInfo;
        this.leaderConnectionMethod = 'account';
        try {
            this.ensureService();
            const account = await this.service!.connectLeaderFromWebSocketURL(
                websocketUrl,
                accountInfo,
                action(() => {
                    this.leader_status = 'error';
                    this.leader_error = 'Source account connection lost — reconnecting…';
                    if (this.is_running) this.service?.stopCopying();
                    this.scheduleReconnect();
                })
            );
            runInAction(() => {
                this.leader_account = account;
                this.leader_status = 'connected';
                this.leader_token = account.loginid;
            });
        } catch (error) {
            runInAction(() => {
                this.leader_status = 'error';
                this.leader_error = error instanceof Error ? error.message : 'Connection failed';
            });
        }
    };

    /**
     * Disconnect the leader and reset back to idle so a new token can be entered.
     */
    disconnectLeader = () => {
        this.copySessionVersion++;
        if (this.is_running) {
            this.service?.stopCopying();
            this.is_running = false;
        }
        this.service?.disconnectLeader();
        this.leader_account = null;
        this.leader_status = 'idle';
        this.leader_error = '';
        this.leader_token = '';
        this.leaderConnectionMethod = 'token';
        this.leaderApiInstance = null;
        this.leaderAccountInfo = null;
    };

    setNewFollowerToken = (token: string) => {
        this.new_follower_token = token.trim();
    };

    addFollower = async (tokenOverride?: string) => {
        const token = (tokenOverride ?? this.new_follower_token).trim();
        if (!token) return;
        const existingFollower = this.followers.find(f => f.token === token);
        if (existingFollower?.status === 'connected') return;
        if (existingFollower) {
            this.service?.removeFollower(token);
            existingFollower.status = 'pending';
            existingFollower.error = '';
        }
        // Prevent adding the app's own token (avoid self-replication)
        try {
            const active_loginid = localStorage.getItem('active_loginid') || '';
            const accounts_map = JSON.parse(localStorage.getItem('accountsList') || '{}');
            const local_token = accounts_map[active_loginid] || '';
            if (local_token && token === local_token) {
                const entry: FollowerEntry = {
                    token,
                    account: null,
                    status: 'error',
                    error: 'Cannot add your own token as a follower',
                };
                this.followers.push(entry);
                this.new_follower_token = '';
                return;
            }
            if (this.leader_token && token === this.leader_token) {
                const entry: FollowerEntry = {
                    token,
                    account: null,
                    status: 'error',
                    error: 'Follower token cannot match leader token',
                };
                this.followers.push(entry);
                this.new_follower_token = '';
                return;
            }
        } catch (e) {
            // parsing error — continue
        }

        if (!existingFollower) {
            this.followers.push({
                token,
                account: null,
                status: 'pending',
                error: '',
                authMethod: 'token',
            });
        }
        this.new_follower_token = '';

        try {
            this.ensureService();
            const account = await this.service!.addFollower(
                token,
                action((loginid: string) => {
                    const idx = this.followers.findIndex(f => f.account?.loginid === loginid);
                    if (idx >= 0) {
                        this.followers[idx].status = 'error';
                        this.followers[idx].error = 'Connection lost — reconnect this follower.';
                        if (this.is_running) this.scheduleReconnect();
                    }
                })
            );
            if (account.loginid === this.leader_account?.loginid) {
                this.service.removeFollower(token);
                throw new Error('Destination account must be different from the logged-in source account');
            }
            runInAction(() => {
                const idx = this.followers.findIndex(f => f.token === token);
                if (idx >= 0) {
                    this.followers[idx].account = account;
                    this.followers[idx].status = 'connected';
                }
            });
        } catch (e: any) {
            runInAction(() => {
                const idx = this.followers.findIndex(f => f.token === token);
                if (idx >= 0) {
                    this.followers[idx].status = 'error';
                    this.followers[idx].error = e?.message ?? 'Connection failed';
                }
            });
        }
    };

    connectFollowerFromApi = async (api_instance: any, account_info: any) => {
        const loginid = account_info?.loginid || '';
        if (!loginid) return null;

        this.followerApiInstance = api_instance;
        this.followerAccountInfo = account_info;

        const existing = this.followers.find(f => f.token === loginid || f.account?.loginid === loginid);
        if (existing) {
            existing.status = 'connected';
            existing.error = '';
            return existing.account;
        }

        const entry: FollowerEntry = {
            token: loginid,
            account: null,
            status: 'pending',
            error: '',
            authMethod: 'api',
        };
        this.followers.push(entry);

        try {
            this.ensureService();
            const account = await this.service!.connectFollowerFromApi(api_instance, account_info, action((_loginid: string) => {
                const idx = this.followers.findIndex(f => f.account?.loginid === _loginid || f.token === _loginid);
                if (idx >= 0) {
                    this.followers[idx].status = 'error';
                    this.followers[idx].error = 'Connection lost — reconnect this follower.';
                    if (this.is_running) this.scheduleReconnect();
                }
            }));
            runInAction(() => {
                const idx = this.followers.findIndex(f => f.token === loginid || f.account?.loginid === loginid);
                if (idx >= 0) {
                    this.followers[idx].account = account;
                    this.followers[idx].status = 'connected';
                }
            });
            return account;
        } catch (e: any) {
            runInAction(() => {
                const idx = this.followers.findIndex(f => f.token === loginid || f.account?.loginid === loginid);
                if (idx >= 0) {
                    this.followers[idx].status = 'error';
                    this.followers[idx].error = e?.message ?? 'Connection failed';
                }
            });
            return null;
        }
    };

    connectFollowerFromAccount = async (
        websocketUrl: string,
        accountInfo: { loginid: string; balance?: number; currency?: string; is_virtual?: number }
    ) => {
        const loginid = accountInfo?.loginid || '';
        if (!loginid) return null;
        if (loginid === this.leader_account?.loginid) {
            this.leader_error = 'Source and destination accounts must be different';
            return null;
        }

        const existing = this.followers.find(follower => follower.token === loginid);
        if (existing?.status === 'connected') return existing.account;
        if (existing) {
            existing.status = 'pending';
            existing.error = '';
            existing.authMethod = 'account';
        } else {
            this.followers.push({
                token: loginid,
                account: null,
                status: 'pending',
                error: '',
                authMethod: 'account',
            });
        }

        try {
            this.ensureService();
            const account = await this.service!.connectFollowerFromWebSocketURL(
                websocketUrl,
                accountInfo,
                action(disconnectedLoginid => {
                    const follower = this.followers.find(entry => entry.token === disconnectedLoginid);
                    if (follower) {
                        follower.status = 'error';
                        follower.error = 'Connection lost — reconnecting…';
                        if (this.is_running) this.scheduleReconnect();
                    }
                })
            );
            runInAction(() => {
                const follower = this.followers.find(entry => entry.token === loginid);
                if (follower) {
                    follower.account = account;
                    follower.status = 'connected';
                }
            });
            return account;
        } catch (error) {
            runInAction(() => {
                const follower = this.followers.find(entry => entry.token === loginid);
                if (follower) {
                    follower.status = 'error';
                    follower.error = error instanceof Error ? error.message : 'Connection failed';
                }
            });
            return null;
        }
    };

    removeFollower = (token: string) => {
        this.service?.removeFollower(token);
        this.followers = this.followers.filter(f => f.token !== token);
    };

    private scheduleReconnect = () => {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.recoverFromDisconnect();
        }, 800);
    };

    private recoverFromDisconnect = async () => {
        if ((!this.leaderApiInstance && this.leaderConnectionMethod !== 'account') || !this.leaderAccountInfo) return;
        const wasRunning = this.is_running;
        const sessionVersion = this.copySessionVersion;

        try {
            this.leader_status = 'connecting';
            this.leader_error = '';
            if (this.leaderConnectionMethod === 'account' && this.leaderAccountInfo?.loginid) {
                const { getAccountSocketURL } = await import('@/components/shared/utils/config/config');
                const websocketUrl = await getAccountSocketURL(this.leaderAccountInfo.loginid);
                await this.connectLeaderFromAccount(websocketUrl, this.leaderAccountInfo);
            } else {
                const currentApi = api_base?.api || this.leaderApiInstance;
                const currentAccountInfo = (api_base as any)?.account_info || this.leaderAccountInfo;
                await this.connectLeaderFromApi(currentApi, currentAccountInfo);
            }

            if (this.followerApiInstance && this.followerAccountInfo) {
                await this.connectFollowerFromApi(this.followerApiInstance, this.followerAccountInfo);
            }
            const accountFollowers = this.followers.filter(
                follower => follower.authMethod === 'account' && follower.status !== 'connected'
            );
            for (const follower of accountFollowers) {
                const { getAccountSocketURL } = await import('@/components/shared/utils/config/config');
                const websocketUrl = await getAccountSocketURL(follower.token);
                const accountInfo = follower.account ?? {
                    loginid: follower.token,
                    balance: 0,
                    currency: 'USD',
                };
                await this.connectFollowerFromAccount(websocketUrl, accountInfo);
            }
            const tokenFollowers = this.followers.filter(f => f.account?.token === f.token && f.status !== 'connected');
            for (const follower of tokenFollowers) {
                await this.addFollower(follower.token);
            }
            if (wasRunning && sessionVersion === this.copySessionVersion) {
                await this.startCopying(this.copyTargetLoginids ?? undefined);
            }
        } catch (e: any) {
            this.leader_status = 'error';
            this.leader_error = e?.message ?? 'Reconnect failed';
        }
    };

    startCopying = async (followerLoginids?: string[]) => {
        if (this.is_running) return;
        if (this.leader_status !== 'connected') {
            this.leader_error = 'Connect the logged-in source account before starting';
            return;
        }

        if (!followerLoginids && this.followers.filter(f => f.status === 'connected').length === 0 && this.followerApiInstance && this.followerAccountInfo) {
            await this.connectFollowerFromApi(this.followerApiInstance, this.followerAccountInfo);
        }

        const connectedFollowers = this.followers.filter(f => f.status === 'connected');
        const targetFollowers = followerLoginids
            ? connectedFollowers.filter(follower => followerLoginids.includes(follower.account?.loginid ?? follower.token))
            : connectedFollowers;
        if (targetFollowers.length === 0 || (followerLoginids && targetFollowers.length !== followerLoginids.length)) {
            this.leader_error = 'Add and connect a destination API token before starting';
            return;
        }

        this.copyTargetLoginids = followerLoginids ?? null;
        if (this.service) {
            this.service.stakeMultiplier = this.stake_multiplier;
        }

        try {
            this.service!.startCopying(followerLoginids);
            this.is_running = true;
            this.leader_error = '';
        } catch (e: any) {
            this.copyTargetLoginids = null;
            this.leader_error = e?.message ?? 'Failed to start';
        }
    };

    startDemoToReal = async (destinationLoginid: string) => {
        if (this.is_running) return;
        if (this.leader_status !== 'connected' || !this.leader_account?.is_virtual) {
            this.leader_error = 'Connect a demo account as the source before starting Demo to Real';
            return;
        }
        const destination = this.followers.find(
            follower =>
                follower.status === 'connected' &&
                (follower.account?.loginid ?? follower.token) === destinationLoginid
        );
        if (!destination || destination.account?.is_virtual !== false) {
            this.leader_error = 'Connect a real account as the destination before starting Demo to Real';
            return;
        }
        await this.startCopying([destinationLoginid]);
    };

    stopCopying = () => {
        this.copySessionVersion++;
        this.service?.stopCopying();
        this.is_running = false;
        this.copyTargetLoginids = null;
    };

    setStakeMultiplier = (val: number) => {
        this.stake_multiplier = val;
        if (this.service) this.service.stakeMultiplier = val;
    };

    clearLog = () => {
        this.trade_log = [];
    };

    dismissError = (idx: number) => {
        this.error_messages.splice(idx, 1);
    };

    // ── private ───────────────────────────────────────────────────────────────

    private ensureService() {
        if (!this.service) {
            this.service = new CopyTradingService(
                action((log: CopyTradeLog) => {
                    this.trade_log.unshift(log);
                }),
                action((msg: string) => {
                    console.error('[CopyTrading]', msg);
                    this.error_messages.unshift(msg);
                    // Auto-dismiss after 8 s
                    setTimeout(
                        action(() => {
                            const i = this.error_messages.indexOf(msg);
                            if (i >= 0) this.error_messages.splice(i, 1);
                        }),
                        8000
                    );
                })
            );
        }
    }

    destroy() {
        this.service?.destroy();
        this.service = null;
        this.is_running = false;
    }
}
