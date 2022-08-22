import express from "express";
import "dotenv/config";
import {config} from "dotenv";
import path from "path";
import {fileURLToPath} from "url";
import {stringify} from "querystring";
import { createClient, SchemaFieldTypes } from "redis";

const { resolve } = path;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: resolve(__dirname, "./variables.env") })

const trainIndex = "idx:trains";
const reservationIndex = "idx:reservations";
const trainKey = "trains:9863";

const client = createClient({url: process.env.CACHE});
client.connect();

async function createTrainIndex(client) {
	await client.ft.create(trainIndex, {
		train_no: {
			type: SchemaFieldTypes.TEXT
		},
		seat_no: {
			type: SchemaFieldTypes.NUMERIC,
			sortable: true
		},
		current_seat_no: {
			type: SchemaFieldTypes.NUMERIC,
			sortable: true
		}
	});
}

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
		if (!idxList.includes(trainIndex))
		// Create text search indexes for the collection
		await createTrainIndex(client);
		if (!idxList.includes(reservationIndex))
		await createReservationIndex(client);

		const trains = await client.json.get(trainKey);
		console.log("trains: ", trains);
		if (trains == null || trains.length < 1) {
			const train = {
				train_no: "9863",
				seat_no: 5,
				current_seat_no: 0,
				train_name: "Rajadahani Express",
				source: "Thrissur",
				destination: "Bengaluru"
			};
			let r = await client.json.set(trainKey, '.', train);
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
				await client.json.set(trainKey, "$.current_seat_no", 0);
			}
		}
		res();
	});
}

init()
	.then(async() => {
		let number = 1;

		const app = express();
		const port = 8000;

		app.get("/", (_req, res) => {
			res.send("hello world");
		});

		app.post("/", async (_req, res) => {
			try {
				// let number = Math.ceil(Math.random() * 100);
				number = number + 1;
				let [r0, r1] = await client.executeIsolated(async isolatedClient => {
					const session = isolatedClient.multi();
					// check if the current_seat_no is equal to seat_no
					const trainDetails = await isolatedClient.json.get(trainKey);
					if (trainDetails.current_seat_no >= trainDetails.seat_no) {
						res.status(400).send("Seat filed");
						return ["FAIL", "FAIL"];
					} else {
						console.log("train details: ", trainDetails);
						// if not create new registration
						// and update current_seat_no inside trainDetails
						session.json.set(trainKey, "$.current_seat_no", trainDetails.current_seat_no + 1);
						session.json.set("reservations:" + number, ".", {id: number, deleted: false})
						return session.exec();
					}
				});
				if(r0 == "OK" && r1 == "OK") {
					console.log("inserted document: ", number);
					res.status(200).end(stringify(number));
				} else {
					console.log("failed: ", r0, r1);
				}
			} catch (error) {
				console.log(error);
				res.status(500).send(error);
			}
		});

		app.listen(port, () => {
			console.log("App is listening on port: ", port);
		})

	});
