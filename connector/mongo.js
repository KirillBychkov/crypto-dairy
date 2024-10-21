import mongoose from "mongoose";
import path from 'path';
import { fileURLToPath } from 'url';

import dotenv from 'dotenv';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });
console.log('__dirname mongo', __dirname)

// Connect to MongoDB
export const dbConnect = () => mongoose
    .connect(process.env.MONGO_URL)
    .then(() => console.log('MongoDB connected...'))
    .catch((err) => console.log(err));
