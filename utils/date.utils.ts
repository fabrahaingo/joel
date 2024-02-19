// Ex: Will take "2021-08-25T00:00:00.000Z" and return "25 août 2021"
export function dateToFrenchString(date: string): string {
  const dateToConvert = new Date(date);
  return dateToConvert.toLocaleDateString("fr-FR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
