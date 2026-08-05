import { cn } from "@/lib/cn";

/**
 * Segmented, not a smooth bar: a parent can see how many taps are left, which
 * is the thing that actually reduces drop-off (spec §8.5 — show a time estimate).
 */
export function Progress({
  total,
  current,
}: {
  total: number;
  current: number;
}) {
  return (
    <div
      className="flex items-center gap-1"
      role="progressbar"
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current + 1}
      aria-label={`Step ${current + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors duration-300",
            i < current
              ? "bg-green"
              : i === current
                ? "bg-green-deep"
                : "bg-bark",
          )}
        />
      ))}
    </div>
  );
}
