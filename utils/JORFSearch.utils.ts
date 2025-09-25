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
  peopleName: string
): Promise<JORFSearchItem[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-people" });
    return await axios
      .get<JORFSearchResponse>(getJORFSearchLinkPeople(peopleName, true))
      .then(async (res1: AxiosResponse<JORFSearchResponse>) => {
        if (res1.data === null) return []; // If an error occurred
        if (typeof res1.data !== "string") return res1.data; // If it worked

        const request = res1.request as CustomInternalAxiosRequestConfig;

        // If the peopleName had nom/prenom inverted or bad formatting:
        // we need to call JORFSearch again with the response url in the correct format
        if (request.res?.responseUrl) {
          await umami.log({ event: "/jorfsearch-request-people-formatted" });
          return await axios
            .get<JORFSearchResponse>(
              request.res.responseUrl.endsWith("?format=JSON")
                ? request.res.responseUrl
                : `${request.res.responseUrl}?format=JSON`
            )
            .then((res2: AxiosResponse<JORFSearchResponse>) => {
              if (res2.data === null || typeof res2.data === "string") {
                return [];
              }
              return res2.data;
            });
        }
        return [];
      })
      .then((res) => cleanJORFItems(res));
  } catch (error) {
    console.log(error);
    return [];
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
      .then((res) => {
        if (res.data === null || typeof res.data === "string") return [];
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    console.log(error);
  }
  return null;
}

export async function callJORFSearchTag(
  tag: FunctionTags,
  tagValue?: string
): Promise<JORFSearchItem[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-tag" });
    return await axios
      .get<JORFSearchResponse>(
        getJORFSearchLinkFunctionTag(tag, true, tagValue)
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") return [];
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    console.log(error);
  }
  return [];
}

export async function callJORFSearchOrganisation(
  wikiId: WikidataId
): Promise<JORFSearchItem[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-organisation" });
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/${wikiId.toUpperCase()}?format=JSON`
        )
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") return [];
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    console.log(error);
  }
  return [];
}

export async function callJORFSearchReference(
  reference: string
): Promise<JORFSearchItem[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-reference" });
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/doc/${reference.toUpperCase()}?format=JSON`
        )
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") return [];
        return cleanJORFItems(res.data);
      });
  } catch (error) {
    console.log(error);
  }
  return [];
}

// not used for now
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function JORFSearchCallPublications(
  currentDay: string
): Promise<JORFSearchPublication[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-meta" });
    return await axios
      .get<JORFSearchResponseMeta>(
        `https://jorfsearch.steinertriples.ch/meta/search?&date=${currentDay.split("-").reverse().join("-")}`
      )
      .then((res) => {
        if (res.data === null || typeof res.data === "string") {
          return [];
        }
        return cleanJORFPublication(res.data);
      });
  } catch (error) {
    console.log(error);
  }
  return [];
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
