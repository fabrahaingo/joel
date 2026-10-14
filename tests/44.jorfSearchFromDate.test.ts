import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

// Shared spies for the internal axios instances. `axios.create()` is stubbed to
// hand the same object to every module, so the URL tells the callers apart.
const { getSpy, postSpy } = vi.hoisted(() => ({
  getSpy: vi.fn(),
  postSpy: vi.fn()
}));

// Mock axios so `axios.create()` returns an object whose `.get`/`.post` we
// control. Keep the real `isAxiosError` so shouldRetry keeps working.
vi.mock("axios", async (importActual) => {
  const actual = await importActual<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...(actual.default as object),
      create: () => ({ get: getSpy, post: postSpy })
    },
    isAxiosError: actual.isAxiosError
  };
});

const { umamiLogSpy, umamiLogAsyncSpy } = vi.hoisted(() => ({
  umamiLogSpy: vi.fn(),
  umamiLogAsyncSpy: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/umami.ts", () => ({
  default: { log: umamiLogSpy, logAsync: umamiLogAsyncSpy }
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: vi.fn(() => Promise.resolve()),
  logWarning: vi.fn(() => Promise.resolve()),
  logErrorForApps: vi.fn(() => Promise.resolve())
}));

import {
  getJORFRecordsFromDate,
  getJORFMetaRecordsFromDate
} from "../utils/JORFSearch.utils.ts";
import { resetLegifranceCaches } from "../utils/legifrance.utils.ts";

// Build a valid raw JORFSearch "people" record for a given source_date (YMD).
function rawItem(source_date: string) {
  return {
    nom: "Dupont",
    prenom: "Jean",
    source_id: "JORFTEXT" + source_date.replace(/-/g, ""),
    source_date,
    source_name: "JORF",
    type_ordre: "nomination",
    organisations: [{ nom: "Conseil", wikidata_id: "Q123" }]
  };
}

// Mirrors RETRY_MAX in httpRetry.utils.ts.
const RETRY_MAX = 5;
// Mirrors CONSECUTIVE_FAILED_CHUNKS_BEFORE_ABANDON in JORFSearch.utils.ts.
const FAILED_CHUNKS_BEFORE_ABANDON = 3;

