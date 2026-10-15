const getTicksInterface = tradeEngine => {
    return {
        getDelayTickValue: (...args) => tradeEngine.getDelayTickValue(...args),
        getCurrentStat: (...args) => tradeEngine.getCurrentStat(...args),
        getStatList: (...args) => tradeEngine.getStatList(...args),
        getLastTick: (...args) => tradeEngine.getLastTick(...args),
        getLastDigit: (...args) => tradeEngine.getLastDigit(...args),
        getNthLastDigit: (...args) => tradeEngine.getNthLastDigit(...args),
        getTicks: (...args) => tradeEngine.getTicks(...args),
        analyzeLastDigitsCondition: (...args) => tradeEngine.analyzeLastDigitsCondition(...args),
        analyzeDigitFrequency: (...args) => tradeEngine.analyzeDigitFrequency(...args),
        analyzeDigitFrequencyRanking: (...args) => tradeEngine.analyzeDigitFrequencyRanking(...args),
        analyzeDigitPercentage: (...args) => tradeEngine.analyzeDigitPercentage(...args),
        analyzeLastTicksDirection: (...args) => tradeEngine.analyzeLastTicksDirection(...args),
        analyzeDirectionPercentage: (...args) => tradeEngine.analyzeDirectionPercentage(...args),
        checkDirection: (...args) => tradeEngine.checkDirection(...args),
        getOhlcFromEnd: (...args) => tradeEngine.getOhlcFromEnd(...args),
        getOhlc: (...args) => tradeEngine.getOhlc(...args),
        getLastDigitList: (...args) => tradeEngine.getLastDigitList(...args),
    };
};

export default getTicksInterface;
