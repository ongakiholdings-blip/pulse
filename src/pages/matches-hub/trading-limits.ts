export type TradingLimitReason = 'take-profit' | 'stop-loss';

export const getTradingLimitReason = (
    realizedProfit: number,
    stopLoss: number,
    takeProfit: number
): TradingLimitReason | null => {
    if (realizedProfit >= takeProfit) return 'take-profit';
    if (realizedProfit <= -stopLoss) return 'stop-loss';
    return null;
};
