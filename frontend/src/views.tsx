import * as stylex from "@stylexjs/stylex";
import { styles } from "./dashboard-styles";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Plus,
  Search,
  Trash2,
  UtensilsCrossed,
} from "lucide-react";
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
  type FoodEntry,
} from "./lib/api";
import type { FoodSubmission } from "../../src/food/contract";
import { LogFoodDialog } from "./log-food-dialog";
import { ConnectionDialog } from "./connection-dialog";
import { MyDay } from "./my-day";

const tokenKey = "nouri.apiToken";

const disconnectedKey = "nouri.disconnected";

const dateKey = "nouri.selectedDate";

const configuredToken = document.querySelector<HTMLMetaElement>('meta[name="nouri-api-token"]')?.content ?? "";

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const now = () => localDate(new Date());

type FoodInput = FoodSubmission["food"];

type PendingCreate = { signature: string; key: string; body: string };

export function Dashboard({ view }: { view: "today" | "food" }) {
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
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const pendingCreate = useRef<PendingCreate | null>(null);
  const pendingDeletes = useRef(new Map<string, string>());

  const dayQuery = useQuery({
    queryKey: ["day", token, date],
    queryFn: () => getDay(token, date),
    enabled: Boolean(token),
  });

  const createMutation = useMutation({
    mutationFn: (pending: PendingCreate) => createFood(token, pending.key, pending.body),
    onSuccess: async () => {
      pendingCreate.current = null;
      await queryClient.invalidateQueries({ queryKey: ["day", token] });
      setNotice("Food added to your log.");
      setLogOpen(false);
    },
    onError: (error) => setNotice(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (entry: FoodEntry) => {
      const key = pendingDeletes.current.get(entry.id) || crypto.randomUUID();
      pendingDeletes.current.set(entry.id, key);

      return deleteFood(token, entry, key);
    },
    onSuccess: async (_, entry) => {
      pendingDeletes.current.delete(entry.id);
      await queryClient.invalidateQueries({ queryKey: ["day", token] });
      setNotice("Food removed from your log.");
    },
    onError: (error) => {
      setNotice(error.message);

      if (error.message.includes("conflict")) {
        pendingDeletes.current.clear();
        void queryClient.invalidateQueries({ queryKey: ["day", token] });
      }
    },
  });

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
    setNotice("");
  }

  function selectDate(next: string) {
    sessionStorage.setItem(dateKey, next);
    setDate(next);
    setNotice("");
  }

  function disconnect() {
    sessionStorage.removeItem(tokenKey);
    sessionStorage.setItem(disconnectedKey, "true");
    queryClient.clear();
    setToken("");
    setConnectionOpen(false);
    setNotice("");
  }

  function saveFood(event: FormEvent<HTMLFormElement>, food: FoodInput) {
    event.preventDefault();

    if (!token) {
      setLogOpen(false);
      setConnectionOpen(true);

      return;
    }

    const signature = JSON.stringify({ date, zone, food });

    if (pendingCreate.current?.signature !== signature)
      pendingCreate.current = {
        signature,
        key: crypto.randomUUID(),
        body: JSON.stringify({
          occurredAt: occurredAt(date),
          timeZone: zone,
          food,
        }),
      };
    createMutation.mutate(pendingCreate.current);
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
      "Connect your log from the sidebar to see your foods."
    ) : entries.length === 0 ? (
      <>
        <strong {...stylex.props(styles.emptyTitle)}>No foods logged yet</strong>
        <Button variant="outline" size="sm" onClick={() => setLogOpen(true)}>
          <Plus size={15} /> Log a food
        </Button>
      </>
    ) : null;

  return (
    <div {...stylex.props(styles.appShell)}>
      <aside {...stylex.props(styles.sidebar)}>
        <Link to="/" {...stylex.props(styles.brand)}>
          <span {...stylex.props(styles.brandIcon)}>
            <UtensilsCrossed size={17} strokeWidth={2.5} />
          </span>
          <span>NOURI</span>
        </Link>
        <nav {...stylex.props(styles.sidebarNav)} aria-label="Main navigation">
          <p {...stylex.props(styles.navCaption)}>WORKSPACE</p>
          <Link
            to="/"
            {...stylex.props(styles.navItem, view === "today" && styles.navItemActive)}
          >
            <LayoutDashboard size={17} {...stylex.props(view === "today" && styles.iconAccent)} />
            Today
          </Link>
          <button {...stylex.props(styles.navItem)} onClick={() => setLogOpen(true)}>
            <Plus size={19} />
            Log a food
          </button>
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
          <button {...stylex.props(styles.helpLink)} onClick={() => setConnectionOpen(true)}>
            <CircleHelp size={16} />{" "}
            {token ? "Connection settings" : "Connect your log"}
          </button>
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
            {view === "today" ? "TODAY" : "FOOD"}
          </span>
          <span {...stylex.props(styles.topbarDate)}>{dateLabel(date)}</span>
        </div>
        <div {...stylex.props(styles.pageContent)}>
          {view === "today" ? (
            <header {...stylex.props(styles.dayHeader)}>
              <div>
                <p {...stylex.props(styles.eyebrow)}>MY DAY</p>
                <h1 {...stylex.props(styles.dayHeadline)}>{isToday ? "Today" : dateLabel(date)}</h1>
              </div>
              <div {...stylex.props(styles.dateActions)}>
                {dateActions}
                <Button sx={styles.pageHeaderButton} onClick={() => setLogOpen(true)}>
                  <Plus size={17} /> Log a food
                </Button>
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
                <Button sx={styles.pageHeaderButton} onClick={() => setLogOpen(true)}>
                  <Plus size={17} /> Log a food
                </Button>
              </header>
              <div {...stylex.props(styles.dateToolbar)}>
                <span {...stylex.props(styles.dateLabel)}>
                  <CalendarDays size={16} {...stylex.props(styles.iconAccent)} /> {isToday ? "Today" : dateLabel(date)}
                </span>
                <div {...stylex.props(styles.dateActions)}>{dateActions}</div>
              </div>
            </>
          )}
          {notice && (
            <div {...stylex.props(styles.notice)} role="status">
              {notice}
              <button
                {...stylex.props(styles.noticeDismiss)}
                onClick={() => setNotice("")}
                aria-label="Dismiss message"
              >
                ×
              </button>
            </div>
          )}
          {view === "today" ? (
            <MyDay
              token={token}
              day={day}
              isToday={isToday}
              status={timelineStatus}
              deletePending={deleteMutation.isPending}
              onLog={() => setLogOpen(true)}
              onDelete={(entry) => deleteMutation.mutate(entry)}
            />
          ) : (
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
          )}
        </div>
      </main>
      <ConnectionDialog open={connectionOpen} onOpenChange={setConnectionOpen} token={token} onConnect={connect} onDisconnect={disconnect} />
      <LogFoodDialog open={logOpen} onOpenChange={setLogOpen} token={token} date={date} isToday={isToday} pending={createMutation.isPending} onSave={saveFood} onConnect={() => { setLogOpen(false); setConnectionOpen(true); }} />
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
