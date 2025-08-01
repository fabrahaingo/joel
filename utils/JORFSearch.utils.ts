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
  JORFSearchResponseMeta
} from "../entities/JORFSearchResponseMeta.ts";

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
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/name/${
            cleanPeopleName(peopleName) // Cleaning the string reduces the number of calls to JORFSearch
          }?format=JSON`
        )
      )
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

export async function callJORFSearchDay(day: Date): Promise<JORFSearchItem[]> {
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
  return [];
}

export async function callJORFSearchTag(
  tag: string,
  tagValue?: string
): Promise<JORFSearchItem[]> {
  try {
    await umami.log({ event: "/jorfsearch-request-tag" });
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/tag/${tag}${
            tagValue !== undefined ? `="${tagValue}"` : ``
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

async function JORFSearchCallPublications(
  currentDay: string
): Promise<JORFSearchItem[]> {
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

interface NameInfo {
  nom: string;
  prenom: string;
}
export function uniqueMinimalNameInfo(records: NameInfo[]) {
  return records.reduce((infoList: { nom: string; prenom: string }[], item) => {
    if (
      infoList.find((i) => i.nom === item.nom && i.prenom == item.prenom) !==
      undefined
    )
      return infoList;
    infoList.push({ nom: item.nom, prenom: item.prenom });
    return infoList;
  }, []);
}
