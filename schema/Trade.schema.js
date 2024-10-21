import { Schema, model } from "mongoose";

export const TICKERS = ['BTC/USDT', 'ETH/USDT'];
export const POSITIONS = ['Long', 'Short'];
export const TRENDS = ['Up', 'Down'];
export const ORDERS = ['Limit', 'Market'];
export const RISKS = [0.1, 0.2, 0.3, 0.5, 1, 2, 3];
export const ORDER_TYPE = ['enter', 'stop', 'take', 'mannualyClosed'];
export const ORDER_STATUS = ['pending', 'fulfilled', 'cancelled'];

export const TradeGroupSchema = new Schema({
    ticker: {
        minLength: 6,
        maxLength: 9,
        type: String,
        enum: TICKERS,
        default: 'BTC/USDT',
        required: true,
        trim: true,
    },
    position: {
        minLength: 4,
        maxLength: 5,
        type: String,
        enum: POSITIONS,
        default: 'Long',
        required: true,
        trim: true,
    },
    trend: {
        minLength: 2,
        maxLength: 4,
        type: String,
        enum: TRENDS,
        default: 'Up',
        required: true,
        trim: true,
    },
    order: {
        minLength: 5,
        maxLength: 6,
        type: String,
        enum: ORDERS,
        default: 'Limit',
        required: true,
        trim: true,
    },
    avgEnter: {
        type: Number,
        min: 0.01,
        max: 200000,
        required: true,
    },
    riskPercent: {
        type: Number,
        enum: RISKS,
        default: 1,
        required: true,
    },
    fakeOrder: {
        type: Boolean,
        default: true,
    },
    enterTrades: [{ type: Schema.Types.ObjectId, ref: 'TradeOrder' }],
    stopTrades: [{ type: Schema.Types.ObjectId, ref: 'TradeOrder' }],
    takeTrades: [{ type: Schema.Types.ObjectId, ref: 'TradeOrder' }],
    manuallyClosedTrades: [{ type: Schema.Types.ObjectId, ref: 'TradeOrder' }],
    createdBy: {
        type: String,
        required: true,
        trim: true,
    },
    quantity:  {
        type: String,
        trim: true,
    },
    lost:  {
        type: Number,
    },
    profit:  {
        type: Number,
    },
    status: {
        type: String,
        trim: true,
    },
    result:  {
        type: Number,
    },
    depositBefore: {
        type: Number,
    },
    depositAfter: {
        type: Number,
    },
    closeScenario: {
        type: String,
        trim: true,
    },
    description: {
        type: String,
        trim: true,
    },
    images: [{
        type: String,
        trim: true,
    }],
}, { timestamps: true });
export const TradeGroup = model('TradeGroup', TradeGroupSchema);

export const TradeOrderSchema = new Schema({
    type: {
        type: String,
        enum: ORDER_TYPE,
        required: true,
        trim: true,
    },
    price: {
        type: Number,
        required: true
    },
    percentage: {
        type: String,
        required: true
    },
    tradeGroup: {type: Schema.Types.ObjectId, ref: 'TradeGroup'},
    status: {
        type: String,
        enum: ORDER_STATUS,
        default: 'pending',
        required: true,
        trim: true,
    },
    createdBy: {
        type: String,
        required: true,
        trim: true,
    }
}, { timestamps: true });
export const TradeOrder = model('TradeOrder', TradeOrderSchema);
