jest.mock('../constants/config', () => ({
    config: () => ({
        mandatoryMainBlocks: ['trade_definition', 'before_purchase'],
        single_instance_blocks: [],
    }),
}));

import { hasAllRequiredBlocks, hasEnabledPurchaseBlock } from './workspace';

describe('purchase action requirements', () => {
    const createPurchaseBlock = (type, parent, disabled = false) => ({
        type,
        disabled,
        getParent: () => parent,
        isEnabled: () => !disabled,
    });

    it.each(['purchase', 'hedge_purchase'])('accepts an enabled %s block under Purchase conditions', type => {
        const purchaseConditions = { type: 'before_purchase', getParent: () => null };
        const actionBlock = createPurchaseBlock(type, purchaseConditions);
        const workspace = { getAllBlocks: () => [purchaseConditions, actionBlock] };

        expect(hasEnabledPurchaseBlock(workspace)).toBe(true);
    });

    it('requires the purchase action to be enabled and inside Purchase conditions', () => {
        const purchaseConditions = { type: 'before_purchase', getParent: () => null };
        const disabledHedge = createPurchaseBlock('hedge_purchase', purchaseConditions, true);
        const detachedPurchase = createPurchaseBlock('purchase', null);

        expect(hasEnabledPurchaseBlock({ getAllBlocks: () => [purchaseConditions, disabledHedge] })).toBe(false);
        expect(hasEnabledPurchaseBlock({ getAllBlocks: () => [detachedPurchase] })).toBe(false);
    });

    it('accepts a hedge block as the required purchase action when validating a workspace', () => {
        const purchaseConditions = { type: 'before_purchase', getParent: () => null };
        const hedge = createPurchaseBlock('hedge_purchase', purchaseConditions);
        const workspace = { getAllBlocks: () => [
            { type: 'trade_definition_tradeoptions' },
            { type: 'trade_definition' },
            purchaseConditions,
            hedge,
        ] };
        window.Blockly = { derivWorkspace: workspace };

        expect(hasAllRequiredBlocks()).toBe(true);
    });

    it('rejects a workspace without an enabled purchase action', () => {
        const purchaseConditions = { type: 'before_purchase', getParent: () => null };
        const workspace = { getAllBlocks: () => [
            { type: 'trade_definition_tradeoptions' },
            { type: 'trade_definition' },
            purchaseConditions,
        ] };
        window.Blockly = { derivWorkspace: workspace };

        expect(hasAllRequiredBlocks()).toBe(false);
    });
});