// The day URL for the "records" endpoint is keyed on DD-MM-YYYY.
function dmy(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${String(d.getFullYear())}`;
}

/** A Legifrance JO summary holding one text, published on `datePubli`. */
function jorfContResponse(textId: string, datePubli: number) {
  return {
    data: {
      items: [
        {
          joCont: {
            id: "JORFCONT000000000001",
            datePubli,
            structure: {
              liens: [{ id: textId, titre: "Titre de test" }]
            }
          }
        }
      ]
    }
  };
}

/**
 * Routes the Legifrance calls: the token POST, the no-JO day list GET, and the
 * per-day summary POST. `onSummary` decides what a summary request answers.
 */
function mockLegifrance(onSummary: (epochMs: number) => unknown) {
  postSpy.mockImplementation((url: string, payload: unknown) => {
    if (url.includes("oauth")) {
      return Promise.resolve({
        data: { access_token: "test-token", expires_in: 3600 }
      });
    }
    const { start } = payload as {
      start: { year: number; month: number; dayOfMonth: number };
    };
    return Promise.resolve(
      onSummary(Date.UTC(start.year, start.month - 1, start.dayOfMonth))
    );
  });
}

function mockDatesWithoutJo(days: number[] = []) {
  return (url: string) => {
    if (url.includes("datesWithoutJo")) {
      return Promise.resolve({ data: { lstDateDisabled: days } });
    }
    return Promise.resolve({ data: [], request: {} });
  };
}

/** Drives the retry back-off without spending the test's wall-clock on it. */
async function withFakeTimers<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const pending = run();
    await vi.runAllTimersAsync();
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(async () => {
  if (!mongoose.connection.db) throw new Error("no db");
  await mongoose.connection.db.dropDatabase();
  vi.clearAllMocks();
  resetLegifranceCaches();
  process.env.LEGIFRANCE_CLIENT_ID = "test-id";
  process.env.LEGIFRANCE_CLIENT_SECRET = "test-secret";
});

describe("getJORFRecordsFromDate", () => {
  it("aggregates records across a multi-day range (chunked loop runs >1 chunk)", async () => {
    // Return, per requested day, a single record whose source_date matches that day.
    getSpy.mockImplementation((url: string) => {
      const m = /(\d{2})-(\d{2})-(\d{4})/.exec(url); // DMY in the day URL
      const ymd = m ? `${m[3]}-${m[2]}-${m[1]}` : "2024-01-01";
      return Promise.resolve({ data: [rawItem(ymd)], request: {} });
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 2); // 3-day range => 3 chunks of size 1

    const { items: results, failedDates } = await getJORFRecordsFromDate(
      startDate,
      ["Telegram", "Signal"]
    );

    // One record per day -> 3 total, sorted ascending by source_date.
    expect(failedDates).toEqual([]);
    expect(results).toHaveLength(3);
    expect(getSpy).toHaveBeenCalledTimes(3);
    for (let i = 1; i < results.length; i++) {
      expect(new Date(results[i].source_date).getTime()).toBeGreaterThanOrEqual(
        new Date(results[i - 1].source_date).getTime()
      );
    }
    // Aggregated stats logged once per app.
    const dateEvents = umamiLogSpy.mock.calls.filter(
      (c) => (c[0] as { event?: string }).event === "/jorfsearch-request-date"
    );
    expect(dateEvents).toHaveLength(2);
    expect(
      (dateEvents[0][0] as { payload: { day_nb: number } }).payload.day_nb
    ).toBe(3);
  });

  it("retries a 2xx carrying a string body before reporting the day failed", async () => {
    getSpy.mockResolvedValue({ data: "error string", request: {} });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await withFakeTimers(() =>
      getJORFRecordsFromDate(new Date(today), ["Telegram"])
    );

    expect(result.items).toEqual([]);
    expect(result.requestedDays).toBe(1);
    expect(result.failedDates).toHaveLength(1);
    // An HTML login or overload page is transient, so it burns the retries
    // rather than being read as "this day holds no records".
    expect(getSpy).toHaveBeenCalledTimes(RETRY_MAX + 1);
  });

  it("keeps the days that succeeded when another day fails", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 1); // 2-day range

    const todayDMY = dmy(today);
    getSpy.mockImplementation((url: string) => {
      const m = /(\d{2})-(\d{2})-(\d{4})/.exec(url);
      // Today is fetched first (the range walks backwards); fail the older day.
      if (m?.[0] !== todayDMY)
        return Promise.resolve({ data: "error string", request: {} });
      const ymd = `${m[3]}-${m[2]}-${m[1]}`;
      return Promise.resolve({ data: [rawItem(ymd)], request: {} });
    });

    const result = await withFakeTimers(() =>
      getJORFRecordsFromDate(startDate, ["Telegram"])
    );

    expect(result.items).toHaveLength(1);
    expect(result.requestedDays).toBe(2);
    expect(result.failedDates).toHaveLength(1);
  });

  it("keeps requesting days after a single failed day", async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 2); // 3-day range, newest first

    const todayDMY = dmy(today);
    getSpy.mockImplementation((url: string) => {
      const m = /(\d{2})-(\d{2})-(\d{4})/.exec(url);
      // Only the newest day fails; the two older ones must still be requested.
      if (m?.[0] === todayDMY)
        return Promise.resolve({ data: "error string", request: {} });
      const ymd = `${m?.[3] ?? "2024"}-${m?.[2] ?? "01"}-${m?.[1] ?? "01"}`;
      return Promise.resolve({ data: [rawItem(ymd)], request: {} });
    });

    const result = await withFakeTimers(() =>
      getJORFRecordsFromDate(startDate, ["Telegram"])
    );

    expect(result.failedDates).toHaveLength(1);
    expect(result.items).toHaveLength(2);
  });

  it("stops requesting further days once the source stays unreachable", async () => {
    getSpy.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), {
        isAxiosError: true,
        toJSON: () => ({})
      })
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 5); // 6-day range

    const result = await withFakeTimers(() =>
      getJORFRecordsFromDate(startDate, ["Telegram"])
    );

    expect(result.items).toEqual([]);
    // Every day is reported missing, but only the days probed before the
    // breaker tripped burned their retries.
    expect(result.failedDates).toHaveLength(6);
    expect(getSpy).toHaveBeenCalledTimes(
      FAILED_CHUNKS_BEFORE_ABANDON * (RETRY_MAX + 1)
    );
  });

  it("does not mutate the caller's startDate", async () => {
    getSpy.mockResolvedValue({ data: [], request: {} });

    const startDate = new Date();
    startDate.setHours(13, 45, 30, 0);
    const before = startDate.getTime();

    await getJORFRecordsFromDate(startDate, ["Telegram"]);

    expect(startDate.getTime()).toBe(before);
  });
});

describe("getJORFMetaRecordsFromDate", () => {
  it("aggregates meta publications across a multi-day range and persists them", async () => {
    getSpy.mockImplementation(mockDatesWithoutJo());
    mockLegifrance((epochMs) =>
      jorfContResponse("JORFTEXT" + String(epochMs), epochMs)
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 2); // 3 chunks of size 1

    const { items: results, failedDates } = await getJORFMetaRecordsFromDate(
      startDate,
      ["Telegram"]
    );

    expect(failedDates).toEqual([]);
    expect(results).toHaveLength(3);
    // sorted ascending by date
    for (let i = 1; i < results.length; i++) {
      expect(new Date(results[i].date).getTime()).toBeGreaterThanOrEqual(
        new Date(results[i - 1].date).getTime()
      );
    }
    const metaEvents = umamiLogSpy.mock.calls.filter(
      (c) => (c[0] as { event?: string }).event === "/jorfsearch-request-meta"
    );
    expect(metaEvents).toHaveLength(1);
    expect(
      (metaEvents[0][0] as { payload: { day_nb: number } }).payload.day_nb
    ).toBe(3);
    // Persisted to the in-memory DB (saveMetaPublications upserts).
    expect(umamiLogAsyncSpy).toHaveBeenCalled();
  });

  it("lists a text once when several days of the range carry it", async () => {
    getSpy.mockImplementation(mockDatesWithoutJo());
    mockLegifrance((epochMs) =>
      jorfContResponse("JORFTEXT000054979812", epochMs)
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 6);

    const { items } = await getJORFMetaRecordsFromDate(startDate, ["Telegram"]);

    expect(items.map((i) => i.id)).toEqual(["JORFTEXT000054979812"]);
  });

  it("reports a failed day instead of throwing", async () => {
    getSpy.mockImplementation(mockDatesWithoutJo());
    // A summary with no container means the edition could not be established.
    mockLegifrance(() => ({ data: { items: [] } }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const result = await withFakeTimers(() =>
      getJORFMetaRecordsFromDate(new Date(today), ["Telegram"])
    );

    expect(result.items).toEqual([]);
    expect(result.requestedDays).toBe(1);
    expect(result.failedDates).toHaveLength(1);
  });
});
