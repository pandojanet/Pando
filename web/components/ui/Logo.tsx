import { cn } from "@/lib/cn";

/** The Pando mark: an aspen leaf over three dots — a message, and a root system. */
export function PandoMark({
  className,
  tone = "dark",
  pulse,
}: {
  className?: string;
  /** "light" for use on the moss brand panel. */
  tone?: "dark" | "light";
  /** Ticks the three dots like a typing indicator — used on the public site. */
  pulse?: boolean;
}) {
  const leaf = tone === "light" ? "var(--color-gold)" : "var(--color-green)";
  const dots = tone === "light" ? "var(--color-paper)" : "var(--color-ink)";
  const dot = (delay: number) =>
    pulse
      ? {
          animation: "dot-tick 1.4s ease-in-out infinite",
          animationDelay: `${delay}s`,
        }
      : undefined;

  return (
    <svg
      viewBox="0 0 26 29"
      className={cn("h-7 w-auto", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M13 2C9 6.5 7.5 9.5 7.5 12.5C7.5 16 10 18.5 13 18.5C16 18.5 18.5 16 18.5 12.5C18.5 9.5 17 6.5 13 2Z"
        fill={leaf}
      />
      <path d="M13 17.2V22" stroke={leaf} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="7.4" cy="25.4" r="1.55" fill={dots} style={dot(0)} />
      <circle cx="13" cy="25.4" r="1.55" fill={dots} style={dot(0.2)} />
      <circle cx="18.6" cy="25.4" r="1.55" fill={dots} style={dot(0.4)} />
    </svg>
  );
}

export function Wordmark({
  className,
  tone = "dark",
  markClassName,
  pulse,
}: {
  className?: string;
  tone?: "dark" | "light";
  markClassName?: string;
  pulse?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <PandoMark className={cn("h-6", markClassName)} tone={tone} pulse={pulse} />
      <span className="font-display text-[1.15rem] font-bold tracking-[-0.02em]">
        Pando
      </span>
    </span>
  );
}
