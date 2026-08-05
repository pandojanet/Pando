"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { track } from "@/lib/analytics";
import {
  classifyDemand,
  DEMAND_CATEGORIES,
  type DemandSensitivity,
} from "@/lib/demand";

/**
 * D1 — the closing question, on the completion screen.
 *
 * It sits at the end on purpose: everything up to here has been the parent giving.
 * This is the first moment they can ask for something, which is why it doubles as
 * the emotional close and as the launch-day question inventory.
 *
 * What the client's question set adds, and what most of this file is: the answer
 * depends on what they asked. "You'll hear the moment the network can answer it" is
 * right for a camp and wrong for "is this normal, and who do I call?" — so a
 * sensitive question gets a response in-flow and is only saved with permission, and
 * a health, legal or safety question gets professional resources immediately plus an
 * admin flag. Never banked silently.
 */

export interface DemandValue {
  question_text: string;
  category: string | null;
  /** Set by the classifier, and echoed back by the server for the record. */
  sensitivity?: DemandSensitivity;
  /** Peer-support questions are only stored if the parent says yes. */
  may_save?: boolean;
}

export function DemandQuestion({
  saved,
  onSave,
}: {
  saved: DemandValue | null;
  onSave: (value: DemandValue) => void;
}) {
  const [text, setText] = useState(saved?.question_text ?? "");
  const [category, setCategory] = useState<string | null>(saved?.category ?? null);
  const [stage, setStage] = useState<"asking" | "responding" | "done">(
    saved ? "done" : "asking",
  );
  const sensitivity = classifyDemand(text, category);

  function submit() {
    const value: DemandValue = {
      question_text: text.trim(),
      category,
      sensitivity,
    };
    track("seed_demand_captured", {
      has_category: category !== null,
      sensitivity,
    });

    // Ordinary questions are saved and acknowledged. Anything else gets answered
    // first — and a peer-support question isn't stored until they agree.
    if (sensitivity === "ordinary") {
      onSave({ ...value, may_save: true });
      setStage("done");
      return;
    }
    setStage("responding");
  }

  if (stage === "done") {
    return (
      <div className="mt-7 rounded-3xl border border-green/25 bg-green-wash p-5">
        <p className="text-[15.5px] font-semibold text-green-deep">
          Noted — that&apos;s yours.
        </p>
        {(saved?.question_text || text) && (
          <p className="mt-1.5 text-[14px] leading-relaxed text-green-deep/90">
            {saved?.question_text || text}
          </p>
        )}
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          You&apos;ll hear the moment the network can answer it — not before.
        </p>
        <button
          type="button"
          onClick={() => setStage("asking")}
          className="mt-2 min-h-11 text-[14px] font-semibold text-green-deep underline underline-offset-2"
        >
          Change it
        </button>
      </div>
    );
  }

  if (stage === "responding") {
    return (
      <Response
        sensitivity={sensitivity}
        onKeep={(maySave) => {
          /* "Just needed to say it" has to mean it on this device too — the server
             drops the text either way, but leaving it in the session would be us
             keeping something they asked us not to keep. */
          if (!maySave) setText("");
          onSave({
            question_text: maySave ? text.trim() : "",
            category,
            sensitivity,
            may_save: maySave,
          });
          track("seed_demand_response_shown", { sensitivity, saved: maySave });
          setStage("done");
        }}
      />
    );
  }

  return (
    <div className="mt-7 rounded-3xl border border-bark bg-card p-5 shadow-card">
      <p className="text-[12.5px] font-semibold uppercase tracking-[0.1em] text-green">
        One last thing — this bit&apos;s for you
      </p>
      <h2 className="mt-2 font-display text-[1.15rem] font-semibold">
        What&apos;s one parenting question or decision you&apos;d genuinely want to
        ask Pando?
      </h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-muted">
        Local, practical — or something you might not feel comfortable posting in a
        parent group.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 300))}
        rows={2}
        placeholder="e.g. summer camps for a 5-year-old that aren't a fortune"
        aria-label="What would you want to ask Pando?"
        className="mt-3 w-full resize-none rounded-2xl border border-bark bg-paper px-4 py-3 text-[16px] leading-snug outline-none placeholder:text-muted/60 focus:border-green"
      />

      <p className="mt-3 text-[13.5px] font-semibold">What&apos;s it about?</p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Category">
        {DEMAND_CATEGORIES.map((option) => (
          <Chip
            key={option.id}
            label={option.label}
            mode="single"
            selected={category === option.id}
            onToggle={() => setCategory(category === option.id ? null : option.id)}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button full disabled={text.trim().length === 0} onClick={submit}>
          Done
        </Button>
        <Button
          variant="secondary"
          full
          onClick={() => {
            onSave({ question_text: "", category: null });
            setStage("done");
            track("seed_demand_skipped");
          }}
        >
          Skip
        </Button>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted">
        We&apos;ll text you when Pando can actually help — we&apos;re not promising an
        answer today.
      </p>
    </div>
  );
}

/**
 * The in-flow answer. Two shapes, and the difference is deliberate:
 *  - peer support gets recognition, an explanation of how Pando handles it, and a
 *    real choice about whether it is kept at all;
 *  - health, legal or safety gets resources *now*, because "you'll hear at launch"
 *    must never be the only reply to it.
 */
function Response({
  sensitivity,
  onKeep,
}: {
  sensitivity: DemandSensitivity;
  onKeep: (maySave: boolean) => void;
}) {
  if (sensitivity === "high_stakes") {
    return (
      <div className="mt-7 rounded-3xl border border-gold-line bg-gold-wash p-5">
        <h2 className="font-display text-[1.15rem] font-semibold text-gold-ink">
          This one shouldn&apos;t wait for us.
        </h2>
        <p className="mt-2 text-[15px] leading-relaxed text-gold-ink/90">
          Pando is a parent network, not a professional service — and for anything
          touching health, legal questions or safety, the right answer is someone
          qualified, today.
        </p>
        <ul className="mt-3 space-y-1.5 text-[14.5px] leading-relaxed text-gold-ink/90">
          <li>
            <strong>Immediate danger:</strong> 911.
          </li>
          <li>
            <strong>Medical advice, any hour:</strong> your pediatrician&apos;s
            after-hours line, or the LA County nurse line at 211.
          </li>
          <li>
            <strong>Someone to talk to now:</strong> call or text 988 (Suicide &amp;
            Crisis Lifeline).
          </li>
          <li>
            <strong>Legal help:</strong> Neighborhood Legal Services of LA County,
            1-800-433-6251.
          </li>
        </ul>
        <p className="mt-3 text-[13.5px] leading-relaxed text-gold-ink/80">
          A person on our team will see that you asked, so we can follow up properly.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button full onClick={() => onKeep(true)}>
            Thanks — keep my question
          </Button>
          <Button variant="secondary" full onClick={() => onKeep(false)}>
            Don&apos;t keep it
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-7 rounded-3xl border border-green/25 bg-green-wash p-5">
      <h2 className="font-display text-[1.15rem] font-semibold text-green-deep">
        You&apos;re not the only one.
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        Thank you for trusting Pando with that. It&apos;s the kind of question
        parents almost never post in a group chat — which is exactly why it goes
        somewhere else.
      </p>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        Pando puts questions like this to a small, private, matched group of parents
        who have lived the same thing — never a public feed, never with your name,
        and never with anything that would identify you.
      </p>
      <p className="mt-3 text-[13.5px] font-semibold text-green-deep">
        May we keep it so we can bring you those parents when Pasadena goes live?
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <Button full onClick={() => onKeep(true)}>
          Yes, keep it
        </Button>
        <Button variant="secondary" full onClick={() => onKeep(false)}>
          No — just needed to say it
        </Button>
      </div>
    </div>
  );
}
