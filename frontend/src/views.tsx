import * as stylex from "@stylexjs/stylex";
import { styles } from "./dashboard-styles";
import { useState, type FormEvent } from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ChartColumn,
  Droplet,
  Dumbbell,
  Moon,
  Pill,
  Ruler,
  SlidersHorizontal,
  Target,
  UtensilsCrossed,
  Watch,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { createFood, deleteFood, getDay } from "./lib/api";
import { dateLabel, localDate, occurredAt, shiftDate, timeZone as zone } from "./lib/time";
import { useIdempotentWrite, useIdempotentDelete } from "./lib/use-idempotent";
import { useWater } from "./lib/use-water";
import { useConnection } from "./lib/use-connection";
import { submissionSchema, type FoodSubmission } from "../../src/food/contract";
import { LogFoodDialog } from "./log-food-dialog";
import { EditFoodDialog } from "./edit-food-dialog";
import { SaveMealDialog, type MealSelection } from "./save-meal-dialog";
import { ConnectionDialog } from "./connection-dialog";
import { TargetsDialog } from "./targets-dialog";
import { SupplementsDialog } from "./supplements-dialog";
import { WearablesDialog } from "./wearables-dialog";
import { dashboardPageContext } from "./dashboard-page-context";
import { MeasurementDialog, SleepDialog, WaterDialog, WorkoutDialog } from "./overview-dialogs";
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

type RecordKind = "water" | "workout" | "sleep" | "measurement";

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mealSelection, setMealSelection] = useState<MealSelection | null>(null);
  const [logMenuOpen, setLogMenuOpen] = useState(false);
  const [recordDialog, setRecordDialog] = useState<RecordKind | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [customizingCards, setCustomizingCards] = useState(false);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [supplementsOpen, setSupplementsOpen] = useState(false);
  const [wearablesOpen, setWearablesOpen] = useState(false);

  const journal = useJournal(token);

  const water = useWater(token, () => {
    setRecordDialog(null);
    setConnectionOpen(true);
  });

  const googleHealth = useConnection(token, "google-health");

  const foodDelete = useIdempotentDelete<FoodEntry>(token, (entry, key) => deleteFood(token, entry, key), {
    refresh: ["day", "overview"], success: () => "Food removed from your log.",
  });

  const refresh = ["day", "overview"];

  const createMutation = useIdempotentWrite<PendingFood>(token, (pending, key) => createFood(token, key, pending.input), {
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

  function manageSupplements() {
    if (token) setSupplementsOpen(true);
    else setConnectionOpen(true);
  }

  function manageWearables() {
    if (token) setWearablesOpen(true);
    else setConnectionOpen(true);
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

  function openLog(kind: "food" | RecordKind) {
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
    <dashboardPageContext.Provider value={{ token, date, isToday, onEditFood: (entry) => setEditingId(entry.id), onSaveMeal: setMealSelection, foodDelete, journal, water, onManageSupplements: manageSupplements, onManageWearables: manageWearables, customizingCards, onCustomizingCardsChange: setCustomizingCards }}>
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
          <button
            type="button"
            {...stylex.props(styles.navItem, targetsOpen && styles.navItemActive)}
            onClick={() => (token ? setTargetsOpen(true) : setConnectionOpen(true))}
          >
            <Target size={17} {...stylex.props(targetsOpen && styles.iconAccent)} />
            Targets
          </button>
          <button
            type="button"
            {...stylex.props(styles.navItem, supplementsOpen && styles.navItemActive)}
            onClick={manageSupplements}
          >
            <Pill size={17} {...stylex.props(supplementsOpen && styles.iconAccent)} />
            Supplements
          </button>
          <button
            type="button"
            {...stylex.props(styles.navItem, wearablesOpen && styles.navItemActive)}
            onClick={manageWearables}
          >
            <Watch size={17} {...stylex.props(wearablesOpen && styles.iconAccent)} />
            Wearables
          </button>
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
      <TargetsDialog open={targetsOpen} onOpenChange={setTargetsOpen} token={token} />
      <SupplementsDialog open={supplementsOpen} onOpenChange={setSupplementsOpen} token={token} />
      <WearablesDialog open={wearablesOpen} onOpenChange={setWearablesOpen} connection={googleHealth} />
      <ConnectionDialog open={connectionOpen} onOpenChange={setConnectionOpen} token={token} onConnect={connect} onDisconnect={disconnect} />
      <LogFoodDialog open={logOpen} onOpenChange={setLogOpen} token={token} date={date} isToday={isToday} pending={createMutation.isPending} onSave={saveFood} onConnect={() => { setLogOpen(false); setConnectionOpen(true); }} />
      <EditFoodDialog token={token} date={date} entryId={editingId} onClose={() => setEditingId(null)} />
      <SaveMealDialog token={token} date={date} selection={mealSelection} onClose={() => setMealSelection(null)} />
      <WaterDialog open={recordDialog === "water"} onOpenChange={(open) => setRecordDialog(open ? "water" : null)} date={date} pending={water.pending} onSave={(input) => water.add(input, () => setRecordDialog(null))} />
      <WorkoutDialog open={recordDialog === "workout"} onOpenChange={(open) => setRecordDialog(open ? "workout" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.workout, input }, "Workout")} />
      <SleepDialog open={recordDialog === "sleep"} onOpenChange={(open) => setRecordDialog(open ? "sleep" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.sleep, input }, "Sleep")} />
      <MeasurementDialog open={recordDialog === "measurement"} onOpenChange={(open) => setRecordDialog(open ? "measurement" : null)} date={date} pending={journal.create.isPending} onSave={(input) => saveRecord({ path: recordPaths.measurement, input }, "Measurement")} />
    </div>
    </dashboardPageContext.Provider>
  );
}
