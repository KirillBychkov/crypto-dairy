import mongoose from "mongoose";
import path from 'path';
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Connect to MongoDB
export const dbConnect = () => mongoose
    .connect(process.env.MONGO_URL)
    .then(() => console.log('MongoDB connected...'))
    .catch((err) => console.log(err));
