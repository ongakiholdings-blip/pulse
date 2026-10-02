/**
 * Copy Trading Service
 *
 * Opens independent WebSocket connections for the leader and each follower,
 * listens to the leader's `transaction` stream, and replicates every `buy`
 * event on all connected follower accounts.
 *
 * Also supports demo → real copying: attach the logged-in demo session as
 * the leader and add only the destination real-account token as a follower.
 */
import DerivAPIBasic from '@deriv/deriv-api/dist/DerivAPIBasic';

// ─── types ──────────────────────────────────────────────────────────────────

export type CopyAccount = {
    token: string;
    loginid: string;
    balance: number;
    currency: string;
    is_virtual: boolean;
};

export type CopyTradeResult = {
    follower_loginid: string;
    /** Redacted token suffix for display only — never the full token. */
    follower_token_hint: string;
    contract_id?: number;
    buy_price?: number;
    error?: string;
    timestamp: number;
};

export type CopyTradeLog = {
    id: string;
    leader_loginid: string;
    leader_contract_id: number;
    symbol: string;
    contract_type: string;
    duration: number;
    duration_unit: string;
    stake: number;
    currency: string;
    timestamp: number;
    results: CopyTradeResult[];
};

type OnTradeCallback = (log: CopyTradeLog) => void;
type OnErrorCallback = (msg: string) => void;

// ─── helpers ─────────────────────────────────────────────────────────────────

const APP_ID = process.env.NEXT_PUBLIC_DERIV_APP_ID || '34dW9DIkkb8AWcPRK27Mh';
const WS_URL = `wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`;

let _logIdCounter = 0;
const nextLogId = () => `ct-${Date.now()}-${++_logIdCounter}`;

export function shouldTreatConnectionAsDisconnected(ws: WebSocket | null | undefined, isBrowserOnline: boolean): boolean {
    if (!ws) return true;
    if (!isBrowserOnline) return false;
    return ws.readyState === WebSocket.CLOSED;
}

export const buildCopyTradeProposalRequest = (params: {
    amount: number;
    basis: string;
    barrier?: string;
    barrier2?: string;
    contract_type: string;
    currency: string;
    duration: number;
    duration_unit: string;
    symbol: string;
}) => ({
    proposal: 1 as const,
    amount: params.amount,
    basis: params.basis,
    contract_type: params.contract_type,
    currency: params.currency,
    duration: params.duration,
    duration_unit: params.duration_unit,
    underlying_symbol: params.symbol,
    ...(params.barrier !== undefined ? { barrier: params.barrier } : {}),
    ...(params.barrier2 !== undefined ? { barrier2: params.barrier2 } : {}),
});

const countDecimals = (value: string | number) => String(value).split('.')[1]?.length ?? 0;

/**
 * Convert a leader's `proposal_open_contract` into the parameters needed to re-buy it.
 * Deriv no longer returns `underlying`, `duration` or `duration_unit` there, and reports barriers as
 * absolute prices, so symbol, duration and the Higher/Lower offset are derived from the other fields.
 */
export const getCopyContractParams = (details: any) => {
    const symbol: string | undefined = details?.underlying_symbol ?? details?.underlying;
    let contract_type: string | undefined = details?.contract_type;

    let duration: number | undefined = details?.duration;
    let duration_unit: string | undefined = details?.duration_unit;
    if (duration === undefined || !duration_unit) {
        const shortcodeTicks = /_(\d+)T_/.exec(details?.shortcode ?? '');
        if (shortcodeTicks) {
            duration = Number(shortcodeTicks[1]);
            duration_unit = 't';
        } else if (details?.tick_count && !details?.date_expiry) {
            duration = Number(details.tick_count);
            duration_unit = 't';
        } else if (details?.date_start && details?.date_expiry) {
            duration = Number(details.date_expiry) - Number(details.date_start);
            duration_unit = 's';
        }
    }

    let barrier: string | undefined = details?.barrier !== undefined ? String(details.barrier) : undefined;
    if (contract_type === 'CALL' || contract_type === 'PUT' || contract_type === 'HIGHER' || contract_type === 'LOWER') {
        const isRelative = barrier !== undefined && /^[+-]/.test(barrier);
        const entry = details?.entry_spot ?? details?.entry_tick;
        if (!isRelative && barrier !== undefined && entry !== undefined) {
            const offset = Number(barrier) - Number(entry);
            const decimals = Math.max(countDecimals(barrier), countDecimals(entry));
            // A barrier on the entry spot is a plain Rise/Fall contract, which takes no barrier.
            barrier = Math.abs(offset) < 10 ** -(decimals + 1) ? undefined : `${offset < 0 ? '-' : '+'}${Math.abs(offset).toFixed(decimals)}`;
        } else if (!isRelative) {
            barrier = undefined;
        }
        if (barrier !== undefined) {
            if (contract_type === 'CALL') contract_type = 'HIGHER';
            if (contract_type === 'PUT') contract_type = 'LOWER';
        }
    }

    return { symbol, contract_type, duration, duration_unit, barrier, barrier2: details?.barrier2 as string | undefined };
};

