import { localize } from '@deriv-com/translations';
import { getContractTypeOptions } from '../../../shared';
import { excludeOptionFromContextMenu, modifyContextMenu } from '../../../utils';

const contractDropdown = name => ({
    type: 'field_dropdown',
    name,
    options: [['', '']],
});

window.Blockly.Blocks.hedge_purchase = {
    init() {
        this.jsonInit({
            message0: localize('Hedge purchase (2 at once)'),
            message1: localize('Purchase 1: %1'),
            message2: localize('Purchase 2: %1'),
            args1: [contractDropdown('PURCHASE1_LIST')],
            args2: [contractDropdown('PURCHASE2_LIST')],
            previousStatement: null,
            colour: window.Blockly.Colours.Special1.colour,
            colourSecondary: window.Blockly.Colours.Special1.colourSecondary,
            colourTertiary: window.Blockly.Colours.Special1.colourTertiary,
            tooltip: localize('Purchases two selected contracts together from the same purchase condition.'),
            category: window.Blockly.Categories.Before_Purchase,
            inputsInline: false,
        });
        this.setNextStatement(false);
    },
    meta() {
        return {
            display_name: localize('Hedge purchase (2 at once)'),
            description: localize(
                'Opens one contract for each selected type when the purchase condition is met. Both contracts are tracked until they close.'
            ),
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
                        this.populatePurchaseOptions(event);
                    }
                }, 0);
            }
            return;
        }

        this.populatePurchaseOptions(event);
    },
    populatePurchaseOptions(event) {
        if (!this.workspace) return;

        const trade_definition_block = this.workspace.getTradeDefinitionBlock();
        const trade_type_block = trade_definition_block?.getChildByType('trade_definition_tradetype');
        const contract_type_block = trade_definition_block?.getChildByType('trade_definition_contracttype');
        if (!trade_type_block || !contract_type_block) return;

        const options = getContractTypeOptions(
            contract_type_block.getFieldValue('TYPE_LIST'),
            trade_type_block.getFieldValue('TRADETYPE_LIST')
        );
        const firstField = this.getField('PURCHASE1_LIST');
        const secondField = this.getField('PURCHASE2_LIST');
        const updateOptions = (field, defaultValue) =>
            field.updateOptions(options, {
                default_value: defaultValue,
                event_group: event.group,
                should_pretend_empty: true,
            });

        updateOptions(firstField, firstField.getValue());
        const firstValue = firstField.getValue();
        const secondValue = secondField.getValue();
        const alternateOption = options.find(option => option[1] !== firstValue);
        const secondDefault = options.some(option => option[1] === secondValue)
            ? secondValue
            : alternateOption?.[1] || firstValue;
        updateOptions(secondField, secondDefault);
    },
    customContextMenu(menu) {
        const menu_items = [localize('Enable Block'), localize('Disable Block')];
        excludeOptionFromContextMenu(menu, menu_items);
        modifyContextMenu(menu);
    },
    restricted_parents: ['before_purchase'],
};

window.Blockly.JavaScript.javascriptGenerator.forBlock.hedge_purchase = block => {
    const first = block.getFieldValue('PURCHASE1_LIST');
    const second = block.getFieldValue('PURCHASE2_LIST');
    return `Bot.purchaseMany(['${first}', '${second}']);\n`;
};
