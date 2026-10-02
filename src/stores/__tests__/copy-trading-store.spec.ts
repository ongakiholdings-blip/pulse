import CopyTradingStore, { resolveAutoFollowerToken, resolvePairedAccountInfo } from '../copy-trading-store';

describe('resolveAutoFollowerToken', () => {
    it('returns the stored direct token for a demo leader when the saved account is real', () => {
        expect(
            resolveAutoFollowerToken({
                currentLoginid: 'VRTC12345',
                isVirtualAccount: true,
                storedDirectToken: 'real-token',
                storedAccountType: 'real',
            })
        ).toBe('real-token');
    });

    it('returns the stored direct token for a real account when the current account is demo', () => {
        expect(
            resolveAutoFollowerToken({
                currentLoginid: 'CR12345',
                isVirtualAccount: false,
                storedDirectToken: 'demo-token',
                storedAccountType: 'demo',
            })
        ).toBe('demo-token');
    });

    it('returns null when no direct token is stored', () => {
        expect(
            resolveAutoFollowerToken({
                currentLoginid: 'VRTC12345',
                isVirtualAccount: true,
                storedDirectToken: '',
                storedAccountType: 'real',
            })
        ).toBeNull();
    });

    it('returns the paired real account info for a demo current account', () => {
        const account = resolvePairedAccountInfo({
            currentLoginid: 'VRTC12345',
            isVirtualAccount: true,
            accounts: [
                { account_id: 'VRTC12345', balance: '100', currency: 'USD', group: '', status: 'active', account_type: 'demo' },
                { account_id: 'CR12345', balance: '250', currency: 'USD', group: '', status: 'active', account_type: 'real' },
            ],
        });

        expect(account?.loginid).toBe('CR12345');
        expect(account?.balance).toBe(250);
        expect(account?.is_virtual).toBe(false);
    });

    it('does not start copy trading when no follower is connected', async () => {
        const store = new CopyTradingStore();
        const startCopying = jest.fn();
        (store as any).service = { startCopying, stopCopying: jest.fn(), stakeMultiplier: 1 };
        store.leader_status = 'connected';
        store.leader_account = {
            token: 'leader',
            loginid: 'VRTC12345',
            balance: 100,
            currency: 'USD',
            is_virtual: true,
        };

        await store.startCopying();

        expect(startCopying).not.toHaveBeenCalled();
        expect(store.is_running).toBe(false);
        expect(store.leader_error).toContain('destination API token');
    });

    it('starts Demo to Real using only the selected connected real destination', async () => {
        const store = new CopyTradingStore();
        const startCopying = jest.fn();
        (store as any).service = { startCopying, stopCopying: jest.fn(), stakeMultiplier: 1 };
        store.leader_status = 'connected';
        store.leader_account = {
            token: 'demo-source',
            loginid: 'VRTC12345',
            balance: 100,
            currency: 'USD',
            is_virtual: true,
        };
        store.followers = [
            {
                token: 'real-destination',
                account: {
                    token: 'real-destination',
                    loginid: 'CR12345',
                    balance: 250,
                    currency: 'USD',
                    is_virtual: false,
                },
                status: 'connected',
                error: '',
            },
            {
                token: 'other-demo',
                account: {
                    token: 'other-demo',
                    loginid: 'VRTC67890',
                    balance: 100,
                    currency: 'USD',
                    is_virtual: true,
                },
                status: 'connected',
                error: '',
            },
        ];

        await store.startDemoToReal('CR12345');

        expect(startCopying).toHaveBeenCalledWith(['CR12345']);
        expect(store.is_running).toBe(true);
    });

    it('rejects Demo to Real unless the source is demo and destination is real', async () => {
        const store = new CopyTradingStore();
        const startCopying = jest.fn();
        (store as any).service = { startCopying, stopCopying: jest.fn(), stakeMultiplier: 1 };
        store.leader_status = 'connected';
        store.leader_account = {
            token: 'real-source',
            loginid: 'CR12345',
            balance: 250,
            currency: 'USD',
            is_virtual: false,
        };
        store.followers = [
            {
                token: 'demo-destination',
                account: {
                    token: 'demo-destination',
                    loginid: 'VRTC67890',
                    balance: 100,
                    currency: 'USD',
                    is_virtual: true,
                },
                status: 'connected',
                error: '',
            },
        ];

        await store.startDemoToReal('VRTC67890');

        expect(startCopying).not.toHaveBeenCalled();
        expect(store.is_running).toBe(false);
        expect(store.leader_error).toContain('demo account as the source');
    });

    it('reconnects the leader and follower after a transient disconnect', async () => {
        const store = new CopyTradingStore();
        const connectLeaderFromApi = jest.fn().mockResolvedValue({ loginid: 'VRTC12345' });
        const connectFollowerFromApi = jest.fn().mockResolvedValue({ loginid: 'CR12345' });
        (store as any).service = {
            connectLeaderFromApi,
            connectFollowerFromApi,
            startCopying: jest.fn(),
            stopCopying: jest.fn(),
            stakeMultiplier: 1,
        };
        (store as any).leaderApiInstance = {};
        (store as any).leaderAccountInfo = { loginid: 'VRTC12345', is_virtual: 1 };
        (store as any).followerApiInstance = {};
        (store as any).followerAccountInfo = { loginid: 'CR12345', is_virtual: 0 };

        await (store as any).recoverFromDisconnect();

        expect(connectLeaderFromApi).toHaveBeenCalled();
        expect(connectFollowerFromApi).toHaveBeenCalled();
    });
});
