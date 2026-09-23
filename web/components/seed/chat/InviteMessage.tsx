import { CopyButton } from "@/components/ui/CopyButton";
import { Eyebrow } from "@/components/ui/Screen";
import { CAREGIVER_INVITE_URL_PATTERN } from "@/lib/caregiver-invite";

/**
 * The message the parent sends to a caregiver they nominated (C11).
 *
 * It sits in the transcript as something to copy, not something Pando will send:
 * Pando never contacts a nominated caregiver, and nothing about them is stored
 * until they set up their own profile. The copy button is the whole feature — on a
 * phone, selecting several lines of text by hand is exactly where a parent gives up.
 *
 * The button is `CopyButton` now. Its old local copy put `aria-live` on the
 * button itself and swallowed a blocked clipboard in silence, with a comment
 * saying that was deliberate ("the text is on screen and selectable, so say
 * nothing"). It reads as a dead button, which is worse than a sentence — and the
 * sentence is the one thing that tells a parent the text *is* selectable.
 *
 * No longer a client component: everything stateful moved into `CopyButton`.
 */
export function InviteMessage({ text }: { text: string }) {
  /**
   * The link picked out (23 Sep, the developer: *"посилання в інвайті няні
   * виділи"*) — the one string in the message that has to be recognised, the
   * same reason `/done/next` picks out the referral link.
   *
   * ⚠ **Split for display only.** `text` is what `CopyButton` puts on the
   * clipboard, and any markup that reached it would arrive in somebody's chat
   * as literal angle brackets — so the message stays one plain string and the
   * pattern finds the link inside it. White on this green-wash bubble rather
   * than the wash the referral pill uses, or it would disappear into its own
   * background.
   */
  const match = CAREGIVER_INVITE_URL_PATTERN.exec(text);
  const before = match ? text.slice(0, match.index) : text;
  const link = match?.[0];
  const after = match ? text.slice(match.index + match[0].length) : "";
  return (
    <div className="animate-rise rounded-3xl rounded-bl-lg border border-green/25 bg-green-wash p-4">
      <Eyebrow tone="deep">Send this to them</Eyebrow>
      <p className="mt-2 whitespace-pre-line leading-relaxed text-ink text-control">
        {before}
        {link && (
          <span className="inline-block break-all rounded-2xl border border-green/30 bg-card px-2.5 py-1 font-semibold text-green-deep">
            {link}
          </span>
        )}
        {after}
      </p>
      <CopyButton
        className="mt-3"
        text={text}
        label="Copy the message"
        copiedLabel="Copied — paste it into your messages"
      />
    </div>
  );
}
