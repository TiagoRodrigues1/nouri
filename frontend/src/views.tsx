import * as stylex from "@stylexjs/stylex";
import { styles } from "./dashboard-styles";
import { createContext, useContext, useState, type FormEvent } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ChartColumn,
  Dumbbell,
  Moon,
  SlidersHorizontal,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import {
  createFood,
  deleteFood,
  dateLabel,
  getDay,
  localDate,
  occurredAt,
  shiftDate,
  timeZone as zone,
} from "./lib/api";
import { useIdempotentCreate, useIdempotentDelete } from "./lib/use-idempotent";
import { useWater } from "./lib/use-water";
import { submissionSchema, type FoodSubmission } from "../../src/food/contract";
import { LogFoodDialog } from "./log-food-dialog";
import { ConnectionDialog } from "./connection-dialog";
import { TodayPage } from "./today-page";
import { FoodPage } from "./food-page";
import { Overview } from "./overview";
import { MeasurementDialog, SleepDialog, WorkoutDialog } from "./overview-dialogs";
import { useJournal } from "./overview/use-journal";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import type { FoodEntry, RecordCommand } from "./lib/api";
import { recordPaths } from "../../src/journal/paths";

const tokenKey = "nouri.apiToken";

const disconnectedKey = "nouri.disconnected";

const dateKey = "nouri.selectedDate";

const configuredToken = document.querySelector<HTMLMetaElement>('meta[name="nouri-api-token"]')?.content ?? "";

const now = () => localDate(new Date());

type FoodInput = FoodSubmission["food"];

type View = "today" | "overview" | "food";

type PendingFood = { input: FoodSubmission; signature: string };

type DashboardPageContext = {
  token: string;
  date: string;
  isToday: boolean;
  onLogFood: () => void;
  onLogWorkout: () => void;
  onLogSleep: () => void;
  onLogMeasurement: () => void;
  foodDelete: ReturnType<typeof useIdempotentDelete<FoodEntry>>;
  journal: ReturnType<typeof useJournal>;
  water: ReturnType<typeof useWater>;
  customizingCards: boolean;
  onCustomizingCardsChange: (open: boolean) => void;
};

const dashboardPageContext = createContext<DashboardPageContext | null>(null);

export function useDashboardPage() {
  const context = useContext(dashboardPageContext);

  if (!context) throw new Error("Dashboard page rendered outside its shell");

  return context;
}

