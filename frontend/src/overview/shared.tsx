import * as stylex from "@stylexjs/stylex";
import { useId, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Trash2 } from "lucide-react";
import { styles } from "../overview-styles";

export const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

export function Section({ title, description, icon, color, action, children }: { title: string; description: string; icon: ReactNode; color: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();

  return (
    <section aria-labelledby={id} {...stylex.props(styles.section)}>
      <header {...stylex.props(styles.sectionHeader)}>
        <span {...stylex.props(styles.sectionIcon(color))}>{icon}</span>
        <div {...stylex.props(styles.sectionText)}>
          <h2 id={id} {...stylex.props(styles.sectionTitle)}>{title}</h2>
          <p {...stylex.props(styles.sectionDescription)}>{description}</p>
        </div>
        {action}
      </header>
      <div {...stylex.props(styles.grid)}>{children}</div>
    </section>
  );
}

export function Tile({ title, icon, aside, wide = false, children }: { title: string; icon: ReactNode; aside?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <Card sx={[styles.tile, wide && styles.wide]}>
      <CardHeader sx={styles.tileHeader}>
        <CardTitle sx={styles.tileTitle}>
          {icon} {title}
        </CardTitle>
        {aside && <span {...stylex.props(styles.aside)}>{aside}</span>}
      </CardHeader>
      <CardContent sx={styles.tileContent}>{children}</CardContent>
    </Card>
  );
}

export function Value({ value, unit }: { value: string; unit?: string }) {
  return (
    <div>
      <span {...stylex.props(styles.value)}>{value}</span>
      {unit && <span {...stylex.props(styles.unit)}>{unit}</span>}
    </div>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.caption)}>{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.empty)}>{children}</p>;
}

export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);

  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

export function Stat({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div {...stylex.props(styles.row)}>
      {icon && <span {...stylex.props(styles.statIcon)}>{icon}</span>}
      <span {...stylex.props(styles.rowLabel, styles.grow)}>{label}</span>
      <span {...stylex.props(styles.rowValue)}>{value}</span>
    </div>
  );
}

export function DeleteButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" size="icon" sx={styles.delete} aria-label={label} disabled={disabled} onClick={onClick}>
      <Trash2 size={14} />
    </Button>
  );
}

export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div {...stylex.props(styles.sparkline)} />;
  const low = Math.min(...points);
  const span = Math.max(...points) - low || 1;
  const path = points.map((point, index) => `${(index / (points.length - 1)) * 200},${44 - ((point - low) / span) * 40}`).join(" ");

  return (
    <svg viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden {...stylex.props(styles.sparkline)}>
      <polyline points={path} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" {...stylex.props(styles.sparklineStroke)} />
    </svg>
  );
}

