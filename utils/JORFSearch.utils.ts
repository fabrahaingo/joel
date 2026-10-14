import {
  cleanJORFItems,
  JORFSearchItem,
  JORFSearchItemCleaningStats,
  JORFSearchResponse,
  mergeJORFSearchItemCleaningStats
} from "../entities/JORFSearchResponse.ts";
import { MessageApp, WikidataId } from "../types.ts";
import axios, { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import umami from "./umami.ts";
import {
  JORFSearchPublication,
  saveMetaPublications
} from "../entities/JORFSearchResponseMeta.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";
import { dateToString, JORFtoDate } from "./date.utils.ts";
import { logError, logErrorForApps, logWarning } from "./debugLogger.ts";
import { IPublication, Publication } from "../models/Publication.ts";
import {
  assertJsonPayload,
  REQUEST_TIMEOUT_MS,
  RETRY_MAX,
  shouldRetry,
  waitBeforeRetry
} from "./httpRetry.utils.ts";
import { fetchLegifranceMetaDay } from "./legifrance.utils.ts";

// Per Wikimedia policy, provide a descriptive agent with contact info.
const USER_AGENT = "JOEL/1.0 (contact@joel-officiel.fr)";

const JORFSEARCH_CALLS_CONCURRENCY = 1;

/**
 * Consecutive fully-failed chunks before the remaining days of a range are
 * abandoned. One failed day is a routine hiccup, and with a chunk of
 * {@link JORFSEARCH_CALLS_CONCURRENCY} day it must not condemn a whole
 * backfill; a run of them means the source is down and each further day would
 * burn `RETRY_MAX + 1` attempts against it for nothing.
 */
const CONSECUTIVE_FAILED_CHUNKS_BEFORE_ABANDON = 3;

const jorfAxios = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT }
});

