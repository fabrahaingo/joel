import { describe, expect, it } from "@jest/globals";
import {
  dateToString,
  dateToFrenchString,
  JORFtoDate,
  getISOWeek,
  timeDaysBetweenDates,
  calendarDaysBetweenDates,
  formatDuration
} from "../utils/date.utils.ts";

describe("dateToString", () => {
  const date = new Date("2024-01-15T12:00:00.000Z");

  it("formats YMD correctly", () => {
    expect(dateToString(date, "YMD")).toBe("2024-01-15");
  });

  it("formats DMY correctly", () => {
    expect(dateToString(date, "DMY")).toBe("15-01-2024");
  });

  it("pads single-digit month and day", () => {
    const d = new Date("2024-03-05T00:00:00.000Z");
    expect(dateToString(d, "YMD")).toBe("2024-03-05");
  });

  it("does not mutate the input date", () => {
    const d = new Date("2024-06-15T00:00:00.000Z");
    const original = d.getTime();
    dateToString(d, "YMD");
    expect(d.getTime()).toBe(original);
  });
});

describe("dateToFrenchString", () => {
  it("formats a date in French locale", () => {
    const result = dateToFrenchString("2024-01-15T00:00:00.000Z");
    expect(result).toContain("2024");
    expect(result).toMatch(/janvier/i);
  });
});

describe("JORFtoDate", () => {
  it("parses a YYYY-MM-DD string into a Date", () => {
    const d = JORFtoDate("2024-01-15");
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(0); // January is 0
    expect(d.getDate()).toBe(15);
  });

  it("parses year-boundary date correctly", () => {
    const d = JORFtoDate("2023-12-31");
    expect(d.getFullYear()).toBe(2023);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });
});

describe("getISOWeek", () => {
  it("returns correct ISO week for a mid-year date", () => {
    // 2024-07-01 is week 27
    expect(getISOWeek(new Date("2024-07-01"))).toBe("2024-W27");
  });

  it("Jan 1 2024 belongs to week 1 of 2024", () => {
    // 2024-01-01 is Monday → W1
    expect(getISOWeek(new Date("2024-01-01"))).toBe("2024-W1");
  });

  it("Dec 30 2024 belongs to week 1 of 2025", () => {
    // 2024-12-30 → W1 2025
    expect(getISOWeek(new Date("2024-12-30"))).toBe("2025-W1");
  });

  it("returns different week strings for dates 7 days apart", () => {
    const w1 = getISOWeek(new Date("2024-07-01"));
    const w2 = getISOWeek(new Date("2024-07-08"));
    expect(w1).not.toBe(w2);
  });

  it("returns same week string for dates in the same ISO week", () => {
    // 2024-07-01 (Mon) and 2024-07-07 (Sun) are both W27
    const w1 = getISOWeek(new Date("2024-07-01"));
    const w2 = getISOWeek(new Date("2024-07-07"));
    expect(w1).toBe(w2);
  });
});

describe("timeDaysBetweenDates", () => {
  it("returns 0 for same date", () => {
    const d = new Date("2024-01-15");
    expect(timeDaysBetweenDates(d, d)).toBe(0);
  });

  it("returns 1 for dates 24h apart", () => {
    const a = new Date("2024-01-15T00:00:00.000Z");
    const b = new Date("2024-01-16T00:00:00.000Z");
    expect(timeDaysBetweenDates(a, b)).toBe(1);
  });

  it("is symmetric (|a - b| == |b - a|)", () => {
    const a = new Date("2024-01-10");
    const b = new Date("2024-01-15");
    expect(timeDaysBetweenDates(a, b)).toBe(timeDaysBetweenDates(b, a));
  });

  it("returns 5 for dates 5 days apart", () => {
    const a = new Date("2024-01-10T00:00:00.000Z");
    const b = new Date("2024-01-15T00:00:00.000Z");
    expect(timeDaysBetweenDates(a, b)).toBe(5);
  });
});

describe("calendarDaysBetweenDates", () => {
  it("returns 0 for same date", () => {
    const d = new Date("2024-06-15");
    expect(calendarDaysBetweenDates(d, d)).toBe(0);
  });

  it("returns 1 for consecutive calendar days", () => {
    const a = new Date("2024-06-15");
    const b = new Date("2024-06-16");
    expect(calendarDaysBetweenDates(a, b)).toBe(1);
  });

  it("is symmetric", () => {
    const a = new Date("2024-01-01");
    const b = new Date("2024-03-01");
    expect(calendarDaysBetweenDates(a, b)).toBe(calendarDaysBetweenDates(b, a));
  });

  it("correctly counts across DST boundary (UTC-based)", () => {
    // March 31 is DST in France but UTC-based calc should give exactly 1
    const a = new Date("2024-03-30");
    const b = new Date("2024-03-31");
    expect(calendarDaysBetweenDates(a, b)).toBe(1);
  });
});

describe("formatDuration", () => {
  it("returns empty string for 0ms", () => {
    expect(formatDuration(0)).toBe("");
  });

  it("formats seconds correctly", () => {
    expect(formatDuration(1000)).toBe("1 second");
    expect(formatDuration(2000)).toBe("2 seconds");
  });

  it("formats minutes correctly", () => {
    expect(formatDuration(60000)).toBe("1 minute");
  });

  it("formats hours correctly", () => {
    expect(formatDuration(3600000)).toBe("1 hour");
  });

  it("formats combined duration", () => {
    // 1h 1m 1s = 3661000ms
    expect(formatDuration(3661000)).toBe("1 hour, 1 minute, 1 second");
  });

  it("formats days correctly", () => {
    expect(formatDuration(86400000)).toBe("1 day");
  });

  it("handles negative values (takes absolute)", () => {
    expect(formatDuration(-1000)).toBe("1 second");
  });
});
