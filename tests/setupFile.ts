import mongoose from "mongoose";

beforeAll(async () => {
    // put your client connection code here, example with mongoose:
    await mongoose.connect(process.env['MONGO_URI_TEST']);
});

afterAll(async () => {
    // put your client disconnection code here, example with mongoose:
    await mongoose.disconnect();
});