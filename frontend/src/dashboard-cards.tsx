import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Checkbox } from "./components/ui/checkbox";
import { Label } from "./components/ui/label";
import { Button } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./components/ui/dialog";
import { styles as formStyles } from "./form-styles";
import { colors } from "./theme.stylex";
import { cardIds, defaultCards } from "../../src/dashboard/contract";
import { getDashboard, saveDashboard, type CardId } from "./lib/api";

export const cardLabels: Record<CardId, { name: string; description: string }> = {
  totals: { name: "Daily totals", description: "Energy, protein, carbs, and fat against reference values" },
  water: { name: "Water", description: "Log drinks and track your daily goal" },
  mix: { name: "Energy mix", description: "How protein, carbs, and fat split your energy" },
  activity: { name: "Activity", description: "Workouts and movement for the day" },
  fasting: { name: "Fasting", description: "Time since your last food, or your eating window" },
  largest: { name: "Largest food", description: "The food that brought the most energy" },
  meals: { name: "Meals", description: "How many times you ate and when" },
};

// Cards stay undefined while the saved layout loads, so the defaults never flash before it.
export function useDashboardCards(token: string) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["dashboard", token],
    queryFn: () => getDashboard(token),
    enabled: Boolean(token),
  });

  const mutation = useMutation({
    mutationFn: (cards: CardId[]) => saveDashboard(token, { cards }),
    onSuccess: (saved) => queryClient.setQueryData(["dashboard", token], saved),
  });

  const cards = !token || query.isError ? defaultCards : query.data?.cards;

  return { cards, mutation };
}

type Draft = Array<{ id: CardId; shown: boolean }>;

// Shown cards keep their saved order; hidden ones follow in catalog order so they can be switched back on.
function draftFrom(cards: CardId[]): Draft {
  return [...cards.map((id) => ({ id, shown: true })), ...cardIds.filter((id) => !cards.includes(id)).map((id) => ({ id, shown: false }))];
}

type DashboardCardsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cards: CardId[];
  pending: boolean;
  error: string;
  onSave: (cards: CardId[]) => void;
};

export function DashboardCardsDialog({ open, onOpenChange, ...props }: DashboardCardsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle {...stylex.props(formStyles.dialogTitle)}>Customize cards</DialogTitle>
        <DialogDescription {...stylex.props(formStyles.dialogDescription)}>
          Choose the cards on My Day and the order they appear in.
        </DialogDescription>
        <CardsForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

// Mounted only while the dialog is open, so each opening starts from the saved layout.
function CardsForm({ cards, pending, error, onSave }: Omit<DashboardCardsDialogProps, "open" | "onOpenChange">) {
  const [draft, setDraft] = useState(() => draftFrom(cards));
  const rows = useRef(new Map<CardId, HTMLLIElement>());
  const previousPositions = useRef<Map<CardId, number> | null>(null);
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const previous = previousPositions.current;

    if (!previous) return;

    previousPositions.current = null;
    animations.current.forEach((animation) => animation.cancel());
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    animations.current = draft.flatMap(({ id }) => {
      const row = rows.current.get(id);
      const oldTop = previous.get(id);

      if (!row || oldTop === undefined) return [];

      const offset = oldTop - row.getBoundingClientRect().top;

      if (Math.abs(offset) < 1) return [];

      return [row.animate(
        reduceMotion
          ? [{ opacity: 0.7 }, { opacity: 1 }]
          : [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
        { duration: reduceMotion ? 100 : 180, easing: reduceMotion ? "cubic-bezier(0.22, 1, 0.36, 1)" : "cubic-bezier(0.77, 0, 0.175, 1)" },
      )];
    });
  }, [draft]);

  function move(index: number, offset: number) {
    previousPositions.current = new Map(
      [...rows.current].map(([id, row]) => [id, row.getBoundingClientRect().top]),
    );
    const next = [...draft];
    const [item] = next.splice(index, 1);

    next.splice(index + offset, 0, item);
    setDraft(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draft.filter((item) => item.shown).map((item) => item.id));
  }

  return (
    <form onSubmit={submit}>
      <ul {...stylex.props(styles.list)} aria-label="Cards">
        {draft.map((item, index) => {
          const { name, description } = cardLabels[item.id];

          return (
            <li key={item.id} ref={(node) => { if (node) rows.current.set(item.id, node); else rows.current.delete(item.id); }} {...stylex.props(styles.row)}>
              <Checkbox
                id={`card-${item.id}`}
                type="button"
                checked={item.shown}
                onCheckedChange={(checked) => setDraft(draft.map((other) => (other.id === item.id ? { ...other, shown: checked === true } : other)))}
                sx={styles.checkbox}
              />
              <Label htmlFor={`card-${item.id}`} {...stylex.props(styles.label)}>
                <span {...stylex.props(styles.name, !item.shown && styles.hidden)}>{name}</span>
                <span {...stylex.props(styles.description)}>{description}</span>
              </Label>
              <Button type="button" variant="ghost" size="icon" sx={styles.move} aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={15} />
              </Button>
              <Button type="button" variant="ghost" size="icon" sx={styles.move} aria-label={`Move ${name} down`} disabled={index === draft.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown size={15} />
              </Button>
            </li>
          );
        })}
      </ul>
      {error && (
        <p {...stylex.props(formStyles.connectionError)} role="alert">
          {error}
        </p>
      )}
      <div {...stylex.props(formStyles.dialogActions, styles.actions)}>
        <Button type="button" variant="ghost" onClick={() => setDraft(draftFrom(defaultCards))}>
          Restore defaults
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  list: { listStyle: "none", margin: 0, padding: 0, borderWidth: 1, borderStyle: "solid", borderColor: colors.border, borderRadius: 8 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 8px 8px 12px",
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.border,
  },
  checkbox: { width: 16, height: 16, margin: 0, accentColor: colors.primary, cursor: "pointer" },
  label: { flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0, cursor: "pointer" },
  name: { fontSize: 14, fontWeight: 600 },
  hidden: { color: colors.mutedForeground },
  description: { color: colors.mutedForeground, fontSize: 12 },
  move: { width: 32, height: 32, color: colors.mutedForeground },
  actions: { justifyContent: "space-between", marginTop: 16 },
});
