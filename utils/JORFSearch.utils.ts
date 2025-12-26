import {
  cleanJORFItems,
  JORFSearchItem,
  JORFSearchResponse
} from "../entities/JORFSearchResponse.ts";
import { MessageApp, WikidataId } from "../types.ts";
import axios, {
  AxiosResponse,
  InternalAxiosRequestConfig,
  isAxiosError
} from "axios";
import umami from "./umami.ts";
import {
  cleanJORFPublication,
  JORFSearchPublication,
  JORFSearchResponseMeta
} from "../entities/JORFSearchResponseMeta.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { dateToString } from "./date.utils.ts";
import { logError } from "./debugLogger.ts";

// Per Wikimedia policy, provide a descriptive agent with contact info.
const USER_AGENT = "JOEL/1.0 (contact@joel-officiel.fr)";
const RETRY_MAX = 3;
const BASE_RETRY_DELAY_MS = 1000;

// Extend the InternalAxiosRequestConfig with the res field
interface CustomInternalAxiosRequestConfig extends InternalAxiosRequestConfig {
  res?: {
    responseUrl?: string;
  };
  responseURL?: string;
}

function shouldRetry(e: unknown): boolean {
  if (!isAxiosError(e)) return false;
  const s = e.response?.status;
  return !(s && s >= 400 && s < 500 && s !== 408 && s !== 429);
}

function logJORFSearchError(
  errorType:
    | "people"
    | "organisation"
    | "function_tag"
    | "date"
    | "wikidata"
    | "reference"
    | "meta",
  messageApp?: MessageApp
) {
  umami.log({
    event: "/jorfsearch-error",
    messageApp,
    payload: { [errorType]: true }
  });
}

export async function callJORFSearchPeople(
  peopleName: string,
  messageApp: MessageApp,
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    return await axios
      .get<JORFSearchResponse>(getJORFSearchLinkPeople(peopleName, true), {
        headers: {
          "User-Agent": USER_AGENT
        }
      })
      .then(async (res1: AxiosResponse<JORFSearchResponse>) => {
        if (res1.data === null) {
          logJORFSearchError("people", messageApp);
          console.log("JORFSearch request for people returned null");
          return null;
        } // If an error occurred
        if (typeof res1.data !== "string") return cleanJORFItems(res1.data); // If it worked

        // If the peopleName had nom/prenom inverted or bad formatting:
        // we need to call JORFSearch again with the response url in the correct format

        const request = res1.request as CustomInternalAxiosRequestConfig;
        const responseUrl = request.res?.responseUrl ?? request.responseURL; // Node (follow-redirects) // Browser

        if (typeof responseUrl === "string" && responseUrl.length) {
          // ensure ?format=JSON is present idempotently
          const url = responseUrl.includes("?")
            ? `${responseUrl}${/([?&])format=JSON\b/.test(responseUrl) ? "" : "&format=JSON"}`
            : `${responseUrl}?format=JSON`;

          umami.log({
            event: "/jorfsearch-request-people-formatted",
            messageApp
          });
          const res2 = await axios.get<JORFSearchResponse>(url, {
            headers: { "User-Agent": USER_AGENT }
          });
          if (res2.data && typeof res2.data !== "string") {
            const cleanedItems = cleanJORFItems(res2.data);
            umami.log({
              event: "/jorfsearch-request-people",
              messageApp,
              payload: {
                raw_item_nb: res2.data.length,
                clean_item_nb: cleanedItems.length,
                dropped_item_nb: res2.data.length - cleanedItems.length
              }
            });
            return cleanedItems;
          }
          logJORFSearchError("people", messageApp);
          return null;
        }
        return null;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await callJORFSearchPeople(
          peopleName,
          messageApp,
          retryNumber + 1
        );
      } else {
        logJORFSearchError("people", messageApp);
        console.log(
          `JORFSearch request for people aborted after ${String(RETRY_MAX)} tries`,
          error
        );
      }
    } else {
      await logError(messageApp, "Error in callJORFSearchPeople", error);
    }
  }
  return null;
}

