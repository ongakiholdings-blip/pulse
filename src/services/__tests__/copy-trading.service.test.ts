import { buildCopyTradeProposalRequest, shouldTreatConnectionAsDisconnected } from '../copy-trading.service';

describe('copy-trading service connection health', () => {
    it('does not mark the connection as disconnected while the browser is offline', () => {
        const ws = { readyState: WebSocket.CLOSED } as WebSocket;

        expect(shouldTreatConnectionAsDisconnected(ws, false)).toBe(false);
    });

    describe('copy trading proposal request', () => {
        it('uses Deriv’s underlying_symbol field and preserves barriers', () => {
            const request = buildCopyTradeProposalRequest({
                amount: 2,
                basis: 'stake',
                barrier: '+0.5',
                barrier2: '-0.5',
                contract_type: 'CALL',
                currency: 'USD',
                duration: 5,
                duration_unit: 't',
                symbol: 'R_100',
            });

            expect(request).toEqual({
                proposal: 1,
                amount: 2,
                basis: 'stake',
                contract_type: 'CALL',
                currency: 'USD',
                duration: 5,
                duration_unit: 't',
                underlying_symbol: 'R_100',
                barrier: '+0.5',
                barrier2: '-0.5',
            });
            expect(request).not.toHaveProperty('symbol');
        });
    });

    it('marks a closed socket as disconnected when the browser is online', () => {
        const ws = { readyState: WebSocket.CLOSED } as WebSocket;

        expect(shouldTreatConnectionAsDisconnected(ws, true)).toBe(true);
    });

    it('keeps a connecting socket from being marked disconnected', () => {
        const ws = { readyState: WebSocket.CONNECTING } as WebSocket;

        expect(shouldTreatConnectionAsDisconnected(ws, true)).toBe(false);
    });
});
