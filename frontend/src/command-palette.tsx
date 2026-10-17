import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Command as CommandPrimitive } from "cmdk";
import { Dialog as DialogPrimitive } from "radix-ui";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CalendarRange,
  ChartColumn,
  Droplet,
  Dumbbell,
  History,
  LayoutDashboard,
  ListChecks,
  Moon,
  PencilLine,
  Pill,
  Play,
  Ruler,
  ScanBarcode,
  Search,
  Target,
  TrendingUp,
  UtensilsCrossed,
  Watch,
  Weight,
  X,
  Zap,
} from "lucide-react";
import { styles } from "./palette-styles";
import { BarcodeScanner } from "./barcode-scanner";
import { Button } from "./components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./components/ui/command";
import { DialogOverlay, DialogPortal } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Kbd } from "./components/ui/kbd";
import { Label } from "./components/ui/label";
import { TimePicker } from "./components/ui/time-picker";
import { ManualFoodForm } from "./manual-food-form";
import { measurementLabels } from "./overview-dialogs";
import { findChoices, retryOutage, type Choice } from "./search-foods-tab";
import { ApiError, format, type MeasurementKind, type RecordCommand, type SavedMeal } from "./lib/api";
import { nutrientLine, unitLabels } from "./lib/food-text";
import { portionFood } from "./lib/food-portion";
import { rowsKcal } from "./lib/food-selection";
import { nameMatches, parseShortcut, type PaletteShortcut } from "./lib/palette-shortcuts";
import { draftRow, foodItems, rowFood, type FoodRow } from "./lib/saved-meals";
import { typedAmount } from "./lib/typed-amount";
import { currentTime, dateLabel, occurredAt, timeZone } from "./lib/time";
import { useLogFoods, useRecentFoods } from "./lib/use-recent-foods";
import { useLogMeal, useSavedMeals } from "./lib/use-saved-meals";
import { useRoutines } from "./lib/routines";
import { useWorkoutSession } from "./lib/use-workout-session";
import { useKeyboardInset, usePhone } from "./lib/use-phone";
import { useJournal } from "./overview/use-journal";
import { recordPaths } from "../../src/journal/paths";
import { isBarcode, isUserAdded, maxBatchFoods, recordedFood, totalNutrients, type FoodInput } from "../../src/food/contract";
import { measurementKinds, measurementLimits } from "../../src/measurements/contract";

// Where the palette is. Each step narrows the one before it; Backspace in an empty search, or Escape, goes back one.
type Step =
  | { kind: "root" }
  | { kind: "food" }
  | { kind: "amount"; row: FoodRow }
  | { kind: "manual"; barcode: string | null }
  | { kind: "scan" }
  | { kind: "water" }
  | { kind: "measurement" }
  | { kind: "measurement-value"; measurement: MeasurementKind }
  | { kind: "workout" };

// Records that keep their full forms, which the palette opens.
export type PaletteRecord = "sleep" | "workout";

export type PaletteSetting = "targets" | "supplements" | "wearables";

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  isToday: boolean;
  onOpenRecord: (kind: PaletteRecord) => void;
  onOpenSetting: (setting: PaletteSetting) => void;
};

const pages = [
  { to: "/", label: "Today", icon: LayoutDashboard },
  { to: "/meals", label: "Meals", icon: BookOpen },
  { to: "/workouts", label: "Workouts", icon: Dumbbell },
  { to: "/overview", label: "Overview", icon: ChartColumn },
  { to: "/progress", label: "Progress", icon: TrendingUp },
  { to: "/review", label: "Review", icon: CalendarRange },
] as const;

const settings = [
  { setting: "targets", label: "Targets", icon: Target },
  { setting: "supplements", label: "Supplements", icon: Pill },
  { setting: "wearables", label: "Wearables", icon: Watch },
] as const;

const waterPresets = [
  { volumeMl: 250, label: "Glass" },
  { volumeMl: 500, label: "Bottle" },
  { volumeMl: 1000, label: "Carafe" },
] as const;

const placeholders: Record<Step["kind"], string> = {
  root: "Log food, water, a measurement… or go to a page",
  food: "Search foods, or type a barcode",
  amount: "",
  manual: "",
  scan: "",
  water: "How much, in ml? e.g. 330",
  measurement: "Which measurement?",
  "measurement-value": "",
  workout: "Pick a routine…",
};

const foodsLabel = (count: number) => `${count} ${count === 1 ? "food" : "foods"}`;

