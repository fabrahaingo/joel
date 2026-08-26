import axios, { AxiosResponse, isAxiosError } from "axios";
import { MessageApp } from "../types.ts";
import { dateToString } from "./date.utils.ts";
import {
  cleanJORFPublication,
  JORFSearchPublication
} from "../entities/JORFSearchResponseMeta.ts";
import { logErrorForApps } from "./debugLogger.ts";
import {
  assertJsonPayload,
  REQUEST_TIMEOUT_MS,
  RETRY_MAX,
  shouldRetry,
  TransientUpstreamError,
  waitBeforeRetry
} from "./httpRetry.utils.ts";
import umami from "./umami.ts";

// Per Wikimedia policy, provide a descriptive agent with contact info.
const USER_AGENT = "JOEL/1.0 (contact@joel-officiel.fr)";

const TOKEN_URL = "https://oauth.piste.gouv.fr/api/oauth/token";
const DEFAULT_API_URL =
  "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app";

/** Renew the token slightly early so an in-flight request cannot outlive it. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

const DATES_WITHOUT_JO_TTL_MS = 24 * 60 * 60 * 1000;

/** The JO summary nests sections a handful of levels deep; the cap is a guard
 * against a malformed cyclic payload, not a real structural limit. */
const MAX_SECTION_DEPTH = 16;

/** Containers per page. A single day holds one JO edition, occasionally a
 * handful of companion editions, so one page always covers a day. */
const CONTAINER_PAGE_SIZE = 100;

const legifranceAxios = axios.create({
  timeout: REQUEST_TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
  // A redirect means the request was bounced to a login page. Following it
  // yields an HTML body that parses as a string and reads as "no data", so a
  // credential problem must surface as an error instead.
  maxRedirects: 0,
  validateStatus: (status) => status >= 200 && status < 300
});

export function getLegifranceApiUrl(): string {
  return process.env.LEGIFRANCE_API_URL ?? DEFAULT_API_URL;
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let inFlightToken: Promise<string> | null = null;
let datesWithoutJoCache: { days: Set<string>; fetchedAt: number } | null = null;

/** Test seam: drops the token and the no-JO day list. */
export function resetLegifranceCaches(): void {
  cachedToken = null;
  inFlightToken = null;
  datesWithoutJoCache = null;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface OAuthErrorBody {
  error?: string;
  error_description?: string;
}

/**
 * OAuth codes that describe the client rather than the moment: the same request
 * fails identically until someone changes the credentials or the PISTE app
 * subscription, so retrying only delays the alert. Anything else, a bare 400
 * included, is read as throttling and retried.
 */
const FATAL_OAUTH_ERRORS = new Set([
  "invalid_client",
  "invalid_grant",
  "unauthorized_client",
  "invalid_scope"
]);

function readOAuthError(error: unknown): OAuthErrorBody | null {
  if (!isAxiosError(error)) return null;
  const data: unknown = error.response?.data;
  if (data == null || typeof data !== "object") return null;
  return data;
}

/**
 * Turns a token endpoint rejection into an error that says what PISTE answered.
 * The status alone does not: a 400 is `invalid_client` for dead credentials and
 * an unlabelled throttle otherwise, and only the body tells the two apart.
 */
function describeTokenFailure(error: unknown): Error {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const body = readOAuthError(error);
  const context = [
    status != null ? `HTTP ${String(status)}` : null,
    body?.error,
    body?.error_description
  ]
    .filter((part): part is string => part != null && part.length > 0)
    .join(" ");
  const message =
    context.length > 0
      ? `Legifrance token endpoint rejected the request (${context})`
      : "Legifrance token endpoint rejected the request";

  return body?.error != null && FATAL_OAUTH_ERRORS.has(body.error)
    ? new Error(message, { cause: error })
    : new TransientUpstreamError(message, { cause: error });
}

async function requestAccessToken(): Promise<string> {
  const clientId = process.env.LEGIFRANCE_CLIENT_ID;
  const clientSecret = process.env.LEGIFRANCE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Legifrance credentials are missing: set LEGIFRANCE_CLIENT_ID and LEGIFRANCE_CLIENT_SECRET"
    );
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: "openid"
  });

  const requestedAt = Date.now();
  let res: AxiosResponse<TokenResponse>;
  try {
    res = await legifranceAxios.post<TokenResponse>(TOKEN_URL, body, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
  } catch (error) {
    throw describeTokenFailure(error);
  }
  const data = assertJsonPayload(res.data, "Legifrance token endpoint");

  if (!data.access_token) {
    throw new Error("Legifrance token endpoint returned no access_token");
  }

  // expires_in is in seconds; fall back to a short life so a malformed
  // response cannot pin a stale token in memory.
  const lifetimeMs = (data.expires_in ?? 60) * 1000;
  cachedToken = {
    value: data.access_token,
    expiresAt: requestedAt + lifetimeMs
  };
  return cachedToken.value;
}

