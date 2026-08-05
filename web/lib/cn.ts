/** Tiny class joiner — no runtime dependency needed for this app's size. */
export function cn(
  ...parts: Array<string | false | null | undefined>
): string {
  return parts.filter(Boolean).join(" ");
}
