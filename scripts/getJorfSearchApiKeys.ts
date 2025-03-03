import axios, { AxiosResponse } from "axios";
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

function getFrequencyCount(values: string[]) {
  return values.reduce((acc, val) => {
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {});
}

interface JORFKeyStat {
  field_name: string;
  nb_presence: number;
  is_boolean: boolean;
}

async function main() {
  const nbDays = 12844;

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

  const items_keys_freq = getFrequencyCount(
    res_data.map((i) => Object.keys(i)).flat(),
  );

  const item_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(items_keys_freq)) {
    const isKeyBoolean = !res_data
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v === "true" || v === "false"));

    item_keys_stats.push({
      field_name: key,
      nb_presence: items_keys_freq[key],
      is_boolean: isKeyBoolean,
    });
  }

  const typeOrdre_keys = Object.keys(
    getFrequencyCount(
      res_data
        .filter((i) => i.type_ordre)
        .map((i) => i.type_ordre)
        .flat(),
    ),
  );

  const res_org = res_data
    .filter((i) => i.organisations.length > 0)
    .map((i) => i.organisations)
    .flat();
  const nbRecordsOrg = res_org.length;

  const res_org_keys = res_org.map((i) => Object.keys(i)).flat();

  const org_keys_freq = getFrequencyCount(res_org_keys);

  const org_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(org_keys_freq)) {
    const isKeyBoolean = !res_org
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v === "true" || v === "false"));

    org_keys_stats.push({
      field_name: key,
      nb_presence: org_keys_freq[key],
      is_boolean: isKeyBoolean,
    });
  }

  const res_rempl = res_data
    .filter((i) => i.remplacement)
    .map((i) => i.remplacement);
  const nbRecordsRempl = res_rempl.length;

  const res_rempl_keys = res_rempl.map((i) => Object.keys(i)).flat();

  const rempl_keys_freq = getFrequencyCount(res_rempl_keys);

  const rempl_keys_stats: JORFKeyStat[] = [];

  for (const key of Object.keys(rempl_keys_freq)) {
    const isKeyBoolean = !res_rempl
      .filter((i) => i[key])
      .map((i) => i[key])
      .some((v) => !(v === "true" || v === "false"));

    rempl_keys_stats.push({
      field_name: key,
      nb_presence: rempl_keys_freq[key],
      is_boolean: isKeyBoolean,
    });
  }

  //
  const item_keys_stats_sort = item_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence,
  );
  const org_keys_stats_sort = org_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence,
  );
  const rempl_keys_stats_sort = rempl_keys_stats.sort(
    (i, j) => j.nb_presence - i.nb_presence,
  );
  // Disp stats

  console.log("\nItems:\n");
  for (const key of item_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsTotal).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`,
    );
  }

  console.log("\nOrgs:\n");
  for (const key of org_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsOrg).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`,
    );
  }

  console.log("\nRempl:\n");
  for (const key of rempl_keys_stats_sort) {
    console.log(
      `${key.field_name} - ${((100 * key.nb_presence) / nbRecordsRempl).toFixed(2)}% ${key.is_boolean ? " - boolean" : ""}`,
    );
  }

  console.log("\nTypeOrdre:\n");
  for (const key of typeOrdre_keys) {
    console.log(key);
  }
}

main();
