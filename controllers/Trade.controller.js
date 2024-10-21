import { tradeService } from "../services/Trade.service.js";
import { Deposit } from "../schema/Deposit.schema.js";
import { Upload } from "@aws-sdk/lib-storage";
import { S3 } from '@aws-sdk/client-s3';
import { TradeGroup } from "../schema/Trade.schema.js";
import path from 'path';
require('dotenv').config({ path: path.join(__dirname, '.env') });

const s3 = new S3({
    forcePathStyle: process.env.FORCE_PATH_STYLE,
    endpoint: process.env.ENDPOINT,
    region: process.env.REGION,
    credentials: {
        accessKeyId: process.env.ACCESS_KEY_ID,
        secretAccessKey: process.env.SECRET_KEY_ID,
    }
});

export class TradeController {
    service;

    constructor(service) {
        this.service = service;
    }

    checkIfGroupIsMy = async (tradeGroupId, userId) => {
        const [group] = await this.service.getTradeGroupID(tradeGroupId);
        return group.createdBy === userId;
    }

    uploadDescription = async (req, res)  => {
        const userId = req.kauth.grant.access_token.content.sub;
        const groupId = req.params.tradeId;
        if (!req.body.description) {
            return res.status(400).json({ message: 'No description for uploaded.' });
        }

        const [group] = await this.service.getTradeGroupID(groupId);
        if(group.createdBy !== userId) {
            return res.status(401).json({ message: 'Trade group is not yours' });
        }

        if(group.description) {
            return res.status(401).json({ message: 'Trade group is already filled with description' });
        }
        await TradeGroup.updateOne({ createdBy: userId, _id: groupId }, {
            description: req.body.description || "",
        });
        res.status(200).send({ message: "Description updated successfully" });
    }

    uploadFiles = async (req, res) => {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ message: 'No files were uploaded.' });
        }
        const userId = req.kauth.grant.access_token.content.sub;
        const groupId = req.params.tradeId;

        const [group] = await this.service.getTradeGroupID(groupId);
        if(group.createdBy !== userId) {
            return res.status(401).json({ message: 'Trade group is not yours' });
        }
        if(group.images.length > 0) {
            return res.status(401).json({ message: 'Trade group is already filled with images' });
        }

        const files = [
            req.files[Object.keys(req.files)[0]],
            req.files[Object.keys(req.files)[1]],
            req.files[Object.keys(req.files)[2]],
            req.files[Object.keys(req.files)[3]],
        ];

        const promises = [];
        files.forEach((file, i) => {
            if(!file || i > 3) return;
            const key =  userId + '/' + groupId + '/' + Date.now().toString() + '_' + file.name;
            const params = {
                Bucket: process.env.BUCKET,
                Key: key,
                Body: file.data,
                ACL: 'public-read',
            };

            const parallelUploads3 = new Upload({
                client: s3,
                params,
            }).done();
            promises.push(parallelUploads3);
        });

        const result = await Promise.all(promises);
        await TradeGroup.updateOne({ createdBy: userId, _id: groupId }, {
            images: result.map(e => e.Location),
        });

        res.status(200).send({ message: "Files uploaded successfully" });
    }

    getTradeGroups = async (req, res) => {
        try {
            const userId = req.kauth.grant.access_token.content.sub;
            const data = await this.service.getTradeGroups(userId)
            res.status(200).json({length: data.length, data});
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    getTradeGroupById = async (req, res) => {
        try {
            const groupId = req.params.tradeGroupId;
            const data = await this.service.getTradeGroupID(groupId);
            res.status(200).json(data);
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    postTradeGroup = async (req, res) => {
        try {
            const payload = req.body;
            const userId = req.kauth.grant.access_token.content.sub;
            const data = await this.service.postTradeGroup(userId, payload);
            if (!data) {
                return res.status(404).json({message: "Couldn't post trade group, check data accuracy and user id"});
            }
            res.status(200).json(data);
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    deleteTradeGroup = async (req, res) => {
        try {
            const tradeGroupId = req.params.tradeGroupId;
            const userId = req.kauth.grant.access_token.content.sub;
            const isGroupYours = await this.checkIfGroupIsMy(tradeGroupId, userId);
            if(!isGroupYours) return res.status(401).json({ message: 'Trade group is not yours' });

            const data = await this.service.deleteTradeGroup(tradeGroupId);
            res.status(200).json(data);
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    manuallyCloseTradeGroup = async (req, res) => {
        try {
            const tradeGroupId = req.params.tradeGroupId;
            const payload = req.body;
            const userId = req.kauth.grant.access_token.content.sub;
            const isGroupYours = await this.checkIfGroupIsMy(tradeGroupId, userId);
            if(!isGroupYours)
                return res.status(401).json({ message: 'Trade group is not yours' });

            const data = await this.service.manuallyCloseTradeGroup(tradeGroupId, payload);
            const deposit = await Deposit.findOneAndUpdate({ userId }, { $inc: { deposit: data.result } });

            res.status(200).json(data);
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    setupDefaultDeposit = async (req, res) => {
        try {
            const userId = req.kauth.grant.access_token.content.sub;
            const payload = req.body;
            if(!payload.deposit) {
                return res.status(400).json({ message: "Please specify field 'deposit' with amount of $" });
            }
            const data = await this.service.setupDefaultDeposit(userId, payload);
            if (!data) {
                return res.status(400).json({ message: "Already used default deposit. You can use it only once" });
            }
            res.status(200).json({ message: "Successfully setup default deposit" });
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    addToDeposit = async (req, res) => {
        try {
            const userId = req.kauth.grant.access_token.content.sub;
            const payload = req.body;
            if(!payload.deposit) {
                return res.status(400).json({ message: "Please specify field 'deposit' with amount of $" });
            }
            const data = await this.service.addToDeposit(userId, payload);
            if (!data) {
                return res.status(400).json({ message: "Already used default deposit. You can use it only once" });
            }
            res.status(200).json({ message: "Successfully setup default deposit" });
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }

    getDeposit = async (req, res) => {
        try {
            const userId = req.kauth.grant.access_token.content.sub;
            const data = await this.service.getDeposit(userId)
            res.status(200).json({ data });
        } catch (e) {
            console.log('Server error: ', e);
            return res.status(400).json({ message: 'Server error: ' + e });
        }
    }
}

export const tradeController = new TradeController(tradeService);
