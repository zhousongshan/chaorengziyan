"use client";

import * as Popover from "@radix-ui/react-popover";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays, X } from "lucide-react";
import { useMemo, useState } from "react";
import { DayPicker, type DateRange, type DayButtonProps, type Matcher } from "react-day-picker";
import "react-day-picker/style.css";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";

import styles from "./asset-date-range-picker.module.css";

export type AssetDateRange = { from: string; to: string };

type CalendarFilters = {
  keyword: string;
  scope: "all" | "favorites";
  folderId?: string;
  projectId?: string;
  source: "all" | "uploaded" | "generated";
};

export function AssetDateRangePicker({
  value,
  filters,
  disabled,
  onApply
}: Readonly<{
  value: AssetDateRange | null;
  filters: CalendarFilters;
  disabled?: boolean;
  onApply: (range: AssetDateRange | null) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange | undefined>(() => toDateRange(value));
  const [month, setMonth] = useState(() => toDateRange(value)?.from ?? shanghaiToday());
  const calendarQuery = {
    ...filters,
    month: formatDate(month).slice(0, 7)
  };
  const calendar = useQuery({
    queryKey: queryKeys.mediaAssetCalendar(calendarQuery),
    queryFn: () => apiClient.getMediaAssetCalendar(calendarQuery),
    enabled: open && !disabled
  });
  const counts = useMemo(
    () => new Map(calendar.data?.days.map((day) => [day.date, day.count]) ?? []),
    [calendar.data?.days]
  );
  const disabledDays = useMemo<Matcher[]>(() => {
    if (!calendar.data?.minDate || !calendar.data.maxDate) return [];
    return [
      { before: parseDate(calendar.data.minDate) },
      { after: parseDate(calendar.data.maxDate) }
    ];
  }, [calendar.data?.maxDate, calendar.data?.minDate]);

  const updateOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      const selected = toDateRange(value);
      setDraft(selected);
      setMonth(selected?.from ?? shanghaiToday());
    }
  };

  const apply = () => {
    if (!draft?.from) return;
    const from = formatDate(draft.from);
    const to = formatDate(draft.to ?? draft.from);
    onApply(from <= to ? { from, to } : { from: to, to: from });
    setOpen(false);
  };

  const setQuickRange = (days: number) => {
    const today = shanghaiToday();
    setDraft({ from: subDays(today, days - 1), to: today });
    setMonth(today);
  };

  return (
    <div className={styles.control}>
      <Popover.Root open={open} onOpenChange={updateOpen}>
        <Popover.Trigger asChild>
          <button
            className={styles.trigger}
            type="button"
            disabled={disabled}
            aria-label="按生成或上传日期筛选"
          >
            <CalendarDays />
            <span>{rangeLabel(value)}</span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className={styles.popover} align="start" sideOffset={5}>
            <div className={styles.popoverBody}>
              <div className={styles.quickRanges} aria-label="快捷日期范围">
                <button type="button" onClick={() => setQuickRange(1)}>
                  今天
                </button>
                <button type="button" onClick={() => setQuickRange(7)}>
                  最近 7 天
                </button>
                <button type="button" onClick={() => setQuickRange(30)}>
                  最近 30 天
                </button>
              </div>
              <DayPicker
                animate
                fixedWeeks
                mode="range"
                locale={zhCN}
                month={month}
                selected={draft}
                disabled={disabledDays}
                onMonthChange={setMonth}
                onSelect={setDraft}
                showOutsideDays
                navLayout="around"
                formatters={{
                  formatCaption: (date) => format(date, "yyyy年 M月", { locale: zhCN })
                }}
                components={{
                  DayButton: (props) => <AssetDayButton {...props} counts={counts} />
                }}
              />
              <div className={styles.calendarStatus} aria-live="polite">
                {calendar.isPending
                  ? "正在读取素材日期…"
                  : calendar.isError
                    ? "素材日期读取失败，可切换月份重试"
                    : calendar.data?.days.length === 0
                      ? "本月没有符合当前条件的素材"
                      : "数字表示当天的素材数量"}
              </div>
            </div>
            <div className={styles.footer}>
              <button
                type="button"
                className={styles.clearButton}
                disabled={!value && !draft}
                onClick={() => {
                  setDraft(undefined);
                  onApply(null);
                  setOpen(false);
                }}
              >
                清除
              </button>
              <Button type="button" disabled={!draft?.from} onClick={apply}>
                应用
              </Button>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {value && !disabled && (
        <button
          className={styles.clearIcon}
          type="button"
          aria-label="清除日期筛选"
          title="清除日期筛选"
          onClick={() => onApply(null)}
        >
          <X />
        </button>
      )}
    </div>
  );
}

function AssetDayButton({
  day,
  counts,
  children,
  ...buttonProps
}: DayButtonProps & { counts: ReadonlyMap<string, number> }) {
  const count = counts.get(formatDate(day.date));
  return (
    <button {...buttonProps} title={count ? `${count} 个素材` : undefined}>
      <span>{children}</span>
      {count && <small>{count}</small>}
    </button>
  );
}

function rangeLabel(value: AssetDateRange | null): string {
  if (!value) return "全部日期";
  if (value.from === value.to) return value.from.replaceAll("-", ".");
  return `${value.from.replaceAll("-", ".")} - ${value.to.replaceAll("-", ".")}`;
}

function toDateRange(value: AssetDateRange | null): DateRange | undefined {
  return value ? { from: parseDate(value.from), to: parseDate(value.to) } : undefined;
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, day);
}

function formatDate(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

function shanghaiToday(): Date {
  const value = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
  return parseDate(value);
}
