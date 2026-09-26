import * as stylex from "@stylexjs/stylex";
import { styles } from "./dashboard-styles";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ChartColumn,
  Dumbbell,
  Moon,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import {
  createFood,
  dateLabel,
  deleteFood,
  format,
  getDay,
  localDate,
  occurredAt,
  shiftDate,
  timeZone as zone,
  type FoodEntry,
} from "./lib/api";
import { useIdempotentCreate, useIdempotentDelete } from "./lib/use-idempotent";
import { submissionSchema, type FoodSubmission } from "../../src/food/contract";
import { LogFoodDialog } from "./log-food-dialog";
import { ConnectionDialog } from "./connection-dialog";
import { MyDay } from "./my-day";
import { Overview } from "./overview";
import { MeasurementDialog, SleepDialog, WorkoutDialog } from "./overview-dialogs";
import { useJournal } from "./overview/use-journal";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import type { MeasurementInput } from "../../src/measurements/contract";
import type { WorkoutInput } from "../../src/workouts/contract";
import type { SleepInput } from "../../src/sleep/contract";
import type { RecordPath } from "./lib/api";

const tokenKey = "nouri.apiToken";

const disconnectedKey = "nouri.disconnected";

const dateKey = "nouri.selectedDate";

const configuredToken = document.querySelector<HTMLMetaElement>('meta[name="nouri-api-token"]')?.content ?? "";

const now = () => localDate(new Date());

type FoodInput = FoodSubmission["food"];

type View = "today" | "overview" | "food";

type PendingFood = { input: FoodSubmission; signature: string };

