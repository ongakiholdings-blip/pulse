export type HigherLowerSide = 'higher' | 'lower';
export type HigherLowerContractType = 'CALL' | 'PUT';

export const getHigherLowerContractType = (side: HigherLowerSide): HigherLowerContractType =>
    side === 'higher' ? 'CALL' : 'PUT';

export const formatHigherLowerBarrier = (barrier: string, contractType: HigherLowerContractType): string => {
    const magnitude = barrier.trim().replace(/^[+-]/, '');
    if (!/^\d+(?:\.\d+)?$/.test(magnitude) || Number(magnitude) <= 0) {
        throw new Error('Higher/Lower barrier must be a positive number');
    }

    return `${contractType === 'CALL' ? '+' : '-'}${magnitude}`;
};
