import * as stylex from "@stylexjs/stylex";
import { Pill, Settings2, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import { colors } from "../theme.stylex";
import { styles as cardStyles } from "../my-day-styles";
import { checklist, takenAt } from "../lib/supplements";
import type { Supplement, SupplementDay, SupplementIntake } from "../lib/api";

type SupplementsCardProps = {
  connected: boolean;
  day: SupplementDay | undefined;
  pending: boolean;
  onTake: (supplement: Supplement) => void;
  onRemove: (intake: SupplementIntake) => void;
  onManage: () => void;
};

export function SupplementsCard({ connected, day, pending, onTake, onRemove, onManage }: SupplementsCardProps) {
  const { rows, unlisted, taken, total, empty } = checklist(day ?? { items: [], unlisted: [] });

  return (
    <section {...stylex.props(cardStyles.card)} aria-label="Supplements">
      <div {...stylex.props(cardStyles.cardHead)}>
        <h2 {...stylex.props(cardStyles.cardTitle, styles.title)}>
          <Pill size={17} /> Supplements
        </h2>
        <span {...stylex.props(styles.head)}>
          {total > 0 && <span {...stylex.props(cardStyles.cardAside)}>{taken} of {total} taken</span>}
          <Button variant="ghost" size="icon" {...stylex.props(cardStyles.entryAction)} aria-label="Edit your supplements" title="Edit your supplements" onClick={onManage}>
            <Settings2 size={15} />
          </Button>
        </span>
      </div>
      {empty ? (
        <div {...stylex.props(styles.empty)}>
          <p {...stylex.props(styles.emptyText)}>{connected ? "No supplements on your list for this day." : "Connect to track your supplements."}</p>
          <Button type="button" variant="outline" size="sm" onClick={onManage}>Add supplements</Button>
        </div>
      ) : (
        <ul {...stylex.props(styles.list)} aria-label="Your supplements">
          {rows.map(({ supplement, last, timesLabel, meta, markLabel, unmarkLabel }) => {
            const id = `supplement-${supplement.id}`;

            return (
              <li key={supplement.id} {...stylex.props(styles.row)}>
                {/* Ticking logs an intake now; unticking removes the latest one, so a mistaken tap is one click to undo. */}
                <Checkbox
                  id={id}
                  checked={Boolean(last)}
                  aria-label={last ? unmarkLabel : markLabel}
                  disabled={!connected || pending}
                  onCheckedChange={() => (last ? onRemove(last) : onTake(supplement))}
                  {...stylex.props(styles.check)}
                />
                <Label htmlFor={id} {...stylex.props(styles.label)}>
                  <span {...stylex.props(styles.name, last && styles.done)}>{supplement.name}</span>
                  <span {...stylex.props(styles.meta)}>{meta}</span>
                </Label>
                {last && (
                  <time dateTime={last.occurredAt} {...stylex.props(cardStyles.entryTime)}>
                    {timesLabel}{takenAt(last)}
                  </time>
                )}
              </li>
            );
          })}
          {unlisted.map(({ intake, time, meta, removeLabel }) => (
            <li key={intake.id} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.label)}>
                <span {...stylex.props(styles.name)}>{intake.name}</span>
                <span {...stylex.props(styles.meta)}>{meta}</span>
              </span>
              <time dateTime={intake.occurredAt} {...stylex.props(cardStyles.entryTime)}>{time}</time>
              <Button variant="ghost" size="icon" {...stylex.props(cardStyles.entryAction)} aria-label={removeLabel} disabled={pending} onClick={() => onRemove(intake)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const styles = stylex.create({
  title: { color: colors.supplements },
  head: { display: "flex", alignItems: "center", gap: 6 },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    padding: 16,
    textAlign: "center",
  },
  emptyText: { margin: 0, color: colors.mutedForeground, fontSize: 12 },
  list: { listStyle: "none", margin: 0, padding: 0, maxHeight: 220, overflowY: "auto" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: colors.muted,
  },
  check: { flexShrink: 0 },
  label: { flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, minWidth: 0, cursor: "pointer" },
  name: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" },
  done: { color: colors.mutedForeground },
  meta: { color: colors.mutedForeground, fontSize: 11, fontWeight: 400 },
});
