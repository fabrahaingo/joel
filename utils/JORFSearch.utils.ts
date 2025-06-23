import { cleanJORFItems, JORFSearchResponse } from "../entities/JORFSearchResponse";
import { WikidataId } from "../types";
import axios from "axios";
import umami from "./umami";

export async function callJORFSearchPeople(peopleName: string) {
    try {
        await umami.log({ event: "/jorfsearch-request-people" });
        return axios
            .get<JORFSearchResponse>(encodeURI(
                `https://jorfsearch.steinertriples.ch/name/${
                    cleanPeopleName(peopleName) // Cleaning the string reduces the number of calls to JORFSearch
                }?format=JSON`
            )
        ).then(async (res1) => {
            if (res1.data === null ) return []; // If an error occurred
            if (typeof res1.data !== "string") return res1.data; // If it worked

            // If the peopleName had nom/prenom inverted or bad formatting:
            // we need to call JORFSearch again with the response url with correct format
            if (res1.request.res.responseUrl) {
                await umami.log({ event: "/jorfsearch-request-people-formatted" });
                return await axios
                    .get<JORFSearchResponse>(
                    res1.request.res.responseUrl.endsWith("?format=JSON")
                        ? res1.request.res.responseUrl
                        : `${res1.request.res.responseUrl}?format=JSON`
                ).then(async (res2) => {
                        if (res2.data === null || typeof res2.data === "string") {
                            return [];
                        }
                        return res2.data;
                    });
            }
            return []
        }).then(res=> cleanJORFItems(res));
    } catch (error) {
        console.log(error);
        return [];
    }
}

export async function callJORFSearchDay(day: Date){
    try {
        await umami.log({ event: "/jorfsearch-request-date" });
        return axios
        .get<JORFSearchResponse>(encodeURI(
            `https://jorfsearch.steinertriples.ch/${
            day.toLocaleDateString("fr-FR").split("/").join("-") // format day = "18-02-2024";
        }?format=JSON`))
        .then((res) => {
            if (res.data === null || typeof res.data === "string") return [];
            return cleanJORFItems(res.data);
        });
    } catch (error) {
        console.log(error);
    }
    return [];
}

export async function callJORFSearchTag(tag: string, tagValue?: string) {
    try {
        await umami.log({ event: "/jorfsearch-request-tag" });
        return axios
            .get<JORFSearchResponse>(encodeURI(
                `https://jorfsearch.steinertriples.ch/tag/${tag}${
                    tagValue !== undefined ? `="${tagValue}"` : ``
                }?format=JSON`))
            .then((res) => {
                if (res.data === null || typeof res.data === "string") return [];
                return cleanJORFItems(res.data);
            });
    } catch (error) {
        console.log(error);
    }
    return [];
}

export async function callJORFSearchOrganisation(wikiId: WikidataId) {
    try {
        await umami.log({ event: "/jorfsearch-request-organisation" });
        return axios
        .get<JORFSearchResponse>(encodeURI(
            `https://jorfsearch.steinertriples.ch/${wikiId.toUpperCase()}?format=JSON`))
        .then((res) => {
            if (res.data === null || typeof res.data === "string") return [];
            return cleanJORFItems(res.data);
        });
    } catch (error) {
        console.log(error);
    }
    return [];
}

// Format a string to match the expected search format on JORFSearch: first letter capitalized and no accent
export function cleanPeopleName(input: string): string {
    /// To lower case
    input = input.trim().toLowerCase();

    // Replace non-standard URL characters
    input = input.replace(/[àáâãäå]/g, "a");
    input = input.replace(/[èéêë]/g, "e");
    input = input.replace(/[ìíîï]/g, "i");
    input = input.replace(/[òóôõö]/g, "o");
    input = input.replace(/[ùúûü]/g, "u");
    input = input.replace(/[ç]/g, "c");

    // Capitalized the first letter of each part of the name
    input=input.split(" ").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

    return input;
}