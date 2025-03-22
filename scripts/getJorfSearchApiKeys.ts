import axios, { AxiosResponse } from "axios";
import {
  JORFSearchItem,
  JORFSearchResponse,
} from "../entities/JORFSearchResponse";
import * as fs from "node:fs";
import { dateTOJORFFormat} from "../utils/date.utils";

function round(value: number, exp: number) {
  if (typeof exp === 'undefined' || +exp === 0)
    return Math.round(value);

  value = +value;
  exp = +exp;

  if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0))
    return NaN;

  // Shift
  value = value.toString().split('e');
  value = Math.round(+(value[0] + 'e' + (value[1] ? (+value[1] + exp) : exp)));

  // Shift back
  value = value.toString().split('e');
  return +(value[0] + 'e' + (value[1] ? (+value[1] - exp) : -exp));
}

type StringToNumberMap={[key: string]:number}[];

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

function getOccurenceCount(values: string[]): StringToNumberMap {
  return values.reduce((acc , val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, [] as StringToNumberMap);
}

interface JORFKeyStat {
  field_name: string;
  nb_presence: number;
  frequency: number;
  is_boolean: boolean;
}

interface uncomplete {
  source_date: string,
  source_id: string,
  nb_occurences: number
}

// Function to convert array to CSV
function convertToCSV(array: any[]) {
  if (array.length < 1) {
    return null
  }
  // Extract the keys from the first element
  const headers = Object.keys(array[0]).join(',');

  // Convert each element to a CSV row
  const rows = array.map((element: any) => Object.values(element).join(',')).join('\n');

  // Combine headers and rows
  return `${headers}\n${rows}`;
}

async function main() {
  const nbDays = 14000;
  // Max 14000

  const currentDay = new Date();

  let res_data: JORFSearchItem[] = [];
  for (let i = 0; i < nbDays; i++) {
    // currentDay minus i days
    const day = new Date(currentDay);
    day.setDate(day.getDate() - i);

    const res_day = await JORFSearchCall(dateTOJORFFormat(day));
    res_data = res_data.concat(res_day);

    console.log(`Day ${String(i)} done. ${String(nbDays - i)} days left.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const nbRecordsTotal = res_data.length;

  const items_keys_occurs = getOccurenceCount(
      res_data.map((i) => Object.keys(i)).flat(),
  );

  const item_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(items_keys_occurs)) {
    const isKeyBoolean = !res_data
        .filter((i) => i[key])
        .map((i) => i[key])
        .some((v) => !(v === "true" || v === "false"));

    item_keys_stats.push({
      field_name: key,
      nb_presence: items_keys_occurs[key],
      is_boolean: isKeyBoolean,
      frequency: round(items_keys_occurs[key]/nbRecordsTotal,3),
    });
  }

  const typeOrdre_keys = getOccurenceCount(
          res_data
              .filter((i) => i.type_ordre)
              .map((i) => i.type_ordre)
              .flat(),
  );

  const typeOrdre_keys_stats= [];
  for (const key of Object.keys(typeOrdre_keys)) {
    typeOrdre_keys_stats.push({
      field_name: key,
      nb_presence: typeOrdre_keys[key],
      is_boolean: false,
      frequency: round(typeOrdre_keys[key]/nbRecordsTotal,3),
    });
  }

  const sourceName_keys = getOccurenceCount(
      res_data
          .filter((i) => i.source_name)
          .map((i) => i.source_name)
          .flat(),
  );

  const sourceName_keys_stats= [];
  for (const key of Object.keys(sourceName_keys)) {
    sourceName_keys_stats.push({
      field_name: key,
      nb_presence: sourceName_keys[key],
      is_boolean: false,
      frequency: round(sourceName_keys[key]/nbRecordsTotal,3),
    });
  }

  const res_org = res_data
      .filter((i) => i.organisations.length > 0)
      .map((i) => i.organisations)
      .flat();
  const nbRecordsOrg = res_org.length;

  const res_org_keys = res_org.map((i) => Object.keys(i)).flat();

  const org_keys_occurs: StringToNumberMap = getOccurenceCount(res_org_keys);

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
      frequency: round(org_keys_occurs[key]/nbRecordsOrg,3),
    });
  }

  const res_rempl = res_data
      .filter((i) => i.remplacement)
      .map((i) => i.remplacement);
  const nbRecordsRempl = res_rempl.length;

  const res_rempl_keys = res_rempl.map((i) => Object.keys(i)).flat();

  const rempl_keys_occurs = getOccurenceCount(res_rempl_keys);

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
      frequency: round(rempl_keys_occurs[key]/nbRecordsRempl,3)
    });
  }

  // Sort by frequency
  const item_keys_stats_sort = item_keys_stats.sort(
      (i, j) => j.nb_presence - i.nb_presence,
  );

  const type_ordre_keys_stats_sort = typeOrdre_keys_stats.sort(
      (i, j) => j.nb_presence - i.nb_presence,
  );

  const org_keys_stats_sort = org_keys_stats.sort(
      (i, j) => j.nb_presence - i.nb_presence,
  );
  const rempl_keys_stats_sort = rempl_keys_stats.sort(
      (i, j) => j.nb_presence - i.nb_presence,
  );

  // Disp and write stats

  console.log("\nStructure base item:\n");
  for (const key of item_keys_stats_sort) {
    console.log(
        `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsTotal).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`,
    );
  }

  const items_stats_csv= convertToCSV(item_keys_stats_sort);
  if (items_stats_csv !== null) {
    fs.writeFileSync('stats_items.csv', items_stats_csv, 'utf8');
  }

  console.log('\nStructure "Organisations":\n');
  for (const key of org_keys_stats_sort) {
    console.log(
        `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsOrg).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`,
    );
  }

  const orgs_stats_csv= convertToCSV(org_keys_stats_sort);
  if (orgs_stats_csv !== null) {
    fs.writeFileSync('stats_organisations.csv', orgs_stats_csv, 'utf8');
  }

  console.log('\nStructure "remplacement":\n');
  for (const key of rempl_keys_stats_sort) {
    console.log(
        `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsRempl).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`,
    );
  }

  const repl_stats_csv= convertToCSV(rempl_keys_stats_sort);
  if (repl_stats_csv !== null) {
    fs.writeFileSync('stats_remplacement.csv', repl_stats_csv, 'utf8');
  }

  console.log("\nTypeOrdre:\n");
  for (const key of typeOrdre_keys) {
    console.log(key);
  }

  const typeOrdre_stats_csv= convertToCSV(typeOrdre_keys_stats);
  if (typeOrdre_stats_csv !== null) {
    fs.writeFileSync('stats_type_ordre.csv', typeOrdre_stats_csv, 'utf8');
  }

  const sourceName_stats_csv= convertToCSV(sourceName_keys_stats);
  if (sourceName_stats_csv !== null) {
    fs.writeFileSync('stats_source_name.csv', sourceName_stats_csv, 'utf8');
  }

  const uncomplete_items: uncomplete[] = res_data.filter(i =>
      i.nom === undefined ||
      i.prenom === undefined ||
      i.type_ordre === undefined
  ).map(i => ({
    source_date: i.source_date,
    source_id: i.source_id,
    nb_occurences: 1,
  }) as uncomplete)
      .reduce((accumulator: uncomplete[], currentItem) => {
        // Check if the valueT already exists in the accumulator
        const existingItem = accumulator
            .find(item => item.source_id === currentItem.source_id);

        if (existingItem) {
          // If it exists, increment the count
          existingItem.nb_occurences += 1;
        } else {
          // If it doesn't exist, add the item with a count of 1
          accumulator.push({...currentItem, nb_occurences: 1});
        }

        return accumulator;
      }, []);

  const uncomplete_items_csv = convertToCSV(uncomplete_items);
  if (uncomplete_items_csv !== null) {
    fs.writeFileSync('uncomplete_items_nom_prenom.csv', uncomplete_items_csv, 'utf8');
  }

  const rempl_uncomplete_items: uncomplete[]=res_data.filter(i=>
      !(i.remplacement === undefined) && (
        i.remplacement.nom === undefined ||
        i.remplacement.prenom === undefined)
  ).map(i=> ({
    source_date: i.source_date,
    source_id: i.source_id,
    nb_occurences: 1,
  }) as uncomplete)
      .reduce((accumulator: uncomplete[], currentItem) => {
        // Check if the valueT already exists in the accumulator
        const existingItem = accumulator
            .find(item  => item.source_id === currentItem.source_id);

        if (existingItem) {
          // If it exists, increment the count
          existingItem.nb_occurences += 1;
        } else {
          // If it doesn't exist, add the item with a count of 1
          accumulator.push({ ...currentItem, nb_occurences: 1 });
        }

        return accumulator;
      }, []);

  const rempl_uncomplete_items_csv=convertToCSV(rempl_uncomplete_items);
  if (rempl_uncomplete_items_csv !== null) {
    fs.writeFileSync('uncomplete_remplacements_nom_prenom.csv', rempl_uncomplete_items_csv, 'utf8');
  }

  const missing_sexe=res_data.filter(i=>i.sexe === undefined).map(i=> ({
    source_date: i.source_date,
    source_id: i.source_id,
    nb_occurences: 1,
  }) as uncomplete)
      .reduce((accumulator: uncomplete[], currentItem) => {
        // Check if the valueT already exists in the accumulator
        const existingItem = accumulator
            .find(item  => item.source_id === currentItem.source_id);

        if (existingItem) {
          // If it exists, increment the count
          existingItem.nb_occurences += 1;
        } else {
          // If it doesn't exist, add the item with a count of 1
          accumulator.push({ ...currentItem, nb_occurences: 1 });
        }

        return accumulator;
      }, []);

  const missing_sexe_csv=convertToCSV(missing_sexe);
  if (missing_sexe_csv !== null) {
    fs.writeFileSync('uncomplete_items_sexe.csv', missing_sexe_csv, 'utf8');
  }

  1;
}

main();