async function createConnection(
    token: string,
    onDisconnect?: (loginid: string) => void
): Promise<{
    api: InstanceType<typeof DerivAPIBasic>;
    account: CopyAccount;
    ws: WebSocket;
}> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL);
        const api = new DerivAPIBasic({ connection: ws });
        const isBrowserOnline = () => typeof navigator !== 'undefined' ? navigator.onLine : true;
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                ws.close();
                reject(new Error(`Connection timeout for token ...${token.slice(-4)}`));
            }
        }, 15000);

        ws.addEventListener('open', async () => {
            try {
                const res: any = await api.authorize(token);
                clearTimeout(timeout);
                if (res?.error) {
                    ws.close();
                    reject(new Error(res.error.message || 'Authorization failed'));
                    return;
                }
                const auth = res?.authorize;
                if (Array.isArray(auth?.scopes) && !auth.scopes.includes('trade')) {
                    ws.close();
                    reject(new Error('This API token does not have trading permission'));
                    return;
                }
                const account: CopyAccount = {
                    token,
                    loginid: auth?.loginid ?? '',
                    balance: auth?.balance ?? 0,
                    currency: auth?.currency ?? 'USD',
                    is_virtual: !!auth?.is_virtual,
                };
                resolved = true;
                // Only mark the connection as lost when the socket is actually closed
                // and the browser is online. Temporary offline/network blips should not
                // force the copy tool into a disconnected state.
                ws.addEventListener('close', () => {
                    if (shouldTreatConnectionAsDisconnected(ws, isBrowserOnline())) {
                        onDisconnect?.(account.loginid);
                    }
                });
                resolve({ api, ws, account });
            } catch (e: any) {
                clearTimeout(timeout);
                ws.close();
                reject(new Error(e?.message ?? 'Auth error'));
            }
        });

        ws.addEventListener('error', () => {
            if (!resolved) {
                clearTimeout(timeout);
                ws.close();
                reject(
                    new Error(
                        'Could not connect to Deriv. Check that your network, VPN, or browser extensions allow WebSocket connections to ws.derivws.com, then try again.'
                    )
                );
            }
        });
    });
}

async function createAccountConnection(
    websocketUrl: string,
    accountInfo: { loginid: string; balance?: number; currency?: string; is_virtual?: number },
    onDisconnect?: (loginid: string) => void
): Promise<{
    api: InstanceType<typeof DerivAPIBasic>;
    account: CopyAccount;
    ws: WebSocket;
}> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(websocketUrl);
        const api = new DerivAPIBasic({ connection: ws });
        let settled = false;

        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            ws.close();
            reject(error);
        };
        const timeout = setTimeout(() => fail(new Error('Timed out connecting to the selected Deriv account')), 15000);

        ws.addEventListener('open', async () => {
            try {
                const response: any = await api.balance();
                if (response?.error) {
                    fail(new Error(response.error.message || 'Unable to read selected account balance'));
                    return;
                }
                const balance = response?.balance;
                const account: CopyAccount = {
                    token: accountInfo.loginid,
                    loginid: balance?.loginid ?? accountInfo.loginid,
                    balance: Number(balance?.balance ?? accountInfo.balance ?? 0),
                    currency: balance?.currency ?? accountInfo.currency ?? 'USD',
                    is_virtual: !!(accountInfo.is_virtual ?? (balance?.loginid?.startsWith('V'))),
                };
                settled = true;
                clearTimeout(timeout);
                ws.addEventListener('close', () => {
                    if (shouldTreatConnectionAsDisconnected(ws, typeof navigator !== 'undefined' ? navigator.onLine : true)) {
                        onDisconnect?.(account.loginid);
                    }
                });
                resolve({ api, account, ws });
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });

        ws.addEventListener('error', () => {
            if (!settled) {
                clearTimeout(timeout);
                fail(new Error('Could not connect to the selected Deriv account. Check your network and try again.'));
            }
        });
    });
}

