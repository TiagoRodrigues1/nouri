import { useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { ChevronDown, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { colors } from "../../theme.stylex";

type TimePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onNow: () => void;
};

const hours = Array.from({ length: 24 }, (_, hour) => pad(hour));

const steps = Array.from({ length: 12 }, (_, step) => pad(step * 5));

const styles = stylex.create({
  trigger: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingInline: 10,
    borderRadius: 6,
    borderWidth: 1, borderStyle: "solid", borderColor: colors.input,
    backgroundColor: { default: colors.background, ":hover": colors.accent },
    color: colors.foreground,
    fontSize: 13,
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.ring}` },
  },
  icon: { color: colors.mutedForeground },
  columns: { display: "flex", gap: 4 },
  column: {
    position: "relative",
    display: "grid",
    gap: 2,
    width: 48,
    maxHeight: 196,
    overflowY: "auto",
    scrollbarWidth: "none",
  },
  option: {
    height: 28,
    borderRadius: 4,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.muted },
    color: colors.foreground,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.ring}` },
  },
  selected: {
    backgroundColor: { default: colors.primary, ":hover": colors.primaryHover },
    color: colors.primaryForeground,
  },
  footer: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: colors.border,
  },
  now: {
    width: "100%",
    height: 28,
    borderRadius: 4,
    borderWidth: 0,
    backgroundColor: { default: "transparent", ":hover": colors.accent },
    color: colors.primary,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
});

// An "HH:MM" picker in the shadcn Popover style: hours on the left, 5-minute steps on the right.
export function TimePicker({ id, value, onChange, onNow }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [hour, minute] = value.split(":");
  // Keep an off-step minute such as 16:57 selectable after the default fills it in.
  const minutes = [...new Set([...steps, minute])].sort();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger id={id} {...stylex.props(styles.trigger)}>
        <Clock size={14} {...stylex.props(styles.icon)} />
        {value}
        <ChevronDown size={14} {...stylex.props(styles.icon)} />
      </PopoverTrigger>
      <PopoverContent>
        <div {...stylex.props(styles.columns)}>
          <Column label="Hour" options={hours} selected={hour} onSelect={(next) => onChange(`${next}:${minute}`)} />
          <Column label="Minute" options={minutes} selected={minute} onSelect={(next) => onChange(`${hour}:${next}`)} />
        </div>
        <div {...stylex.props(styles.footer)}>
          <button type="button" {...stylex.props(styles.now)} onClick={() => { onNow(); setOpen(false); }}>
            Now
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Column({ label, options, selected, onSelect }: { label: string; options: string[]; selected: string; onSelect: (value: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // Center the selected option when the popover opens.
  useEffect(() => {
    const column = ref.current;
    const option = column?.querySelector<HTMLElement>("[aria-pressed=true]");

    if (column && option) column.scrollTop = option.offsetTop - (column.clientHeight - option.offsetHeight) / 2;
  }, []);

  return (
    <div ref={ref} role="group" aria-label={label} {...stylex.props(styles.column)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === selected}
          aria-label={`${label} ${option}`}
          {...stylex.props(styles.option, option === selected && styles.selected)}
          onClick={() => onSelect(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
