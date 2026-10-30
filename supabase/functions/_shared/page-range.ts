import { ValidationError } from "./validation.ts";
export function parsePageRange(value: unknown, pageCount: number): number[] {
  if (typeof value !== "string" || !value.trim() || value.length > 1000)
    throw new ValidationError("Enter pages such as 1-3, 4, 7.");
  const result = new Set<number>();
  for (const part of value
    .replace(/，/g, ",")
    .replace(/[–—]/g, "-")
    .split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match)
      throw new ValidationError(
        "Use page numbers or ranges separated by commas, such as 1-3, 4, 7.",
      );
    const start = Number(match[1]),
      end = Number(match[2] || match[1]);
    if (start < 1 || end < start || end > pageCount)
      throw new ValidationError(
        `Pages must be between 1 and ${pageCount}, with ranges in ascending order.`,
      );
    for (let page = start; page <= end; page++) result.add(page);
  }
  return [...result].sort((a, b) => a - b);
}