export async function callJORFSearchDay(
  day: Date,
  messageApps: MessageApp[],
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    const dateDMY = dateToString(day, "DMY");
    const dateYMD = dateToString(day, "YMD");

    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${
            dateDMY // format day = "18-02-2024";
          }?format=JSON`
        ),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          logJORFSearchError("date");
          console.log("JORFSearch request for date returned null");
          return null;
        }
        const rawItems = res.data.filter((m) => m.source_date === dateYMD);
        const cleanedItems = cleanJORFItems(rawItems);
        umami.log({
          event: "/jorfsearch-request-date",
          payload: {
            raw_item_nb: rawItems.length,
            clean_item_nb: cleanedItems.length,
            dropped_item_nb: rawItems.length - cleanedItems.length
          }
        });
        return cleanedItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await callJORFSearchDay(day, messageApps, retryNumber + 1);
      } else {
        logJORFSearchError("date");
        console.log(
          `JORFSearch request for date aborted after ${String(RETRY_MAX)} tries`,
          error
        );
      }
    } else {
      for (const messageApp of messageApps)
        await logError(messageApp, "Error in callJORFSearchDay", error);
    }
  }
  return null;
}

export async function callJORFSearchMetaDay(
  day: Date,
  messageApps: MessageApp[],
  retryNumber = 0
): Promise<JORFSearchPublication[] | null> {
  try {
    const dateYMD = dateToString(day, "YMD");

    const previousDay = new Date(day);
    // subtract one day
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDayYMD = dateToString(previousDay, "YMD");

    return await axios
      .get<JORFSearchResponseMeta>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/meta/search?date=${dateYMD}`
        ),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          logJORFSearchError("meta");
          console.log("JORFSearch request for meta returned null");
          return null;
        }
        const rawItems = res.data.filter((m) => m.date === previousDayYMD);
        const cleanedItems = cleanJORFPublication(rawItems);
        umami.log({
          event: "/jorfsearch-request-meta",
          payload: {
            raw_item_nb: rawItems,
            clean_item_nb: cleanedItems.length,
            dropped_item_nb: rawItems.length - cleanedItems.length
          }
        });
        return cleanedItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await callJORFSearchMetaDay(day, messageApps, retryNumber + 1);
      }
      logJORFSearchError("meta");
      console.log(
        `JORFSearch request for meta aborted after ${String(RETRY_MAX)} tries`,
        error
      );
    } else {
      for (const messageApp of messageApps)
        await logError(messageApp, "Error in callJORFSearchMetaDay", error);
    }
  }
  return null;
}

export async function callJORFSearchTag(
  tag: FunctionTags,
  messageApp: MessageApp,
  tagValue?: string,
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    return await axios
      .get<JORFSearchResponse>(
        getJORFSearchLinkFunctionTag(tag, true, tagValue),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          logJORFSearchError("function_tag");
          console.log("JORFSearch request for tag returned null");
          return null;
        }
        const cleanedItems = cleanJORFItems(res.data);
        umami.log({
          event: "/jorfsearch-request-tag",
          messageApp,
          payload: {
            raw_item_nb: res.data.length,
            clean_item_nb: cleanedItems.length,
            dropped_item_nb: res.data.length - cleanedItems.length
          }
        });
        return cleanedItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await callJORFSearchTag(
          tag,
          messageApp,
          tagValue,
          retryNumber + 1
        );
      } else {
        logJORFSearchError("function_tag", messageApp);
        console.log(
          `JORFSearch request for function_tag aborted after ${String(RETRY_MAX)} tries`,
          error
        );
      }
    } else {
      await logError(messageApp, "Error in callJORFSearchTag", error);
    }
  }
  return null;
}

export async function callJORFSearchOrganisation(
  wikiId: WikidataId,
  messageApp: MessageApp,
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${wikiId.toUpperCase()}?format=JSON`
        ),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          logJORFSearchError("organisation");
          console.log("JORFSearch request for organisation returned null");
          return null;
        }
        const cleanedItems = cleanJORFItems(res.data);
        umami.log({
          event: "/jorfsearch-request-organisation",
          messageApp,
          payload: {
            raw_item_nb: res.data.length,
            clean_item_nb: cleanedItems.length,
            dropped_item_nb: res.data.length - cleanedItems.length
          }
        });
        return cleanedItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await callJORFSearchOrganisation(
          wikiId,
          messageApp,
          retryNumber + 1
        );
      } else {
        logJORFSearchError("organisation", messageApp);
        console.log(
          `JORFSearch request for organisation aborted after ${String(RETRY_MAX)} tries`,
          error
        );
      }
    } else {
      await logError(messageApp, "Error in callJORFSearchOrganisation", error);
    }
  }
  return null;
}

interface WikiDataAPIResponse {
  success: number;
  search: {
    id: WikidataId;
  }[];
}

export async function searchOrganisationWikidataId(
  org_name: string,
  messageApp: MessageApp,
  retryNumber = 0
): Promise<{ nom: string; wikidataId: WikidataId }[] | null> {
  if (org_name.length == 0) throw new Error("Empty org_name");

  try {
    umami.log({
      event: "/jorfsearch-request-wikidata-names",
      messageApp
    });

    const wikidataIds_raw: WikidataId[] | null = await axios
      .get<string | null | WikiDataAPIResponse>(
        encodeURI(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${org_name}&language=fr&origin=*&format=json&limit=50`
        ),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then(async (r) => {
        if (r.data === null || typeof r.data === "string") {
          await logError(
            messageApp,
            `Wikidata API error when fetching organisation: ${org_name}`
          );
          return null;
        }
        return r.data.search.map((o) => o.id);
      });

    if (wikidataIds_raw === null) return null;
    if (wikidataIds_raw.length == 0) return []; // prevents unnecessary jorf event

    return await axios
      .get<{ name: string; id: WikidataId }[] | null>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/wikidata_id_to_name?ids[]=${wikidataIds_raw.join("&ids[]=")}`
        ),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          logJORFSearchError("wikidata");
          console.log("JORFSearch request for wikidata returned null");
          return null;
        }
        return res.data.map((o) => ({
          nom: o.name,
          wikidataId: o.id
        }));
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await searchOrganisationWikidataId(
          org_name,
          messageApp,
          retryNumber + 1
        );
      }
      logJORFSearchError("wikidata");
      console.log(
        `JORFSearch request for wikidata_id aborted after ${String(RETRY_MAX)} tries`,
        error
      );
    } else {
      await logError(
        messageApp,
        "Error in searchOrganisationWikidataId",
        error
      );
    }
  }
  return null;
}

export async function callJORFSearchReference(
  reference: string,
  messageApp: MessageApp,
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/doc/${reference.toUpperCase()}?format=JSON`
        ),
        {
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          logJORFSearchError("reference");
          console.log("JORFSearch request for reference returned null");
          return null;
        }
        const cleanedItems = cleanJORFItems(res.data);
        umami.log({
          event: "/jorfsearch-request-reference",
          messageApp,
          payload: {
            raw_item_nb: res.data.length,
            clean_item_nb: cleanedItems.length,
            dropped_item_nb: res.data.length - cleanedItems.length
          }
        });
        return cleanedItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_RETRY_DELAY_MS * (retryNumber + 1))
        );
        return await callJORFSearchReference(
          reference,
          messageApp,
          retryNumber + 1
        );
      }
      logJORFSearchError("reference");
      console.log(
        `JORFSearch request for reference aborted after ${String(RETRY_MAX)} tries`,
        error
      );
    } else {
      await logError(messageApp, "Error in callJORFSearchReference", error);
    }
  }
  return null;
}

