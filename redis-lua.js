
import express from "express";
import "dotenv/config";
import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createClient, defineScript, SchemaFieldTypes } from "redis";
import bodyParser from "body-parser";

const { resolve } = path;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: resolve(__dirname, "./variables.env") })

const trainIndex = "idx:trains";
const reservationIndex = "idx:reservations";
const trainKey = "trains:9863";

const client = createClient({
    url: process.env.CACHE,
    scripts: {
        book: defineScript({
            NUMBER_OF_KEYS: 1,
            SCRIPT:
                /* Need to update script */
                /* `EVAL 'local num = redis.call("GET", ARGV[1]) local numInt = tonumber(num) if numInt > 6 then return -1 else redis.call("SET", ARGV[1], numInt+1) return 0 end' 0 value`, */
                `
            local trainDetails = redis.call("HGETALL", KEYS[1]) 
            local current_seat_no = tonumber(trainDetails[6])
            local seat_no = tonumber(trainDetails[4])
            if seat_no <= current_seat_no then
                return -1
            else
                return redis.call("HSET", KEYS[1], "current_seat_no", current_seat_no+1) 
            end
            `,
            transformArguments(key) {
                return [key];
            },
            transformReply(reply) {
                return reply;
            },
        })
    }
});
client.connect();

async function createReservationIndex(client) {
    await client.ft.create(reservationIndex, {
        deleted: {
            type: SchemaFieldTypes.TAG
        },
        train_no: {
            type: SchemaFieldTypes.TEXT,
            sortable: true
        }
    });
}

async function init() {
    return new Promise(async (res, rej) => {

        const pong = await client.ping();
        console.log(pong);

        const idxList = await client.ft._list();
        // Create text search indexes for the collection
        if (!idxList.includes(reservationIndex))
            await createReservationIndex(client);

        const trains = await client.hGetAll(trainKey);
        console.log("trains: ", trains.train_name);
        if (trains.train_name == undefined) {
            const train = {
                train_no: "9863",
                seat_no: 50,
                current_seat_no: 0,
                train_name: "Rajadahani Express",
                source: "Thrissur",
                destination: "Bengaluru"
            };
            let r = await client.hSet(trainKey, train);
            if (r != null)
                res();
            else
                rej("Unable to insert train");
        }
        else {
            const reservations = await client.ft.search(reservationIndex, '@deleted:{false}');
            if (reservations.length > 0) {
                // reset the values and delete all the reservations created
                await client.ft.dropIndex(reservationIndex);
                await client.hSet(trainKey, "current_seat_no", 0);
            }
        }
        res();
    });
}

init()
    .then(async () => {

        const app = express();
        const port = 8000;

        app.use(bodyParser.json())

        app.get("/", (_req, res) => {
            res.send("hello world");
        });

        app.post("/", async (req, res) => {
            try {
                const id = req.body.id;
                const reservationKey = `reservations:${id}`
                const session = client.multi();
                const [r0, r1] = await session
                    .book(trainKey)
                    .json.set(reservationKey, ".", { id, deleted: false })
                    .exec();
                if (r0 == "0" && r1 == "OK") {
                    console.log("inserted document: ", id);
                    res.status(200).json({ id });
                    return;
                } else if (r0 == "-1" && r1 == "OK") {
                    client.del(reservationKey);
                    res.status(400).json({ id });
                    return;
                }
                console.log(r0, r1)
                res.status(500).json({ id });
            } catch (error) {
                console.log(error);
                res.status(500).json({ id });
            }
        })

        app.listen(port, () => {
            console.log("App is listening on port: ", port);
        })

    });
