import { describe, expect, jest, beforeEach } from "@jest/globals";
import mongoose from "mongoose";
import User from "../models/User.ts";
import { processMessage } from "../commands/Commands.ts";
import { ISession } from "../types.ts";

// Mock session for testing
const createMockSession = (hasUser: boolean): ISession => {
  const session = {
    messageApp: "Matrix",
    chatId: "test@matrix.org",
    roomId: "!testroom:matrix.org",
    language_code: "fr",
    lastEngagementAt: new Date(),
    user: hasUser ? ({ _id: "mockUserId" } as any) : null,
    isReply: false,
    mainMenuKeyboard: [],
    sendTypingAction: jest.fn(),
    log: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue(true),
    loadUser: jest
      .fn()
      .mockResolvedValue(hasUser ? { _id: "mockUserId" } : null),
    createUser: jest.fn(),
    extractMessageAppsOptions: jest.fn()
  } as unknown as ISession;
  return session;
};

describe("First Message Processing", () => {
  beforeEach(async () => {
    if (!mongoose.connection.db)
      throw new Error("MongoDB connection not established");
    await mongoose.connection.db.dropDatabase();
    jest.clearAllMocks();
  });

  describe("processMessage with isFirstMessage flag", () => {
    it("should treat invalid command as /start for first message", async () => {
      const session = createMockSession(false);

      // Test an invalid message that would normally trigger default command
      await processMessage(session, "random nonsense message", {
        isFirstMessage: true
      });

      // Verify that sendMessage was called with welcome text (from /start command)
      expect(session.sendMessage).toHaveBeenCalled();
      // The first call should be the help text from startCommand
      const calls = (session.sendMessage as jest.MockedFunction<any>).mock
        .calls;
      expect(calls.length).toBeGreaterThan(0);
      // Check that it contains help/welcome text, not the default "Je n'ai pas compris" message
      const firstCallArg = calls[0][0];
      expect(firstCallArg).not.toContain("Je n'ai pas compris");
    });

    it("should process valid command normally even for first message", async () => {
      const session = createMockSession(false);

      // Test a valid command like "Bonjour"
      await processMessage(session, "Bonjour JOEL", { isFirstMessage: true });

      // Should trigger start command and send help text
      expect(session.sendMessage).toHaveBeenCalled();
      const calls = (session.sendMessage as jest.MockedFunction<any>).mock
        .calls;
      expect(calls.length).toBeGreaterThan(0);
    });

    it("should use default command for invalid message when NOT first message", async () => {
      const session = createMockSession(true); // Has user

      // Test an invalid message for existing user
      await processMessage(session, "random nonsense message", {
        isFirstMessage: false
      });

      // Should trigger default command
      expect(session.sendMessage).toHaveBeenCalled();
      const calls = (session.sendMessage as jest.MockedFunction<any>).mock
        .calls;
      const firstCallArg = calls[0][0];
      expect(firstCallArg).toContain("Je n'ai pas compris");
    });

    it("should handle keyboard button commands the same way regardless of isFirstMessage", async () => {
      const session = createMockSession(false);

      // Test with a keyboard button text
      await processMessage(session, "🤝 Aide", { isFirstMessage: true });

      // Should process the keyboard command normally
      expect(session.sendMessage).toHaveBeenCalled();
    });
  });
});
