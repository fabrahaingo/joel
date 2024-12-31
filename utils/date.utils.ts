// Ex: Will take "2021-08-25T00:00:00.000Z" and return "25 août 2021"
export function dateToFrenchString(date: string): string {
  const dateToConvert = new Date(date);
  return dateToConvert.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function dateTOJORFFormat(date: Date): string {
  const dateISO = date.toISOString().split(/[-T]/);
  return `${dateISO[2]}-${dateISO[1]}-${dateISO[0]}`;
}

export function JORFtoDate(dateStr: string): Date {
  const dateSplit = dateStr.split("-");

  const date = new Date(
    parseInt(dateSplit[0]),
    parseInt(dateSplit[1]),
    parseInt(dateSplit[2]),
  );
  date.setHours(0, 0, 0, 0);

  return date;
}
