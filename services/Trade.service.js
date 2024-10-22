import mongoose from "mongoose";
import { TradeGroup, TradeOrder } from "../schema/Trade.schema.js";
import { CalcService } from "../util/Calc.service.js";
import { Deposit } from "../schema/Deposit.schema.js";

export class TradeService {
    tradeGroupSchema;
    tradeOrderSchema;
    depositSchema;

    constructor() {
        this.tradeGroupSchema = TradeGroup;
        this.tradeOrderSchema = TradeOrder;
        this.depositSchema = Deposit;
    }

    getTradeGroups = async (userId) => {
        try {
            const results = await this.tradeGroupSchema.find({ createdBy: userId })
                .populate('enterTrades').populate('stopTrades')
                .populate('takeTrades').populate('manuallyClosedTrades');
            return results.map(this.formatTradeGroup);
        } catch (error) {
            throw error;
        }
    }

    getTradeGroupID = async (groupId) => {
        try {
            const results = await this.tradeGroupSchema.findById(groupId)
                .populate('enterTrades').populate('stopTrades')
                .populate('takeTrades').populate('manuallyClosedTrades');
            return [results].map(this.formatTradeGroup);
        } catch (error) {
            throw error;
        }
    }

    deleteTradeGroup = async (groupId) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const tradeGroup = await this.tradeGroupSchema.findById(groupId)
                .populate('enterTrades')
                .populate('stopTrades')
                .populate('takeTrades')
                .populate('manuallyClosedTrades');

            if (!tradeGroup) {
                throw new Error('TradeGroup not found');
            }

            const orders = [
                ...tradeGroup.enterTrades,
                ...tradeGroup.stopTrades,
                ...tradeGroup.takeTrades,
                ...tradeGroup.manuallyClosedTrades
            ];
            const isNotStarted = orders.every(order => order.status !== 'fulfilled');
            
            if (!isNotStarted) {
                throw new Error('One of the orders has been already fulfilled')
            }

            const orderIds = orders.map(order => order._id);

            await this.tradeOrderSchema.deleteMany({ _id: {$in: orderIds} }, { session })

            const res = await this.tradeGroupSchema.findByIdAndDelete(groupId, { session })

