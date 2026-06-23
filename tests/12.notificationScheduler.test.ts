import { describe, it, expect } from "vitest";
import { computeNextOccurrence } from "../notifications/notificationScheduler.ts";
import { WHATSAPP_SHIFT_STEP_MINS } from "../entities/WhatsAppSession.ts";

// `now` is injected at 05:00 local (<= 6am) so computeNextOccurrence schedules
// the *same* calendar day at the configured time with no day-advance — isolating
// the day-of-week shift, which is the only thing that differs between apps.
const TIME = { hour: 9, minute: 0 };
const at5am = (y: number, mIdx: number, d: number): Date =>
  new Date(y, mIdx, d, 5, 0, 0, 0);

const STEP_MS = WHATSAPP_SHIFT_STEP_MINS * 60 * 1000;

describe("computeNextOccurrence — day-of-week shift", () => {
  it("applies no shift for non-WhatsApp apps", () => {
    const now = at5am(2026, 5, 24); // Wednesday
    const next = computeNextOccurrence(TIME, ["Telegram"], now);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getDate()).toBe(24);
  });

  // (weekday, expected shift-step index) per the scheduler's (getDay()+5)%7 rule.
  const cases: [string, Date, number][] = [
    ["Tuesday", at5am(2026, 5, 23), 0],
    ["Wednesday", at5am(2026, 5, 24), 1],
    ["Thursday", at5am(2026, 5, 25), 2],
    ["Friday", at5am(2026, 5, 26), 3],
    ["Saturday", at5am(2026, 5, 27), 4],
    ["Sunday", at5am(2026, 5, 28), 5],
    ["Monday", at5am(2026, 5, 22), 6]
  ];

  for (const [label, now, index] of cases) {
    it(`advances WhatsApp by ${String(index)}*STEP on ${label}`, () => {
      const base = computeNextOccurrence(TIME, ["Telegram"], now);
      const wh = computeNextOccurrence(TIME, ["WhatsApp"], now);

      // WhatsApp run is advanced earlier than the un-shifted base by index*step.
      expect(base.getTime() - wh.getTime()).toBe(index * STEP_MS);
    });
  }

  it("uses WHATSAPP_SHIFT_STEP_MINS (decoupled from the cutoff margin) as the step", () => {
    const now = at5am(2026, 5, 22); // Monday -> index 6
    const base = computeNextOccurrence(TIME, ["Telegram"], now);
    const wh = computeNextOccurrence(TIME, ["WhatsApp"], now);
    expect(base.getTime() - wh.getTime()).toBe(6 * STEP_MS);
  });
});
