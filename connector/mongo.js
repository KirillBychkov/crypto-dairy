import mongoose from "mongoose";

// Connect to MongoDB
export const dbConnect = () => mongoose
    .connect(process.env.MONGO_URL)
    .then(() => console.log('MongoDB connected...'))
    .catch((err) => console.log(err));