/** Fetch full contract details for a given contract_id from the leader API. */
async function fetchContractDetails(
    api: InstanceType<typeof DerivAPIBasic>,
    contract_id: number
): Promise<any> {
    const res: any = await api.send({
        proposal_open_contract: 1,
        contract_id,
    });
    return res?.proposal_open_contract ?? null;
}

/** Get a proposal on a follower connection, then buy it. */
async function replicateTrade(
    followerApi: InstanceType<typeof DerivAPIBasic>,
    params: {
        contract_type: string;
        symbol: string;
        duration: number;
        duration_unit: string;
        amount: number;
        currency: string;
        basis: string;
        barrier?: string;
        barrier2?: string;
    }
): Promise<{ contract_id: number; buy_price: number }> {
    const proposalReq = buildCopyTradeProposalRequest(params);

    const proposalRes: any = await followerApi.send(proposalReq);
    if (proposalRes?.error) {
        throw new Error(proposalRes.error.message || 'Proposal failed');
    }

    const proposal = proposalRes?.proposal;
    if (!proposal?.id) throw new Error('Invalid proposal response');

    const buyRes: any = await followerApi.send({
        buy: proposal.id,
        price: proposal.ask_price,
    });

    if (buyRes?.error) throw new Error(buyRes.error.message || 'Buy failed');

    return {
        contract_id: buyRes?.buy?.contract_id,
        buy_price: buyRes?.buy?.buy_price,
    };
}

// ─── service class ────────────────────────────────────────────────────────────

export class CopyTradingService {
    private leaderConn: { api: InstanceType<typeof DerivAPIBasic>; ws: WebSocket; account: CopyAccount } | null =
        null;

    private followerConns: Map<
        string,
        { api: InstanceType<typeof DerivAPIBasic>; ws: WebSocket; account: CopyAccount }
    > = new Map();

    // Subscription returned by sendAndGetSource().subscribe() — has .unsubscribe()
    private txSubscription: { unsubscribe: () => void } | null = null;
    private targetFollowerLoginids: Set<string> | null = null;

    private onTrade: OnTradeCallback;
    private onError: OnErrorCallback;

    /** Multiplier applied to the leader's stake for all followers (1.0 = same stake). */
    public stakeMultiplier = 1.0;

    constructor(onTrade: OnTradeCallback, onError: OnErrorCallback) {
        this.onTrade = onTrade;
        this.onError = onError;
    }

    /**
     * Attach an existing API instance (for example the app's active WebSocket)
     * as the leader connection. This allows using the currently logged-in
     * session (OAuth) as the leader without requiring the user to paste
     * their API token again.
     */
    async connectLeaderFromApi(
        api_instance: InstanceType<typeof DerivAPIBasic>,
        account_info: { loginid: string; balance?: number; currency?: string; is_virtual?: number },
        onDisconnect?: (loginid: string) => void
    ): Promise<CopyAccount> {
        if (!api_instance) throw new Error('API instance not provided');
        if (this.leaderConn) this.disconnectLeader();

        const liveBalance = typeof (api_instance as any).balance === 'function'
            ? await (api_instance as any).balance()
            : null;
        if (liveBalance?.error) {
            throw new Error(liveBalance.error.message || 'Unable to read source account balance');
        }
        const balanceData = liveBalance?.balance;
        const account: CopyAccount = {
            token: account_info?.loginid ?? '',
            loginid: account_info?.loginid ?? '',
            balance: Number(balanceData?.balance ?? account_info?.balance ?? 0),
            currency: balanceData?.currency ?? account_info?.currency ?? 'USD',
            is_virtual: !!account_info?.is_virtual,
        };

        // DerivAPIBasic exposes its WebSocket on `connection`.
        const ws = (api_instance as any).connection as WebSocket;

        this.leaderConn = { api: api_instance, ws, account } as any;

        try {
            ws.addEventListener?.('close', () => {
                if (shouldTreatConnectionAsDisconnected(ws, typeof navigator !== 'undefined' ? navigator.onLine : true)) {
                    onDisconnect?.(account.loginid);
                }
            });
        } catch (e) {
            // ignore
        }

        return account;
    }

    // ── public API ─────────────────────────────────────────────────────────

    /** Authorize the leader account. */
    async connectLeader(token: string, onDisconnect?: (loginid: string) => void): Promise<CopyAccount> {
        if (this.leaderConn) this.disconnectLeader();
        const conn = await createConnection(token, onDisconnect);
        this.leaderConn = conn;
        return conn.account;
    }

