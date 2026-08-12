import type { MediaAssetListQuery } from "@chaoren/contracts";

const SHANGHAI_OFFSET = "+08:00";

export function shanghaiDayStart(date: string): Date {
  return new Date(`${date}T00:00:00${SHANGHAI_OFFSET}`);
}

export function nextShanghaiDay(date: string): Date {
  return new Date(shanghaiDayStart(date).getTime() + 24 * 60 * 60 * 1000);
}

export function shanghaiMonthRange(month: string): { start: Date; end: Date } {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const nextMonth = monthNumber === 12 ? `${year + 1}-01` : `${year}-${pad(monthNumber + 1)}`;
  return {
    start: shanghaiDayStart(`${month}-01`),
    end: shanghaiDayStart(`${nextMonth}-01`)
  };
}

export function listDateRange(query: MediaAssetListQuery): { start?: Date; end?: Date } {
  if (query.date) {
    return { start: shanghaiDayStart(query.date), end: nextShanghaiDay(query.date) };
  }
  return {
    ...(query.dateFrom ? { start: shanghaiDayStart(query.dateFrom) } : {}),
    ...(query.dateTo ? { end: nextShanghaiDay(query.dateTo) } : {})
  };
}

export function formatShanghaiDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