/**
 * The bearer for every call, minted at most once at a time: PISTE throttles a
 * client that opens several token requests at once, and concurrent callers all
 * want the same token anyway.
 */
async function getAccessToken(): Promise<string> {
  if (
    cachedToken != null &&
    Date.now() < cachedToken.expiresAt - TOKEN_EXPIRY_MARGIN_MS
  ) {
    return cachedToken.value;
  }

  inFlightToken ??= requestAccessToken().finally(() => {
    inFlightToken = null;
  });
  return await inFlightToken;
}

function isUnauthorized(error: unknown): boolean {
  if (!isAxiosError(error)) return false;
  const status = error.response?.status;
  return status === 401 || status === 403;
}

/**
 * Sends an authenticated call, and on a rejected bearer mints a fresh one and
 * sends it once more. A token can be refused before its announced expiry, and
 * the cached value would otherwise keep every later call failing too. A second
 * rejection is a real credential or permission problem and propagates.
 */
async function legifranceRequest<T>(
  path: string,
  send: (token: string) => Promise<AxiosResponse<T>>
): Promise<T> {
  let res: AxiosResponse<T>;
  try {
    res = await send(await getAccessToken());
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    cachedToken = null;
    res = await send(await getAccessToken());
  }
  return assertJsonPayload(res.data, `Legifrance ${path}`);
}

async function legifrancePost<T>(path: string, payload: unknown): Promise<T> {
  return await legifranceRequest<T>(path, (token) =>
    legifranceAxios.post<T>(`${getLegifranceApiUrl()}${path}`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      }
    })
  );
}