            await session.commitTransaction();
            await session.endSession();
            return res;
        } catch (error) {
            await session.abortTransaction();
            await session.endSession();
            throw error;
        }
    }

    postTradeGroup = async(userId, payload) => {
        const deposit = await this.depositSchema.findOne({ userId });
        // TODO check if dep isset
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const group = new TradeGroup({
                ticker: payload.ticker,
                position: payload.position,
                trend: payload.trend,
                order: payload.order,
                avgEnter: payload.avgEnter,
                riskPercent: payload.riskPercent,
                fakeOrder: true,
                closedManually: false,
                manuallyClosedTrades: [],
                status: 'new',
                createdBy: userId,
            });

            const savedTradeGroup = await group.save({ session });
            const groupId = savedTradeGroup._id;

            if(![1,2,3,4].includes(payload.enterCount)) {
                throw new Error('Count of trades does not much to 1,2,3,4');
            }
            const enterCount = payload.order === 'Market' ? 1 : payload.enterCount;
            const enterValues = CalcService.populateEnterValues(payload.avgEnter, enterCount);
            const enterPercentage = 100 / enterCount;
            const takes = [payload.firstTakePrice, payload.secondTakePrice, payload.thirdTakePrice]
                .filter(Boolean)
                .map(take => CalcService.getTake(take));

            if(+payload.stop <= 0) {
                throw new Error('Stop price must not zero positive number');
            }
            if(enterValues.some(eP => +eP < +payload.stop) && payload.position === "Long") {
                throw new Error('Stop price must lower than enter price in Long orders');
            }
            if(enterValues.some(eP => +eP > +payload.stop) && payload.position === "Short") {
                throw new Error('Stop price must higher than enter price in Short orders');
            }

            if(takes.some((tP) => !+tP.percent || !tP.value)) {
                throw new Error('Takes percentages must be from 10 to 100 and values must be not zero positive integers');
            }
            if(takes.reduce((s, tP) => +tP.percent + +s, 0) !== 100) {
                throw new Error('Takes must cover together exactly 100% from all the take orders');
            }
            if(takes.some(tP => enterValues.some(eP => +eP <= +tP.value)) && payload.position === "Short") {
                throw new Error('Take price\'s must lower than enter price\'s in Short orders');
            }
            if(takes.some(tP => enterValues.some(eP => +eP >= +tP.value)) && payload.position === "Long") {
                throw new Error('Take price\'s must higher than enter price\'s in Long orders');
            }

            const enterOrders = await this.tradeOrderSchema.insertMany(
                enterValues.map(value => ({
                    type: 'enter',
                    price: value,
                    percentage : `${enterPercentage}%`,
                    tradeGroup: groupId,
                    status: 'pending',
                    createdBy: userId
                })),
                { session }
            )

            const _stopOrder = new TradeOrder({
                type: 'stop',
                price: payload.stop,
                percentage: '100%',
                tradeGroup: groupId,
                status: 'pending',
                createdBy: userId
            })
            const stopOrder = await _stopOrder.save({ session });

            const _takeOrders = takes.map(take => new TradeOrder({
                    type: 'take',
                    price: take.value,
                    percentage: `${take.percent}%`,
                    tradeGroup: groupId,
                    status: 'pending',
                    createdBy: userId
                }));
            const takeOrders = await this.tradeOrderSchema.insertMany(_takeOrders, { session });
            savedTradeGroup.enterTrades = enterOrders.map(order => order._id);
            savedTradeGroup.stopTrades = [stopOrder._id];
            savedTradeGroup.takeTrades = takeOrders.map(order => order._id);

            const quantity = CalcService.calculateQuantity(savedTradeGroup, +deposit.deposit, stopOrder);
            const lost = CalcService.calculateLost(savedTradeGroup, quantity, +deposit.deposit).value;
            savedTradeGroup.profit = CalcService.precalculateProfit(savedTradeGroup, quantity, takeOrders).value;
            savedTradeGroup.quantity = quantity;
            savedTradeGroup.lost = lost;

            await savedTradeGroup.save({ session });

            await session.commitTransaction();
            await session.endSession();
        
            return savedTradeGroup;
        } catch (error) {
            await session.abortTransaction();
            await session.endSession();
            throw error;
        }
    }

    manuallyCloseTradeGroup = async(groupId, payload) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const tradeGroup = await this.tradeGroupSchema.findById(groupId)
                .populate('enterTrades')
                .populate('stopTrades')
                .populate('takeTrades')
                .populate('manuallyClosedTrades');

            if (!tradeGroup) {
                throw new Error('TradeGroup not found');
            }

            const currentStatus = CalcService.calculateStatus(tradeGroup);
            if (currentStatus === 'failed' || currentStatus === 'success' || currentStatus === 'partiallyClosed') {
                throw new Error("Trade group has been already closed");
            }
            const { enters, stops, takes, price } = payload;
            const fulfilledEnterTrades = [];
            const fulfilledExitTrades = [];
            if (!enters || enters.length === 0) {
                throw new Error('Key "enters" must be a string of "price / percentage" enter orders scenario');
            }

            if (enters.includes('100%') && stops && !price && !takes) {
                // enter all fulfilled
                for (const trade of tradeGroup.enterTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledEnterTrades.push(trade);
                }
                // stop all fulfilled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledExitTrades.push(trade);
                }
                // take all cancelled
                for (const trade of tradeGroup.takeTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                tradeGroup.closeScenario = "1) Enters 100% + Stops";
                console.log('First scenario', tradeGroup._id, payload)
            }
            if (enters.includes('100%') && !stops && !price && takes && takes.includes('100%')) {
                // enter all fulfilled
                for (const trade of tradeGroup.enterTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledEnterTrades.push(trade);
                }
                // stop all cancelled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // take all fulfilled
                for (const trade of tradeGroup.takeTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledExitTrades.push(trade);
                }
                tradeGroup.closeScenario = "2) Enters 100% + Takes 100%";
                console.log('Second scenario', tradeGroup._id, payload)
            }
            if (enters.includes('100%') && !stops && price && takes && !takes.includes('100%')) {
                // enter all fulfilled
                for (const trade of tradeGroup.enterTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledEnterTrades.push(trade);
                }
                // stop all cancelled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // take partial fulfilled
                const [takeLastPrice, takeLastPercentage] = takes.split(' / ');
                let partialTakeTrades = tradeGroup.takeTrades.toSorted((a, b) =>
                    tradeGroup.position === 'Long' ? +a.price - +b.price : +b.price - +a.price);
                partialTakeTrades = partialTakeTrades.slice(0, partialTakeTrades
                    .findIndex(e => +e.price === +takeLastPrice) + 1);
                for (const trade of tradeGroup.takeTrades) {
                    const status = !!partialTakeTrades.find(e => +e.price === +trade.price) ?
                        'fulfilled' : 'cancelled';
                    await this.updateTradeOrderStatus(trade._id, status, session);
                    if(status === 'fulfilled') fulfilledExitTrades.push(trade);
                }

                // manual order created
                const _closedManuallyOrder = new TradeOrder({
                    type: 'mannualyClosed',
                    price,
                    percentage: 100 - partialTakeTrades.reduce((s, e) => s + +e.percentage.replace('%', ''), 0) + '%',
                    tradeGroup: groupId,
                    status: 'fulfilled',
                    createdBy: tradeGroup.createdBy
                });
                const closedManuallyOrder = await _closedManuallyOrder.save({ session });
                tradeGroup.manuallyClosedTrades = [closedManuallyOrder._id];
                fulfilledExitTrades.push(closedManuallyOrder);

                tradeGroup.closeScenario = "3) Enters 100% + Takes less 100% + Custom price";
                console.log('Third scenario', tradeGroup._id, payload)
            }
            if (enters.includes('100%') && !stops && price && !takes) {
                // enter all fulfilled
                for (const trade of tradeGroup.enterTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledEnterTrades.push(trade);
                }
                // stop all cancelled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // take all cancelled
                for (const trade of tradeGroup.takeTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // manual order created
                const _closedManuallyOrder = new TradeOrder({
                    type: 'mannualyClosed',
                    price,
                    percentage: '100%',
                    tradeGroup: groupId,
                    status: 'fulfilled',
                    createdBy: tradeGroup.createdBy
                });
                const closedManuallyOrder = await _closedManuallyOrder.save({session});
                tradeGroup.manuallyClosedTrades = [closedManuallyOrder._id];
                fulfilledExitTrades.push(closedManuallyOrder);

                tradeGroup.closeScenario = "4) Enters 100% + No takes + Custom price";
                console.log('Fourth scenario', tradeGroup._id, payload)
            }

            if (!enters.includes('100%') && !stops && !price && takes && takes.includes('100%')) {
                // enter partial fulfilled
                const [enterLastPrice] = enters.split(' / ');
                let partialEnterTrades = tradeGroup.enterTrades.toSorted((a, b) =>
                    tradeGroup.position === 'Long' ? +a.price - +b.price : +b.price - +a.price);
                partialEnterTrades = partialEnterTrades.slice(0, partialEnterTrades
                    .findIndex(e => +e.price === +enterLastPrice) + 1);
                for (const trade of tradeGroup.enterTrades) {
                    const status = !!partialEnterTrades.find(e => +e.price === +trade.price) ?
                        'fulfilled' : 'cancelled';
                    await this.updateTradeOrderStatus(trade._id, status, session);
                    if(status === 'fulfilled') fulfilledEnterTrades.push(trade);
                }
                // stop all cancelled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // take all fulfilled
                for (const trade of tradeGroup.takeTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'fulfilled', session);
                    fulfilledExitTrades.push(trade);
                }
                tradeGroup.closeScenario = "5) Enters less 100% + Takes 100%";
                console.log('Fifth scenario', tradeGroup._id, payload)
            }
            if (!enters.includes('100%') && !stops && price && takes && !takes.includes('100%')) {
                // enter partial fulfilled
                const [enterLastPrice] = enters.split(' / ');
                let partialEnterTrades = tradeGroup.enterTrades.toSorted((a, b) =>
                    tradeGroup.position === 'Long' ? +a.price - +b.price : +b.price - +a.price);
                partialEnterTrades = partialEnterTrades.slice(0, partialEnterTrades
                    .findIndex(e => +e.price === +enterLastPrice) + 1);
                for (const trade of tradeGroup.enterTrades) {
                    const status = !!partialEnterTrades.find(e => +e.price === +trade.price) ?
                        'fulfilled' : 'cancelled';
                    await this.updateTradeOrderStatus(trade._id, status, session);
                    if(status === 'fulfilled') fulfilledEnterTrades.push(trade);
                }
                // stop all cancelled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // take partial fulfilled
                const [takeLastPrice, takeLastPercentage] = takes.split(' / ');
                let partialTakeTrades = tradeGroup.takeTrades.toSorted((a, b) =>
                    tradeGroup.position === 'Long' ? +a.price - +b.price : +b.price - +a.price);
                partialTakeTrades = partialTakeTrades.slice(0, partialTakeTrades
                    .findIndex(e => +e.price === +takeLastPrice) + 1);
                for (const trade of tradeGroup.takeTrades) {
                    const status = !!partialTakeTrades.find(e => +e.price === +trade.price) ?
                        'fulfilled' : 'cancelled';
                    await this.updateTradeOrderStatus(trade._id, status, session);
                    if(status === 'fulfilled') fulfilledExitTrades.push(trade);
                }

                // manual order created
                const _closedManuallyOrder = new TradeOrder({
                    type: 'mannualyClosed',
                    price,
                    percentage: 100 - partialTakeTrades.reduce((s, e) => s + +e.percentage.replace('%', ''), 0) + '%',
                    tradeGroup: groupId,
                    status: 'fulfilled',
                    createdBy: tradeGroup.createdBy
                });
                const closedManuallyOrder = await _closedManuallyOrder.save({session});
                tradeGroup.manuallyClosedTrades = [closedManuallyOrder._id];
                fulfilledExitTrades.push(closedManuallyOrder);

                tradeGroup.closeScenario = "6) Enters less 100% + Takes less 100% + Custom price";
                console.log('Sixth scenario', tradeGroup._id, payload)
            }
            if (!enters.includes('100%') && !stops && price && !takes) {
                // enter partial fulfilled
                const [enterLastPrice] = enters.split(' / ');
                let partialEnterTrades = tradeGroup.enterTrades.toSorted((a, b) =>
                    tradeGroup.position === 'Long' ? +a.price - +b.price : +b.price - +a.price);
                partialEnterTrades = partialEnterTrades.slice(0, partialEnterTrades
                    .findIndex(e => +e.price === +enterLastPrice) + 1);
                for (const trade of tradeGroup.enterTrades) {
                    const status = !!partialEnterTrades.find(e => +e.price === +trade.price) ?
                        'fulfilled' : 'cancelled';
                    await this.updateTradeOrderStatus(trade._id, status, session);
                    if(status === 'fulfilled') fulfilledEnterTrades.push(trade);
                }
                // stop all cancelled
                for (const trade of tradeGroup.stopTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // take all cancelled
                for (const trade of tradeGroup.takeTrades) {
                    await this.updateTradeOrderStatus(trade._id, 'cancelled', session);
                }
                // manual order created
                const _closedManuallyOrder = new TradeOrder({
                    type: 'mannualyClosed',
                    price,
                    percentage: '100%',
                    tradeGroup: groupId,
                    status: 'fulfilled',
                    createdBy: tradeGroup.createdBy
                });
                const closedManuallyOrder = await _closedManuallyOrder.save({session});
                tradeGroup.manuallyClosedTrades = [closedManuallyOrder._id];
                fulfilledExitTrades.push(closedManuallyOrder);

                tradeGroup.closeScenario = "7) Enters less 100% + No takes + Custom price";
                console.log('Seventh scenario', tradeGroup._id, payload)
            }

            if(fulfilledEnterTrades.length === 0 || fulfilledExitTrades.length === 0) {
                throw Error("Enter or exit trades is empty, something went wrong, check prices, and amount of each order");
            }
            tradeGroup.result = CalcService.calculateProfit(tradeGroup, tradeGroup.quantity, fulfilledEnterTrades, fulfilledExitTrades).value;
            tradeGroup.status = CalcService.calculateStatus(tradeGroup.result);

            const deposit = await this.depositSchema.findOne({ userId: tradeGroup.createdBy });

            tradeGroup.depositBefore = +deposit.deposit;
            tradeGroup.depositAfter = +deposit.deposit + +tradeGroup.result;

            await tradeGroup.save({ session });
            await session.commitTransaction();
            await session.endSession();

            return this.formatTradeGroup(tradeGroup);
        } catch (error) {
            await session.abortTransaction();
            await session.endSession();
            throw error;
        }
    }

    updateTradeOrderStatus = async (orderId, status, session) => {
        const order = await this.tradeOrderSchema.findById(orderId);
        if (!order || order.status !== 'pending') {
            throw new Error('Unable to update order, check status or order Id')
        }

        order.status = status;
        order.save(session? { session }: undefined);

        return order;
    }

    setupDefaultDeposit = async (userId, payload) => {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const isDeposit = await this.depositSchema.findOne({ userId });
            if (isDeposit) {
                throw new Error('Deposit is already setup');
            }

            const deposit = new Deposit({
                deposit: payload.deposit,
                userId: userId
            });
            const savedDeposit = await deposit.save({ session });

            await session.commitTransaction();
            await session.endSession();

            return savedDeposit;
        } catch (error) {
            await session.abortTransaction();
            await session.endSession();
            throw error;
        }
    }

    addToDeposit = async (userId, payload) => {
        try {
            return await this.depositSchema
                .updateOne({ userId }, { $inc: { deposit: payload.deposit } });
        } catch (error) {
            throw error;
        }
    }

    getDeposit = async (userId) => {
        try {
            return await this.depositSchema.findOne({ userId });
        } catch (error) {
            throw error;
        }
    }

    formatTradeGroup(tradeGroup) {
        return {
            id: tradeGroup._id,
            ticker: tradeGroup.ticker,
            position: tradeGroup.position,
            trend: tradeGroup.trend,
            order: tradeGroup.order,
            riskPercent: tradeGroup.riskPercent,
            avgEnter: tradeGroup.avgEnter,
            fakeOrder: tradeGroup.fakeOrder,
            enterTrades: tradeGroup.enterTrades,
            stopTrades: tradeGroup.stopTrades,
            takeTrades: tradeGroup.takeTrades,
            manuallyClosedTrades: tradeGroup.manuallyClosedTrades,
            createdBy: tradeGroup.createdBy,
            createdAt: tradeGroup.createdAt,
            updatedAt: tradeGroup.updatedAt,
            quantity: tradeGroup.quantity,
            lost: tradeGroup.lost,
            profit: tradeGroup.profit,
            status: tradeGroup.status,
            result: tradeGroup.result,
            closeScenario: tradeGroup.closeScenario,
            depositBefore: tradeGroup.depositBefore,
            depositAfter: tradeGroup.depositAfter,
            images: tradeGroup.images,
            description: tradeGroup.description,
        }
    }
}

export const tradeService = new TradeService();
