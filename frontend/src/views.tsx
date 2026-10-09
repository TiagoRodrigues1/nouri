import * as stylex from "@stylexjs/stylex";
import { styles } from "./dashboard-styles";
import { useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  CalendarRange,
  ChartColumn,
  CookingPot,
  Droplet,
  Dumbbell,
  Moon,
  Pill,
  Ruler,
  SlidersHorizontal,
  Target,
  TrendingUp,
  UtensilsCrossed,
  Watch,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { DatePicker } from "./components/ui/date-picker";
import { UserButton, useUser } from "@clerk/react";
import { createFood, deleteFood } from "./lib/api";
import { dateLabel, localDate, occurredAt, shiftDate, weekLabel, timeZone as zone } from "./lib/time";
import { useIdempotentWrite, useIdempotentDelete } from "./lib/use-idempotent";
import { queryRefresh } from "./lib/query-refresh";
import { useConnection } from "./lib/use-connection";
import { submissionSchema, type FoodSubmission } from "../../src/food/contract";
import { LogFoodDialog } from "./log-food-dialog";
import { EditFoodDialog } from "./edit-food-dialog";
import { TargetsDialog } from "./targets-dialog";
import { SupplementsDialog } from "./supplements-dialog";
import { WearablesDialog } from "./wearables-dialog";
import { dashboardPageContext, useDashboardPage } from "./dashboard-page-context";
import { MeasurementDialog, SleepDialog, WaterDialog, WorkoutDialog } from "./overview-dialogs";
import { useJournal } from "./overview/use-journal";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import type { FoodEntry, RecordCommand } from "./lib/api";
import { recordPaths } from "../../src/journal/paths";

const dateKey = "nouri.selectedDate";

const now = () => localDate(new Date());

type FoodInput = FoodSubmission["food"];

type View = "today" | "meals" | "overview" | "progress" | "review";

type PendingFood = { input: FoodSubmission; signature: string };

type RecordKind = "water" | "workout" | "sleep" | "measurement";

function useView(): View {
  const path = useLocation({ select: (location) => location.pathname });

  return path.startsWith("/meals") ? "meals" : path === "/overview" ? "overview" : path === "/progress" ? "progress" : path === "/review" ? "review" : "today";
}

export function Dashboard() {
  const view = useView();
  const navigate = useNavigate();
  const search = useSearch({ strict: false });
  const today = now();

  const { user } = useUser();

  const [storedDate, setStoredDate] = useState(
    () => sessionStorage.getItem(dateKey) || today,
  );

  // Review owns its window end in the URL; Today, Overview, and Progress share the remembered day.
  const reviewing = view === "review";
  const date = reviewing ? search.to ?? today : search.date ?? storedDate;
  const isToday = date === today;

  useEffect(() => {
    if (!search.date) return;

    sessionStorage.setItem(dateKey, search.date);
    setStoredDate(search.date);
  }, [search.date]);

  const [logOpen, setLogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [logMenuOpen, setLogMenuOpen] = useState(false);
  const [recordDialog, setRecordDialog] = useState<RecordKind | null>(null);
  const [customizingCards, setCustomizingCards] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [supplementsOpen, setSupplementsOpen] = useState(false);
  const [wearablesOpen, setWearablesOpen] = useState(false);

  const journal = useJournal();

  const googleHealth = useConnection("google-health", wearablesOpen);

  const foodDelete = useIdempotentDelete<FoodEntry>((entry, key) => deleteFood(entry, key), {
    refresh: queryRefresh.food, success: () => "Food removed from your log.",
  });

  const createMutation = useIdempotentWrite<PendingFood>((pending, key) => createFood(key, pending.input), {
    refresh: queryRefresh.food, success: () => "Food added to your log.", onSuccess: () => setLogOpen(false),
    signature: (pending) => pending.signature,
  });

  function saveFood(food: FoodInput, time: string) {
    createMutation.mutate({
      input: submissionSchema.parse({ occurredAt: occurredAt(date, time), timeZone: zone, food }),
      signature: JSON.stringify({ date, time, zone, food }),
    });
  }

  function openLog(kind: "food" | RecordKind) {
    setLogMenuOpen(false);

    if (kind === "food") setLogOpen(true);
    else setRecordDialog(kind);
  }

  function saveRecord(command: RecordCommand, label: string) {
    journal.create.mutate({ ...command, label, signature: `${command.path} ${JSON.stringify(command.input)}`, onSaved: () => setRecordDialog(null) });
  }

  return (
    <dashboardPageContext.Provider value={{ date, isToday, onEditFood: (entry) => setEditingId(entry.id), onSaveMeal: () => void navigate({ to: "/meals/new", search: { date } }), foodDelete, journal, onManageSupplements: () => setSupplementsOpen(true), customizingCards, onCustomizingCardsChange: setCustomizingCards }}>
    <div {...stylex.props(styles.appShell)}>
      <aside {...stylex.props(styles.sidebar)}>
        <Link to="/" {...stylex.props(styles.brand)}>
          <span {...stylex.props(styles.brandIcon)}>
            <UtensilsCrossed size={17} strokeWidth={2.5} />
          </span>
          <span>NOURI</span>
        </Link>
        <Popover open={logMenuOpen} onOpenChange={setLogMenuOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" {...stylex.props(styles.logButton)} aria-expanded={logMenuOpen}>
              + Log
            </Button>
          </PopoverTrigger>
          <PopoverContent {...stylex.props(styles.logMenu)} align="start" sideOffset={8}>
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("food")}><UtensilsCrossed size={17} /> Food</button>
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("water")}><Droplet size={17} /> Water</button>
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("sleep")}><Moon size={17} /> Sleep</button>
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("workout")}><Dumbbell size={17} /> Exercise</button>
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("measurement")}><Ruler size={17} /> Measurement</button>
          </PopoverContent>
        </Popover>
        <nav {...stylex.props(styles.sidebarNav)} aria-label="Main navigation">
          <Link
            to="/"
            {...stylex.props(styles.navItem, view === "today" && styles.navItemActive)}
          >
            <LayoutDashboard size={17} {...stylex.props(view === "today" && styles.iconAccent)} />
            Today
          </Link>
          <Link
            to="/meals"
            {...stylex.props(styles.navItem, view === "meals" && styles.navItemActive)}
          >
            <CookingPot size={17} {...stylex.props(view === "meals" && styles.iconAccent)} />
            Meals
          </Link>
          <Link
            to="/overview"
            {...stylex.props(styles.navItem, view === "overview" && styles.navItemActive)}
          >
            <ChartColumn size={17} {...stylex.props(view === "overview" && styles.iconAccent)} />
            Overview
          </Link>
          <Link
            to="/progress"
            {...stylex.props(styles.navItem, view === "progress" && styles.navItemActive)}
          >
            <TrendingUp size={17} {...stylex.props(view === "progress" && styles.iconAccent)} />
            Progress
          </Link>
          <Link
            to="/review"
            {...stylex.props(styles.navItem, view === "review" && styles.navItemActive)}
          >
            <CalendarRange size={17} {...stylex.props(view === "review" && styles.iconAccent)} />
            Review
          </Link>
          <p {...stylex.props(styles.navCaption, styles.navCaptionData)}>SETTINGS</p>
          <button
            type="button"
            {...stylex.props(styles.navItem, targetsOpen && styles.navItemActive)}
            onClick={() => setTargetsOpen(true)}
          >
            <Target size={17} {...stylex.props(targetsOpen && styles.iconAccent)} />
            Targets
          </button>
          <button
            type="button"
            {...stylex.props(styles.navItem, supplementsOpen && styles.navItemActive)}
            onClick={() => setSupplementsOpen(true)}
          >
            <Pill size={17} {...stylex.props(supplementsOpen && styles.iconAccent)} />
            Supplements
          </button>
          <button
            type="button"
            {...stylex.props(styles.navItem, wearablesOpen && styles.navItemActive)}
            onClick={() => setWearablesOpen(true)}
          >
            <Watch size={17} {...stylex.props(wearablesOpen && styles.iconAccent)} />
            Wearables
          </button>
        </nav>
        <div {...stylex.props(styles.sidebarBottom)}>
          <div {...stylex.props(styles.profile)}>
            <UserButton />
            <div {...stylex.props(styles.profileName)}>
              <strong {...stylex.props(styles.profileText)}>{user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Your account"}</strong>
              {user?.fullName && <small {...stylex.props(styles.profileText, styles.profileSubtext)}>{user.primaryEmailAddress?.emailAddress}</small>}
            </div>
          </div>
        </div>
      </aside>
      <main {...stylex.props(styles.mainArea)}>
        <div {...stylex.props(styles.pageContent)}>
          <Outlet />
        </div>
      </main>
      <TargetsDialog open={targetsOpen} onOpenChange={setTargetsOpen} />
      <SupplementsDialog open={supplementsOpen} onOpenChange={setSupplementsOpen} />
      <WearablesDialog open={wearablesOpen} onOpenChange={setWearablesOpen} connection={googleHealth} />
      <LogFoodDialog open={logOpen} onOpenChange={setLogOpen} date={date} isToday={isToday} pending={createMutation.isPending} onSave={saveFood} />
      <EditFoodDialog date={date} entryId={editingId} onClose={() => setEditingId(null)} />
      <WaterDialog open={recordDialog === "water"} onOpenChange={(open) => setRecordDialog(open ? "water" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.water, input }, "Water")} />
      <WorkoutDialog open={recordDialog === "workout"} onOpenChange={(open) => setRecordDialog(open ? "workout" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.workout, input }, "Workout")} />
      <SleepDialog open={recordDialog === "sleep"} onOpenChange={(open) => setRecordDialog(open ? "sleep" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.sleep, input }, "Sleep")} />
      <MeasurementDialog open={recordDialog === "measurement"} onOpenChange={(open) => setRecordDialog(open ? "measurement" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.measurement, input }, "Measurement")} />
    </div>
    </dashboardPageContext.Provider>
  );
}