    async connectLeaderFromWebSocketURL(
        websocketUrl: string,
        accountInfo: { loginid: string; balance?: number; currency?: string; is_virtual?: number },
        onDisconnect?: (loginid: string) => void
    ): Promise<CopyAccount> {
        if (this.leaderConn) this.disconnectLeader();
        const conn = await createAccountConnection(websocketUrl, accountInfo, onDisconnect);
        this.leaderConn = conn;
        return conn.account;
    }

    /** Preserve the authenticated logged-in connection as a destination before switching source. */
    moveLeaderToFollower(loginid: string): boolean {
        if (!this.leaderConn || this.leaderConn.account.loginid !== loginid) return false;
        this.followerConns.set(loginid, this.leaderConn);
        this.leaderConn = null;
        return true;
    }

    /** Disconnect and tear down the leader connection. */
    disconnectLeader() {
        this.stopCopying();
        if (this.leaderConn) {
            this.leaderConn.ws.close();
            this.leaderConn = null;
        }
    }

    /** Authorize a follower account. */
    async addFollower(token: string, onDisconnect?: (loginid: string) => void): Promise<CopyAccount> {
        if (this.followerConns.has(token)) {
            return this.followerConns.get(token)!.account;
        }
        const conn = await createConnection(token, onDisconnect);
        this.followerConns.set(token, conn);
        return conn.account;
    }

    /** Attach an existing API instance as a follower connection for the current account. */
    async connectFollowerFromApi(
        api_instance: InstanceType<typeof DerivAPIBasic>,
        account_info: { loginid: string; balance?: number; currency?: string; is_virtual?: number },
        onDisconnect?: (loginid: string) => void
    ): Promise<CopyAccount> {
        if (!api_instance) throw new Error('API instance not provided');
        const loginid = account_info?.loginid ?? '';
        if (!loginid) throw new Error('Follower loginid not provided');

        if (this.followerConns.has(loginid)) {
            return this.followerConns.get(loginid)!.account;
        }

        const account: CopyAccount = {
            token: loginid,
            loginid,
            balance: account_info?.balance ?? 0,
            currency: account_info?.currency ?? 'USD',
            is_virtual: !!account_info?.is_virtual,
        };

        const ws = (api_instance as any).connection as WebSocket;
        this.followerConns.set(loginid, { api: api_instance, ws, account } as any);

        try {
            ws.addEventListener?.('close', () => {
                if (shouldTreatConnectionAsDisconnected(ws, typeof navigator !== 'undefined' ? navigator.onLine : true)) {
                    onDisconnect?.(account.loginid);
                }
            });
        } catch (e) {
            // ignore
        }

        return account;
    }

    async connectFollowerFromWebSocketURL(
        websocketUrl: string,
        accountInfo: { loginid: string; balance?: number; currency?: string; is_virtual?: number },
        onDisconnect?: (loginid: string) => void
    ): Promise<CopyAccount> {
        const loginid = accountInfo?.loginid ?? '';
        if (!loginid) throw new Error('Follower loginid not provided');
        const existing = this.followerConns.get(loginid);
        if (existing?.ws.readyState === WebSocket.OPEN) return existing.account;
        if (existing) this.followerConns.delete(loginid);

        const conn = await createAccountConnection(websocketUrl, accountInfo, onDisconnect);
        this.followerConns.set(loginid, conn);
        return conn.account;
    }

    /** Disconnect and remove a follower. */
    removeFollower(token: string) {
        const conn = this.followerConns.get(token);
        if (conn) {
            conn.ws.close();
            this.followerConns.delete(token);
        }
    }

    /**
     * Start listening to the leader's transaction stream and copying trades.
     *
     * Uses sendAndGetSource() so the subscription Observable only receives
     * messages belonging to this specific subscription request — avoiding
     * cross-contamination with concurrent API calls (proposals, contract details, etc.).
     */
    startCopying(followerLoginids?: string[]) {
        if (!this.leaderConn) throw new Error('Leader not connected');
        if (this.leaderConn.ws.readyState !== WebSocket.OPEN) {
            throw new Error('Source account is not connected');
        }
        if (followerLoginids && followerLoginids.length === 0) {
            throw new Error('No destination accounts selected');
        }
        const disconnectedTargets = followerLoginids?.filter(
            loginid => this.followerConns.get(loginid)?.ws.readyState !== WebSocket.OPEN
        );
        if (disconnectedTargets?.length) {
            throw new Error('Selected real destination account is not connected');
        }
        // Guard: ensure only one subscription active at a time
        if (this.txSubscription) this.stopCopying();
        this.targetFollowerLoginids = followerLoginids ? new Set(followerLoginids) : null;

        // sendAndGetSource sends the request and returns an Observable that
        // emits only responses for this subscription (identified by req_id).
        const source = (this.leaderConn.api as any).sendAndGetSource({
            transaction: 1,
            subscribe: 1,
        });

        this.txSubscription = source.subscribe((msg: any) => {
            if (msg?.msg_type === 'transaction' && msg?.transaction?.action === 'buy') {
                this.handleLeaderBuy(msg.transaction).catch((e: any) => {
                    this.onError(`Error replicating trade: ${e?.message ?? e}`);
                });
            }
        });
    }