// One keyboard entry point for logging and moving around: Ctrl+K, or the + Log button. It floats over the page
// without dimming it, so the day stays in view while logging. On phones it is a sheet from the bottom, over a
// dimmed page, that starts from big buttons rather than a search.
export function CommandPalette({ open, onOpenChange, ...props }: CommandPaletteProps) {
  // The open step's way back, so Escape leaves a step before it closes the palette.
  const back = useRef<(() => boolean) | null>(null);
  const phone = usePhone();
  const keyboard = useKeyboardInset();
  const sheet = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="bg-transparent max-[680px]:bg-black/40 supports-backdrop-filter:backdrop-blur-none" />
        <DialogPrimitive.Content
          ref={sheet}
          {...stylex.props(styles.palette, styles.keyboardInset(`${keyboard}px`))}
          aria-describedby={undefined}
          // Focusing the search would raise a phone's keyboard over the buttons, so the sheet itself takes focus.
          onOpenAutoFocus={(event) => {
            if (!phone) return;
            event.preventDefault();
            sheet.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (back.current?.()) event.preventDefault();
          }}
        >
          <DialogPrimitive.Title className="sr-only">Log or go to</DialogPrimitive.Title>
          <div {...stylex.props(styles.grab)} aria-hidden />
          <PaletteBody {...props} back={back} close={() => onOpenChange(false)} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

type BodyProps = Omit<CommandPaletteProps, "open" | "onOpenChange"> & { back: RefObject<(() => boolean) | null>; close: () => void };

// Mounts with the palette, so each opening starts at the root, at the current time, with nothing ticked.
function PaletteBody({ date, isToday, onOpenRecord, onOpenSetting, back, close }: BodyProps) {
  const navigate = useNavigate();
  const phone = usePhone();
  const [stack, setStack] = useState<Step[]>([{ kind: "root" }]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState("");
  const [time, setTime] = useState(currentTime);
  const [tray, setTray] = useState<FoodRow[]>([]);
  const step = stack.at(-1) ?? { kind: "root" };
  const list = useRef<HTMLDivElement>(null);

  // Whether the person moved the highlight since typing. Until then it follows the first item, so search results
  // that arrive after typing are what Enter picks.
  const browsed = useRef(false);

  const foods = useFoodOptions(query, step.kind === "food");
  const logFoods = useLogFoods(close);
  const journal = useJournal();
  const target = isToday ? "today" : dateLabel(date);

  // A meal logs on its own, so foods ticked before it stay for their own Log.
  const logMeal = useLogMeal(() => {
    if (tray.length === 0) close();
  });

  function moveTo(next: Step[], nextQuery = "") {
    setStack(next);
    setQuery(nextQuery);
    setActive("");
    browsed.current = false;
  }

  function search(next: string) {
    setQuery(next);
    browsed.current = false;
  }

  // cmdk highlights the first item itself only where it filters, at the root.
  useEffect(() => {
    if (step.kind === "root" || phone || !list.current) return;
    const first = list.current.querySelector("[cmdk-item]:not([data-disabled='true'])")?.getAttribute("data-value");
    const highlighted = list.current.querySelector("[cmdk-item][data-selected='true']");

    if (first && (!highlighted || !browsed.current) && first !== active) setActive(first);
  });

  const push = (next: Step) => moveTo([...stack, next]);

  function pop() {
    if (stack.length === 1) return false;
    moveTo(stack.slice(0, -1));

    return true;
  }

  // Back to the food search, as after setting an amount or adding a food by hand.
  const toFood = (nextQuery = "") => moveTo([{ kind: "root" }, { kind: "food" }], nextQuery);

  useEffect(() => {
    back.current = pop;
  });

  // Adds the row to the selection, or replaces it at its new amount.
  function keep(row: FoodRow): boolean {
    if (tray.some((other) => other.key === row.key)) {
      setTray(tray.map((other) => (other.key === row.key ? row : other)));

      return true;
    }

    if (tray.length >= maxBatchFoods) {
      toast.error(`You can log up to ${maxBatchFoods} foods at once.`);

      return false;
    }

    setTray([...tray, row]);

    return true;
  }

  function toggle(row: FoodRow) {
    if (tray.some((other) => other.key === row.key)) setTray(tray.filter((other) => other.key !== row.key));
    else keep(row);
  }

  function logRows(rows: FoodRow[]) {
    const items = foodItems(rows);

    if (items && items.length > 0) logFoods.mutate({ occurredAt: occurredAt(date, time), timeZone, items });
  }

  function saveRecord(command: RecordCommand, label: string) {
    journal.create.mutate({ ...command, label, signature: `${command.path} ${JSON.stringify(command.input)}`, onSaved: close });
  }

  function saveShortcut(shortcut: PaletteShortcut) {
    const at = { occurredAt: occurredAt(date, time), timeZone };

    if (shortcut.kind === "water") saveRecord({ path: recordPaths.water, input: { ...at, volumeMl: shortcut.volumeMl } }, "Water");
    else saveRecord({ path: recordPaths.measurement, input: { ...at, kind: shortcut.measurement, value: shortcut.value } }, measurementLabels[shortcut.measurement].name);
  }

  function leave(then: () => void) {
    close();
    then();
  }

  // Shift+Enter ticks the highlighted food without leaving the search.
  function listKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") browsed.current = true;

    if (event.key !== "Enter" || !event.shiftKey) return;
    const option = foods.options.get(active);

    if (option) {
      event.preventDefault();
      toggle(option.row);
    }
  }

  // A phone's root keeps its search at the bottom, by the thumb and the keyboard, under its buttons.
  const bottomSearch = phone && step.kind === "root";

  const header = (
    <PaletteHeader
      stack={stack}
      query={query}
      bottom={bottomSearch}
      autoFocus={!phone}
      onQueryChange={search}
      onBack={pop}
      onJump={(depth) => moveTo(stack.slice(0, depth + 1))}
    />
  );

  const when = <TimePicker id="palette-time" value={time} onChange={setTime} onNow={() => setTime(currentTime())} />;

  switch (step.kind) {
    case "amount":
      return (
        <>
          {header}
          <AmountStep
            key={step.row.key}
            row={step.row}
            tray={tray}
            when={when}
            pending={logFoods.isPending}
            onRemove={(key) => setTray(tray.filter((row) => row.key !== key))}
            onKeep={(row) => {
              if (keep(row)) toFood();
            }}
            onLog={(row) => logRows([...tray.filter((other) => other.key !== row.key), row])}
          />
        </>
      );
    case "manual":
      return (
        <>
          {header}
          <div {...stylex.props(styles.form)}>
            <ManualFoodForm
              actionLabel="Add to selection"
              barcode={step.barcode}
              onPick={(food) => {
                if (keep(submittedRow(food, step.barcode ? `barcode:${step.barcode}` : `manual:${crypto.randomUUID()}`))) toFood();
              }}
            />
          </div>
        </>
      );
    case "scan":
      return (
        <>
          {header}
          <div {...stylex.props(styles.form)}>
            <BarcodeScanner onDetected={(code) => toFood(code)} onCancel={pop} />
          </div>
        </>
      );
    case "measurement-value":
      return (
        <>
          {header}
          <MeasurementStep
            measurement={step.measurement}
            when={when}
            pending={journal.create.isPending}
            onSave={(value) => saveRecord(
              { path: recordPaths.measurement, input: { occurredAt: occurredAt(date, time), timeZone, kind: step.measurement, value } },
              measurementLabels[step.measurement].name,
            )}
          />
        </>
      );
  }

  return (
    <Command
      key={stack.length}
      {...stylex.props(styles.command, phone && step.kind === "food" && styles.tall)}
      // The root's items are fixed, so cmdk filters them; the other steps filter or search for themselves.
      shouldFilter={step.kind === "root"}
      value={active}
      onValueChange={setActive}
      onKeyDown={listKeyDown}
      loop
    >
      {!bottomSearch && header}
      {/* Touch has no highlight to move, so a phone shows none. */}
      <ActiveItem.Provider value={phone ? "" : active}>
      <CommandList ref={list} {...stylex.props(styles.list)} onPointerMove={() => (browsed.current = true)}>
        {step.kind === "root" && query !== "" && !parseShortcut(query) && <CommandEmpty {...stylex.props(styles.message)}>Nothing matches “{query}”.</CommandEmpty>}
        {bottomSearch && query === "" && (
          <PhoneLauncher
            onPush={push}
            onScan={() => moveTo([{ kind: "root" }, { kind: "food" }, { kind: "scan" }])}
            onRecent={(row) => moveTo([{ kind: "root" }, { kind: "food" }, { kind: "amount", row }])}
            onSleep={() => leave(() => onOpenRecord("sleep"))}
          />
        )}
        {step.kind === "root" && (!bottomSearch || query !== "") && (
          <RootItems
            query={query}
            pending={journal.create.isPending}
            onPush={push}
            onShortcut={saveShortcut}
            onRecord={(kind) => leave(() => onOpenRecord(kind))}
            onSetting={(setting) => leave(() => onOpenSetting(setting))}
            onGo={(to) => leave(() => void navigate({ to }))}
          />
        )}
        {step.kind === "food" && (
          <FoodItems
            foods={foods}
            query={query}
            tray={tray}
            phone={phone}
            pending={logFoods.isPending || logMeal.isPending}
            onPick={(row) => push({ kind: "amount", row: tray.find((other) => other.key === row.key) ?? row })}
            onToggle={toggle}
            onLogTray={() => logRows(tray)}
            onLogMeal={(meal) => logMeal.mutate({
              meal,
              input: { occurredAt: occurredAt(date, time), timeZone, items: meal.items.map(({ id, food }) => ({ id, amount: food.quantity.amount })) },
            })}
            onManual={(barcode) => push({ kind: "manual", barcode })}
            onScan={() => push({ kind: "scan" })}
          />
        )}
        {step.kind === "water" && (
          <WaterItems
            query={query}
            pending={journal.create.isPending}
            onSave={(volumeMl) => saveRecord({ path: recordPaths.water, input: { occurredAt: occurredAt(date, time), timeZone, volumeMl } }, "Water")}
          />
        )}
        {step.kind === "measurement" && (
          <PaletteGroup heading="Measurement" forceMount>
            {!measurementKinds.some((measurement) => nameMatches(measurementLabels[measurement].name, query)) && (
              <p {...stylex.props(styles.groupMessage)}>Nouri records weight, height, body fat, and waist.</p>
            )}
            {measurementKinds.filter((measurement) => nameMatches(measurementLabels[measurement].name, query)).map((measurement) => (
              <PaletteItem
                key={measurement}
                value={measurement}
                icon={<Ruler size={14} />}
                name={measurementLabels[measurement].name}
                aside={measurementLabels[measurement].unit}
                onSelect={() => push({ kind: "measurement-value", measurement })}
              />
            ))}
          </PaletteGroup>
        )}
        {step.kind === "workout" && (
          <WorkoutItems
            query={query}
            onStarted={() => leave(() => void navigate({ to: "/workouts/session" }))}
            onPastActivity={() => leave(() => onOpenRecord("workout"))}
          />
        )}
      </CommandList>
      </ActiveItem.Provider>
      {bottomSearch && header}
      {phone && step.kind === "food" ? (
        // Phones tick foods by tapping them, then log them all from here.
        <div {...stylex.props(styles.footer, styles.logBar)}>
          {when}
          <Button type="button" {...stylex.props(styles.logBarButton)} disabled={tray.length === 0 || logFoods.isPending} onClick={() => logRows(tray)}>
            {tray.length === 0 ? "Tap foods to tick them" : `Log ${foodsLabel(tray.length)} · ${format(rowsKcal(tray))} kcal`}
          </Button>
        </div>
      ) : (!phone || step.kind === "water") && (
        <div {...stylex.props(styles.footer)}>
          <Hint keys={["↑", "↓"]} label="move" />
          <Hint keys={["↵"]} label={step.kind === "food" ? "set amount" : "choose"} />
          {step.kind === "food" && <Hint keys={["Shift", "↵"]} label="tick" />}
          {step.kind !== "root" && <Hint keys={["Esc"]} label="back" />}
          {(step.kind === "food" || step.kind === "water") && (
            <span {...stylex.props(styles.footerEnd)}>Logging to {target} at {when}</span>
          )}
        </div>
      )}
    </Command>
  );
}

function stepChip(step: Step): { label: string; icon: ReactNode } | null {
  switch (step.kind) {
    case "root": return null;
    case "food": return { label: "Food", icon: <UtensilsCrossed size={13} /> };
    case "amount": return { label: step.row.food.name, icon: null };
    case "manual": return { label: step.barcode ? "Add product" : "Add manually", icon: <PencilLine size={13} /> };
    case "scan": return { label: "Scan barcode", icon: <ScanBarcode size={13} /> };
    case "water": return { label: "Water", icon: <Droplet size={13} /> };
    case "measurement": return { label: "Measurement", icon: <Ruler size={13} /> };
    case "measurement-value": return { label: measurementLabels[step.measurement].name, icon: null };
    case "workout": return { label: "Workout", icon: <Dumbbell size={13} /> };
  }
}

const formSteps = new Set<Step["kind"]>(["amount", "manual", "scan", "measurement-value"]);

// Back, the steps taken so far as chips, then this step's search. An earlier chip goes back to its step.
function PaletteHeader({ stack, query, bottom, autoFocus, onQueryChange, onBack, onJump }: {
  stack: Step[];
  query: string;
  bottom: boolean;
  autoFocus: boolean;
  onQueryChange: (query: string) => void;
  onBack: () => void;
  onJump: (depth: number) => void;
}) {
  const step = stack.at(-1) ?? { kind: "root" };

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && query === "" && stack.length > 1) {
      event.preventDefault();
      onBack();
    }
  }

  return (
    <div {...stylex.props(styles.header, bottom && styles.headerBottom)}>
      {stack.length > 1 ? (
        <Button type="button" variant="ghost" size="icon-sm" {...stylex.props(styles.backButton)} aria-label="Back" title="Back (Esc)" onClick={onBack}>
          <ArrowLeft size={16} />
        </Button>
      ) : (
        <Search size={17} {...stylex.props(styles.headerIcon)} />
      )}
      {stack.map((taken, depth) => {
        const chip = stepChip(taken);

        if (!chip) return null;

        return depth < stack.length - 1 ? (
          <button key={depth} type="button" {...stylex.props(styles.scope, styles.scopeButton)} title={`Back to ${chip.label}`} onClick={() => onJump(depth)}>
            {chip.icon}{chip.label}
          </button>
        ) : (
          <span key={depth} {...stylex.props(styles.scope)}>{chip.icon}{chip.label}</span>
        );
      })}
      {!formSteps.has(step.kind) && (
        // cmdk's own input, without the search box shadcn wraps it in, so it sits beside the chips.
        <CommandPrimitive.Input
          {...stylex.props(styles.query)}
          value={query}
          onValueChange={onQueryChange}
          onKeyDown={keyDown}
          placeholder={bottom ? "Search, or type “weight 82.4”" : placeholders[step.kind]}
          aria-label={placeholders[step.kind]}
          autoFocus={autoFocus}
        />
      )}
    </div>
  );
}

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span {...stylex.props(styles.hint)}>
      {keys.map((key) => <Kbd key={key} {...stylex.props(styles.key)}>{key}</Kbd>)}
      {label}
    </span>
  );
}

