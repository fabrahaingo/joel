import axios, { AxiosResponse } from "axios";
import * as fs from "node:fs";
import { dateTOJORFFormat } from "../utils/date.utils.js";
import { JORFSearchResponseMeta } from "../entities/JORFSearchResponseMeta.js";
import {
  getOccurrenceCount,
  round,
  convertToCSV
} from "./getJorfSearchApiKeys.js";

async function JORFSearchCallRawMeta(currentDay: string) {
  return await axios
    .get<JORFSearchResponseMeta>(
      `https://jorfsearch.steinertriples.ch/meta/search?&date=${currentDay}`
    )
    .then((res: AxiosResponse<JORFSearchResponseMeta>) => {
      if (res.data === null || typeof res.data === "string") {
        return [];
      }
      return res.data;
    });
}

interface JORFKeyStat {
  field_name: string;
  nb_presence: number;
  frequency: number;
  is_boolean: boolean;
}

interface Incomplete {
  date: string;
  id: string;
  nb_occurrences: number;
}

async function main() {
  const nbDays = 8300;
  // Max 8300

  const currentDay = new Date();

  type JORFSearchRawPublicationArray = Awaited<
    ReturnType<typeof JORFSearchCallRawMeta>
  >; // This form is used as JORFSearchRawItem is not exported

  let res_data: JORFSearchRawPublicationArray = [];
  for (let i = 0; i < nbDays; i++) {
    // currentDay minus i days
    const day = new Date(currentDay);
    day.setDate(day.getDate() - i);

    const res_day = await JORFSearchCallRawMeta(
      dateTOJORFFormat(day).split("-").reverse().join("-")
    );
    res_data = res_data.concat(res_day);

    console.log(`Day ${String(i)} done. ${String(nbDays - i)} days left.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const nbRecordsTotal = res_data.length;

  const items_keys_occurs = getOccurrenceCount(
    res_data.map((i) => Object.keys(i)).flat()
  );

  const item_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(items_keys_occurs)) {
    const isKeyBoolean = !res_data
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v === true || v === false));

    item_keys_stats.push({
      field_name: key,
      nb_presence: items_keys_occurs[key],
      is_boolean: isKeyBoolean,
      frequency: round(items_keys_occurs[key] / nbRecordsTotal, 3)
    });
  }

  const res_tags = res_data.filter((i) => i.tags).map((i) => i.tags);
  const nbRecordsTags = res_tags.length;

  const res_tags_keys = res_tags.map((i) => Object.keys(i)).flat();

  const tags_keys_occurs = getOccurrenceCount(res_tags_keys);

  const tags_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(tags_keys_occurs)) {
    const isKeyBoolean = !res_tags
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v == true || v == false));

    tags_keys_stats.push({
      field_name: key,
      nb_presence: tags_keys_occurs[key],
      is_boolean: isKeyBoolean,
      frequency: round(tags_keys_occurs[key] / nbRecordsTags, 3)
    });
  }

  // Sort by frequency
  const item_keys_stats_sort = item_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence
  );

  const tags_keys_stats_sort = tags_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence
  );

  // Disp and write stats

  console.log("\nStructure base item:\n");
  for (const key of item_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsTotal).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`
    );
  }

  const items_stats_csv = convertToCSV(item_keys_stats_sort as never);
  if (items_stats_csv !== null) {
    fs.writeFileSync("stats_meta_items.csv", items_stats_csv, "utf8");
  }

  console.log('\nStructure "tags":\n');
  for (const key of tags_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsTags).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`
    );
  }

  const tags_stats_csv = convertToCSV(tags_keys_stats_sort as never);
  if (tags_stats_csv !== null) {
    fs.writeFileSync("stats_meta_tags.csv", tags_stats_csv, "utf8");
  }

  const incomplete_items: Incomplete[] = res_data
    .filter(
      (i) => i.id === undefined || i.date === undefined || i.title === undefined
    )
    .map(
      (i) =>
        ({
          date: i.date,
          id: i.id,
          nb_occurrences: 1
        }) as Incomplete
    )
    .reduce((accumulator: Incomplete[], currentItem) => {
      // Check if the valueT already exists in the accumulator
      const existingItem = accumulator.find(
        (item) => item.id === currentItem.id
      );

      if (existingItem) {
        // If it exists, increment the count
        existingItem.nb_occurrences += 1;
      } else {
        // If it doesn't exist, add the item with a count of 1
        accumulator.push({ ...currentItem, nb_occurrences: 1 });
      }

      return accumulator;
    }, []);

  const incomplete_items_csv = convertToCSV(incomplete_items as never);
  if (incomplete_items_csv !== null) {
    fs.writeFileSync("incomplete_meta_items.csv", incomplete_items_csv, "utf8");
  }
}

await main();
