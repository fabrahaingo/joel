const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const BlockedSchema = new Schema(
  {
    chatId: {
      type: String,
      required: true,
      unique: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Blocked", BlockedSchema);
