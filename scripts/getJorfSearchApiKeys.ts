import axios, { AxiosResponse } from "axios";
import fs from "fs";
import {
  JORFSearchItem,
  JORFSearchResponse,
} from "../entities/JORFSearchResponse";
import { dateTOJORFFormat } from "../utils/date.utils";

async function JORFSearchCall(currentDay: string): Promise<JORFSearchItem[]> {
  return await axios
    .get<JORFSearchResponse>(
      `https://jorfsearch.steinertriples.ch/${currentDay}?format=JSON`,
    )
    .then((res: AxiosResponse<JORFSearchResponse>) => {
      if (res.data === null || typeof res.data == "string") {
        return [];
      }
      return res.data;
    });
}

// We need to go through the data and get all the possible keys. The goal is to build a type of the data
function getAllPossibleKeys(res: JORFSearchItem[]) {
  const keys: string[] = [];
  for (const contact of res) {
    for (const key of Object.keys(contact)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

async function main() {
  const allPossibleKeys = new Set<string>();

  const currentDay = new Date();
  for (let i = 0; i < 1500; i++) {
    // currentDay minus i days
    const day = new Date(currentDay);
    day.setDate(day.getDate() - i);

    const res = await JORFSearchCall(dateTOJORFFormat(day));

    const keys = getAllPossibleKeys(res);
    keys.forEach((key) => allPossibleKeys.add(key));

    if (i > 0) {
      // remove 2 lines from console
      process.stdout.moveCursor(0, -2);
    }
    console.log(`Day ${String(i)} done. ${String(1500 - i)} days left.`);
    console.log(`Found ${String(allPossibleKeys.size)} keys.`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // every 100 days, write the keys to a file
    if (i % 100 === 0) {
      fs.writeFileSync(
        "allPossibleKeys.txt",
        Array.from(allPossibleKeys).join("\n"),
      );
    }
  }

  console.log("All possible keys:");
  for (const key of allPossibleKeys) {
    console.log(key);
  }
}

main();
