import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { styles } from "../my-day-styles";
import { format } from "../lib/api";

// Each size draws as the container it usually comes in, sized so the icons read small to large.
const sizes = [
  {
    volumeMl: 250,
    name: "Glass",
    label: "250",
    width: 22,
    height: 28,
    fill: "M4 8 L18 8 L16.6 25 H5.4 Z",
    outline: "M2 2 H20 L17.5 26 H4.5 Z",
  },
  {
    volumeMl: 500,
    name: "Bottle",
    label: "500",
    width: 20,
    height: 38,
    fill: "M3 14 H17 V34 Q17 36 15 36 H5 Q3 36 3 34 Z",
    outline: "M7 1.5 H13 V6 C13 8 18 9 18 13 V34 Q18 36.5 15.5 36.5 H4.5 Q2 36.5 2 34 V13 C2 9 7 8 7 6 Z",
  },
  {
    volumeMl: 1000,
    name: "Carafe",
    label: "1 L",
    width: 30,
    height: 46,
    fill: "M5 20 C5 18 9 17 21 17 C25 17 25 18 25 20 V41 Q25 43.5 22.5 43.5 H7.5 Q5 43.5 5 41 Z",
    outline: "M9 2 H21 V9 C21 11 27 12 27 18 V41 Q27 44.5 23.5 44.5 H6.5 Q3 44.5 3 41 V18 C3 12 9 11 9 9 Z M10 2 H20",
  },
] as const;

type WaterQuickAddProps = {
  // The drink being pointed at, whose icon shows full.
  preview: number | null;
  pending: boolean;
  onAim: (volumeMl: number | null) => void;
  onAdd: (volumeMl: number) => void;
};

export function WaterQuickAdd({ preview, pending, onAim: aim, onAdd }: WaterQuickAddProps) {
  // The latest tap. Its key restarts the drink and float animations on the tile that was tapped.
  const [poured, setPoured] = useState<{ volumeMl: number; key: number } | null>(null);

  return (
    <div {...stylex.props(styles.waterSizes)}>
      {sizes.map((size) => (
        <Button
          key={size.volumeMl}
          type="button"
          variant="outline"
          {...stylex.props(styles.waterSize)}
          aria-label={`Log ${size.volumeMl} ml of water`}
          disabled={pending}
          onPointerEnter={() => aim(size.volumeMl)}
          onPointerLeave={() => aim(null)}
          onFocus={(event) => event.currentTarget.matches(":focus-visible") && aim(size.volumeMl)}
          onBlur={() => aim(null)}
          onClick={() => {
            setPoured({ volumeMl: size.volumeMl, key: Date.now() });
            onAdd(size.volumeMl);
          }}
        >
          <svg
            key={poured?.volumeMl === size.volumeMl ? `icon-${poured.key}` : "icon"}
            width={size.width}
            height={size.height}
            viewBox={`0 0 ${size.width} ${size.height}`}
            aria-hidden
            {...stylex.props(styles.vesselIcon)}
            // The button shrinks icons to 16px; these are drawn to scale with their volume.
            style={{ width: size.width, height: size.height }}
          >
            <path d={size.fill} {...stylex.props(styles.vesselFill, preview === size.volumeMl && styles.vesselFull, poured?.volumeMl === size.volumeMl && styles.vesselDrink)} />
            <path d={size.outline} {...stylex.props(styles.vesselOutline)} />
          </svg>
          <span {...stylex.props(styles.waterSizeMl)}>{size.label}</span>
          <span {...stylex.props(styles.waterSizeName)}>{size.name}</span>
          {poured?.volumeMl === size.volumeMl && (
            <span key={`float-${poured.key}`} aria-hidden {...stylex.props(styles.waterFloat)}>+{format(size.volumeMl)}</span>
          )}
        </Button>
      ))}
    </div>
  );
}
