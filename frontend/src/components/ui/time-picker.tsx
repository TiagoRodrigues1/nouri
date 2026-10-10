import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as stylex from "@stylexjs/stylex";
import { ChevronDown, Clock } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { colors } from "../../theme.stylex";

type TimePickerProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onNow: () => void;
  // Picking an hour and then a minute changes the value twice; a caller that saves on change waits for this.
  onClose?: () => void;
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
// While it is open, typing digits sets the time: "7" is 07, "12" is 12, and "1230" is 12:30.
export function TimePicker({ id, value, onChange, onNow, onClose }: TimePickerProps) {
  const [open, setOpen] = useState(false);
  const [hour, minute] = value.split(":");
  // Keep an off-step minute such as 16:57 selectable after the default fills it in.
  const minutes = [...new Set([...steps, minute])].sort();
  const typed = useRef("");
  const typedAt = useRef(0);

  function changeOpen(next: boolean) {
    setOpen(next);
    typed.current = "";

    if (!next) onClose?.();
  }

  function type(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && typed.current) {
      event.preventDefault();
      changeOpen(false);

      return;
    }

    if (!/^[0-9]$/.test(event.key)) return;
    event.preventDefault();
    // A pause starts a new time instead of continuing the last one.
    const fresh = event.timeStamp - typedAt.current > 1500;
    typedAt.current = event.timeStamp;
    const next = appendDigit(fresh ? "" : typed.current, event.key);

    if (next === null) return;
    typed.current = next.length === 4 ? "" : next;
    onChange(next.length <= 2 ? `${next.padStart(2, "0")}:${minute}` : `${next.slice(0, 2)}:${next.slice(2).padEnd(2, "0")}`);

    if (next.length === 4) changeOpen(false);
  }

  return (
    // Modal so the hour and minute lists scroll inside a dialog, whose scroll lock blocks everything outside it.
    <Popover modal open={open} onOpenChange={changeOpen}>
      <PopoverTrigger id={id} {...stylex.props(styles.trigger)}>
        <Clock size={14} {...stylex.props(styles.icon)} />
        {value}
        <ChevronDown size={14} {...stylex.props(styles.icon)} />
      </PopoverTrigger>
      <PopoverContent onKeyDown={type}>
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

  const opened = useRef(false);

  // Center the selected option when the popover opens, then keep it in view as typing changes it.
  useEffect(() => {
    const column = ref.current;
    const option = column?.querySelector<HTMLElement>("[aria-pressed=true]");

    if (!column || !option) return;

    if (opened.current) option.scrollIntoView({ block: "nearest" });
    else column.scrollTop = option.offsetTop - (column.clientHeight - option.offsetHeight) / 2;
    opened.current = true;
  }, [selected]);

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

// Appends a typed digit to "H", "HH", "HHM", or "HHMM". A first hour digit above 2 or a first minute digit
// above 5 can only mean one value, so it is padded at once. Returns null for a digit that cannot fit.
function appendDigit(sofar: string, digit: string): string | null {
  if (sofar === "" && digit > "2") return `0${digit}`;

  if (sofar.length === 1 && Number(sofar + digit) > 23) return null;

  if (sofar.length === 2 && digit > "5") return `${sofar}0${digit}`;

  return sofar + digit;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
