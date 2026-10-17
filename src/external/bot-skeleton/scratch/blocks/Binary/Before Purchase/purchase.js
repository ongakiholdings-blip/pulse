import { localize } from '@deriv-com/translations';
import { getContractTypeOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

window.Blockly.Blocks.purchase = {
    init() {
        this.jsonInit(this.definition());
        const tradeCountShadow = document.createElement('shadow');
        tradeCountShadow.setAttribute('type', 'math_number');
        const tradeCountField = document.createElement('field');
        tradeCountField.setAttribute('name', 'NUM');
        tradeCountField.textContent = '1';
        tradeCountShadow.appendChild(tradeCountField);
        this.getInput('TRADE_COUNT').connection.setShadowDom(tradeCountShadow);

        // Ensure one of this type per statement-stack
        this.setNextStatement(false);
    },
    definition() {
        return {
            message0: localize('Purchase {{ contract_type }}', { contract_type: '%1' }),
            message1: localize('Allow bulk purchase: {{ allow_bulk_purchase }}', {
                allow_bulk_purchase: '%1',
            }),
            message2: localize('No. of trades: %1'),
            args0: [
                {
                    type: 'field_dropdown',
                    name: 'PURCHASE_LIST',
                    options: [['', '']],
                },
            ],
            args1: [
                {
                    type: 'field_dropdown',
                    name: 'ALLOW_BULK_PURCHASE',
                    options: [
                        [localize('No'), 'FALSE'],
                        [localize('Yes'), 'TRUE'],
                    ],
                },
            ],
            args2: [
                {
                    type: 'input_value',
                    name: 'TRADE_COUNT',
                    check: 'Number',
                },
            ],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize(
                'This block purchases the selected contract. Enable bulk purchase to buy up to 10 contracts from the same signal.'
            ),
            category: window.Blockly.Categories.Before_Purchase,
            inputsInline: false,
        };
    },
    meta() {
        return {
            display_name: localize('Single Purchase'),
            description: localize(
                'Buys the selected contract once per signal. Enable bulk purchase only if you want multiple buys. This block can only be used within the Purchase conditions block.'
            ),
            key_words: localize('buy'),
        };
    },
    onchange(event) {
        if (!this.workspace || this.workspace.isDragging()) return;

        const isCreate = event.type === window.Blockly.Events.BLOCK_CREATE && event.ids.includes(this.id);
        const isTradeDefinitionChange =
            event.type === window.Blockly.Events.BLOCK_CHANGE &&
            ['TYPE_LIST', 'TRADETYPE_LIST'].includes(event.name);
        const isDragEnd =
            event.type === window.Blockly.Events.BLOCK_DRAG && !event.isStart && event.blockId === this.id;
        if (!isCreate && !isTradeDefinitionChange && !isDragEnd) return;

        if (window.Blockly.derivWorkspace.isFlyoutVisible) {
            if (isCreate && this.workspace === window.Blockly.derivWorkspace) {
                setTimeout(() => {
                    if (this.workspace && !window.Blockly.derivWorkspace.isFlyoutVisible) {
                        this.populatePurchaseList(event);
                    }
                }, 0);
            }
            return;
        }

        if (isCreate || isTradeDefinitionChange || isDragEnd) {
            this.populatePurchaseList(event);
        }
    },
    populatePurchaseList(event) {
        const trade_definition_block = this.workspace.getTradeDefinitionBlock();

        if (trade_definition_block) {
            const trade_type_block = trade_definition_block.getChildByType('trade_definition_tradetype');
            const trade_type = trade_type_block.getFieldValue('TRADETYPE_LIST');
            const contract_type_block = trade_definition_block.getChildByType('trade_definition_contracttype');
            const contract_type = contract_type_block.getFieldValue('TYPE_LIST');
            const purchase_type_list = this.getField('PURCHASE_LIST');
            const purchase_type = purchase_type_list.getValue();
            const contract_type_options = getContractTypeOptions(contract_type, trade_type);
            if (contract_type_options.length === 0) return;

            const default_purchase_type = contract_type_options.some(option => option[1] === purchase_type)
                ? purchase_type
                : contract_type_options[0][1];

            purchase_type_list.updateOptions(contract_type_options, {
                default_value: default_purchase_type,
                event_group: event.group,
                should_pretend_empty: true,
            });
        }
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.purchase = block => {
    const purchaseList = block.getFieldValue('PURCHASE_LIST');
    const bulkEnabled = block.getFieldValue('ALLOW_BULK_PURCHASE') === 'TRUE';
    const tradeCount =
        window.Blockly.JavaScript.javascriptGenerator.valueToCode(
            block,
            'TRADE_COUNT',
            window.Blockly.JavaScript.javascriptGenerator.ORDER_ATOMIC
        ) || '1';
    const code = bulkEnabled
        ? `Bot.purchaseMany(['${purchaseList}'], ${tradeCount});\n`
        : `Bot.purchase('${purchaseList}');\n`;
    return code;
};
