export class CalcService {
    static getPercent(value, percent) {
        return +value / 100 * percent;
    }

    static getTake(take) {
        if (!take || !take.length) {
            return { value: 0, percent: 0 };
        }
        const percent = Number(take.split('/')[1].match(/[0-9]{2,3}/));
        return { value: +take.split('/')[0], percent };
    }

    static calculateQuantity(trade, currentDeposit, stopTrade) {
        // todo: float precision
        const { riskPercent, avgEnter } = trade;
        const stop = stopTrade.price;
        const riskAmount = this.getPercent(currentDeposit, riskPercent);
        const stopDiff = Math.abs(avgEnter - stop);
        return riskAmount / stopDiff
    }

    static calculateLost(trade, quantity, currentDeposit) {
        if (!quantity) {
            return {
                amount: 0,
                value: 0
            }
        }
        const { riskPercent } = trade;

        return {
            amount: quantity,
            value: this.getPercent(currentDeposit, riskPercent)
        }
    }

    static precalculateProfit(trade, quantity, takeTrades) {
        if (!quantity) {
            return {
                amount: 0,
                value: 0
            }
        }

        return takeTrades
            .map(take => ({ value: take.price, percent: parseFloat(take.percentage.replace('%', '')) }))
            .reduce((acc, order) => {
                const takeValue = this.calculateTakeValue(quantity, trade.avgEnter, order.value, order.percent);
                return { amount: acc.amount + takeValue.percent, value: acc.value + takeValue.value }
            }, { amount: 0, value: 0 });
    }

    static calculateProfit(tradeGroup, quantity, fulfilledEnterTrades, fulfilledExitTrades) {
        let result = 0;
        if(!fulfilledEnterTrades.length || !fulfilledExitTrades.length) return { value: 0 };

        let [priceEnter, volumeEnter] = fulfilledEnterTrades
            .reduce((state, el) => [
                +el.price + state[0],
                +quantity * +el.percentage.replace('%', '') / 100 + state[1],
            ], [0, 0]);
        priceEnter = priceEnter / fulfilledEnterTrades.length;

        let [priceExit, volumeExit] = fulfilledExitTrades
            .reduce((state, el) => [
                +el.price + state[0],
                +volumeEnter * +el.percentage.replace('%', '') / 100 + state[1],
            ], [0, 0]);
        priceExit = priceExit / fulfilledExitTrades.length;

        console.log(
            tradeGroup.position,
            'enter => ', priceEnter, volumeEnter,
            'exit => ', priceExit, volumeExit
        );
        if(tradeGroup.position === 'Long') {
            result = priceExit * volumeExit - priceEnter * volumeEnter;
        }

        if(tradeGroup.position === 'Short') {
            result = priceEnter * volumeEnter - priceExit * volumeExit;
        }

        return { value: result, amount: volumeExit };
    }

    static calculateTakeValue(quantity, enter, takeValue, takePercent) {
        if (!takeValue) {
            return {percent: 0, value: 0}
        }
        const percent = quantity / 100 * takePercent;
        return {
            percent, value: percent * Math.abs(takeValue - enter)
        }
    }

    static calculateStatus(result) {
        if (!result) {
            return 'new'
        } else if (result <= 0) {
            return 'failed'
        } else if (result > 0) {
            return 'success'
        }
    }

    static populateEnterValues(avgEnter, enterCount) {
        const percent = 0.1;
        const step = avgEnter / 100 * percent;
        if (enterCount === 1) return [avgEnter];

        const middle = (enterCount - 1) / 2;

        return new Array(enterCount).fill(0).map((_, index) => {
            let stepMultiplier = index - middle;
            stepMultiplier = stepMultiplier < 0 ? Math.floor(stepMultiplier) : Math.ceil(stepMultiplier)
            return avgEnter + (stepMultiplier * step)
        });
    }
}
