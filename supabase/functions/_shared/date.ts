export const SIGNING_TIME_ZONE = "America/Los_Angeles";
export function signingDate(value: string | Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SIGNING_TIME_ZONE,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