// The highlighted item's value, so items can style themselves as cmdk moves the highlight.
const ActiveItem = createContext("");

function PaletteGroup({ heading, forceMount, children }: { heading: string; forceMount?: boolean; children: ReactNode }) {
  return (
    <CommandGroup heading={<span {...stylex.props(styles.groupHeading)}>{heading}</span>} forceMount={forceMount}>
      {children}
    </CommandGroup>
  );
}

function PaletteItem({ value, icon, lead, name, meta, aside, keywords, forceMount, disabled, onSelect }: {
  value: string;
  icon?: ReactNode;
  // Stands in for the icon, such as a food's tick box.
  lead?: ReactNode;
  name: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  keywords?: string[];
  forceMount?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const selected = useContext(ActiveItem) === value;

  return (
    <CommandItem
      {...stylex.props(styles.item, selected && styles.itemSelected)}
      value={value}
      keywords={keywords}
      forceMount={forceMount}
      disabled={disabled}
      onSelect={onSelect}
    >
      {lead}
      {icon && <span {...stylex.props(styles.itemIcon, selected && styles.itemIconSelected)}>{icon}</span>}
      <span {...stylex.props(styles.itemText)}>
        <span {...stylex.props(styles.itemName)}>{name}</span>
        {meta && <span {...stylex.props(styles.itemMeta)}>{meta}</span>}
      </span>
      {aside && <span {...stylex.props(styles.itemAside)}>{aside}</span>}
    </CommandItem>
  );
}

// The typed words in the name, marked, as the search matched them.
function Highlighted({ name, query }: { name: string; query: string }) {
  const words = query.trim().split(/\s+/).filter(Boolean).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  if (words.length === 0) return name;

  return name.split(new RegExp(`(${words.join("|")})`, "gi")).map((part, index) => (
    index % 2 === 1 ? <mark key={index} {...stylex.props(styles.mark)}>{part}</mark> : part
  ));
}

// A phone's root before anything is typed: the common logs as big buttons, then recent foods to log again.
function PhoneLauncher({ onPush, onScan, onRecent, onSleep }: {
  onPush: (step: Step) => void;
  onScan: () => void;
  onRecent: (row: FoodRow) => void;
  onSleep: () => void;
}) {
  const recent = useRecentFoods();

  const tiles = [
    { label: "Food", icon: UtensilsCrossed, tint: styles.tintFood, onClick: () => onPush({ kind: "food" }) },
    { label: "Water", icon: Droplet, tint: styles.tintWater, onClick: () => onPush({ kind: "water" }) },
    { label: "Scan", icon: ScanBarcode, tint: styles.tintScan, onClick: onScan },
    { label: "Weight", icon: Weight, tint: styles.tintWeight, onClick: () => onPush({ kind: "measurement-value", measurement: "weight" }) },
    { label: "Workout", icon: Dumbbell, tint: styles.tintWorkout, onClick: () => onPush({ kind: "workout" }) },
    { label: "Sleep", icon: Moon, tint: styles.tintSleep, onClick: onSleep },
  ];

  return (
    <div {...stylex.props(styles.launcher)}>
      <div {...stylex.props(styles.tiles)}>
        {tiles.map(({ label, icon: Icon, tint, onClick }) => (
          <button key={label} type="button" {...stylex.props(styles.tile, tint)} onClick={onClick}>
            <Icon size={22} />
            {label}
          </button>
        ))}
      </div>
      {(recent.data ?? []).length > 0 && (
        <>
          <p {...stylex.props(styles.groupHeading, styles.launcherHeading)}>Log again</p>
          <div {...stylex.props(styles.chips)}>
            {(recent.data ?? []).slice(0, 6).map(({ entryId, food }) => (
              <button
                key={entryId}
                type="button"
                {...stylex.props(styles.chip)}
                onClick={() => onRecent({ ...draftRow({ kind: "entry", entryId }, food), key: `entry:${entryId}` })}
              >
                {food.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RootItems({ query, pending, onPush, onShortcut, onRecord, onSetting, onGo }: {
  query: string;
  pending: boolean;
  onPush: (step: Step) => void;
  onShortcut: (shortcut: PaletteShortcut) => void;
  onRecord: (kind: PaletteRecord) => void;
  onSetting: (setting: PaletteSetting) => void;
  onGo: (to: (typeof pages)[number]["to"]) => void;
}) {
  const shortcut = parseShortcut(query);

  return (
    <>
      {shortcut && (
        <PaletteGroup heading="Quick log" forceMount>
          <PaletteItem
            value="shortcut"
            forceMount
            disabled={pending}
            icon={shortcut.kind === "water" ? <Droplet size={14} /> : <Zap size={14} />}
            name={shortcut.kind === "water"
              ? <>Add <strong>{shortcut.volumeMl} ml</strong> of water</>
              : <>Log {measurementLabels[shortcut.measurement].name.toLowerCase()} <strong>{format(shortcut.value, 1)} {measurementLabels[shortcut.measurement].unit}</strong></>}
            aside={<Kbd {...stylex.props(styles.desktopOnly)}>↵</Kbd>}
            onSelect={() => onShortcut(shortcut)}
          />
        </PaletteGroup>
      )}
      <PaletteGroup heading="Log">
        <PaletteItem value="Log food" keywords={["eat", "meal", "breakfast", "lunch", "dinner", "snack"]} icon={<UtensilsCrossed size={14} />} name="Log food" onSelect={() => onPush({ kind: "food" })} />
        <PaletteItem value="Add water" keywords={["drink"]} icon={<Droplet size={14} />} name="Add water" onSelect={() => onPush({ kind: "water" })} />
        <PaletteItem value="Log measurement" keywords={["weight", "waist", "body fat", "height"]} icon={<Ruler size={14} />} name="Log measurement" onSelect={() => onPush({ kind: "measurement" })} />
        <PaletteItem value="Start workout" keywords={["exercise", "routine", "gym", "train"]} icon={<Dumbbell size={14} />} name="Start workout" onSelect={() => onPush({ kind: "workout" })} />
        <PaletteItem value="Log sleep" keywords={["bed", "night"]} icon={<Moon size={14} />} name="Log sleep" onSelect={() => onRecord("sleep")} />
      </PaletteGroup>
      <PaletteGroup heading="Go to">
        {pages.map(({ to, label, icon: Icon }) => (
          <PaletteItem key={to} value={`Go to ${label}`} icon={<Icon size={14} />} name={label} onSelect={() => onGo(to)} />
        ))}
      </PaletteGroup>
      <PaletteGroup heading="Settings">
        {settings.map(({ setting, label, icon: Icon }) => (
          <PaletteItem key={setting} value={label} icon={<Icon size={14} />} name={label} onSelect={() => onSetting(setting)} />
        ))}
      </PaletteGroup>
    </>
  );
}

// A food the search offers, as the row it would add to the selection.
type FoodOption = { value: string; row: FoodRow; meta: string | null };

function submittedRow(food: FoodInput["food"], key: string): FoodRow {
  return { ...draftRow({ kind: "submitted", food }, recordedFood(food)), key };
}

// A catalog food starts at one serving, or 100 g or ml.
function choiceRow(choice: Choice): FoodRow {
  const { submitted, preview } = portionFood(choice.source, choice.serving?.amount ?? 100);

  return { ...draftRow({ kind: "submitted", food: submitted }, preview), key: choice.key };
}

function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

// Recent foods and saved meals filtered as you type, and Nouri's foods and Ciqual searched once typing pauses.
function useFoodOptions(query: string, enabled: boolean) {
  const recentQuery = useRecentFoods();
  const mealsQuery = useSavedMeals();
  const term = useDebounced(query.trim(), 250);

  // Digits are a barcode, never a name, so a mistyped code says so instead of finding no foods.
  const badBarcode = /^\d+$/.test(term) && !isBarcode(term);

  const search = useQuery({
    queryKey: ["foods", term],
    queryFn: () => findChoices(term),
    enabled: enabled && !badBarcode && term.length >= 2,
    retry: retryOutage,
  });

  const recent: FoodOption[] = (recentQuery.data ?? [])
    .filter((food) => nameMatches(food.food.name, query))
    .slice(0, query ? 8 : 6)
    .map(({ entryId, food }) => ({
      value: `recent:${entryId}`,
      row: { ...draftRow({ kind: "entry", entryId }, food), key: `entry:${entryId}` },
      meta: null,
    }));

  const catalog: FoodOption[] = term.length >= 2 ? (search.data?.choices ?? []).slice(0, 12).map((choice) => ({
    value: `catalog:${choice.key}`,
    row: choiceRow(choice),
    meta: [isUserAdded(choice.source.basis) && "User-added", choice.brand].filter(Boolean).join(" · ") || null,
  })) : [];

  const meals = (mealsQuery.data ?? []).filter((meal) => nameMatches(meal.name, query)).slice(0, 5);

  const notFound = search.error instanceof ApiError && search.error.status === 404;

  const catalogMessage = term.length < 2 ? null
    : badBarcode ? "That barcode's numbers don't add up. Check it and try again."
    : search.isFetching ? "Searching foods…"
    : notFound ? "No product with this barcode yet."
    : search.isError ? search.error.message
    : catalog.length === 0 ? "No foods found. Try another name."
    : null;

  return {
    recent,
    catalog,
    meals,
    catalogMessage,
    unknownBarcode: notFound ? term : null,
    attribution: (search.data?.attribution ?? []).filter((source) => source.provider !== "ciqual"),
    options: new Map([...recent, ...catalog].map((option) => [option.value, option])),
  };
}

function FoodItems({ foods, query, tray, phone, pending, onPick, onToggle, onLogTray, onLogMeal, onManual, onScan }: {
  foods: ReturnType<typeof useFoodOptions>;
  query: string;
  tray: FoodRow[];
  // Phones tick a food when it is tapped, and open its amount from the amount on the right.
  phone: boolean;
  pending: boolean;
  onPick: (row: FoodRow) => void;
  onToggle: (row: FoodRow) => void;
  onLogTray: () => void;
  onLogMeal: (meal: SavedMeal) => void;
  onManual: (barcode: string | null) => void;
  onScan: () => void;
}) {
  const ticked = (row: FoodRow) => tray.some((other) => other.key === row.key);

  // A phone lists ticked foods under Selected instead, until a search.
  const recent = phone && !query ? foods.recent.filter((food) => !ticked(food.row)) : foods.recent;

  const option = (food: FoodOption) => {
    const on = ticked(food.row);
    // At its ticked amount, if it has been changed.
    const { quantity, nutrients } = rowFood(food.row);

    return (
      <PaletteItem
        key={food.value}
        value={food.value}
        lead={
          <button
            type="button"
            role="checkbox"
            aria-checked={on}
            aria-label={`Tick ${food.row.food.name}`}
            {...stylex.props(styles.box, on && styles.boxOn)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onToggle(food.row);
            }}
          >
            {/* The size class opts out of the item's 16px icon size, and the colour holds on the highlighted row. */}
            {on && <Check className="size-[11px] text-primary-foreground!" strokeWidth={3} />}
          </button>
        }
        name={<Highlighted name={food.row.food.name} query={query} />}
        meta={phone ? [food.meta, `${format(nutrients.kcal)} kcal`].filter(Boolean).join(" · ") : food.meta}
        aside={phone ? (
          <button
            type="button"
            {...stylex.props(styles.amountButton)}
            aria-label={`Change the amount of ${food.row.food.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onPick(food.row);
            }}
          >
            {format(quantity.amount)} {unitLabels[quantity.unit]} <ChevronRight size={14} />
          </button>
        ) : `${format(quantity.amount)} ${unitLabels[quantity.unit]} · ${format(nutrients.kcal)} kcal`}
        onSelect={() => (phone ? onToggle(food.row) : onPick(food.row))}
      />
    );
  };

  return (
    <>
      {tray.length > 0 && !query && !phone && (
        <PaletteGroup heading="Selected">
          <PaletteItem
            value="log-tray"
            disabled={pending}
            icon={<ListChecks size={14} />}
            name={`Log ${foodsLabel(tray.length)}`}
            meta={tray.map((row) => rowFood(row).name).join(", ")}
            aside={`${format(rowsKcal(tray))} kcal`}
            onSelect={onLogTray}
          />
        </PaletteGroup>
      )}
      {phone && tray.length > 0 && !query && (
        // What is ticked, whether or not the list shows it, such as a food added by hand.
        <PaletteGroup heading="Selected">
          {tray.map((row) => option({ value: `selected:${row.key}`, row, meta: null }))}
        </PaletteGroup>
      )}
      {recent.length > 0 && (
        <PaletteGroup heading="Recent">{recent.map(option)}</PaletteGroup>
      )}
      {foods.meals.length > 0 && (
        <PaletteGroup heading="Saved meals">
          {foods.meals.map((meal) => (
            <PaletteItem
              key={meal.id}
              value={`meal:${meal.id}`}
              disabled={pending}
              icon={<History size={14} />}
              name={meal.name}
              meta={`${foodsLabel(meal.items.length)}${meal.daily ? ` · every day at ${meal.daily.time}` : ""}`}
              aside={`${format(totalNutrients(meal.items.map(({ food }) => food.nutrients)).kcal)} kcal`}
              onSelect={() => onLogMeal(meal)}
            />
          ))}
        </PaletteGroup>
      )}
      {(foods.catalog.length > 0 || foods.catalogMessage) && (
        <PaletteGroup heading="Foods" forceMount>
          {foods.catalog.map(option)}
          {foods.catalogMessage && <p {...stylex.props(styles.groupMessage)}>{foods.catalogMessage}</p>}
          {foods.attribution.map((source) => (
            // Open Food Facts' licence asks for its credit next to the results.
            <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer" {...stylex.props(styles.groupMessage)}>Source: {source.label}</a>
          ))}
        </PaletteGroup>
      )}
      <PaletteGroup heading="More" forceMount>
        {foods.unknownBarcode && (
          <PaletteItem value="add-product" forceMount icon={<PencilLine size={14} />} name="Add this product from its label" meta="Others who scan it will find it" onSelect={() => onManual(foods.unknownBarcode)} />
        )}
        <PaletteItem value="manual" forceMount icon={<PencilLine size={14} />} name="Add a food manually" meta="Type its nutrition label" onSelect={() => onManual(null)} />
        <PaletteItem value="scan" forceMount icon={<ScanBarcode size={14} />} name="Scan a barcode" onSelect={onScan} />
      </PaletteGroup>
    </>
  );
}

// The chosen food at an amount. Enter logs it with everything ticked; Ctrl+Enter keeps it and goes back for more.
function AmountStep({ row, tray, when, pending, onRemove, onKeep, onLog }: {
  row: FoodRow;
  tray: FoodRow[];
  when: ReactNode;
  pending: boolean;
  onRemove: (key: string) => void;
  onKeep: (row: FoodRow) => void;
  onLog: (row: FoodRow) => void;
}) {
  const [amount, setAmount] = useState(row.amount);
  const current = { ...row, amount };
  const usable = typedAmount(amount) !== null;
  const others = tray.filter((other) => other.key !== row.key);
  const unit = unitLabels[row.food.quantity.unit];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (usable) onLog(current);
  }

  function keyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();

    if (usable) onKeep(current);
  }

  return (
    <form {...stylex.props(styles.form)} onSubmit={submit} onKeyDown={keyDown}>
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="palette-amount" {...stylex.props(styles.fieldLabel)}>Amount</Label>
        <span {...stylex.props(styles.amount)}>
          <Input
            id="palette-amount"
            {...stylex.props(styles.amountInput)}
            type="number"
            inputMode="decimal"
            min="0.001"
            max="10000"
            step="0.001"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            autoFocus
            required
          />
          {unit}
        </span>
      </div>
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.fieldLabel)}>Time</span>
        <span>{when}</span>
      </div>
      <p {...stylex.props(styles.preview)}>{usable ? nutrientLine(rowFood(current).nutrients) : "Type an amount above zero."}</p>
      {others.length > 0 && (
        <div {...stylex.props(styles.tray)}>
          Also logging:
          {others.map((other) => (
            <span key={other.key} {...stylex.props(styles.trayChip)}>
              {other.food.name} · {other.amount} {unitLabels[other.food.quantity.unit]}
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${other.food.name}`} onClick={() => onRemove(other.key)}>
                <X />
              </Button>
            </span>
          ))}
        </div>
      )}
      <div {...stylex.props(styles.actions)}>
        <Button type="button" variant="outline" disabled={!usable} onClick={() => onKeep(current)}>
          Add another <Kbd {...stylex.props(styles.desktopOnly)}>Ctrl ↵</Kbd>
        </Button>
        <Button type="submit" disabled={pending || !usable}>
          Log {foodsLabel(others.length + 1)} · {format(rowsKcal([...others, current]))} kcal
        </Button>
      </div>
    </form>
  );
}

function MeasurementStep({ measurement, when, pending, onSave }: { measurement: MeasurementKind; when: ReactNode; pending: boolean; onSave: (value: number) => void }) {
  const [value, setValue] = useState("");
  const { name, unit, step } = measurementLabels[measurement];
  const limits = measurementLimits[measurement];

  // The browser checks the range before this runs.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(Number(value));
  }

  return (
    <form {...stylex.props(styles.form)} onSubmit={submit}>
      <div {...stylex.props(styles.field)}>
        <Label htmlFor="palette-measurement" {...stylex.props(styles.fieldLabel)}>{name}</Label>
        <span {...stylex.props(styles.amount)}>
          <Input
            id="palette-measurement"
            {...stylex.props(styles.amountInput)}
            type="number"
            inputMode="decimal"
            min={limits.min}
            max={limits.max}
            step={step}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            required
          />
          {unit}
        </span>
      </div>
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.fieldLabel)}>Time</span>
        <span>{when}</span>
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : `Save ${name.toLowerCase()}`}</Button>
      </div>
    </form>
  );
}

function WaterItems({ query, pending, onSave }: { query: string; pending: boolean; onSave: (volumeMl: number) => void }) {
  const typed = Number(query.trim().replace(/\s*ml$/i, ""));
  const custom = query.trim() !== "" && Number.isInteger(typed) && typed >= 1 && typed <= 5000 ? typed : null;

  return (
    <PaletteGroup heading="Water">
      {custom !== null && (
        <PaletteItem value={`water:${custom}`} disabled={pending} icon={<Droplet size={14} />} name={`Add ${custom} ml`} onSelect={() => onSave(custom)} />
      )}
      {waterPresets.map(({ volumeMl, label }) => (
        <PaletteItem key={volumeMl} value={`water:preset:${volumeMl}`} disabled={pending} icon={<Droplet size={14} />} name={label} aside={`${volumeMl} ml`} onSelect={() => onSave(volumeMl)} />
      ))}
    </PaletteGroup>
  );
}

// Starting opens the live workout. One already in progress is resumed instead, so its sets are never lost.
function WorkoutItems({ query, onStarted, onPastActivity }: { query: string; onStarted: () => void; onPastActivity: () => void }) {
  const workout = useWorkoutSession();
  const routines = useRoutines();
  const session = workout.session;

  function start(routine: Parameters<typeof workout.start>[0]) {
    const result = workout.start(routine);

    if (result.outcome === "in-progress") toast.info(`${result.session.title} is still open, so it was resumed.`);
    onStarted();
  }

  return (
    <>
      {session && (
        <PaletteGroup heading="In progress">
          <PaletteItem value="resume" icon={<Play size={14} />} name={`Resume ${session.title}`} onSelect={onStarted} />
        </PaletteGroup>
      )}
      <PaletteGroup heading="Routines" forceMount>
        {routines.data?.length === 0 && <p {...stylex.props(styles.groupMessage)}>No routines yet. Build them on the Workouts page.</p>}
        {(routines.data ?? []).filter((routine) => nameMatches(routine.name, query)).map((routine) => (
          <PaletteItem
            key={routine.id}
            value={`routine:${routine.id}`}
            icon={<Play size={14} />}
            name={routine.name}
            aside={`${routine.exercises.length} ${routine.exercises.length === 1 ? "exercise" : "exercises"}`}
            onSelect={() => start(routine)}
          />
        ))}
        {routines.isPending && <p {...stylex.props(styles.groupMessage)}>Loading your routines…</p>}
      </PaletteGroup>
      <PaletteGroup heading="Other">
        <PaletteItem value="empty-workout" icon={<Play size={14} />} name="Start an empty workout" onSelect={() => start(null)} />
        <PaletteItem value="past-activity" icon={<History size={14} />} name="Log a past activity" meta="A run, a walk, or a workout already done" onSelect={onPastActivity} />
      </PaletteGroup>
    </>
  );
}