export function Dashboard({ view }: { view: View }) {
  const queryClient = useQueryClient();

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
  const journal = useJournal(token);

  const dayQuery = useQuery({
    queryKey: ["day", token, date],
    queryFn: () => getDay(token, date),
    enabled: Boolean(token),
  });

  const refresh = ["day", "overview"];

  const createMutation = useIdempotentCreate<PendingFood>(token, (pending, key) => createFood(token, key, pending.input), {
    refresh, success: () => "Food added to your log.", onSuccess: () => setLogOpen(false),
    signature: (pending) => pending.signature,
  });

  const deleteMutation = useIdempotentDelete<FoodEntry>(token, (entry, key) => deleteFood(token, entry, key), { refresh, success: () => "Food removed from your log." });

  const day = dayQuery.data;
  const entries = day?.food.entries || [];
  const totals = day?.food.totals;
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

  function saveRecord<Input extends MeasurementInput | WorkoutInput | SleepInput>(path: RecordPath, label: string) {
    return (input: Input) => {
      if (!token) {
        setRecordDialog(null);
        setConnectionOpen(true);

        return;
      }

      journal.create.mutate({ path, label, input, signature: `${path} ${JSON.stringify(input)}` }, { onSuccess: () => setRecordDialog(null) });
    };
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
        sx={styles.dateInput}
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

  const timelineStatus =
    dayQuery.isPending && token ? (
      "Loading your food log…"
    ) : dayQuery.isError ? (
      <span>
        {dayQuery.error.message}{" "}
        <button {...stylex.props(styles.emptyButton)} onClick={() => void dayQuery.refetch()}>
          Try again
        </button>
      </span>
    ) : !token ? (
      "Connect your log to see your foods."
    ) : entries.length === 0 ? (
      <>
        <strong {...stylex.props(styles.emptyTitle)}>No foods logged yet</strong>
      </>
    ) : null;

  const pages: Record<View, { eyebrow: string; crumb: string; render: ReactNode }> = {
    today: { eyebrow: "MY DAY", crumb: "TODAY", render: <MyDay token={token} day={day} date={date} onConnect={() => setConnectionOpen(true)} isToday={isToday} status={timelineStatus} deletePending={deleteMutation.isPending} onDelete={(entry) => deleteMutation.mutate(entry)} /> },
    overview: { eyebrow: "OVERVIEW", crumb: "OVERVIEW", render: <Overview token={token} date={date} onLogFood={() => setLogOpen(true)} onLogWorkout={() => setRecordDialog("workout")} onLogSleep={() => setRecordDialog("sleep")} onLogMeasurement={() => setRecordDialog("measurement")} onConnect={() => setConnectionOpen(true)} /> },
    food: { eyebrow: "YOUR FOOD JOURNAL", crumb: "FOOD", render: (
<div {...stylex.props(styles.dashboardGrid)}>
              <div {...stylex.props(styles.column)}>
                <Card>
                  <CardHeader sx={styles.cardHeader}>
                    <CardTitle sx={styles.cardTitle}>
                      {isToday ? "Today so far" : "Daily summary"}
                    </CardTitle>
                    <span {...stylex.props(styles.cardOverline)}>
                      {day?.food.entryCount ?? 0}{" "}
                      {day?.food.entryCount === 1 ? "food" : "foods"} logged
                    </span>
                  </CardHeader>
                  <CardContent sx={styles.overviewContent}>
                    <div {...stylex.props(styles.metricGrid)}>
                      <Metric
                        value={token ? String(day?.food.entryCount ?? 0) : "—"}
                        label="foods"
                      />
                      <Metric
                        value={token ? format(totals?.kcal) : "—"}
                        label="kcal"
                      />
                      <Metric
                        value={token ? format(totals?.proteinG, 1) : "—"}
                        label="protein, g"
                      />
                      <Metric
                        value={token ? format(totals?.carbsG, 1) : "—"}
                        label="carbs, g"
                      />
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader sx={styles.cardHeader}>
                    <div>
                      <CardTitle sx={styles.cardTitle}>Food</CardTitle>
                      <p {...stylex.props(styles.foodCardDate)}>{isToday ? "Today's entries" : dateLabel(date)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      sx={styles.foodCardButton}
                      onClick={() => setLogOpen(true)}
                    >
                      <Plus size={15} /> Add food
                    </Button>
                  </CardHeader>
                  <CardContent sx={styles.foodCardContent}>
                    <div {...stylex.props(styles.energyRow)}>
                      <div>
                        <span {...stylex.props(styles.energyValue)}>
                          {token ? format(totals?.kcal) : "—"}
                        </span>
                        <span {...stylex.props(styles.energyUnit)}>kcal logged</span>
                      </div>
                      <div {...stylex.props(styles.macroInline)}>
                        P {token ? format(totals?.proteinG, 1) : "—"}g&nbsp; C{" "}
                        {token ? format(totals?.carbsG, 1) : "—"}g&nbsp; F{" "}
                        {token ? format(totals?.fatG, 1) : "—"}g
                      </div>
                    </div>
                    {dayQuery.isPending && token ? (
                      <p {...stylex.props(styles.emptyState)}>Loading your food log…</p>
                    ) : dayQuery.isError ? (
                      <p {...stylex.props(styles.emptyState)}>
                        {dayQuery.error.message}{" "}
                        <button {...stylex.props(styles.emptyButton)} onClick={() => void dayQuery.refetch()}>
                          Try again
                        </button>
                      </p>
                    ) : !token ? (
                      <p {...stylex.props(styles.emptyState)}>Connect to see your foods.</p>
                    ) : entries.length === 0 ? (
                      <div {...stylex.props(styles.emptyState)}>
                        <UtensilsCrossed size={22} {...stylex.props(styles.iconAccent)} />
                        <strong {...stylex.props(styles.emptyTitle)}>No foods logged yet</strong>
                        <span>Start with a food search or add your own.</span>
                        <Button
                          variant="outline"
                          size="sm"
                          sx={styles.emptyButton}
                          onClick={() => setLogOpen(true)}
                        >
                          Log a food
                        </Button>
                      </div>
                    ) : (
                      <ul {...stylex.props(styles.entryList)} aria-label="Logged foods">
                        {entries.map((entry) => (
                          <li key={entry.id} {...stylex.props(styles.entry)}>
                            <span {...stylex.props(styles.entryMark)}>
                              <UtensilsCrossed size={17} />
                            </span>
                            <div {...stylex.props(styles.entryDetail)}>
                              <strong {...stylex.props(styles.entryDetailText, styles.entryName)}>{entry.food.name}</strong>
                              <small {...stylex.props(styles.entryDetailText, styles.entryMeta)}>
                                {format(entry.food.quantity.amount, 2)}{" "}
                                {entry.food.quantity.unit} ·{" "}
                                {new Intl.DateTimeFormat("en", {
                                  hour: "numeric",
                                  minute: "2-digit",
                                  timeZone: zone,
                                }).format(new Date(entry.occurredAt))}
                              </small>
                            </div>
                            <span {...stylex.props(styles.entryCalories)}>
                              {format(entry.food.nutrients.kcal)} kcal
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              sx={styles.entryDeleteButton}
                              aria-label={`Delete ${entry.food.name}`}
                              disabled={deleteMutation.isPending}
                              onClick={() => deleteMutation.mutate(entry)}
                            >
                              <Trash2 size={16} />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p {...stylex.props(styles.cardFootnote)}>
                      Values reflect what you've logged for this day.
                    </p>
                  </CardContent>
                </Card>
              </div>
              <div {...stylex.props(styles.column)}>
                <Card sx={styles.tipCard}>
                  <CardContent sx={styles.tipContent}>
                    <div {...stylex.props(styles.tipIcon)}>
                      <Search size={22} />
                    </div>
                    <p {...stylex.props(styles.tipEyebrow)}>QUICK START</p>
                    <h2 {...stylex.props(styles.tipHeading)}>What's on your plate?</h2>
                    <p {...stylex.props(styles.tipText)}>
                      Find a food in the Ciqual catalog or enter your own
                      nutrition details.
                    </p>
                    <Button variant="outline" sx={styles.tipButton} onClick={() => setLogOpen(true)}>
                      Add your first food <ChevronRight size={17} />
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader sx={styles.cardHeader}>
                    <CardTitle sx={styles.cardTitle}>Daily nutrition</CardTitle>
                  </CardHeader>
                  <CardContent sx={styles.detailContent}>
                    <NutritionLine
                      label="Protein"
                      value={token ? format(totals?.proteinG, 1) : "—"}
                    />
                    <NutritionLine
                      label="Carbs"
                      value={token ? format(totals?.carbsG, 1) : "—"}
                    />
                    <NutritionLine
                      label="Fat"
                      value={token ? format(totals?.fatG, 1) : "—"}
                    />
                    <p {...stylex.props(styles.detailFootnote)}>Totals are calculated from your logged foods.</p>
                  </CardContent>
                </Card>
              </div>
            </div>
    ) },
  };

  return (
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
            <Button variant="ghost" sx={styles.logButton} aria-expanded={logMenuOpen}>
              + Log
            </Button>
          </PopoverTrigger>
          <PopoverContent sx={styles.logMenu} align="start" sideOffset={8}>
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
            {pages[view].crumb}
          </span>
        </div>
        <div {...stylex.props(styles.pageContent)}>
          {view !== "food" ? (
            <header {...stylex.props(styles.dayHeader)}>
              <div>
                <p {...stylex.props(styles.eyebrow)}>{pages[view].eyebrow}</p>
                <h1 {...stylex.props(styles.dayHeadline)}>{isToday ? "Today" : dateLabel(date)}</h1>
              </div>
              <div {...stylex.props(styles.dateActions)}>
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
          {pages[view].render}
        </div>
      </main>
      <ConnectionDialog open={connectionOpen} onOpenChange={setConnectionOpen} token={token} onConnect={connect} onDisconnect={disconnect} />
      <LogFoodDialog open={logOpen} onOpenChange={setLogOpen} token={token} date={date} isToday={isToday} pending={createMutation.isPending} onSave={saveFood} onConnect={() => { setLogOpen(false); setConnectionOpen(true); }} />
      <WorkoutDialog open={recordDialog === "workout"} onOpenChange={(open) => setRecordDialog(open ? "workout" : null)} date={date} pending={journal.create.isPending} onSave={saveRecord("/v1/workouts", "Workout")} />
      <SleepDialog open={recordDialog === "sleep"} onOpenChange={(open) => setRecordDialog(open ? "sleep" : null)} date={date} pending={journal.create.isPending} onSave={saveRecord("/v1/sleep-sessions", "Sleep")} />
      <MeasurementDialog open={recordDialog === "measurement"} onOpenChange={(open) => setRecordDialog(open ? "measurement" : null)} date={date} pending={journal.create.isPending} onSave={saveRecord("/v1/measurements", "Measurement")} />
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong {...stylex.props(styles.metricValue)}>{value}</strong>
      <span {...stylex.props(styles.metricLabel)}>{label}</span>
    </div>
  );
}

function NutritionLine({ label, value }: { label: string; value: string }) {
  return (
    <div {...stylex.props(styles.nutritionLine)}>
      <span {...stylex.props(styles.nutritionLabel)}>{label}</span>
      <strong {...stylex.props(styles.nutritionValue)}>{value} g</strong>
    </div>
  );
}
