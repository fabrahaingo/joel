import {
  JORFSearchItem,
  JORFSearchResponse,
} from "../entities/JORFSearchResponse";
import axios from "axios";

export async function searchPersonOnJORF(
  person: string,
): Promise<JORFSearchItem[] | null> {
  try {
    return await axios
      .get<JORFSearchResponse>(
        encodeURI(
          `https://jorfsearch.steinertriples.ch/name/${formatJORFName(person)}?format=JSON`,
        ),
      )
      .then(async (res1) => {
        if (!(typeof res1.data === "string")) {
          return res1.data;
        }
        // Autocorrection by JORF of person's name: need to fetch again
        return await axios
          .get<JORFSearchResponse>(
            res1.request.res.responseUrl.endsWith("?format=JSON")
              ? res1.request.res.responseUrl
              : `${res1.request.res.responseUrl}?format=JSON`,
          )
          .then((res2) => {
            if (typeof res2.data === "string") {
              // Truly no data
              return null;
            }
            return res2.data;
          });
      });
  } catch (e) {
    console.log(e);
    return null;
  }
}

export function removeAccents(input: string): string {
  input = input.trim().toLowerCase();

  input = input.replace(/[àáâãäå]/g, "a");
  input = input.replace(/[èéêë]/g, "e");
  input = input.replace(/[ìíîï]/g, "i");
  input = input.replace(/[òóôõö]/g, "o");
  input = input.replace(/[ùúûü]/g, "u");
  input = input.replace(/[ç]/g, "c");
  input = input.replace(/[œ]/g, "oe");

  return input;
}

// Used to format the request name in a JORF-like request pattern
// Useful to reduce the number of request to JORF
export function formatJORFName(input: string): string {
  return input
    .split(" ")
    .map((word) => removeAccents(word))
    .map((word) => word[0].toUpperCase() + word.substring(1))
    .join(" ");
}
