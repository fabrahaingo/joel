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
  date.setHours(0, 0, 0, 0);
  return date
    .toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    })
    .replaceAll("/", "-");
}

export function JORFtoDate(dateStr: string): Date {
  const dateSplit = dateStr.split("-");

  return new Date(
    parseInt(dateSplit[0]),
    parseInt(dateSplit[1])-1,
    parseInt(dateSplit[2]),
  );
}
