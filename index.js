import { fileURLToPath } from 'url';
export const __filename = fileURLToPath(import.meta.url);

import cors from "cors";
import express from "express";
import bodyParser from "body-parser";
import Keycloak from "keycloak-connect";
import fileUpload from "express-fileupload";
import { rateLimit } from 'express-rate-limit';
import path from 'path';
import dotenv from 'dotenv';

import { tradeController } from "./controllers/Trade.controller.js";
import { dbConnect } from "./connector/mongo.js";

const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

console.log('__dirname index', __dirname)

const limiter = rateLimit({
    windowMs: 2 * 60 * 1000, // 3 minutes
    limit: 120, // Limit each IP to 100 requests per `window` (here, per 15 minutes).
    standardHeaders: 'draft-7', // draft-6: `RateLimit-*` headers; draft-7: combined `RateLimit` header
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers.
    // store: ... , // Redis, Memcached, etc. See below.
});

const config = {
    "confidential-port": process.env.CONFIDENTIAL_PORT,
    "realm": process.env.REALM,
    "auth-server-url": process.env.AUTH_SERVER_URL,
    "ssl-required": process.env.SSL_REQUIRED,
    "resource": process.env.RESOURCES,
    "bearer-only": process.env.BEARER_ONLY,
    "realmPublicKey": process.env.REALM_PUBLIC_KEY,
};

const app = express();
const keycloak = new Keycloak({}, config);

app.use(limiter);
app.use(fileUpload({
    limits: { files: 4, fileSize: 1024 * 1024 },
}));
app.use(
    keycloak.middleware(),
    bodyParser.json(),
    cors()
);

// Endpoints
app.get('/v1/tradegroups', keycloak.protect("default-user"), tradeController.getTradeGroups);
app.get('/v1/tradegroup/:tradeGroupId', keycloak.protect("default-user"), tradeController.getTradeGroupById);
app.post('/v1/tradegroup', keycloak.protect("default-user"), tradeController.postTradeGroup);
app.delete('/v1/tradegroup/:tradeGroupId', keycloak.protect("default-user"), tradeController.deleteTradeGroup);
app.put('/v1/tradegroup/:tradeGroupId/close', keycloak.protect("default-user"), tradeController.manuallyCloseTradeGroup);
app.post('/v1/upload/:tradeId', keycloak.protect("default-user"), tradeController.uploadFiles);
app.put('/v1/upload/:tradeId', keycloak.protect("default-user"), tradeController.uploadDescription);

app.post('/v1/deposit', keycloak.protect("default-user"), tradeController.setupDefaultDeposit);
app.get('/v1/deposit', keycloak.protect("default-user"), tradeController.getDeposit);
app.put('/v1/deposit', keycloak.protect("default-user"), tradeController.addToDeposit);

app.use('*', function (req, res) {
    res.send('Not found!');
});

// Start the server
app.listen(8084, async () => {
    console.log(`Server running at http://localhost:8084/`);
    await dbConnect();
});
