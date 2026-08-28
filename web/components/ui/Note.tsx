/**
 * Something didn't work, said to a parent mid-flow.
 *
 * ## Why this is a component
 *
 * There were four of these across `ProfileFlow`, `VerifyPhone` and
 * `CaregiverFlow`, hand-written each time, and the duplication had produced two
 * separate faults.
 *
 * **None of them was announced.** A parent types a wrong code, or taps "Save my
 * profile" and it fails, and the only thing that happens is a line of text
 * appearing somewhere they are not looking. On the OTP screen that is the
 * difference between "I mistyped" and "this app is broken".
 *
 * **Two of the four were red.** `text-alert` next to copy that reads *"Your
 * answers are safe on this phone — try again"* is the colour contradicting the
 * sentence: red says something is lost, and nothing is. Every one of these
 * messages is recoverable by definition — the parent can retry, and their
 * answers are on the device either way — so gold is the honest register, and it
 * is the one the other two had already converged on.
 *
 * `role="alert"` rather than `status`: it interrupts, because the thing the
 * parent just tried did not happen and they are about to move on believing it
 * did.
 */
export function Note({
  children,
  className = "mt-3",
}: {
  children: React.ReactNode;
  /** Spacing only — one of these sits above a button in a dock, the rest below. */
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={`${className} animate-rise rounded-2xl border border-gold-line bg-gold-wash p-3 text-[14px] font-medium text-gold-ink`}
    >
      {children}
    </p>
  );
}
