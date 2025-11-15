import {
  cleanJORFItems,
  JORFSearchItem,
  JORFSearchResponse
} from "../entities/JORFSearchResponse.ts";
import { WikidataId } from "../types.ts";
import axios, { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import umami from "./umami.ts";
import {
  cleanJORFPublication,
  JORFSearchPublication,
  JORFSearchResponseMeta
} from "../entities/JORFSearchResponseMeta.ts";
import { FunctionTags } from "../entities/FunctionTags.ts";

// Extend the InternalAxiosRequestConfig with the res field
interface CustomInternalAxiosRequestConfig extends InternalAxiosRequestConfig {
  res?: {
    responseUrl?: string;
  };
}

export async function callJORFSearchPeople(
  peopleName: string,
  messageApp: MessageApp
): Promise<JORFSearchItem[] | null> {
  async function logError() {
    await umami.log({
      event: "/jorfsearch-error",
      messageApp,
      payload: { people: true }
    });
  }
  try {
    await umami.log({
      event: "/jorfsearch-request-people",
      messageApp
    });
    return await axios
      .get<JORFSearchResponse>(getJORFSearchLinkPeople(peopleName, true))
      .then(async (res1: AxiosResponse<JORFSearchResponse>) => {
        if (res1.data === null) {
          await logError();
          return null;
        } // If an error occurred
        if (typeof res1.data !== "string") return cleanJORFItems(res1.data); // If it worked

        const request = res1.request as CustomInternalAxiosRequestConfig;

        // If the peopleName had nom/prenom inverted or bad formatting:
        // we need to call JORFSearch again with the response url in the correct format
        if (request.res?.responseUrl) {
          await umami.log({
            event: "/jorfsearch-request-people-formatted",
            messageApp
          });
          return await axios
            .get<JORFSearchResponse>(
              request.res.responseUrl.endsWith("?format=JSON")
                ? request.res.responseUrl
                : `${request.res.responseUrl}?format=JSON`
            )
            .then(async (res2: AxiosResponse<JORFSearchResponse>) => {
              if (res2.data === null || typeof res2.data === "string") {
                await logError();
                return null;
              }
              return cleanJORFItems(res2.data);
            });
        }

        await logError();
        return null;
      });
  } catch (error) {
    await logError();
    console.log(error);
    return null;
  }
}

export async function callJORFSearchDay(
  day: Date
): Promise<JORFSearchItem[] | null> {
  try {
    await umami.log({ event: "/jorfsearch-request-date" });
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${
            day.toLocaleDateString("fr-FR").split("/").join("-") // format day = "18-02-2024";
          }?format=JSON`
        )
      )
      .then(async (res) => {
        if (res.data === null || typeof res.data === "string") {
          await umami.log({
            event: "/jorfsearch-error",
            payload: { date: true }
          });
          return null;
        }
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    await umami.log({
      event: "/jorfsearch-error",
      payload: { date: true }
    });
    console.log(error);
  }
  return null;
}

export async function callJORFSearchTag(
  tag: FunctionTags,
  messageApp: MessageApp,
  tagValue?: string
): Promise<JORFSearchItem[] | null> {
  try {
    await umami.log({ event: "/jorfsearch-request-tag", messageApp });
    return await axios
      .get<JORFSearchResponse>(
        getJORFSearchLinkFunctionTag(tag, true, tagValue)
      )
      .then(async (res) => {
        if (res.data === null || typeof res.data === "string") {
          await umami.log({
            event: "/jorfsearch-error",
            messageApp,
            payload: { function_tag: true }
          });
          return null;
        }
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    await umami.log({
      event: "/jorfsearch-error",
      messageApp,
      payload: { function_tag: true }
    });
    console.log(error);
  }
  return null;
}

export async function callJORFSearchOrganisation(
  wikiId: WikidataId,
  messageApp: MessageApp
): Promise<JORFSearchItem[] | null> {
  try {
    await umami.log({ event: "/jorfsearch-request-organisation", messageApp });
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${wikiId.toUpperCase()}?format=JSON`
        )
      )
      .then(async (res) => {
        if (res.data === null || typeof res.data === "string") {
          await umami.log({
            event: "/jorfsearch-error",
            messageApp,
            payload: { organisation: true }
          });
          return null;
        }
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    await umami.log({
      event: "/jorfsearch-error",
      messageApp,
      payload: { organisation: true }
    });
    console.log(error);
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
  messageApp: MessageApp
): Promise<{ nom: string; wikidataId: WikidataId }[] | null> {
  if (org_name.length == 0) throw new Error("Empty org_name");

  try {
    await umami.log({
      event: "/jorfsearch-request-wikidata-names",
      messageApp
    });

    const wikidataIds_raw: WikidataId[] | null = await axios
      .get<string | null | WikiDataAPIResponse>(
        encodeURI(
          `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${org_name}&language=fr&origin=*&format=json&limit=50`
        ),
        {
          // Per Wikimedia policy, provide a descriptive agent with contact info.
          headers: {
            "User-Agent": USER_AGENT
          }
        }
      )
      .then((r) => {
        if (r.data === null || typeof r.data === "string") {
          console.log(
            "Wikidata API error when fetching organisation: ",
            org_name
          );
          return null;
        }
        return r.data.search.map((o) => o.id);
      });

    if (wikidataIds_raw === null) return null;
    if (wikidataIds_raw.length == 0) return []; // prevents unnecessary jorf event

    return await axios
      .get<
        { name: string; id: WikidataId }[] | null
      >(encodeURI(`https://jorfsearch.steinertriples.ch/wikidata_id_to_name?ids[]=${wikidataIds_raw.join("&ids[]=")}`))
      .then(async (res) => {
        if (res.data === null || typeof res.data === "string") {
          await umami.log({
            event: "/jorfsearch-error",
            messageApp,
            payload: { wikidata_name: true }
          });
          return null;
        }
        return res.data.map((o) => ({
          nom: o.name,
          wikidataId: o.id
        }));
      });
  } catch (error) {
    await umami.log({
      event: "/jorfsearch-error",
      messageApp,
      payload: { wikidata_name: true }
    });
    console.log(error);
  }
  return null;
}

export async function callJORFSearchReference(
  reference: string,
  messageApp: MessageApp
): Promise<JORFSearchItem[] | null> {
  try {
    await umami.log({ event: "/jorfsearch-request-reference", messageApp });
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/doc/${reference.toUpperCase()}?format=JSON`
        )
      )
      .then(async (res) => {
        if (res.data === null || typeof res.data === "string") {
          await umami.log({
            event: "/jorfsearch-error",
            messageApp,
            payload: { reference: true }
          });
          return null;
        }
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    await umami.log({
      event: "/jorfsearch-error",
      messageApp,
      payload: { reference: true }
    });
    console.log(error);
  }
  return null;
}

// not used for now
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function JORFSearchCallPublications(
  currentDay: string,
  messageApp: MessageApp
): Promise<JORFSearchPublication[] | null> {
  try {
    await umami.log({ event: "/jorfsearch-request-meta", messageApp });
    return await axios
      .get<JORFSearchResponseMeta>(
        `https://jorfsearch.steinertriples.ch/meta/search?&date=${currentDay.split("-").reverse().join("-")}`
      )
      .then(async (res) => {
        if (res.data === null || typeof res.data === "string") {
          await umami.log({
            event: "/jorfsearch-error",
            messageApp,
            payload: { meta: true }
          });
          return null;
        }
        return cleanJORFPublication(res.data);
      });
  } catch (error) {
    await umami.log({
      event: "/jorfsearch-error",
      messageApp,
      payload: { meta: true }
    });
    console.log(error);
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

  // 1. Trim & lowercase
  let out = input.trim().toLowerCase();

  // 2. Strip common Western diacritics in one shot
  out = out.replace(/[\u0300-\u036f]/g, ""); // remove combining marks

  // 3. Capitalise the first letter after start, space, hyphen or apostrophe
  //    - keeps the delimiter (p1) and upper-cases the following char (p2)
  out = out.replace(/(^|[\s\-'])\p{L}/gu, (m) => m.toUpperCase());

  out = out.replace(/[()]/g, "");

  return out;
}

export function getJORFSearchLinkPeople(
  prenomNom: string,
  json = false
): string {
  return encodeURI(
    `https://jorfsearch.steinertriples.ch/name/${cleanPeopleNameJORFURL(
      prenomNom
    )}${json ? "?format=JSON" : ""}`
  );
}

export function getJORFSearchLinkFunctionTag(
  fctTag: FunctionTags,
  json = false,
  tagValue: string | undefined = undefined
): string {
  return encodeURI(
    `https://jorfsearch.steinertriples.ch/tag/${fctTag}${
      tagValue !== undefined ? `="${tagValue}"` : ``
    }${json ? "?format=JSON" : ""}`
  );
}

export function getJORFSearchLinkOrganisation(
  wikidataId: string,
  json = false
): string {
  return encodeURI(
    `https://jorfsearch.steinertriples.ch/${wikidataId}${json ? "?format=JSON" : ""}`
  );
}

export function getJORFTextLink(source_id: string) {
  return encodeURI(`https://bodata.steinertriples.ch/${source_id}/redirect`);
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
