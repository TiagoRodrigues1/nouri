import * as stylex from "@stylexjs/stylex";
import { Check, ListChecks, Pill, Settings2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Progress } from "../components/ui/progress";
import { checklist, takenAt } from "../lib/supplements";
import type { SupplementDay } from "../lib/api";
import { useSupplements } from "../lib/use-supplements";
import { useDashboardPage } from "../dashboard-page-context";
import { styles } from "../overview-styles";
import { colors } from "../theme.stylex";
import { Caption, DeleteButton, Empty, Section, Tile, Value } from "./shared";

export function SupplementsSection({ day }: { day: SupplementDay }) {
  const { token, date, onManageSupplements: onManage } = useDashboardPage();
  const { pending, take: onTake, remove: onRemove } = useSupplements(token, date);
  const { rows, unlisted, taken, total, empty } = checklist(day);
  const left = total - taken;

  return (
    <Section
      title="Supplements"
      description="What you take each day. One click marks it taken."
      icon={<Pill size={18} />}
      color={colors.supplements}
      action={<Button variant="outline" size="sm" onClick={onManage}><Settings2 size={15} /> Edit list</Button>}
    >
      <Tile title="Taken" icon={<ListChecks size={16} />}>
        <Value value={String(taken)} unit={`of ${total}`} />
        {total > 0 && <Progress value={taken} max={total} color={colors.supplements} aria-label="Supplements taken" />}
        <Caption>{total === 0 ? "No supplements on your list" : left === 0 ? "All taken for the day" : `${left} still to take`}</Caption>
      </Tile>
      <Tile title="Checklist" icon={<Pill size={16} />} wide>
        {empty ? (
          <>
            <Empty>No supplements on your list for this day.</Empty>
            <div {...stylex.props(styles.actions)}>
              <Button variant="outline" size="sm" onClick={onManage}>Add supplements</Button>
            </div>
          </>
        ) : (
          <ul {...stylex.props(styles.list)} aria-label="Supplement checklist">
            {rows.map(({ supplement, last, timesLabel, meta, markLabel, unmarkLabel }) => (
              <li key={supplement.id} {...stylex.props(styles.listRow)}>
                <span {...stylex.props(styles.listText)}>
                  <strong {...stylex.props(styles.listName, last && local.done)}>{supplement.name}</strong>
                  <small {...stylex.props(styles.listMeta)}>{meta}</small>
                </span>
                {/* One click takes it now; clicking the taken button removes the latest intake, so a slip is one click to undo. */}
                {last ? (
                  <Button variant="secondary" size="sm" {...stylex.props(local.taken)} aria-label={unmarkLabel} disabled={pending} onClick={() => onRemove(last)}>
                    <Check size={15} /> {timesLabel}{takenAt(last)}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" aria-label={markLabel} disabled={pending} onClick={() => onTake(supplement)}>
                    Take
                  </Button>
                )}
              </li>
            ))}
            {unlisted.map(({ intake, time, meta, removeLabel }) => (
              <li key={intake.id} {...stylex.props(styles.listRow)}>
                <span {...stylex.props(styles.listText)}>
                  <strong {...stylex.props(styles.listName)}>{intake.name}</strong>
                  <small {...stylex.props(styles.listMeta)}>taken at {time} · {meta}</small>
                </span>
                <DeleteButton label={removeLabel} disabled={pending} onClick={() => onRemove(intake)} />
              </li>
            ))}
          </ul>
        )}
      </Tile>
    </Section>
  );
}

const local = stylex.create({
  done: { color: colors.mutedForeground },
  taken: { color: colors.supplements, backgroundColor: colors.supplementsSoft, fontVariantNumeric: "tabular-nums" },
});
