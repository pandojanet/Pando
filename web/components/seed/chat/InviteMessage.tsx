import { CopyButton } from "@/components/ui/CopyButton";
import { Eyebrow } from "@/components/ui/Screen";

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
  return (
    <div className="animate-rise rounded-3xl rounded-bl-lg border border-green/25 bg-green-wash p-4">
      <Eyebrow tone="deep">Send this to them</Eyebrow>
      <p className="mt-2 whitespace-pre-line leading-relaxed text-ink text-control">
        {text}
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