// Format a string to match the expected search format on JORFSearch: first letter capitalised and no accent
/**
 * Normalises diacritics, trims/lowers the string, and
 * title-cases every segment separated by space, hyphen, or apostrophe.
 */
export function cleanPeopleName(input: string): string {
  if (!input) return "";

  // 1. Trim & lowercase
  let out = input.trim().toLowerCase();

  // 2. Strip common Western diacritics in one shot
  out = out
    .normalize("NFD") // decompose e.g. "é" → "é"
    .replace(/[\u0300-\u036f]/g, ""); // remove combining marks

  // 3. Capitalise first letter after start, space, hyphen or apostrophe
  //    - keeps the delimiter (p1) and upper-cases the following char (p2)
  out = out.replace(/(^|[\s\-'])\p{L}/gu, (m) => m.toUpperCase());

  return out;
}

export function cleanPeopleNameJORFURL(input: string): string {
  if (!input) return "";
  let out = input.trim().toLowerCase();
  out = out.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // add normalize
  out = out.replace(/(^|[\s\-'])\p{L}/gu, (m) => m.toUpperCase());
  out = out.replace(/[()]/g, "");
  return out;
}

export function getJORFSearchLinkPeople(
  prenomNom: string,
  json = false
): string {
  const u = new URL(
    "https://jorfsearch.steinertriples.ch/name/" +
      cleanPeopleNameJORFURL(prenomNom)
  );
  if (json) u.searchParams.set("format", "JSON");
  return u.toString();
}
export function getJORFSearchLinkFunctionTag(
  fctTag: FunctionTags,
  json = false,
  tagValue?: string
): string {
  // JORF expects /tag/<tag>="<value>" exactly in the PATH.
  // Safely percent-encode the value and quotes.
  const base = `https://jorfsearch.steinertriples.ch/tag/${encodeURIComponent(fctTag)}`;
  const path =
    tagValue !== undefined
      ? `${base}=%22${encodeURIComponent(tagValue)}%22`
      : base;

  const u = new URL(path);
  if (json) u.searchParams.set("format", "JSON");
  return u.toString();
}

export function getJORFSearchLinkOrganisation(
  wikidataId: string,
  json = false
): string {
  const u = new URL(
    `https://jorfsearch.steinertriples.ch/${encodeURIComponent(wikidataId)}`
  );
  if (json) u.searchParams.set("format", "JSON");
  return u.toString();
}

export function getJORFTextLink(source_id: string) {
  return `https://bodata.steinertriples.ch/${encodeURIComponent(source_id)}/redirect`;
}

export function extractJORFTextId(url: string): string {
  const parts = url.split("?");
  const path = parts[0];
  const queryString = parts[1];

  if (!queryString) {
    const pathParts = path.split("/");
    const lastNonEmptyPart = pathParts.filter((part) => part !== "").pop();
    return lastNonEmptyPart ?? "";
  }

  const queryParams = queryString.split("&");
  for (const param of queryParams) {
    const [key, value] = param.split("=");
    if (key === "cidTexte") {
      return value;
    }
  }

  // Fallback in case 'cidTexte' is not found in the query string
  const pathParts = path.split("/");
  const lastNonEmptyPart = pathParts.filter((part) => part !== "").pop();
  return lastNonEmptyPart ?? "";
}
