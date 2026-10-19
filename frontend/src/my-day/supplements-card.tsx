import * as stylex from "@stylexjs/stylex";
import { Check, Pill, Settings2, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { colors } from "../theme.stylex";
import { styles as cardStyles } from "../my-day-styles";
import { checklist, takenAt } from "../lib/supplements";
import type { Arrivals } from "../lib/use-arrivals";
import type { Supplement, SupplementDay, SupplementIntake } from "../lib/api";

type SupplementsCardProps = {
  day: SupplementDay | undefined;
  pending: boolean;
  // Intakes logged since the day opened; a fresh tick turns into its taken button with a short settle.
  arrived: Arrivals;
  onTake: (supplement: Supplement) => void;
  onRemove: (intake: SupplementIntake) => void;
  onManage: () => void;
};

export function SupplementsCard({ day, pending, arrived, onTake, onRemove, onManage }: SupplementsCardProps) {
  const { rows, unlisted, taken, total, empty } = checklist(day ?? { items: [], unlisted: [] });

  return (
    <section {...stylex.props(cardStyles.card)} aria-label="Supplements">
      <div {...stylex.props(cardStyles.cardHead, styles.headRow)}>
        <h2 {...stylex.props(cardStyles.cardTitle, styles.title)}>
          <Pill size={17} /> Supplements
        </h2>
        <span {...stylex.props(styles.head)}>
          {total > 0 ? <span {...stylex.props(cardStyles.cardAside)}>{taken} of {total} taken</span>
            : rows.length > 0 && <span {...stylex.props(cardStyles.cardAside)}>Nothing due</span>}
          <Button variant="ghost" size="icon" {...stylex.props(cardStyles.entryAction)} aria-label="Edit your supplements" title="Edit your supplements" onClick={onManage}>
            <Settings2 size={15} />
          </Button>
        </span>
      </div>
      {empty ? (
        <div {...stylex.props(styles.empty)}>
          <p {...stylex.props(styles.emptyText)}>No supplements on your list for this day.</p>
          <Button type="button" variant="outline" size="sm" onClick={onManage}>Add supplements</Button>
        </div>
      ) : (
        <ul {...stylex.props(styles.list)} aria-label="Your supplements">
          {rows.map(({ supplement, last, offDay, complete, dosesLeft, timesLabel, meta, markLabel, unmarkLabel }) => (
            <li key={supplement.id} {...stylex.props(styles.row)}>
              <span {...stylex.props(styles.label)}>
                <span {...stylex.props(styles.name, (complete || offDay) && styles.done)}>{supplement.name}</span>
                <span {...stylex.props(styles.meta)}>{meta}</span>
              </span>
              {/* One click takes it now; clicking the taken button removes the latest intake, so a slip is one click to
                  undo. While doses remain due, a tick for the next one sits beside it. */}
              <span {...stylex.props(styles.actions)}>
                {last && (
                  <Button key={last.id} variant="secondary" size="sm" {...arrived.stateProps(last.id)} {...stylex.props(styles.taken)} aria-label={unmarkLabel} disabled={pending} onClick={() => onRemove(last)}>
                    <Check size={15} /> {timesLabel}{takenAt(last)}
                  </Button>
                )}
                {(!last || dosesLeft > 0) && (
                  <Button key="untaken" variant="outline" size="icon-sm" aria-label={markLabel} title="Mark as taken" disabled={pending} onClick={() => onTake(supplement)}>
                    <Check size={15} />
                  </Button>
                )}
              </span>
            </li>
          ))}
          {unlisted.map(({ intake, time, meta, removeLabel }) => (
            <li key={intake.id} {...arrived.rowProps(intake.id)} {...stylex.props(styles.row)}>
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
  // In a narrow card the count and settings button drop under the title instead of spilling past the edge.
  headRow: { flexWrap: "wrap", rowGap: 4 },
  head: { display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", whiteSpace: "nowrap" },
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
  label: { flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" },
  done: { color: colors.mutedForeground },
  meta: { color: colors.mutedForeground, fontSize: 11, fontWeight: 400 },
  actions: { display: "flex", alignItems: "center", gap: 6, flexShrink: 0 },
  taken: { color: colors.supplements, backgroundColor: colors.supplementsSoft, fontVariantNumeric: "tabular-nums" },
});
