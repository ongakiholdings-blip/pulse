import {
    buildCopyTradeProposalRequest,
    getCopyContractParams,
    shouldTreatConnectionAsDisconnected,
} from '../copy-trading.service';

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


describe('getCopyContractParams', () => {
    it('derives symbol and tick duration for Rise/Fall without a barrier', () => {
        expect(
            getCopyContractParams({
                contract_type: 'CALL',
                underlying_symbol: '1HZ100V',
                shortcode: 'CALL_1HZ100V_1.80_1790884385_1T_S0P_0',
                barrier: '1046.53',
                entry_spot: '1046.53',
            })
        ).toMatchObject({ symbol: '1HZ100V', contract_type: 'CALL', duration: 1, duration_unit: 't', barrier: undefined });
    });

    it('converts an absolute Higher barrier into a signed offset', () => {
        expect(
            getCopyContractParams({
                contract_type: 'CALL',
                underlying_symbol: '1HZ100V',
                date_start: 1000,
                date_expiry: 1060,
                barrier: '1047.10',
                entry_spot: '1046.53',
            })
        ).toMatchObject({ contract_type: 'HIGHER', duration: 60, duration_unit: 's', barrier: '+0.57' });
    });

    it('converts an absolute Lower barrier into a negative offset', () => {
        expect(
            getCopyContractParams({
                contract_type: 'PUT',
                underlying_symbol: '1HZ100V',
                shortcode: 'PUT_1HZ100V_1.80_1790884385_5T_S0P_0',
                barrier: '1045.96',
                entry_spot: '1046.53',
            })
        ).toMatchObject({ contract_type: 'LOWER', duration: 5, duration_unit: 't', barrier: '-0.57' });
    });
}); 