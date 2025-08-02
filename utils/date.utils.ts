// Ex: Will take "2021-08-25T00:00:00.000Z" and return "25 août 2021"
export function dateToFrenchString(date: string): string {
  const dateToConvert = new Date(date);
  return dateToConvert.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

export function dateTOJORFFormat(date: Date): string {
  date.setHours(0, 0, 0, 0);
  return date
    .toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "numeric",
      year: "numeric"
    })
    .replaceAll("/", "-");
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
