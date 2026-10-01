import { useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { calendarDate, localDate, shiftDate } from "@/lib/time";
import { colors } from "../../theme.stylex";

type DatePickerProps = {
  label: string;
  // A local "YYYY-MM-DD" date.
  value: string;
  onChange: (value: string) => void;
  // How many days end on the chosen date; more than one shades the whole span.
  days?: number;
};

const styles = stylex.create({
  trigger: { gap: 8, minWidth: 148, height: 36, fontSize: 13, fontWeight: 500, fontVariantNumeric: "tabular-nums" },
  icon: { color: colors.mutedForeground },
  content: { width: "auto", padding: 0, gap: 0 },
  footer: {
    padding: 6,
    borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border,
  },
  today: { width: "100%", color: colors.primary, fontSize: 12, fontWeight: 600 },
});

const shown = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });

// A date picker in the shadcn style: an outline button that opens a calendar in a popover.
export function DatePicker({ label, value, onChange, days = 1 }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => calendarDate(value));
  const selected = calendarDate(value);
  const span = { from: calendarDate(shiftDate(value, 1 - days)), to: selected };

  useEffect(() => setMonth(calendarDate(value)), [value]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label={label} {...stylex.props(styles.trigger)}>
          <CalendarDays size={15} {...stylex.props(styles.icon)} />
          {shown.format(selected)}
          <ChevronDown size={14} {...stylex.props(styles.icon)} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" {...stylex.props(styles.content)}>
        <Calendar
          mode="single"
          required
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={(date) => pick(localDate(date))}
          modifiers={days > 1 ? { span } : undefined}
          modifiersClassNames={{ span: "bg-muted" }}
        />
        <div {...stylex.props(styles.footer)}>
          <Button variant="ghost" size="sm" {...stylex.props(styles.today)} onClick={() => pick(localDate(new Date()))}>
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
