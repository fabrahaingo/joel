import { describe, it, expect, vi, beforeEach } from "vitest";

const spies = vi.hoisted(() => ({
  helpCommand: vi.fn(() => Promise.resolve()),
  buildInfoCommand: vi.fn(() => Promise.resolve()),
  statsCommand: vi.fn(() => Promise.resolve()),
  defaultCommand: vi.fn(() => Promise.resolve()),
  startCommand: vi.fn(() => Promise.resolve()),
  followCommand: vi.fn(() => Promise.resolve()),
  textAlertCommand: vi.fn(() => Promise.resolve()),
  listCommand: vi.fn(() => Promise.resolve()),
  manualFollowCommand: vi.fn(() => Promise.resolve()),
  fullHistoryCommand: vi.fn(() => Promise.resolve()),
  searchPersonHistory: vi.fn(() => Promise.resolve()),
  unfollowFromStr: vi.fn(() => Promise.resolve()),
  followFunctionFromStrCommand: vi.fn(() => Promise.resolve()),
  followOrgFromStr: vi.fn(() => Promise.resolve()),
  searchOrganisationFromStr: vi.fn(() => Promise.resolve()),
  clearFollowUp: vi.fn(),
  handleFollowUp: vi.fn(() => Promise.resolve(false))
}));

vi.mock("../commands/help.ts", () => ({
  helpCommand: spies.helpCommand,
  buildInfoCommand: spies.buildInfoCommand
}));
vi.mock("../commands/stats.ts", () => ({ statsCommand: spies.statsCommand }));
vi.mock("../commands/default.ts", () => ({
  defaultCommand: spies.defaultCommand,
  mainMenuCommand: vi.fn(() => Promise.resolve())
}));
vi.mock("../commands/start.ts", () => ({ startCommand: spies.startCommand }));
vi.mock("../commands/search.ts", () => ({
  followCommand: spies.followCommand,
  fullHistoryCommand: spies.fullHistoryCommand,
  manualFollowCommand: spies.manualFollowCommand,
  searchCommand: vi.fn(() => Promise.resolve()),
  searchPersonHistory: spies.searchPersonHistory
}));
vi.mock("../commands/textAlert.ts", () => ({
  textAlertCommand: spies.textAlertCommand
}));
vi.mock("../commands/list.ts", () => ({
  listCommand: spies.listCommand,
  unfollowCommand: vi.fn(() => Promise.resolve()),
  unfollowFromStr: spies.unfollowFromStr
}));
vi.mock("../commands/ena.ts", () => ({
  enaCommand: vi.fn(() => Promise.resolve()),
  promosCommand: vi.fn(() => Promise.resolve())
}));
vi.mock("../commands/deleteProfile.ts", () => ({
  deleteProfileCommand: vi.fn(() => Promise.resolve())
}));
vi.mock("../commands/followFunction.ts", () => ({
  followFunctionCommand: vi.fn(() => Promise.resolve()),
  followFunctionFromStrCommand: spies.followFunctionFromStrCommand
}));
vi.mock("../commands/followOrganisation.ts", () => ({
  searchOrganisation: vi.fn(() => Promise.resolve()),
  searchOrganisationFromStr: spies.searchOrganisationFromStr,
  followOrganisationsFromWikidataIdStr: spies.followOrgFromStr
}));
vi.mock("../commands/importExport.ts", () => ({
  exportCommand: vi.fn(() => Promise.resolve()),
  importCommand: vi.fn(() => Promise.resolve())
}));
vi.mock("../commands/triggerPendingNotifications.ts", () => ({
  triggerPendingNotifications: vi.fn(() => Promise.resolve())
}));
vi.mock("../entities/FollowUpManager.ts", () => ({
  clearFollowUp: spies.clearFollowUp,
  handleFollowUpMessage: spies.handleFollowUp
}));

import { processMessage } from "../commands/Commands.ts";
import type { ISession } from "../types.ts";

const makeSession = (over: Partial<ISession> = {}): ISession =>
  ({
    messageApp: "Telegram",
    chatId: "d-" + Math.random().toString(36).slice(2),
    language_code: "fr",
    user: null,
    isReply: false,
    lastEngagementAt: new Date(),
    loadUser: () => Promise.resolve(null),
    createUser: () => Promise.resolve(),
    sendMessage: vi.fn(() => Promise.resolve(true)),
    sendTypingAction: vi.fn(),
    log: vi.fn(),
    extractMessageAppsOptions: () => ({}),
    ...over
  }) as unknown as ISession;

beforeEach(() => {
  vi.clearAllMocks();
  spies.handleFollowUp.mockResolvedValue(false);
});

describe("processMessage", () => {
  it("runs the matching keyboard action and clears the follow-up", async () => {
    await processMessage(makeSession(), "❓ Aide & Stats");
    expect(spies.clearFollowUp).toHaveBeenCalled();
    expect(spies.helpCommand).toHaveBeenCalled();
    expect(spies.handleFollowUp).not.toHaveBeenCalled();
  });

  it("keeps the follow-up alive and continues for an action-less key", async () => {
    // "🔎 Suivre" has keepFollowUpAlive and no action -> continue past it.
    await processMessage(makeSession(), "🔎 Suivre");
    // Falls through to the follow-up / command resolution.
    expect(spies.handleFollowUp).toHaveBeenCalled();
  });

  it("returns early when a follow-up handles the message", async () => {
    spies.handleFollowUp.mockResolvedValue(true);
    await processMessage(makeSession(), "some answer");
    expect(spies.defaultCommand).not.toHaveBeenCalled();
  });

  it("routes a regex command", async () => {
    await processMessage(makeSession(), "/stats");
    expect(spies.statsCommand).toHaveBeenCalled();
  });

  it("routes a follow command", async () => {
    await processMessage(makeSession(), "Suivre Jean Dupont");
    expect(spies.followCommand).toHaveBeenCalled();
  });

  it("falls back to /start on the first unmatched message", async () => {
    await processMessage(makeSession(), "zzz nothing", {
      isFirstMessage: true
    });
    expect(spies.startCommand).toHaveBeenCalledWith(
      expect.anything(),
      "/start"
    );
  });

  it("falls back to the default command otherwise", async () => {
    await processMessage(makeSession(), "zzz nothing");
    expect(spies.defaultCommand).toHaveBeenCalled();
  });

  it.each([
    ["🕵️ Forcer le suivi de Jean Dupont", "manualFollowCommand"],
    ["Suivre N Jean Dupont", "manualFollowCommand"],
    ["Suivre F ambassadeur", "followFunctionFromStrCommand"],
    ["Suivre O Q123", "followOrgFromStr"],
    ["Rechercher O Conseil Etat", "searchOrganisationFromStr"],
    ["Retirer Jean Dupont", "unfollowFromStr"],
    ["Historique complet de Jean Dupont", "fullHistoryCommand"],
    ["Historique de Jean Dupont", "fullHistoryCommand"],
    ["Rechercher Jean Dupont", "searchPersonHistory"]
  ] as [string, keyof typeof spies][])(
    "routes %s through its wrapper",
    async (msg, spyName) => {
      await processMessage(makeSession(), msg);
      expect(spies[spyName]).toHaveBeenCalled();
      expect(spies.defaultCommand).not.toHaveBeenCalled();
    }
  );
});
