import { localize } from '@deriv-com/translations';
import { modifyContextMenu } from '../../../utils';

const Blockly = window.Blockly;
const generator = Blockly.JavaScript.javascriptGenerator;
const comparisonOptions = [
    [localize('less than'), 'lt'],
    [localize('less than or equal to'), 'lte'],
    [localize('equal to'), 'eq'],
    [localize('greater than or equal to'), 'gte'],
    [localize('greater than'), 'gt'],
];
const frequencyOptions = [
    [localize('Most'), 'most'],
    [localize('Least'), 'least'],
];
const evenOddOptions = [
    [localize('Even'), 'even'],
    [localize('Odd'), 'odd'],
];
const overUnderOptions = [
    [localize('Over'), 'over'],
    [localize('Under'), 'under'],
];
const matchDifferOptions = [
    [localize('Match'), 'match'],
    [localize('Differ'), 'differ'],
];
const directionOptions = [
    [localize('Rise'), 'rise'],
    [localize('Fall'), 'fall'],
];

const valueInput = name => ({ type: 'input_value', name, check: 'Number' });
const dropdownInput = (name, options) => ({ type: 'field_dropdown', name, options });

const analysisBlocks = [
    {
        type: 'analysis_last_digits_condition',
        displayName: localize('Last Digits Condition'),
        message: localize('Last %1 digits are %2 digit %3'),
        args: [valueInput('COUNT'), dropdownInput('OPERATOR', comparisonOptions), valueInput('DIGIT')],
        output: 'Boolean',
        outputShape: Blockly.OUTPUT_SHAPE_ROUND,
        tooltip: localize('Checks whether each of the last N digits satisfies the selected comparison.'),
        description: localize(
            'Returns true when every one of the last N digits meets the selected digit condition. Connect this Boolean output to an if condition.'
        ),
        generate: block =>
            `Bot.analyzeLastDigitsCondition(${valueToCode(block, 'COUNT', '3')}, '${block.getFieldValue(
                'OPERATOR'
            )}', ${valueToCode(block, 'DIGIT', '4')})`,
    },
    {
        type: 'analysis_digit_frequency',
        displayName: localize('Most/Least Frequent Digit'),
        message: localize('%1 frequent digit from last %2 digits'),
        args: [dropdownInput('MODE', frequencyOptions), valueInput('COUNT')],
        output: 'Number',
        tooltip: localize('Returns the most or least frequent digit in the selected recent digit sample.'),
        description: localize(
            'Returns the single most or least frequent digit in the selected recent sample. Connect this Number output to a numeric input.'
        ),
        generate: block =>
            `Bot.analyzeDigitFrequency('${block.getFieldValue('MODE')}', ${valueToCode(block, 'COUNT', '1000')})`,
    },
    {
        type: 'analysis_digit_frequency_ranking',
        displayName: localize('Digit Frequency Analysis'),
        message: localize('Rank digits by %1 frequency from last %2 digits'),
        args: [dropdownInput('MODE', frequencyOptions), valueInput('COUNT')],
        output: 'Array',
        tooltip: localize('Returns all digits ranked by frequency in the selected recent sample.'),
        description: localize(
            'Returns digits ranked by frequency, with the most or least frequent first. Connect this Array output to a list input.'
        ),
        generate: block =>
            `Bot.analyzeDigitFrequencyRanking('${block.getFieldValue('MODE')}', ${valueToCode(
                block,
                'COUNT',
                '1000'
            )})`,
    },
    {
        type: 'analysis_even_odd_percentage',
        displayName: localize('Even/Odd %'),
        message: localize('%1 % of last %2 digits'),
        args: [dropdownInput('MODE', evenOddOptions), valueInput('COUNT')],
        output: 'Number',
        tooltip: localize('Returns the percentage of even or odd digits in the selected recent sample.'),
        description: localize(
            'Returns the percentage of even or odd digits in the selected recent tick sample. Connect this Number output to a numeric comparison.'
        ),
        generate: block =>
            `Bot.analyzeDigitPercentage('${block.getFieldValue('MODE')}', ${valueToCode(block, 'COUNT', '1000')})`,
    },
    {
        type: 'analysis_over_under_percentage',
        displayName: localize('Over/Under Analysis'),
        message: localize('%1 %2 % of last %3 digits'),
        args: [dropdownInput('MODE', overUnderOptions), valueInput('DIGIT'), valueInput('COUNT')],
        output: 'Number',
        tooltip: localize('Returns the percentage of digits above or below the selected threshold.'),
        description: localize(
            'Calculates the percentage of recent digits over or under a selected digit. Connect this Number output to a numeric comparison.'
        ),
        generate: block =>
            `Bot.analyzeDigitPercentage('${block.getFieldValue('MODE')}', ${valueToCode(
                block,
                'COUNT',
                '1000'
            )}, ${valueToCode(block, 'DIGIT', '4')})`,
    },
    {
        type: 'analysis_match_differ_percentage',
        displayName: localize('Match/Differ Analysis'),
        message: localize('%1 %2 % of last %3 digits'),
        args: [dropdownInput('MODE', matchDifferOptions), valueInput('DIGIT'), valueInput('COUNT')],
        output: 'Number',
        tooltip: localize('Returns the percentage of digits matching or differing from the selected digit.'),
        description: localize(
            'Calculates the matching or differing digit percentage over recent ticks. Connect this Number output to a numeric comparison.'
        ),
        generate: block =>
            `Bot.analyzeDigitPercentage('${block.getFieldValue('MODE')}', ${valueToCode(
                block,
                'COUNT',
                '1000'
            )}, ${valueToCode(block, 'DIGIT', '5')})`,
    },
    {
        type: 'analysis_last_n_direction',
        displayName: localize('Last N Ticks Direction'),
        message: localize('Last %1 ticks direction is %2'),
        args: [valueInput('COUNT'), dropdownInput('DIRECTION', directionOptions)],
        output: 'Boolean',
        outputShape: Blockly.OUTPUT_SHAPE_ROUND,
        tooltip: localize('Checks whether every move across the selected recent ticks was in one direction.'),
        description: localize(
            'Returns true when all consecutive moves in the selected ticks rose or fell. Connect this Boolean output to an if condition.'
        ),
        generate: block =>
            `Bot.analyzeLastTicksDirection(${valueToCode(block, 'COUNT', '5')}, '${block.getFieldValue(
                'DIRECTION'
            )}')`,
    },
    {
        type: 'analysis_rise_fall_percentage',
        displayName: localize('Rise/Fall %'),
        message: localize('%1 % of last %2 ticks'),
        args: [dropdownInput('DIRECTION', directionOptions), valueInput('COUNT')],
        output: 'Number',
        tooltip: localize('Returns the percentage of recent tick moves that rose or fell; unchanged moves count in the sample.'),
        description: localize(
            'Calculates the percentage of rising or falling moves across recent ticks. Connect this Number output to a numeric comparison.'
        ),
        generate: block =>
            `Bot.analyzeDirectionPercentage('${block.getFieldValue('DIRECTION')}', ${valueToCode(
                block,
                'COUNT',
                '1000'
            )})`,
    },
    {
        type: 'analysis_nth_last_digit',
        displayName: localize('Nth Last Digit'),
        message: localize('Get the %1 last digit'),
        args: [valueInput('INDEX')],
        output: 'Number',
        tooltip: localize('Returns the Nth most recent tick digit; 1 is the latest digit.'),
        description: localize(
            'Returns the digit at a selected position counting back from the latest tick. Connect this Number output to a numeric input.'
        ),
        generate: block => `Bot.getNthLastDigit(${valueToCode(block, 'INDEX', '1')})`,
    },
];

