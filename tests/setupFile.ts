import { afterAll, beforeAll, inject } from "vitest";
import mongoose from "mongoose";

const mongoUri = inject("mongoUri");

beforeAll(async () => {
  // put your client connection code here, example with mongoose:
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  // put your client disconnection code here, example with mongoose:
  await mongoose.disconnect();
});