    /** Stop copying: unsubscribe from the leader stream and send forget request. */
    stopCopying() {
        if (this.txSubscription) {
            this.txSubscription.unsubscribe();
            this.txSubscription = null;
        }
        // Best-effort server-side unsubscribe
        if (this.leaderConn?.api) {
            try {
                this.leaderConn.api.send({ forget_all: 'transaction' }).catch(() => {});
            } catch (_) {
                /* ignore */
            }
        }
        this.targetFollowerLoginids = null;
    }

    /** Disconnect everything. */
    destroy() {
        this.stopCopying();
        this.disconnectLeader();
        this.followerConns.forEach(conn => conn.ws.close());
        this.followerConns.clear();
    }

    // ── private ────────────────────────────────────────────────────────────

    private async handleLeaderBuy(tx: any) {
        if (!this.leaderConn) return;

        const contract_id: number = tx.contract_id;
        if (!contract_id) return;

        // Slight delay so the contract is settled server-side
        await new Promise(r => setTimeout(r, 500));

        let details = await fetchContractDetails(this.leaderConn.api, contract_id);
        // The entry spot (needed to derive a Higher/Lower offset) can arrive a moment after the buy.
        for (let attempt = 0; attempt < 4 && details && !details.entry_spot && details.barrier !== undefined; attempt++) {
            await new Promise(r => setTimeout(r, 1000));
            details = (await fetchContractDetails(this.leaderConn.api, contract_id)) ?? details;
        }
        if (!details) {
            this.onError(`Could not fetch contract details for id ${contract_id}`);
            return;
        }

        const { buy_price, currency } = details;
        const { contract_type, symbol, duration, duration_unit, barrier, barrier2 } = getCopyContractParams(details);

        if (!contract_type || !symbol || duration === undefined || !duration_unit) {
            this.onError(`Incomplete contract details for id ${contract_id}`);
            return;
        }

        const stake = parseFloat(buy_price ?? '1') * this.stakeMultiplier;
        const tradeLog: CopyTradeLog = {
            id: nextLogId(),
            leader_loginid: this.leaderConn.account.loginid,
            leader_contract_id: contract_id,
            symbol,
            contract_type,
            duration: duration ?? 1,
            duration_unit: duration_unit ?? 't',
            stake,
            currency: currency ?? 'USD',
            timestamp: Date.now(),
            results: [],
        };

        const copyPromises = Array.from(this.followerConns.entries())
            .filter(([loginid]) => !this.targetFollowerLoginids || this.targetFollowerLoginids.has(loginid))
            .filter(([, conn]) => conn.ws.readyState === WebSocket.OPEN)
            .map(async ([token, conn]) => {
            const result: CopyTradeResult = {
                follower_loginid: conn.account.loginid,
                // Keep only a safe hint — never the full token
                follower_token_hint: `...${token.slice(-4)}`,
                timestamp: Date.now(),
            };
            try {
                const { contract_id: fCid, buy_price: fBp } = await replicateTrade(conn.api, {
                    contract_type,
                    symbol,
                    duration: duration ?? 1,
                    duration_unit: duration_unit ?? 't',
                    amount: stake,
                    currency: conn.account.currency,
                    basis: 'stake',
                    barrier,
                    barrier2,
                });
                result.contract_id = fCid;
                result.buy_price = fBp;
            } catch (e: any) {
                result.error = e?.message ?? 'Unknown error';
                this.onError(`Trade ${contract_id} was not copied to ${conn.account.loginid}: ${result.error}`);
            }
            return result;
            });

        tradeLog.results = await Promise.all(copyPromises);
        if (tradeLog.results.length === 0) {
            this.onError(`Trade ${contract_id} could not be copied because no destination account is connected`);
        }
        this.onTrade(tradeLog);
    }
}