function valueToCode(block, inputName, defaultValue) {
    return generator.valueToCode(block, inputName, generator.ORDER_ATOMIC) || defaultValue;
}

analysisBlocks.forEach(
    ({ type, displayName, message, args, output, outputShape, tooltip, description, generate }) => {
        Blockly.Blocks[type] = {
            init() {
                this.jsonInit({
                    message0: message,
                    args0: args,
                    inputsInline: true,
                    output,
                    outputShape:
                        outputShape ??
                        (output === 'Boolean' ? Blockly.OUTPUT_SHAPE_HEXAGONAL : Blockly.OUTPUT_SHAPE_ROUND),
                    colour: Blockly.Colours.Base.colour,
                    colourSecondary: Blockly.Colours.Base.colourSecondary,
                    colourTertiary: Blockly.Colours.Base.colourTertiary,
                    tooltip,
                    category: Blockly.Categories.Analysis_Logic,
                });
            },
            meta() {
                return {
                    display_name: displayName,
                    description,
                };
            },
            getRequiredValueInputs() {
                return Object.fromEntries(args.filter(arg => arg.type === 'input_value').map(arg => [arg.name, null]));
            },
            customContextMenu(menu) {
                modifyContextMenu(menu);
            },
        };

        generator.forBlock[type] = block => [generate(block), generator.ORDER_ATOMIC];
    }
);
