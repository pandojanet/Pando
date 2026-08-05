"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "gold" | "secondary" | "ghost";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-green-deep text-white hover:bg-ink disabled:bg-bark disabled:text-muted",
  gold: "bg-gold text-ink hover:bg-gold-deep disabled:bg-bark disabled:text-muted",
  secondary:
    "bg-card text-ink border border-bark hover:border-green/60 disabled:text-muted",
  ghost: "bg-transparent text-muted hover:text-green-deep",
};

// 52px tall: comfortable for a thumb on a phone held one-handed.
const BASE =
  "inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold " +
  "transition-[transform,background-color,color,border-color] duration-150 active:scale-[0.985] " +
  "disabled:cursor-not-allowed disabled:active:scale-100";

/** For links that should look like buttons — never nest a <button> inside <a>. */
export function buttonClass(
  variant: Variant = "primary",
  full = false,
  className?: string,
): string {
  return cn(BASE, full && "w-full", VARIANTS[variant], className);
}

export function Button({
  variant = "primary",
  full,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button {...rest} className={buttonClass(variant, full, className)}>
      {children}
    </button>
  );
}

export function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("h-4 w-4", className)}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 8h11m0 0-4-4m4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
