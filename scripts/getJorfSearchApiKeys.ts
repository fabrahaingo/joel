import axios, { AxiosResponse } from "axios";
import { JORFSearchResponse } from "../entities/JORFSearchResponse.js";
import * as fs from "node:fs";
import { dateTOJORFFormat } from "../utils/date.utils.js";

function round(value: number, exp: number) {
  if (typeof exp === "undefined" || +exp === 0) return Math.round(value);

  value = +value;
  exp = +exp;

  if (isNaN(value) || !(exp % 1 === 0)) return NaN;

  // Shift
  value = value.toString().split("e");
  value = Math.round(+(value[0] + "e" + (value[1] ? +value[1] + exp : exp)));

  // Shift back
  value = value.toString().split("e");
  return +(value[0] + "e" + (value[1] ? +value[1] - exp : -exp));
}

async function JORFSearchCallRaw(currentDay: string) {
  return await axios
    .get<JORFSearchResponse>(
      `https://jorfsearch.steinertriples.ch/${currentDay}?format=JSON`
    )
    .then((res: AxiosResponse<JORFSearchResponse>) => {
      if (res.data === null || typeof res.data === "string") {
        return [];
      }
      return res.data;
    });
}

function getOccurrenceCount(values: string[]) {
  return values.reduce<Record<string, number>>((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

interface JORFKeyStat {
  field_name: string;
  nb_presence: number;
  frequency: number;
  is_boolean: boolean;
}

interface Incomplete {
  source_date: string;
  source_id: string;
  nb_occurrences: number;
}

// Function to convert an array to CSV
function convertToCSV(array: never[]) {
  if (array.length < 1) {
    return null;
  }
  // Extract the keys from the first element
  const headers = Object.keys(array[0]).join(",");

  // Convert each element to a CSV row
  const rows = array
    .map((element: never) => Object.values(element).join(","))
    .join("\n");

  // Combine headers and rows
  return `${headers}\n${rows}`;
}

async function main() {
  const nbDays = 14000;
  // Max 14000

  const currentDay = new Date();

  type JORFSearchRawItemArray = Awaited<ReturnType<typeof JORFSearchCallRaw>>; // This form is used as JORFSearchRawItem is not exported

  let res_data: JORFSearchRawItemArray = [];
  for (let i = 0; i < nbDays; i++) {
    // currentDay minus i days
    const day = new Date(currentDay);
    day.setDate(day.getDate() - i);

    const res_day = await JORFSearchCallRaw(dateTOJORFFormat(day));
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
      .filter((i) => i[key] !== undefined)
      .map((i) => i[key])
      .some((v) => !(v === "true" || v === "false"));

    item_keys_stats.push({
      field_name: key,
      nb_presence: items_keys_occurs[key],
      is_boolean: isKeyBoolean,
      frequency: round(items_keys_occurs[key] / nbRecordsTotal, 3)
    });
  }

  const typeOrdre_keys = getOccurrenceCount(
    res_data.reduce<string[]>((accumulator, currentItem) => {
      if (currentItem.type_ordre === undefined) {
        return accumulator;
      }
      accumulator.push(currentItem.type_ordre);
      return accumulator;
    }, [])
  );

  const typeOrdre_keys_stats = [];
  for (const key of Object.keys(typeOrdre_keys)) {
    typeOrdre_keys_stats.push({
      field_name: key,
      nb_presence: typeOrdre_keys[key],
      is_boolean: false,
      frequency: round(typeOrdre_keys[key] / nbRecordsTotal, 3)
    });
  }

  const sourceName_keys = getOccurrenceCount(
    res_data.reduce<string[]>((accumulator, currentItem) => {
      if (currentItem.source_name === undefined) {
        return accumulator;
      }
      accumulator.push(currentItem.source_name);
      return accumulator;
    }, [])
  );

  const sourceName_keys_stats = [];
  for (const key of Object.keys(sourceName_keys)) {
    sourceName_keys_stats.push({
      field_name: key,
      nb_presence: sourceName_keys[key],
      is_boolean: false,
      frequency: round(sourceName_keys[key] / nbRecordsTotal, 3)
    });
  }

  const res_org = res_data
    .filter((i) => i.organisations && i.organisations.length > 0)
    .map((i) => i.organisations)
    .flat();
  const nbRecordsOrg = res_org.length;

  const res_org_keys = res_org.map((i) => Object.keys(i)).flat();

  const org_keys_occurs = getOccurrenceCount(res_org_keys);

  const org_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(org_keys_occurs)) {
    const isKeyBoolean = !res_org
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v === "true" || v === "false"));

    org_keys_stats.push({
      field_name: key,
      nb_presence: org_keys_occurs[key],
      is_boolean: isKeyBoolean,
      frequency: round(org_keys_occurs[key] / nbRecordsOrg, 3)
    });
  }

  const res_rempl = res_data
    .filter((i) => i.remplacement)
    .map((i) => i.remplacement);
  const nbRecordsRempl = res_rempl.length;

  const res_rempl_keys = res_rempl.map((i) => Object.keys(i)).flat();

  const rempl_keys_occurs = getOccurrenceCount(res_rempl_keys);

  const rempl_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(rempl_keys_occurs)) {
    const isKeyBoolean = !res_rempl
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v === "true" || v === "false"));

    rempl_keys_stats.push({
      field_name: key,
      nb_presence: rempl_keys_occurs[key],
      is_boolean: isKeyBoolean,
      frequency: round(rempl_keys_occurs[key] / nbRecordsRempl, 3)
    });
  }

  // Sort by frequency
  const item_keys_stats_sort = item_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence
  );

  const org_keys_stats_sort = org_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence
  );
  const rempl_keys_stats_sort = rempl_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence
  );

  // Disp and write stats

  console.log("\nStructure base item:\n");
  for (const key of item_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsTotal).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`
    );
  }

  const items_stats_csv = convertToCSV(item_keys_stats_sort as never[]);
  if (items_stats_csv !== null) {
    fs.writeFileSync("stats_items.csv", items_stats_csv, "utf8");
  }

  console.log('\nStructure "Organisations":\n');
  for (const key of org_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsOrg).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`
    );
  }

  const orgs_stats_csv = convertToCSV(org_keys_stats_sort as never[]);
  if (orgs_stats_csv !== null) {
    fs.writeFileSync("stats_organisations.csv", orgs_stats_csv, "utf8");
  }

  console.log('\nStructure "remplacement":\n');
  for (const key of rempl_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsRempl).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`
    );
  }

  const repl_stats_csv = convertToCSV(rempl_keys_stats_sort as never[]);
  if (repl_stats_csv !== null) {
    fs.writeFileSync("stats_remplacement.csv", repl_stats_csv, "utf8");
  }

  console.log("\nTypeOrdre:\n");
  for (const key of typeOrdre_keys_stats) {
    console.log(key);
  }

  const typeOrdre_stats_csv = convertToCSV(typeOrdre_keys_stats as never[]);
  if (typeOrdre_stats_csv !== null) {
    fs.writeFileSync("stats_type_ordre.csv", typeOrdre_stats_csv, "utf8");
  }

  const sourceName_stats_csv = convertToCSV(sourceName_keys_stats as never[]);
  if (sourceName_stats_csv !== null) {
    fs.writeFileSync("stats_source_name.csv", sourceName_stats_csv, "utf8");
  }

  const incomplete_items: Incomplete[] = res_data
    .filter(
      (i) =>
        i.nom === undefined ||
        i.prenom === undefined ||
        i.type_ordre === undefined
    )
    .map(
      (i) =>
        ({
          source_date: i.source_date,
          source_id: i.source_id,
          nb_occurrences: 1
        }) as Incomplete
    )
    .reduce((accumulator: Incomplete[], currentItem) => {
      // Check if the valueT already exists in the accumulator
      const existingItem = accumulator.find(
        (item) => item.source_id === currentItem.source_id
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

  const incomplete_items_csv = convertToCSV(incomplete_items as never[]);
  if (incomplete_items_csv !== null) {
    fs.writeFileSync(
      "incomplete_items_nom_prenom.csv",
      incomplete_items_csv,
      "utf8"
    );
  }

  const rempl_incomplete_items: Incomplete[] = res_data
    .filter(
      (i) =>
        !(i.remplacement === undefined) &&
        (i.remplacement.nom === undefined ||
          i.remplacement.prenom === undefined)
    )
    .map(
      (i) =>
        ({
          source_date: i.source_date,
          source_id: i.source_id,
          nb_occurrences: 1
        }) as Incomplete
    )
    .reduce((accumulator: Incomplete[], currentItem) => {
      // Check if the valueT already exists in the accumulator
      const existingItem = accumulator.find(
        (item) => item.source_id === currentItem.source_id
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

  const rempl_incomplete_items_csv = convertToCSV(
    rempl_incomplete_items as never[]
  );
  if (rempl_incomplete_items_csv !== null) {
    fs.writeFileSync(
      "incomplete_remplacements_nom_prenom.csv",
      rempl_incomplete_items_csv,
      "utf8"
    );
  }
}

await main();
