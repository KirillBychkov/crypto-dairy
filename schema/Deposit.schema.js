import { Schema, model } from "mongoose";

export const DepositSchema = new Schema({
    deposit: {
        type: Number,
        required: true,
        trim: true,
    },
    userId: {
        type: String,
        required: true,
        trim: true,
    }
}, { timestamps: true });

export const Deposit = model('Deposit', DepositSchema);