// The day pages' heading: the day or week shown and the controls that move it. Meals are not tied to a day, so
// their routes sit outside this layout.
export function DayLayout() {
  const { date, isToday, onCustomizingCardsChange } = useDashboardPage();
  const view = useView();
  const navigate = useNavigate();
  const reviewing = view === "review";
  const step = reviewing ? 7 : 1;
  const unit = reviewing ? "week" : "day";

  // Stays on the page and keeps its other search params; the review names the last day of its week `to`.
  function pickDate(next: string) {
    void navigate({ to: ".", search: (previous) => ({ ...previous, [reviewing ? "to" : "date"]: next }) });
    toast.dismiss();
  }

  return (
    <>
      <header {...stylex.props(styles.dayHeader)}>
        <h1 {...stylex.props(styles.dayHeadline)}>{reviewing ? weekLabel(date, isToday) : isToday ? "Today" : dateLabel(date)}</h1>
        <div {...stylex.props(styles.dateActions)}>
          {view === "today" && (
            <Button variant="outline" size="icon" aria-label="Customize cards" title="Customize cards" onClick={() => onCustomizingCardsChange(true)}>
              <SlidersHorizontal size={16} />
            </Button>
          )}
          <Button variant="outline" size="icon" aria-label={`Previous ${unit}`} onClick={() => pickDate(shiftDate(date, -step))}>
            <ChevronLeft size={17} />
          </Button>
          <DatePicker
            label={reviewing ? "Choose the last day of the week" : "Choose log date"}
            value={date}
            days={reviewing ? 7 : 1}
            onChange={pickDate}
          />
          <Button variant="outline" size="icon" aria-label={`Next ${unit}`} onClick={() => pickDate(shiftDate(date, step))}>
            <ChevronRight size={17} />
          </Button>
        </div>
      </header>
      <Outlet />
    </>
  );
}
