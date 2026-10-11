import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { CardId } from "../../../src/dashboard/contract";
import { Bone, Loading } from "../loading";
import { styles as cardStyles } from "../my-day-styles";

const styles = stylex.create({
  // Leaves the card itself as the grid item, so its span still applies.
  contents: { display: "contents" },
  body: { flex: 1, display: "flex", alignItems: "center", gap: 18 },
  column: { flex: 1, display: "grid", gap: 10, minWidth: 0 },
  centered: { flex: 1, display: "grid", alignContent: "center", gap: 10 },
  gauge: { display: "grid", justifyItems: "center", gap: 8 },
  row: { display: "flex", alignItems: "center", gap: 8 },
  bars: { display: "flex", alignItems: "flex-end", gap: 4, height: 72, marginTop: 18 },
  timeline: { display: "grid", gap: 18, padding: "18px 16px 18px 20px" },
  entry: { display: "grid", gridTemplateColumns: "38px 12px minmax(0, 1fr) auto", alignItems: "center", gap: 10 },
  entryText: { display: "grid", gap: 6 },
});

// Heights of the meals-by-hour bars, so the placeholder reads as a chart rather than a block.
const barHeights = [20, 45, 70, 30, 15, 55, 85, 40, 25, 60, 35, 18, 50, 75, 28, 42, 22, 12];

function Card({ span, children }: { span?: "full" | "wide"; children: ReactNode }) {
  return (
    <section {...stylex.props(cardStyles.card, span === "full" && cardStyles.full, span === "wide" && cardStyles.wide)}>
      <div {...stylex.props(cardStyles.cardHead)}>
        <Bone width={120} height={16} />
        <Bone width={70} height={11} />
      </div>
      {children}
    </section>
  );
}

function Rows({ count, swatch = false }: { count: number; swatch?: boolean }) {
  return (
    <div {...stylex.props(styles.column)}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} {...stylex.props(styles.row)}>
          {swatch && <Bone width={8} height={8} round />}
          <Bone width={`${70 - index * 12}%`} height={12} />
        </div>
      ))}
    </div>
  );
}

// Each card's placeholder keeps the card's span and the outline of what it draws.
const placeholders: Record<CardId, () => ReactNode> = {
  totals: () => (
    <Card span="full">
      <div {...stylex.props(cardStyles.gauges)}>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} {...stylex.props(styles.gauge)}>
            <Bone width={76} height={76} round />
            <Bone width={54} height={18} />
            <Bone width={80} height={10} />
          </div>
        ))}
      </div>
    </Card>
  ),
  water: () => (
    <Card span="wide">
      <div {...stylex.props(styles.body)}>
        <Bone width={64} height={140} />
        <div {...stylex.props(styles.column)}>
          <Bone width={90} height={34} />
          <Bone width="55%" height={12} />
          <Bone width="100%" height={84} />
          <Bone width="100%" height={64} />
        </div>
      </div>
    </Card>
  ),
  supplements: () => (
    <Card>
      <div {...stylex.props(styles.column)}>
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} {...stylex.props(styles.row)}>
            <Bone width={18} height={18} />
            <Bone width={`${64 - index * 10}%`} height={12} />
          </div>
        ))}
      </div>
    </Card>
  ),
  mix: () => (
    <Card>
      <div {...stylex.props(styles.body)}>
        <Bone width={112} height={112} round />
        <Rows count={3} swatch />
      </div>
    </Card>
  ),
  activity: () => (
    <Card>
      <div {...stylex.props(styles.body)}>
        <Bone width={112} height={112} round />
        <Rows count={3} swatch />
      </div>
    </Card>
  ),
  fasting: () => (
    <Card>
      <div {...stylex.props(styles.centered)}>
        <Bone width={130} height={34} />
        <Bone width="70%" height={12} />
        <Bone width="100%" height={8} />
      </div>
    </Card>
  ),
  largest: () => (
    <Card>
      <div {...stylex.props(styles.centered)}>
        <Bone width={110} height={34} />
        <Bone width="60%" height={14} />
        <Bone width="45%" height={12} />
      </div>
    </Card>
  ),
  meals: () => (
    <Card span="wide">
      <div {...stylex.props(styles.bars)}>
        {barHeights.map((height, index) => <Bone key={index} width="100%" height={`${height}%`} />)}
      </div>
    </Card>
  ),
};

// The cards the person shows, in their order, as placeholders, while the targets or the layout load.
export function CardsSkeleton({ cards }: { cards: readonly CardId[] }) {
  return (
    <Loading label="Loading your cards…">
      <div {...stylex.props(cardStyles.cards)}>
        {cards.map((id) => <CardSkeleton key={id} id={id} />)}
      </div>
    </Loading>
  );
}

// One card's placeholder, for a card whose own data has not arrived. The timeline announces the loading day.
export function CardSkeleton({ id }: { id: CardId }) {
  return <div aria-hidden {...stylex.props(styles.contents)}>{placeholders[id]()}</div>;
}

// The card's body only, for a card whose frame is drawn but whose own read is still on its way.
export function RingsBodySkeleton() {
  return (
    <div {...stylex.props(styles.body)} aria-hidden>
      <Bone width={112} height={112} round />
      <Rows count={3} swatch />
    </div>
  );
}

const entryWidths = ["72%", "54%", "64%", "46%", "68%"];

export function TimelineSkeleton() {
  return (
    <Loading label="Loading your food log…">
      <div {...stylex.props(styles.timeline)}>
        {entryWidths.map((width, index) => (
          <div key={index} {...stylex.props(styles.entry)}>
            <Bone width={36} height={10} />
            <Bone width={10} height={10} round />
            <span {...stylex.props(styles.entryText)}>
              <Bone width={width} height={13} />
              <Bone width="40%" height={10} />
            </span>
            <Bone width={34} height={10} />
          </div>
        ))}
      </div>
    </Loading>
  );
}
