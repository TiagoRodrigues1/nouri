import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"

// Values past the target stay in the accessible value but the bar stops at full.
function Progress({
  className,
  value,
  max,
  color = "var(--primary)",
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, "value" | "max"> & {
  value: number
  max: number
  color?: string
}) {
  const share = Math.min(Math.max(value / max, 0), 1) * 100

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={Math.min(value, max)}
      max={max}
      className={cn(
        "relative flex h-2 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      {/* Width rather than a transform, so an empty bar shows no antialiased sliver at the rounded edge. */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full rounded-full transition-[width] duration-400 motion-reduce:transition-none"
        style={{ width: `${share}%`, backgroundColor: color }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