// Extend the InternalAxiosRequestConfig with the res field
interface CustomInternalAxiosRequestConfig extends InternalAxiosRequestConfig {
  res?: {
    responseUrl?: string;
  };
  responseURL?: string;
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
    return await jorfAxios
      .get<JORFSearchResponse>(getJORFSearchLinkPeople(peopleName, true))
      .then(async (res1: AxiosResponse<JORFSearchResponse>) => {
        if (res1.data === null) {
          logJORFSearchError("people", messageApp);
          console.log("JORFSearch request for people returned null");
          return null;
        } // If an error occurred
        if (typeof res1.data !== "string") {
          const cleanedItems = cleanJORFItems(res1.data);
          umami.log({
            event: "/jorfsearch-request-people",
            messageApp,
            payload: { ...cleanedItems.processingStats }
          });
          return cleanedItems.cleanItems;
        } // If it worked

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
          const res2 = await jorfAxios.get<JORFSearchResponse>(url);
          if (res2.data && typeof res2.data !== "string") {
            const cleanedItems = cleanJORFItems(res2.data);
            umami.log({
              event: "/jorfsearch-request-people",
              messageApp,
              payload: { ...cleanedItems.processingStats }
            });
            return cleanedItems.cleanItems;
          }
          logJORFSearchError("people", messageApp);
          return null;
        }
        return null;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await waitBeforeRetry(retryNumber);
        return await callJORFSearchPeople(
          peopleName,
          messageApp,
          retryNumber + 1
        );
      } else {
        logJORFSearchError("people", messageApp);
        await logError(
          messageApp,
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

export interface JORFSearchDayResult {
  items: JORFSearchItem[];
  stats: JORFSearchItemCleaningStats;
}

async function callJORFSearchDay(
  day: Date,
  messageApps: MessageApp[],
  retryNumber = 0
): Promise<JORFSearchDayResult | null> {
  try {
    const dateDMY = dateToString(day, "DMY");
    const dateYMD = dateToString(day, "YMD");

    return await jorfAxios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${
            dateDMY // format day = "18-02-2024";
          }?format=JSON`
        )
      )
      .then((res) => {
        const data = assertJsonPayload(res.data, "JORFSearch (day records)");
        const rawItems = data.filter((m) => m.source_date === dateYMD);
        const cleanedItems = cleanJORFItems(rawItems);
        return {
          items: cleanedItems.cleanItems,
          stats: cleanedItems.processingStats
        };
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await waitBeforeRetry(retryNumber);
        return await callJORFSearchDay(day, messageApps, retryNumber + 1);
      } else {
        logJORFSearchError("date");
        await logErrorForApps(
          messageApps,
          `JORFSearch request for date aborted after ${String(RETRY_MAX)} tries`,
          error
        );
      }
    } else {
      await logErrorForApps(messageApps, "Error in callJORFSearchDay", error);
    }
  }
  return null;
}

/**
 * A day range fetched from JORFSearch. `failedDates` lists the days (YMD) whose
 * fetch never succeeded, so callers can tell "nothing was published" apart from
 * "we could not find out".
 */
export interface JORFRangeResult<T> {
  items: T[];
  requestedDays: number;
  failedDates: string[];
}

/**
 * Builds the descending list of days from `startDate` up to today, without
 * mutating the caller's `startDate`.
 */
function buildDayRange(startDate: Date): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const from = new Date(startDate);
  from.setHours(0, 0, 0, 0);

  const dayCount =
    Math.floor((today.getTime() - from.getTime()) / 86_400_000) + 1;
  return Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    return d;
  });
}

/**
 * Walks `days` in chunks of {@link JORFSEARCH_CALLS_CONCURRENCY}, recording the
 * days that came back empty-handed.
 *
 * After {@link CONSECUTIVE_FAILED_CHUNKS_BEFORE_ABANDON} chunks fail back to
 * back, the source is treated as down and the remaining days are marked failed
 * without being requested: each day already burns `RETRY_MAX + 1` attempts, so
 * a multi-day backfill against a dead host would otherwise spend minutes
 * hammering it before reaching the notification stage. Isolated failures do not
 * trip it, so one bad day no longer condemns the days behind it.
 */
async function fetchDayRange<T>(
  days: Date[],
  fetchDay: (day: Date) => Promise<T | null>
): Promise<{ results: T[]; failedDates: string[] }> {
  const results: T[] = [];
  const failedDates: string[] = [];
  let consecutiveFailedChunks = 0;

  const limit = JORFSEARCH_CALLS_CONCURRENCY;
  for (let i = 0; i < days.length; i += limit) {
    const sub = days.slice(i, i + limit);
    const subResults = await Promise.all(sub.map(fetchDay));

    subResults.forEach((result, j) => {
      if (result == null) failedDates.push(dateToString(sub[j], "YMD"));
      else results.push(result);
    });

    if (subResults.every((result) => result == null)) {
      consecutiveFailedChunks += 1;
    } else {
      consecutiveFailedChunks = 0;
    }

    if (consecutiveFailedChunks >= CONSECUTIVE_FAILED_CHUNKS_BEFORE_ABANDON) {
      for (const day of days.slice(i + limit)) {
        failedDates.push(dateToString(day, "YMD"));
      }
      break;
    }
  }

  return { results, failedDates };
}

export async function getJORFRecordsFromDate(
  startDate: Date,
  messageApps: MessageApp[]
): Promise<JORFRangeResult<JORFSearchItem>> {
  const days = buildDayRange(startDate);

  const { results, failedDates } = await fetchDayRange(days, (day) =>
    callJORFSearchDay(day, messageApps)
  );

  const allResults: JORFSearchDayResult = {
    items: results.flatMap((r) => r.items),
    stats: mergeJORFSearchItemCleaningStats(results.flatMap((r) => r.stats))
  };

  // Log aggregated statistics once per app
  for (const messageApp of messageApps) {
    umami.log({
      event: "/jorfsearch-request-date",
      messageApp,
      payload: {
        ...allResults.stats,
        day_nb: days.length,
        failed_day_nb: failedDates.length
      }
    });
  }

  return {
    items: allResults.items.sort(
      (a, b) =>
        JORFtoDate(a.source_date).getTime() -
        JORFtoDate(b.source_date).getTime()
    ),
    requestedDays: days.length,
    failedDates
  };
}

export async function getJORFMetaRecordsFromDate(
  startDate: Date,
  messageApps: MessageApp[]
): Promise<JORFRangeResult<JORFSearchPublication>> {
  const days = buildDayRange(startDate);

  const { results, failedDates } = await fetchDayRange(days, (day) =>
    fetchLegifranceMetaDay(day, messageApps)
  );

  const allItems: JORFSearchPublication[] = [];
  let totalRawItems = 0;
  let totalCleanItems = 0;
  let totalDroppedItems = 0;

  for (const result of results) {
    allItems.push(...result.items);
    totalRawItems += result.stats.raw_item_nb;
    totalCleanItems += result.stats.clean_item_nb;
    totalDroppedItems += result.stats.dropped_item_nb;
  }

  // Log aggregated statistics once per app
  for (const messageApp of messageApps) {
    umami.log({
      event: "/jorfsearch-request-meta",
      messageApp,
      payload: {
        raw_item_nb: totalRawItems,
        clean_item_nb: totalCleanItems,
        dropped_item_nb: totalDroppedItems,
        day_nb: days.length,
        failed_day_nb: failedDates.length
      }
    });
  }

  // A text belongs to a single edition: keep its earliest sighting so an
  // overlap between days can never notify it twice.
  const byId = new Map<string, JORFSearchPublication>();
  for (const item of allItems) {
    const seen = byId.get(item.id);
    if (seen == null || item.date < seen.date) byId.set(item.id, item);
  }
  const items = [...byId.values()].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  await saveMetaPublications(items, messageApps);

  return { items, requestedDays: days.length, failedDates };
}

export async function callJORFSearchTag(
  tag: FunctionTags,
  messageApp: MessageApp,
  tagValue?: string,
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    return await jorfAxios
      .get<JORFSearchResponse>(
        getJORFSearchLinkFunctionTag(tag, true, tagValue)
      )
      .then((res) => {
        const data = assertJsonPayload(res.data, "JORFSearch (function tag)");
        const cleanedItems = cleanJORFItems(data);
        umami.log({
          event: "/jorfsearch-request-tag",
          messageApp,
          payload: { ...cleanedItems.processingStats }
        });
        return cleanedItems.cleanItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await waitBeforeRetry(retryNumber);
        return await callJORFSearchTag(
          tag,
          messageApp,
          tagValue,
          retryNumber + 1
        );
      } else {
        logJORFSearchError("function_tag", messageApp);
        await logError(
          messageApp,
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
    return await jorfAxios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${wikiId.toUpperCase()}?format=JSON`
        )
      )
      .then((res) => {
        const data = assertJsonPayload(res.data, "JORFSearch (organisation)");
        const cleanedItems = cleanJORFItems(data);
        umami.log({
          event: "/jorfsearch-request-organisation",
          messageApp,
          payload: { ...cleanedItems.processingStats }
        });
        return cleanedItems.cleanItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await waitBeforeRetry(retryNumber);
        return await callJORFSearchOrganisation(
          wikiId,
          messageApp,
          retryNumber + 1
        );
      } else {
        logJORFSearchError("organisation", messageApp);
        await logError(
          messageApp,
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
    match: { language?: string; text?: string };
  }[];
}

export async function searchOrganisationWikidataId(
  org_name: string,
  messageApp: MessageApp,
  retryNumber = 0
): Promise<{ nom: string; wikidataId: WikidataId }[] | null> {
  if (org_name.length == 0) throw new Error("Empty org_name");

  let url: string | null = null;
  try {
    umami.log({
      event: "/jorfsearch-request-wikidata-names",
      messageApp
    });

    url = encodeURI(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${org_name}&language=fr&origin=*&format=json&limit=50`
    );

    const wikidataIds_raw: { nom: string; id: WikidataId }[] | null =
      await jorfAxios
        .get<string | null | WikiDataAPIResponse>(url)
        .then(async (r) => {
          if (r.data === null || typeof r.data === "string") {
            await logError(
              messageApp,
              `Wikidata API error when fetching organisation: ${org_name}`
            );
            return null;
          }
          return r.data.search.reduce<{ nom: string; id: WikidataId }[]>(
            (acc, entry) => {
              if (entry.match.language === "fr" && entry.match.text != null) {
                acc.push({ nom: entry.match.text, id: entry.id });
              }
              return acc;
            },
            []
          );
        });

    if (wikidataIds_raw === null) return null;
    if (wikidataIds_raw.length == 0) return []; // prevents unnecessary jorf event

    url = encodeURI(
      `https://jorfsearch.steinertriples.ch/wikidata/contains?ids[]=${wikidataIds_raw.map((o) => o.id).join("&ids[]=")}`
    );
    return await jorfAxios
      .get<{ name: string; id: WikidataId }[] | null>(url)
      .then((res) => {
        const data = assertJsonPayload(res.data, "JORFSearch (wikidata)");
        return data.map((o) => ({
          nom: o.name,
          wikidataId: o.id
        }));
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await waitBeforeRetry(retryNumber);
        return await searchOrganisationWikidataId(
          org_name,
          messageApp,
          retryNumber + 1
        );
      }
      logJORFSearchError("wikidata");
      await logError(
        messageApp,
        `JORFSearch request for wikidata_id aborted after ${String(RETRY_MAX)} tries`,
        error
      );
    } else {
      await logError(
        messageApp,
        url
          ? `Error in searchOrganisationWikidataId when fetching url ${url} with search term ${org_name}`
          : `Error in searchOrganisationWikidataId with search term ${org_name}`,
        error
      );
    }
  }
  return null;
}

/**
 * References that are absent from the JO summary of their own publication day.
 * Bulletins officiels (BOMI, BOEN, BOSanté and the others) are legitimate
 * sources that are never published at the JO, so they can never be resolved.
 * Without this, every message from every user re-fetches the same whole day for
 * the same doomed reference.
 */
const missingReferenceCache = new Map<string, number>();
const MISSING_REFERENCE_TTL_MS = 60 * 60 * 1000;

/** Test seam: drops the memo of references known to be absent from the JO. */
export function resetMissingReferenceCache(): void {
  missingReferenceCache.clear();
}

function isKnownMissingReference(reference: string): boolean {
  const seenAt = missingReferenceCache.get(reference);
  if (seenAt === undefined) return false;
  if (Date.now() - seenAt < MISSING_REFERENCE_TTL_MS) return true;
  missingReferenceCache.delete(reference);
  return false;
}

/**
 * Ensures the JO publication carrying `reference` is stored locally, fetching
 * the summary of each day the reference was seen on until one of them holds it.
 *
 * A reference can carry several dates when a document spans more than one JO
 * edition, and only the day that actually lists it resolves the lookup.
 */
async function checkReferenceInDb(
  reference: string,
  dateYMDs: string[],
  messageApp: MessageApp
): Promise<void> {
  try {
    const res: IPublication | null = await Publication.findOne({
      id: reference
    });
    if (res != null) return;

    if (isKnownMissingReference(reference)) return;

    const validDates = dateYMDs.filter(
      (dateYMD) => !dateYMD.split("-").map(Number).some(isNaN)
    );
    if (validDates.length === 0) {
      await logError(
        messageApp,
        `Error parsing dates ${dateYMDs.join(", ")} in items from reference ${reference}`
      );
      return;
    }

    let anyDayFetched = false;
    for (const dateYMD of validDates) {
      const publicationDay = await fetchLegifranceMetaDay(JORFtoDate(dateYMD), [
        messageApp
      ]);
      if (publicationDay == null) continue;
      anyDayFetched = true;

      // Persist the whole day regardless: the other texts of that edition are
      // very likely to be looked up next.
      await saveMetaPublications(publicationDay.items, [messageApp]);

      if (publicationDay.items.some((item) => item.id === reference)) return;
    }

    if (!anyDayFetched) {
      await logError(
        messageApp,
        `Could not fetch the JO summary for reference ${reference} on ${validDates.join(", ")}`
      );
      return;
    }

    missingReferenceCache.set(reference, Date.now());
    await logWarning(
      messageApp,
      `Reference ${reference} is absent from the JO summary of ${validDates.join(", ")}; it is likely published in a bulletin officiel rather than at the JO`
    );
  } catch (error) {
    await logError(
      messageApp,
      `Error in checkReferenceInDb for reference ${reference} on ${dateYMDs.join(", ")}`,
      error
    );
  }
}

export async function callJORFSearchReference(
  reference: string,
  messageApp: MessageApp,
  retryNumber = 0
): Promise<JORFSearchItem[] | null> {
  try {
    return await jorfAxios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/doc/${reference.toUpperCase()}?format=JSON`
        )
      )
      .then((res) => {
        const data = assertJsonPayload(res.data, "JORFSearch (reference)");
        const cleanedItems = cleanJORFItems(data);
        umami.log({
          event: "/jorfsearch-request-reference",
          messageApp,
          payload: { ...cleanedItems.processingStats }
        });
        if (cleanedItems.cleanItems.length == 0) return [];

        void checkReferenceInDb(
          reference,
          [...new Set(cleanedItems.cleanItems.map((i) => i.source_date))],
          messageApp
        ); // check db in the background
        return cleanedItems.cleanItems;
      });
  } catch (error) {
    if (shouldRetry(error)) {
      if (retryNumber < RETRY_MAX) {
        await waitBeforeRetry(retryNumber);
        return await callJORFSearchReference(
          reference,
          messageApp,
          retryNumber + 1
        );
      }
      logJORFSearchError("reference");
      await logError(
        messageApp,
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
