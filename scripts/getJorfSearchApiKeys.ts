import axios from "axios";
import moment from "moment";

async function JorfSearchCall(currentDay: string) {
  return await axios
    .get(`https://jorfsearch.steinertriples.ch/${currentDay}?format=JSON`)
    .then((res) => {
      return res.data;
    });
}

// We need to go through the data and get all the possible keys. The goal is to build a type of the data
function getAllPossibleKeys(res: any) {
  let keys: string[] = [];
  for (let contact of res) {
    for (let key of Object.keys(contact)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  return keys;
}

async function main() {
  const allPossibleKeys = new Set<string>();

  let currentDay = "02-17-2024";
  for (let i = 0; i < 1500; i++) {
    // currentDay minus i days
    const day = new Date(currentDay);
    day.setDate(day.getDate() - i);
    const formattedDate = moment(day).format("DD-MM-YYYY");
    const res = await JorfSearchCall(formattedDate);

    const keys = getAllPossibleKeys(res);
    keys.forEach((key) => allPossibleKeys.add(key));

    if (i > 0) {
      // remove 2 lines from console
      process.stdout.moveCursor(0, -2);
    }
    console.log(`Day ${i} done. ${1500 - i} days left.`);
    console.log(`Found ${allPossibleKeys.size} keys.`);
    await new Promise((resolve) => setTimeout(resolve, 100));

    // every 100 days, write the keys to a file
    if (i % 100 === 0) {
      const fs = require("fs");
      fs.writeFileSync(
        "allPossibleKeys.txt",
        Array.from(allPossibleKeys).join("\n")
      );
    }
  }

  console.log("All possible keys:");
  for (let key of allPossibleKeys) {
    console.log(key);
  }
}

main();