async function legifranceGet<T>(path: string): Promise<T> {
  return await legifranceRequest<T>(path, (token) =>
    legifranceAxios.get<T>(`${getLegifranceApiUrl()}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
  );
}

interface DatesWithNoJoResponse {
  lstDateDisabled?: (string | number)[];
}

/** Epoch milliseconds read in UTC: the API stamps each day at UTC midnight, so
 * reading it in server-local time would shift the day west of Greenwich. */
function epochToYMD(epoch: string | number): string | null {
  const ms = typeof epoch === "number" ? epoch : Number(epoch);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ymdToUtcEpoch(dateYMD: string): number {
  const [year, month, day] = dateYMD.split("-").map((s) => parseInt(s));
  return Date.UTC(year, month - 1, day);
}

/**
 * Days on which no Journal officiel was published, per Legifrance. This is what
 * separates "nothing was published" from "the fetch failed": without it an
 * empty summary is ambiguous and every Sunday looks like an outage.
 */
async function getDaysWithoutJo(): Promise<Set<string>> {
  const now = Date.now();
  if (
    datesWithoutJoCache != null &&
    now - datesWithoutJoCache.fetchedAt < DATES_WITHOUT_JO_TTL_MS
  ) {
    return datesWithoutJoCache.days;
  }

  const data = await legifranceGet<DatesWithNoJoResponse>(
    "/misc/datesWithoutJo"
  );
  const days = new Set<string>();
  for (const raw of data.lstDateDisabled ?? []) {
    const ymd = epochToYMD(raw);
    if (ymd != null) days.add(ymd);
  }

  datesWithoutJoCache = { days, fetchedAt: now };
  return days;
}

interface LienTxt {
  id?: string;
  titre?: string;
  nature?: string;
  ministere?: string;
  autorite?: string;
}

interface Tms {
  liensTxt?: LienTxt[];
  tms?: Tms[];
}

interface FullConteneur {
  id?: string;
  datePubli?: string;
  num?: string;
  structure?: {
    liens?: LienTxt[];
    tms?: Tms[];
  };
}

interface GetJosResponse {
  items?: { joCont?: FullConteneur }[];
}

/**
 * Flattens a JO summary into its text links. Texts hang either directly off the
 * container or off arbitrarily nested sections (rubriques and sous-rubriques).
 */
function collectTextLinks(container: FullConteneur): LienTxt[] {
  const links: LienTxt[] = [...(container.structure?.liens ?? [])];

  const visitSection = (section: Tms, depth: number): void => {
    if (depth > MAX_SECTION_DEPTH) return;
    links.push(...(section.liensTxt ?? []));
    for (const child of section.tms ?? []) visitSection(child, depth + 1);
  };

  for (const section of container.structure?.tms ?? [])
    visitSection(section, 0);
  return links;
}

export interface LegifranceMetaDayResult {
  items: JORFSearchPublication[];
  stats: {
    raw_item_nb: number;
    clean_item_nb: number;
    dropped_item_nb: number;
  };
}

/**
 * Retrieves every text published in the Journal officiel on `day`.
 *
 * Returns `null` when the day could not be established, so callers can hold
 * their coverage cursor instead of treating the gap as an empty day. A day
 * Legifrance lists as having no JO is a success with zero items.
 */
export async function fetchLegifranceMetaDay(
  day: Date,
  messageApps: MessageApp[],
  retryNumber = 0
): Promise<LegifranceMetaDayResult | null> {
  const dateYMD = dateToString(day, "YMD");
  const emptyResult: LegifranceMetaDayResult = {
    items: [],
    stats: { raw_item_nb: 0, clean_item_nb: 0, dropped_item_nb: 0 }
  };

  try {
    const daysWithoutJo = await getDaysWithoutJo();
    if (daysWithoutJo.has(dateYMD)) return emptyResult;

    const response = await legifrancePost<GetJosResponse>("/consult/jorfCont", {
      // Legifrance dates its consultation requests in epoch milliseconds. Pin
      // them to UTC midnight so the server-local timezone cannot shift the day.
      date: ymdToUtcEpoch(dateYMD),
      pageNumber: 1,
      pageSize: CONTAINER_PAGE_SIZE
    });

    const containers = (response.items ?? [])
      .map((item) => item.joCont)
      .filter((cont): cont is FullConteneur => cont != null);

    // The day is neither listed as JO-free nor served with a summary: the
    // edition is not available, which is a gap rather than an empty day.
    if (containers.length === 0) return null;

    const rawItems = containers.flatMap(collectTextLinks).map((link) => ({
      id: link.id,
      date: dateYMD,
      title: link.titre,
      ministere: link.ministere,
      autorite: link.autorite,
      tags: {}
    }));

    const cleanedItems = cleanJORFPublication(rawItems);

    return {
      items: cleanedItems,
      stats: {
        raw_item_nb: rawItems.length,
        clean_item_nb: cleanedItems.length,
        dropped_item_nb: rawItems.length - cleanedItems.length
      }
    };
  } catch (error) {
    if (shouldRetry(error) && retryNumber < RETRY_MAX) {
      await waitBeforeRetry(retryNumber);
      return await fetchLegifranceMetaDay(day, messageApps, retryNumber + 1);
    }

    umami.log({
      event: "/jorfsearch-error",
      messageApp: messageApps[0],
      payload: { meta: true }
    });
    await logErrorForApps(
      messageApps,
      shouldRetry(error)
        ? `Legifrance request for the JO of ${dateYMD} aborted after ${String(RETRY_MAX)} tries`
        : `Error fetching the Legifrance JO summary of ${dateYMD}`,
      error
    );
    return null;
  }
}
