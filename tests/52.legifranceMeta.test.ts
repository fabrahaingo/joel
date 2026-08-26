import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";

const { getSpy, postSpy, createConfigs } = vi.hoisted(() => ({
  getSpy: vi.fn(),
  postSpy: vi.fn(),
  createConfigs: [] as Record<string, unknown>[]
}));

vi.mock("axios", async (importActual) => {
  const actual = await importActual<typeof import("axios")>();
  return {
    ...actual,
    default: {
      ...(actual.default as object),
      create: (config: Record<string, unknown>) => {
        createConfigs.push(config);
        return { get: getSpy, post: postSpy };
      }
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

const { logErrorSpy, logWarningSpy, logErrorForAppsSpy } = vi.hoisted(() => ({
  logErrorSpy: vi.fn(() => Promise.resolve()),
  logWarningSpy: vi.fn(() => Promise.resolve()),
  logErrorForAppsSpy: vi.fn(() => Promise.resolve())
}));
vi.mock("../utils/debugLogger.ts", () => ({
  logError: logErrorSpy,
  logWarning: logWarningSpy,
  logErrorForApps: logErrorForAppsSpy
}));

import {
  fetchLegifranceMetaDay,
  resetLegifranceCaches
} from "../utils/legifrance.utils.ts";
import {
  callJORFSearchReference,
  resetMissingReferenceCache
} from "../utils/JORFSearch.utils.ts";
import { Publication } from "../models/Publication.ts";

const DAY = new Date(2026, 7, 19); // 19 August 2026, local midnight
const DAY_YMD = "2026-08-19";
const DAY_UTC_EPOCH = Date.UTC(2026, 7, 19);

function tokenResponse(expiresIn = 3600) {
  return { data: { access_token: "test-token", expires_in: expiresIn } };
}

/** Routes the token POST away from the summary POST. */
function mockPost(onSummary: () => unknown, expiresIn = 3600) {
  postSpy.mockImplementation((url: string) => {
    if (url.includes("oauth")) return Promise.resolve(tokenResponse(expiresIn));
    return Promise.resolve(onSummary());
  });
}

/** Calls to the OAuth token endpoint, as opposed to the summary endpoint. */
function tokenCalls() {
  return postSpy.mock.calls.filter((c) => String(c[0]).includes("oauth"));
}

function summaryCalls() {
  return postSpy.mock.calls.filter((c) => !String(c[0]).includes("oauth"));
}

/** A rejection shaped like the one axios raises, so `isAxiosError` accepts it. */
function axiosError(status: number, data?: unknown) {
  return Object.assign(
    new Error(`Request failed with status code ${String(status)}`),
    { isAxiosError: true, response: { status, data } }
  );
}

const ONE_TEXT_SUMMARY = {
  data: {
    items: [
      {
        joCont: {
          structure: {
            liens: [{ id: "JORFTEXT000000000001", titre: "Texte" }]
          }
        }
      }
    ]
  }
};

function mockDatesWithoutJo(epochs: number[] = []) {
  getSpy.mockImplementation((url: string) => {
    if (url.includes("datesWithoutJo")) {
      return Promise.resolve({ data: { lstDateDisabled: epochs } });
    }
    return Promise.resolve({ data: [], request: {} });
  });
}

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
  resetMissingReferenceCache();
  process.env.LEGIFRANCE_CLIENT_ID = "test-id";
  process.env.LEGIFRANCE_CLIENT_SECRET = "test-secret";
});

describe("Legifrance client configuration", () => {
  it("refuses to follow redirects, so a login bounce cannot pass as data", () => {
    const legifranceConfig = createConfigs.find((c) => c.maxRedirects === 0);
    expect(legifranceConfig).toBeDefined();
    const validateStatus = legifranceConfig?.validateStatus as (
      s: number
    ) => boolean;
    expect(validateStatus(200)).toBe(true);
    expect(validateStatus(302)).toBe(false);
  });
});

describe("fetchLegifranceMetaDay", () => {
  it("flattens texts from nested summary sections", async () => {
    mockDatesWithoutJo();
    mockPost(() => ({
      data: {
        items: [
          {
            joCont: {
              id: "JORFCONT000000000001",
              structure: {
                liens: [{ id: "JORFTEXT000000000001", titre: "Texte racine" }],
                tms: [
                  {
                    liensTxt: [
                      { id: "JORFTEXT000000000002", titre: "Texte rubrique" }
                    ],
                    tms: [
                      {
                        liensTxt: [
                          {
                            id: "JORFTEXT000000000003",
                            titre: "Texte sous-rubrique"
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            }
          }
        ]
      }
    }));

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result?.items.map((i) => i.id)).toEqual([
      "JORFTEXT000000000001",
      "JORFTEXT000000000002",
      "JORFTEXT000000000003"
    ]);
    // Every text of the edition carries the day it was published on.
    expect(result?.items.every((i) => i.date === DAY_YMD)).toBe(true);
  });

  it("drops texts missing an id or a title and counts them", async () => {
    mockDatesWithoutJo();
    mockPost(() => ({
      data: {
        items: [
          {
            joCont: {
              structure: {
                liens: [
                  { id: "JORFTEXT000000000001", titre: "Complet" },
                  { id: "JORFTEXT000000000002" },
                  { titre: "Sans identifiant" }
                ]
              }
            }
          }
        ]
      }
    }));

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result?.stats).toEqual({
      raw_item_nb: 3,
      clean_item_nb: 1,
      dropped_item_nb: 2
    });
  });

  it("treats a day Legifrance lists as JO-free as an empty success", async () => {
    mockDatesWithoutJo([DAY_UTC_EPOCH]);
    mockPost(() => ({ data: { items: [] } }));

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    // An empty success, not a gap: the coverage cursor must be free to advance.
    expect(result).not.toBeNull();
    expect(result?.items).toEqual([]);
    // The summary is never requested for a day that has no JO.
    const summaryCalls = postSpy.mock.calls.filter(
      (c) => !String(c[0]).includes("oauth")
    );
    expect(summaryCalls).toHaveLength(0);
  });

  it("reports a gap when a day with a JO returns no container", async () => {
    mockDatesWithoutJo();
    mockPost(() => ({ data: { items: [] } }));

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result).toBeNull();
  });

  it("retries an HTML body served with a 2xx instead of reading it as no data", async () => {
    mockDatesWithoutJo();
    mockPost(() => ({ data: "<!DOCTYPE html><html>Sign in</html>" }));

    const result = await withFakeTimers(() =>
      fetchLegifranceMetaDay(DAY, ["Telegram"])
    );

    expect(result).toBeNull();
    const summaryCalls = postSpy.mock.calls.filter(
      (c) => !String(c[0]).includes("oauth")
    );
    expect(summaryCalls).toHaveLength(6); // RETRY_MAX + 1
    expect(logErrorForAppsSpy).toHaveBeenCalled();
  });

  it("fails fast when the credentials are missing", async () => {
    delete process.env.LEGIFRANCE_CLIENT_ID;
    delete process.env.LEGIFRANCE_CLIENT_SECRET;
    mockDatesWithoutJo();
    mockPost(() => ({ data: { items: [] } }));

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Legifrance access token", () => {
  it("reuses a live token across days", async () => {
    mockDatesWithoutJo();
    mockPost(() => ({ data: { items: [] } }));

    await fetchLegifranceMetaDay(DAY, ["Telegram"]);
    await fetchLegifranceMetaDay(new Date(2026, 7, 18), ["Telegram"]);

    const tokenCalls = postSpy.mock.calls.filter((c) =>
      String(c[0]).includes("oauth")
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it("mints a single token for callers that start at the same time", async () => {
    mockDatesWithoutJo();
    let releaseToken = () => {
      /* replaced below */
    };
    const gate = new Promise<void>((resolve) => {
      releaseToken = resolve;
    });
    postSpy.mockImplementation((url: string) => {
      if (url.includes("oauth")) return gate.then(() => tokenResponse());
      return Promise.resolve({ data: { items: [] } });
    });

    const days = Promise.all([
      fetchLegifranceMetaDay(DAY, ["Telegram"]),
      fetchLegifranceMetaDay(new Date(2026, 7, 18), ["Telegram"])
    ]);
    releaseToken();
    await days;

    // PISTE throttles a client that opens several token requests at once.
    expect(tokenCalls()).toHaveLength(1);
  });

  it("mints a fresh token and replays a call answered with a 401", async () => {
    mockDatesWithoutJo();
    let summaries = 0;
    postSpy.mockImplementation((url: string) => {
      if (url.includes("oauth")) return Promise.resolve(tokenResponse());
      summaries += 1;
      return summaries === 1
        ? Promise.reject(axiosError(401))
        : Promise.resolve(ONE_TEXT_SUMMARY);
    });

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result?.items.map((i) => i.id)).toEqual(["JORFTEXT000000000001"]);
    expect(tokenCalls()).toHaveLength(2);
    expect(logErrorForAppsSpy).not.toHaveBeenCalled();
  });

  it("gives up when a freshly minted token is refused too", async () => {
    mockDatesWithoutJo();
    postSpy.mockImplementation((url: string) =>
      url.includes("oauth")
        ? Promise.resolve(tokenResponse())
        : Promise.reject(axiosError(401))
    );

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result).toBeNull();
    // One replay, not a loop.
    expect(summaryCalls()).toHaveLength(2);
    expect(logErrorForAppsSpy).toHaveBeenCalledTimes(1);
  });

  it("fails fast and names the reason when the credentials are rejected", async () => {
    mockDatesWithoutJo();
    postSpy.mockImplementation((url: string) =>
      url.includes("oauth")
        ? Promise.reject(
            axiosError(400, {
              error: "invalid_client",
              error_description: "Invalid client"
            })
          )
        : Promise.resolve({ data: { items: [] } })
    );

    const result = await fetchLegifranceMetaDay(DAY, ["Telegram"]);

    expect(result).toBeNull();
    expect(tokenCalls()).toHaveLength(1);
    expect(logErrorForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("Error fetching the Legifrance JO summary"),
      expect.objectContaining({
        message: expect.stringContaining("invalid_client") as string
      })
    );
  });

  it("retries a token rejection that carries no OAuth error code", async () => {
    mockDatesWithoutJo();
    postSpy.mockImplementation((url: string) =>
      url.includes("oauth")
        ? Promise.reject(axiosError(400))
        : Promise.resolve({ data: { items: [] } })
    );

    const result = await withFakeTimers(() =>
      fetchLegifranceMetaDay(DAY, ["Telegram"])
    );

    expect(result).toBeNull();
    expect(tokenCalls()).toHaveLength(6); // RETRY_MAX + 1
    expect(logErrorForAppsSpy).toHaveBeenCalledWith(
      ["Telegram"],
      expect.stringContaining("aborted after"),
      expect.anything()
    );
  });

  it("renews a token that is about to expire", async () => {
    mockDatesWithoutJo();
    // Shorter than the renewal margin, so it is stale on every use.
    mockPost(() => ({ data: { items: [] } }), 30);

    await fetchLegifranceMetaDay(DAY, ["Telegram"]);
    await fetchLegifranceMetaDay(new Date(2026, 7, 18), ["Telegram"]);

    const tokenCalls = postSpy.mock.calls.filter((c) =>
      String(c[0]).includes("oauth")
    );
    // Paired with the test above, which pins a live token to a single fetch.
    expect(tokenCalls.length).toBeGreaterThan(1);
  });
});

describe("reference resolution against the JO summary", () => {
  const REFERENCE = "JORFTEXT000054708929";

  function mockReferenceLookup(sourceDates: string[]) {
    getSpy.mockImplementation((url: string) => {
      if (url.includes("datesWithoutJo")) {
        return Promise.resolve({ data: { lstDateDisabled: [] } });
      }
      return Promise.resolve({
        data: sourceDates.map((source_date) => ({
          nom: "Dupont",
          prenom: "Jean",
          source_id: REFERENCE,
          source_date,
          source_name: "JORF",
          type_ordre: "nomination",
          organisations: []
        })),
        request: {}
      });
    });
  }

  it("stores the JO edition holding the reference", async () => {
    mockReferenceLookup([DAY_YMD]);
    mockPost(() => ({
      data: {
        items: [
          {
            joCont: {
              structure: { liens: [{ id: REFERENCE, titre: "Décret" }] }
            }
          }
        ]
      }
    }));

    await callJORFSearchReference(REFERENCE, "Telegram");

    await vi.waitFor(async () => {
      expect(await Publication.findOne({ id: REFERENCE })).not.toBeNull();
    });
  });

  it("looks up every date a reference was seen on", async () => {
    // The reference belongs to the older edition only.
    mockReferenceLookup(["2026-08-19", "2026-08-18"]);
    postSpy.mockImplementation((url: string, payload: unknown) => {
      if (url.includes("oauth")) return Promise.resolve(tokenResponse());
      const { date } = payload as { date: number };
      const liens =
        date === Date.UTC(2026, 7, 18)
          ? [{ id: REFERENCE, titre: "Décret" }]
          : [{ id: "JORFTEXT000000000999", titre: "Autre texte" }];
      return Promise.resolve({
        data: { items: [{ joCont: { structure: { liens } } }] }
      });
    });

    await callJORFSearchReference(REFERENCE, "Telegram");

    await vi.waitFor(async () => {
      expect(await Publication.findOne({ id: REFERENCE })).not.toBeNull();
    });
    // Reading only the first date would have missed it entirely.
    expect(logWarningSpy).not.toHaveBeenCalled();
  });

  it("warns once and memoises a reference absent from the JO summary", async () => {
    mockReferenceLookup([DAY_YMD]);
    mockPost(() => ({
      data: {
        items: [
          {
            joCont: {
              structure: {
                liens: [{ id: "JORFTEXT000000000999", titre: "Autre texte" }]
              }
            }
          }
        ]
      }
    }));

    await callJORFSearchReference(REFERENCE, "Telegram");
    await vi.waitFor(() => {
      expect(logWarningSpy).toHaveBeenCalledTimes(1);
    });

    const summaryCallsAfterFirst = postSpy.mock.calls.filter(
      (c) => !String(c[0]).includes("oauth")
    ).length;

    await callJORFSearchReference(REFERENCE, "Telegram");
    // A bulletin officiel reference is never in the JO summary; re-fetching a
    // whole day for it on every message is what floods the error log.
    await vi.waitFor(() => {
      expect(
        postSpy.mock.calls.filter((c) => !String(c[0]).includes("oauth")).length
      ).toBe(summaryCallsAfterFirst);
    });
    expect(logWarningSpy).toHaveBeenCalledTimes(1);
  });
});
