import { Dropdown } from "./Dropdown";
import { DatePicker } from "./DatePicker";
import { todayInTimeZone } from "../lib/dateUtils";
import type { WorkRange } from "../types";

export const DATE_RANGE_OPTIONS: { value: WorkRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last_24h", label: "Last 24 Hours" },
  { value: "last_3d", label: "Last 3 Days" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_1m", label: "Last 1 Month" },
  { value: "last_1y", label: "Last 1 Year" },
  { value: "custom", label: "Custom Range" },
  { value: "all", label: "All Time" },
];

/** The presets that are stored in a page's URL (All Time is the absence of a range). */
export const DATE_RANGE_URL_VALUES: readonly string[] = DATE_RANGE_OPTIONS.filter((o) => o.value !== "all").map((o) => o.value);

export interface DateRangeValue {
  range: WorkRange;
  from: string;
  to: string;
}
export function DateRangeFilter({
  value,
  onChange,
  timeZone,
}: {
  value: DateRangeValue;
  onChange: (next: DateRangeValue) => void;
  timeZone?: string;
}) {
  const today = todayInTimeZone(timeZone);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="date-range-filter">
      <Dropdown
        className="w-44"
        size="sm"
        value={value.range}
        onChange={(r) =>
          onChange(r === "custom" ? { range: "custom", from: value.from, to: value.to } : { range: r as WorkRange, from: "", to: "" })
        }
        options={DATE_RANGE_OPTIONS}
      />
      {value.range === "custom" && (
        <>
          <DatePicker
            className="w-[150px]"
            ariaLabel="Start date"
            placeholder="Start date"
            value={value.from}
            today={today}
            onChange={(from) => {
              // An End date that is now before the Start is cleared, so the range never inverts.
              const to = from && value.to && value.to < from ? "" : value.to;
              onChange({ range: "custom", from, to });
            }}
          />
          <span className="text-xs text-muted">to</span>
          <DatePicker
            className="w-[150px]"
            ariaLabel="End date"
            placeholder="End date"
            align="right"
            value={value.to}
            today={today}
            min={value.from || undefined}
            onChange={(to) => onChange({ range: "custom", from: value.from, to })}
          />
        </>
      )}
    </div>
  );
}