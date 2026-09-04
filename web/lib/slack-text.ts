/**
 * Reading a Slack message event's `text` — which is **not** what the person
 * typed.
 *
 * ## The bug this was extracted for
 *
 * The relay's cold-inbound form is `+16265550001: hello` (5.9 — a stranger who
 * was forwarded an answer and texted the number; without it that path is
 * unreachable from Slack, because a stranger has no thread by definition).
 *
 * Slack **linkifies a phone number**. What arrives in the event is
 * `<tel:+16265550001|+16265550001>: hello`, so the address parser — which
 * requires the message to *start* with digits — matched nothing, the route took
 * its `ignored` branch, and the channel was silent. Nothing failed: the route
 * answered 200, the log line said `addressed:false`, and the only visible
 * symptom was that Pando did not reply. Dropping the `+` happened to work,
 * because Slack does not linkify a bare `16265550001` — which is how it was
 * found.
 *
 * That is the third time this codebase has met the same shape — `bands`,
 * `area_slug`, the starter list: a rule that reads correctly, typechecks, and
 * silently never fires.
 *
 * ## Why it is a module, and why it imports nothing
 *
 * The regex used to live in the route, and `test-relay.mts` **restated it** with
 * a comment saying the route is a server module and cannot be imported. So the
 * suite was testing a copy: it would have passed with the route's own parser
 * deleted, and it passed throughout this bug. A parser that is not reachable by
 * its test is a parser nobody is checking.
 *
 * It therefore follows the house rule for a testable module (`lib/phone.ts`,
 * `lib/capture.ts`, `lib/matching.ts`): **no runtime imports at all**, so plain
 * `node --experimental-strip-types` can load it. That is why the address comes
 * back as the raw matched string rather than an E.164 number — turning it into
 * one is `toE164`'s job, and the route composes the two.
 *
 * ## Why the whole text is normalised, not just the address
 *
 * The escaping is not specific to phone numbers. Slack escapes `&`, `<` and `>`
 * in every event body, and wraps every URL, email, user and channel reference in
 * its own link syntax — so a parent's free-text answer in a capture would be
 * stored with `&amp;` in it, and a message that is only a link would reach the
 * keyword matcher as `<http://…>`. Both are the same fault one step later.
 */

/**
 * Slack's own markup, undone.
 *
 * Order is load-bearing: the entities are decoded **last**, because an escaped
 * `&lt;` decoded first would then be read as the start of a link the person
 * actually typed as text.
 */
export function unwrapSlackText(text: string): string {
  return (
    text
      /* A phone link yields its **target**, never its label: the label is
         whatever Slack decided to display and may be formatted, while the target
         is the number Slack recognised. */
      .replace(/<tel:([^<>|]+)(?:\|[^<>]*)?>/g, "$1")
      /* Everything else labelled — a URL, an email, a channel — yields the
         label, which is what the person sees and therefore what they meant. */
      .replace(/<([^<>|]+)\|([^<>]*)>/g, "$2")
      /* Unlabelled: the target is all there is. `<@U123>` becomes `@U123`, which
         is honest — a user mention is not text anybody typed. */
      .replace(/<([^<>|]+)>/g, "$1")
      /* Exactly these three, and only these three: Slack's own escaping rule. */
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
  );
}

/**
 * `+1626...: hello` — the cold-inbound form.
 *
 * The colon is required rather than inferred from a leading `+`: a tester
 * writing "+1 more thing" in the channel should not become a text message from a
 * phone number, and requiring the separator keeps the accident impossible.
 *
 * Returns the number **as written**; the caller runs it through `toE164`, which
 * is what decides whether it is a number at all.
 */
export function addressedNumber(
  text: string,
): { raw: string; body: string } | null {
  const match = text.match(/^\s*(\+?[\d\s()\-.]{7,20}):\s*([\s\S]*)$/);
  if (!match) return null;
  return { raw: match[1], body: match[2] };
}

/**
 * The one entry point: unwrap, then read.
 *
 * Both come back together so no caller can normalise the address and forget the
 * body, which is how half a fix ships.
 */
export function readSlackMessage(raw: string): {
  text: string;
  addressed: { raw: string; body: string } | null;
} {
  const text = unwrapSlackText(raw).trim();
  return { text, addressed: addressedNumber(text) };
}
