import "dotenv/config";

import { mongodbConnect } from "../db";
import { ErrorMessages } from "../entities/ErrorMessages";
import {
  forceNotifyTagUpdates,
  getJORFRecordsFromDate,
  notifyPeopleUpdates,
  updatePeopleFromTags,
  updatePeopleInDB,
} from "../utils/update.utils";

const BOT_TOKEN = process.env.BOT_TOKEN;

if (BOT_TOKEN === undefined) {
  throw new Error("BOT TOKEN NOT SET");
}

const MONGODB_URI = process.env.MONGODB_URI;

if (MONGODB_URI === undefined) {
  throw new Error(ErrorMessages.MONGODB_URI_NOT_SET);
}

// Force :
// - Update people from JORF
// - Send notifications when lastUpdate does not match
// - Send tag notifications for the past period

// Require to load all users, all people, compare update and notification time

(async () => {
  // Number of months to go back
  const shiftDays = 5;

  // currentDate is today
  const currentDate = new Date();
  const startDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate() - shiftDays,
  );

  startDate.setHours(0, 0, 0, 0);
  const JORFUpdate = await getJORFRecordsFromDate(startDate);

  // Connect to DB
  await mongodbConnect();

  // Update people and return all people records to be sent to users
  const updatedPeopleRecords = await updatePeopleInDB(JORFUpdate);

  // Update and return tags
  const updatedTagMap = await updatePeopleFromTags(JORFUpdate);

  // Notify users
  const BOT_TOKEN = process.env.BOT_TOKEN;

  if (BOT_TOKEN === undefined) {
    throw new Error("BOT TOKEN NOT SET");
  }

  // False (or missing): only notify users which records show that they have not been notified of these updates
  // True: notify all users following of all updates they follow in updatedPeopleRecords
  const FORCE_NOTIFY = false;

  await notifyPeopleUpdates(updatedPeopleRecords, BOT_TOKEN, FORCE_NOTIFY);

  // Force notify by default, as the last notification time is not saved
  await forceNotifyTagUpdates(updatedTagMap, BOT_TOKEN);

  process.exit(0);
})();
