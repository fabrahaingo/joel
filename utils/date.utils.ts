const FULL_DAY_MS = 24 * 60 * 60 * 1000;

// Ex: Will take "2021-08-25T00:00:00.000Z" and return "25 août 2021"
export function dateToFrenchString(date: string): string {
  const dateToConvert = new Date(date);
  return dateToConvert.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function dateToString(date: Date, format: "YMD" | "DMY"): string {
  // Don't mutate the original date
  const d = new Date(date.getTime());

  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, "0"); // getMonth is 0-based
  const day = String(d.getDate()).padStart(2, "0");

  if (format === "DMY") return `${day}-${month}-${year}`;

  return `${year}-${month}-${day}`; // YYYY-MM-DD
}

export function JORFtoDate(dateStr: string): Date {
  const dateSplit = dateStr.split("-");

  return new Date(
    parseInt(dateSplit[0]),
    parseInt(dateSplit[1]) - 1,
    parseInt(dateSplit[2])
  );
}

// Helper function to get ISO week number
export function getISOWeek(date: Date): string {
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const week1 = new Date(target.getFullYear(), 0, 4);
  const weekNum =
    1 +
    Math.round(
      ((target.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7
    );
  return `${String(target.getFullYear())}-W${String(weekNum)}`;
}
export function timeDaysBetweenDates(a: Date, b: Date): number {
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / FULL_DAY_MS);
}

export function calendarDaysBetweenDates(a: Date, b: Date): number {
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());

  return Math.round(Math.abs(utcB - utcA) / FULL_DAY_MS);
}
