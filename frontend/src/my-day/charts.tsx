import * as stylex from "@stylexjs/stylex";
import { Fragment, useId } from "react";
import { styles } from "../my-day-styles";

type RingProps = {
  size: number;
  stroke: number;
  share: number;
  color: string;
  sweep?: number;
};

export function Ring({ size, stroke, share, color, sweep = 1 }: RingProps) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const arc = length * sweep;
  const filled = arc * Math.min(Math.max(share, 0), 1);
  const rotate = sweep === 1 ? -90 : 90 + (360 * (1 - sweep)) / 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(${rotate} ${size / 2} ${size / 2})`} fill="none" strokeWidth={stroke} strokeLinecap="round">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeDasharray={`${arc} ${length}`} {...stylex.props(styles.ringTrack)} />
        {filled > 0 && (
          <circle cx={size / 2} cy={size / 2} r={radius} strokeDasharray={`${filled} ${length}`} {...stylex.props(styles.ringStroke(color))} />
        )}
      </g>
    </svg>
  );
}


type DonutProps = {
  size: number;
  stroke: number;
  parts: { value: number; color: string }[];
};

// Segments are separated by a small gap so neighbouring macros stay distinct.
export function Donut({ size, stroke, parts }: DonutProps) {
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  const visible = parts.filter((part) => part.value > 0);
  const gap = visible.length > 1 ? 3 : 0;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`} fill="none" strokeWidth={stroke}>
        <circle cx={size / 2} cy={size / 2} r={radius} {...stylex.props(styles.ringTrack)} />
        {total > 0 &&
          visible.map((part) => {
            const arc = (part.value / total) * length;
            const start = offset;

            offset += arc;

            return (
              <circle
                key={part.color}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeDasharray={`${Math.max(arc - gap, 0)} ${length}`}
                strokeDashoffset={-start}
                {...stylex.props(styles.ringStroke(part.color))}
              />
            );
          })}
      </g>
    </svg>
  );
}

export type ActivityRing = { label: string; value: number; goal: number; unit: string; color: string };

export function ActivityRings({ rings, size, stroke }: { rings: ActivityRing[]; size: number; stroke: number }) {
  const spacing = 2;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`} fill="none" strokeWidth={stroke} strokeLinecap="round">
        {rings.map((ring, index) => {
          const radius = (size - stroke) / 2 - index * (stroke + spacing);
          const length = 2 * Math.PI * radius;
          const filled = length * Math.min(Math.max(ring.value / ring.goal, 0), 1);

          return (
            <Fragment key={ring.label}>
              <circle cx={size / 2} cy={size / 2} r={radius} {...stylex.props(styles.activityTrack(ring.color))} />
              {filled > 0 && (
                <circle cx={size / 2} cy={size / 2} r={radius} strokeDasharray={`${filled} ${length}`} {...stylex.props(styles.ringStroke(ring.color))} />
              )}
            </Fragment>
          );
        })}
      </g>
    </svg>
  );
}

// Fillable height inside the bottle outline, from the base (y 146) to the shoulder (y 40).
const bottleBase = 146;

const bottleDepth = 106;

const wave = `M-40 4${" q10 -5 20 0 t20 0".repeat(5)} V${bottleBase + 10} H-40 Z`;

const bottleLevel = (share: number) => bottleBase - bottleDepth * Math.min(Math.max(share, 0), 1);

// `preview` is the share a drink would bring the bottle to, drawn as a dashed line above the water.
export function Bottle({ share, preview }: { share: number; preview?: number }) {
  const clip = useId();
  const level = bottleLevel(share);
  const after = preview == null ? level : bottleLevel(preview);
  const outline = "M30 16 H50 V26 C50 32 68 36 68 50 V136 Q68 146 58 146 H22 Q12 146 12 136 V50 C12 36 30 32 30 26 Z";

  return (
    <svg width={80} height={150} viewBox="0 0 80 150" aria-hidden {...stylex.props(styles.bottle)}>
      <defs>
        <clipPath id={clip}>
          <path d={outline} />
        </clipPath>
      </defs>
      <rect x={27} y={3} width={26} height={13} rx={3} {...stylex.props(styles.bottleCap)} />
      <path d={outline} {...stylex.props(styles.bottleGlass)} />
      <g clipPath={`url(#${clip})`}>
        <g {...stylex.props(styles.waterLevel(level))}>
          <path d={wave} {...stylex.props(styles.waveBack)} />
          <path d={wave} {...stylex.props(styles.waveFront)} />
        </g>
        <g {...stylex.props(styles.bottlePreview, preview != null && styles.bottlePreviewShown)}>
          <rect x={0} y={after} width={80} height={level - after} {...stylex.props(styles.bottlePreviewFill)} />
          <line x1={10} x2={70} y1={after} y2={after} {...stylex.props(styles.bottlePreviewLine)} />
        </g>
      </g>
      {[0.25, 0.5, 0.75].map((mark) => (
        <line key={mark} x1={56} x2={64} y1={bottleBase - bottleDepth * mark} y2={bottleBase - bottleDepth * mark} {...stylex.props(styles.bottleTick)} />
      ))}
      <path d={outline} {...stylex.props(styles.bottleOutline)} />
    </svg>
  );
}
