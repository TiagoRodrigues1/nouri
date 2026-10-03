import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { calendarDate } from "./lib/time";
import { styles } from "./progress-styles";

export type ProgressPoint = { date: string; value: number; label: string };

const height = 220;

const margin = { top: 16, right: 16, bottom: 28, left: 44 };

const day = 86_400_000;

const axisDate = new Intl.DateTimeFormat("en", { day: "numeric", month: "short" });

// About four round steps covering the values, so gridlines land on numbers people read at a glance.
function ticks(min: number, max: number): number[] {
  const span = max - min || Math.max(Math.abs(max), 1);
  const rough = span / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= rough) ?? rough;
  const low = Math.floor((max === min ? min - span / 2 : min) / step) * step;
  const high = Math.ceil((max === min ? max + span / 2 : max) / step) * step;

  return Array.from({ length: Math.round((high - low) / step) + 1 }, (_, index) => low + index * step);
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

// One series over calendar time: a 2 px line, ringed dots, and a crosshair that snaps to the nearest session.
export function ProgressChart({ points, label, unit }: { points: ProgressPoint[]; label: string; unit: string }) {
  const { ref, width } = useWidth();
  const [active, setActive] = useState<number | null>(null);

  const times = points.map((point) => calendarDate(point.date).getTime());
  const first = times[0] ?? 0;
  const last = times.at(-1) ?? first;
  const values = ticks(Math.min(...points.map((point) => point.value)), Math.max(...points.map((point) => point.value)));
  const low = values[0] ?? 0;
  const high = values.at(-1) ?? 1;
  const plotWidth = Math.max(width - margin.left - margin.right, 1);
  const plotHeight = height - margin.top - margin.bottom;
  // A lone session, or several on one day, sits in the middle rather than on the axis.
  const x = (time: number) => margin.left + (last === first ? plotWidth / 2 : ((time - first) / (last - first)) * plotWidth);
  const y = (value: number) => margin.top + plotHeight - ((value - low) / (high - low || 1)) * plotHeight;
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(times[index] ?? first)} ${y(point.value)}`).join(" ");
  const spanDays = (last - first) / day;
  const dateTicks = spanDays < 1 ? [first] : [first, first + (last - first) / 2, last];

  function nearest(event: PointerEvent<SVGSVGElement>) {
    const pointer = event.clientX - event.currentTarget.getBoundingClientRect().left;
    let best = 0;

    times.forEach((time, index) => {
      if (Math.abs(x(time) - pointer) < Math.abs(x(times[best] ?? first) - pointer)) best = index;
    });
    setActive(best);
  }

  function step(event: KeyboardEvent<SVGSVGElement>) {
    const move = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;

    if (move === 0) return;
    event.preventDefault();
    setActive((current) => Math.min(Math.max((current ?? points.length) + move, 0), points.length - 1));
  }

  const shown = active === null ? null : points[active];
  const shownX = active === null ? 0 : x(times[active] ?? first);

  return (
    <div ref={ref} {...stylex.props(styles.chart)}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${label} over ${points.length} sessions. Use the arrow keys to read each session; the table below lists them all.`}
          tabIndex={0}
          onPointerMove={nearest}
          onPointerLeave={() => setActive(null)}
          onKeyDown={step}
          onBlur={() => setActive(null)}
          {...stylex.props(styles.svg)}
        >
          {values.map((value) => (
            <g key={value}>
              <line x1={margin.left} x2={width - margin.right} y1={y(value)} y2={y(value)} {...stylex.props(styles.grid)} />
              <text x={margin.left - 8} y={y(value)} dy="0.32em" textAnchor="end" {...stylex.props(styles.axisText)}>{value}</text>
            </g>
          ))}
          {dateTicks.map((time, index) => (
            <text key={time} x={x(time)} y={height - 8} textAnchor={dateTicks.length === 1 ? "middle" : index === 0 ? "start" : index === dateTicks.length - 1 ? "end" : "middle"} {...stylex.props(styles.axisText)}>
              {axisDate.format(new Date(time))}
            </text>
          ))}
          {shown && <line x1={shownX} x2={shownX} y1={margin.top} y2={margin.top + plotHeight} {...stylex.props(styles.crosshair)} />}
          <path d={path} {...stylex.props(styles.line)} />
          {points.map((point, index) => (
            <circle key={`${point.date}-${index}`} cx={x(times[index] ?? first)} cy={y(point.value)} r={index === active ? 6 : 4} {...stylex.props(styles.dot)} />
          ))}
        </svg>
      )}
      {shown && (
        // Beside the crosshair, on the side with more room, so it never covers the point it describes.
        <div {...stylex.props(styles.tooltip, shownX > width / 2 && styles.tooltipLeft)} style={{ left: shownX, top: margin.top }} role="status">
          <strong>{shown.value} {unit}</strong>
          <span>{shown.label}</span>
        </div>
      )}
    </div>
  );
}
