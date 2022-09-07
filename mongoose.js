import express from "express";
import mongoose from "mongoose";
import "dotenv/config";
import {config} from "dotenv";
import path from "path";
import {fileURLToPath} from "url";
import {stringify} from "querystring";

const { resolve } = path;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config({ path: resolve(__dirname, "./variables.env") })

const { Schema } = mongoose;

const trainSchema =  new Schema({
	train_no: Number,
	seat_no: Number,
	current_seat_no: {
		type: Number,
		default: 0
	},
	train_name: String,
	source: String,
	destination: String,
	created_at: {
		type: Date,
		default: () => Date.now()
	},
	updated_at: {
		type: Date,
		default: () => Date.now()
	}
});

const reservationSchema = new Schema({
	id: Number,
	deleted: {
		type: Boolean,
		default: false
	},
	created_at: {
		type: Date,
		default: () => Date.now()
	},
	updated_at: {
		type: Date,
		default: () => Date.now()
	}
});

mongoose.connect(process.env.DB)

const Train = mongoose.model("trains", trainSchema);
const Reservation = mongoose.model("reserations", reservationSchema);

async function init() {
	return new Promise(async (res, _rej) => {
		const count = await Train.count();
		if (count < 1) {
			const train = {
				train_no: 64,
				seat_no: 20,
				current_seat_no: 0,
				train_name: "Rajadahani Express",
				source: "Thrissur",
				destination: "Bengaluru"
			};

			const insert = new Train(train);
			await insert.save();
			res();
		}
		else {
			const reservationCount = await Reservation.count({deleted: false});
			if (count > 0) {
				await Reservation.deleteMany({});
				await Train.updateMany({}, { $set: { current_seat_no: 0 }});
			}
		}
		res();
	});
}

init()
	.then(async() => {

		const app = express();
		const port = 8000;

		app.get("/", (_req, res) => {
			res.send("hello world");
		});

		app.post("/", async (_req, res) => {
			const session = await mongoose.startSession({ defaultTransactionOptions: { writeConcern: "majority", readConcern: "snapshot" } });
			try {
				console.log("starting transaction");
				await session.startTransaction();
				console.log("started transaction");
				// check if the current_seat_no is equal to seat_no
				// bug
				const trainDetails = await Train.findOneAndUpdate({ train_no: 64 }, { $inc: { current_seat_no: 1 } }, { session, new: true, lean: true });
				console.log("findOneAndUpdate");
				if (trainDetails.current_seat_no > trainDetails.seat_no) {
					await session.abortTransaction();
					res.status(400).send("Seat filed");
					return;
				} else {
					// if not create new registration
					let number = Math.ceil(Math.random() * 100);
					let reservation = await Reservation.create([ {
						id: number
					} ], { session });
					await session.commitTransaction();
					res.status(200).send(stringify(number));
				}
			} catch (error) {
				console.log(error);
				await session.abortTransaction();
				res.status(500).send(error);
			}
		});

		app.listen(port, () => {
			console.log("App is listening on port: ", port);
		})

	});