export function Dashboard() {
  const queryClient = useQueryClient();
  const path = useLocation({ select: (location) => location.pathname });
  const view: View = path === "/food" ? "food" : path === "/overview" ? "overview" : "today";

  const [token, setToken] = useState(
    () => sessionStorage.getItem(disconnectedKey) === "true"
      ? ""
      : configuredToken || sessionStorage.getItem(tokenKey) || "",
  );


  const [date, setDate] = useState(
    () => sessionStorage.getItem(dateKey) || now(),
  );

  const [logOpen, setLogOpen] = useState(false);
  const [logMenuOpen, setLogMenuOpen] = useState(false);
  const [recordDialog, setRecordDialog] = useState<"workout" | "sleep" | "measurement" | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [customizingCards, setCustomizingCards] = useState(false);

  const journal = useJournal(token);
  const water = useWater(token, date, () => setConnectionOpen(true));

  const foodDelete = useIdempotentDelete<FoodEntry>(token, (entry, key) => deleteFood(token, entry, key), {
    refresh: ["day", "overview"], success: () => "Food removed from your log.",
  });

  const refresh = ["day", "overview"];

  const createMutation = useIdempotentCreate<PendingFood>(token, (pending, key) => createFood(token, key, pending.input), {
    refresh, success: () => "Food added to your log.", onSuccess: () => setLogOpen(false),
    signature: (pending) => pending.signature,
  });

  const isToday = date === now();

  async function connect(next: string) {
    await getDay(next, date);
    sessionStorage.setItem(tokenKey, next);
    sessionStorage.removeItem(disconnectedKey);
    queryClient.clear();
    setToken(next);
    setConnectionOpen(false);
    toast.dismiss();
  }

  function selectDate(next: string) {
    sessionStorage.setItem(dateKey, next);
    setDate(next);
    toast.dismiss();
  }

  function disconnect() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.setItem(disconnectedKey, "true");
    queryClient.clear();
    setToken("");
    setConnectionOpen(false);
    toast.dismiss();
  }

  function saveFood(event: FormEvent<HTMLFormElement>, food: FoodInput, time: string) {
    event.preventDefault();

    if (!token) {
      setLogOpen(false);
      setConnectionOpen(true);

      return;
    }

    createMutation.mutate({
      input: submissionSchema.parse({ occurredAt: occurredAt(date, time), timeZone: zone, food }),
      signature: JSON.stringify({ date, time, zone, food }),
    });
  }

  function openLog(kind: "food" | "workout" | "sleep") {
    setLogMenuOpen(false);

    if (kind === "food") setLogOpen(true);
    else setRecordDialog(kind);
  }

  function saveRecord(command: RecordCommand, label: string) {
    if (!token) {
      setRecordDialog(null);
      setConnectionOpen(true);

      return;
    }

    journal.create.mutate({ ...command, label, signature: `${command.path} ${JSON.stringify(command.input)}` }, { onSuccess: () => setRecordDialog(null) });
  }

  const dateActions = (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label="Previous day"
        onClick={() => selectDate(shiftDate(date, -1))}
      >
        <ChevronLeft size={17} />
      </Button>
      <Input
        {...stylex.props(styles.dateInput)}
        aria-label="Choose log date"
        type="date"
        value={date}
        onChange={(event) => {
          if (event.target.value) selectDate(event.target.value);
        }}
      />
      <Button
        variant="outline"
        size="icon"
        aria-label="Next day"
        onClick={() => selectDate(shiftDate(date, 1))}
      >
        <ChevronRight size={17} />
      </Button>
    </>
  );

  const pageText = {
    today: { eyebrow: "MY DAY", crumb: "TODAY" },
    overview: { eyebrow: "OVERVIEW", crumb: "OVERVIEW" },
    food: { eyebrow: "YOUR FOOD JOURNAL", crumb: "FOOD" },
  }[view];

  return (
    <dashboardPageContext.Provider value={{ token, date, isToday, onLogFood: () => setLogOpen(true), onLogWorkout: () => setRecordDialog("workout"), onLogSleep: () => setRecordDialog("sleep"), onLogMeasurement: () => setRecordDialog("measurement"), foodDelete, journal, water, customizingCards, onCustomizingCardsChange: setCustomizingCards }}>
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
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("sleep")}><Moon size={17} /> Sleep</button>
            <button type="button" {...stylex.props(styles.logMenuItem)} onClick={() => openLog("workout")}><Dumbbell size={17} /> Exercise</button>
          </PopoverContent>
        </Popover>
        <nav {...stylex.props(styles.sidebarNav)} aria-label="Main navigation">
          <p {...stylex.props(styles.navCaption)}>WORKSPACE</p>
          <Link
            to="/"
            {...stylex.props(styles.navItem, view === "today" && styles.navItemActive)}
          >
            <LayoutDashboard size={17} {...stylex.props(view === "today" && styles.iconAccent)} />
            Today
          </Link>
          <Link
            to="/overview"
            {...stylex.props(styles.navItem, view === "overview" && styles.navItemActive)}
          >
            <ChartColumn size={17} {...stylex.props(view === "overview" && styles.iconAccent)} />
            Overview
          </Link>
          <p {...stylex.props(styles.navCaption, styles.navCaptionData)}>YOUR DATA</p>
          <Link
            to="/food"
            {...stylex.props(styles.navItem, view === "food" && styles.navItemActive)}
          >
            <UtensilsCrossed size={17} {...stylex.props(view === "food" && styles.iconAccent)} />
            Food
          </Link>
        </nav>
        <div {...stylex.props(styles.sidebarBottom)}>
          <div {...stylex.props(styles.profile)}>
            <span {...stylex.props(styles.avatar)}>N</span>
            <div>
              <strong {...stylex.props(styles.profileText)}>Personal space</strong>
              <small {...stylex.props(styles.profileText, styles.profileSubtext)}>{token ? "Connected" : "Not connected"}</small>
            </div>
          </div>
        </div>
      </aside>
      <main {...stylex.props(styles.mainArea)}>
        <div {...stylex.props(styles.topbar)}>
          <span>
            YOUR SPACE <span {...stylex.props(styles.slash)}>/</span>{" "}
            {pageText.crumb}
          </span>
        </div>
        <div {...stylex.props(styles.pageContent)}>
          {view !== "food" ? (
            <header {...stylex.props(styles.dayHeader)}>
              <div>
                <p {...stylex.props(styles.eyebrow)}>{pageText.eyebrow}</p>
                <h1 {...stylex.props(styles.dayHeadline)}>{isToday ? "Today" : dateLabel(date)}</h1>
              </div>
              <div {...stylex.props(styles.dateActions)}>
                {view === "today" && (
                  <Button variant="outline" size="icon" aria-label="Customize cards" title="Customize cards" disabled={!token} onClick={() => setCustomizingCards(true)}>
                    <SlidersHorizontal size={16} />
                  </Button>
                )}
                {dateActions}
              </div>
            </header>
          ) : (
            <>
              <header {...stylex.props(styles.pageHeader)}>
                <div>
                  <p {...stylex.props(styles.eyebrow)}>YOUR FOOD JOURNAL</p>
                  <h1 {...stylex.props(styles.headline)}>Food journal</h1>
                  <p {...stylex.props(styles.subtitle)}>Search, log, and review the foods in your day.</p>
                </div>
              </header>
              <div {...stylex.props(styles.dateToolbar)}>
                <span {...stylex.props(styles.dateLabel)}>
                  <CalendarDays size={16} {...stylex.props(styles.iconAccent)} /> {isToday ? "Today" : dateLabel(date)}
                </span>
                <div {...stylex.props(styles.dateActions)}>{dateActions}</div>
              </div>
            </>
          )}
          <Outlet />
        </div>
      </main>
      <ConnectionDialog open={connectionOpen} onOpenChange={setConnectionOpen} token={token} onConnect={connect} onDisconnect={disconnect} />
      <LogFoodDialog open={logOpen} onOpenChange={setLogOpen} token={token} date={date} isToday={isToday} pending={createMutation.isPending} onSave={saveFood} onConnect={() => { setLogOpen(false); setConnectionOpen(true); }} />
      <WorkoutDialog open={recordDialog === "workout"} onOpenChange={(open) => setRecordDialog(open ? "workout" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.workout, input }, "Workout")} />
      <SleepDialog open={recordDialog === "sleep"} onOpenChange={(open) => setRecordDialog(open ? "sleep" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.sleep, input }, "Sleep")} />
      <MeasurementDialog open={recordDialog === "measurement"} onOpenChange={(open) => setRecordDialog(open ? "measurement" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.measurement, input }, "Measurement")} />
    </div>
    </dashboardPageContext.Provider>
  );
}

export function TodayRoute() {
  const { token, date, isToday, foodDelete, water, customizingCards, onCustomizingCardsChange } = useDashboardPage();

  return <TodayPage token={token} date={date} isToday={isToday} foodDelete={foodDelete} water={water} customizingCards={customizingCards} onCustomizingCardsChange={onCustomizingCardsChange} />;
}

export function FoodRoute() {
  const { token, date, isToday, onLogFood, foodDelete } = useDashboardPage();

  return <FoodPage token={token} date={date} isToday={isToday} onLogFood={onLogFood} foodDelete={foodDelete} />;
}

export function OverviewRoute() {
  const { token, date, onLogFood, onLogWorkout, onLogSleep, onLogMeasurement, journal, water } = useDashboardPage();

  return <Overview token={token} date={date} onLogFood={onLogFood} onLogWorkout={onLogWorkout} onLogSleep={onLogSleep} onLogMeasurement={onLogMeasurement} journal={journal} water={water} />;
}
