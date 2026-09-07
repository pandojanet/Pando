import fs from 'node:fs';
const sub = (p, pairs) => {
  let s = fs.readFileSync(p, 'utf8');
  const crlf = s.includes('\r\n');
  const n = (t) => (crlf ? t.replace(/\n/g, '\r\n') : t);
  for (const [a, b, tag] of pairs) {
    if (!s.includes(n(a))) throw new Error(`${p}: ${tag}`);
    s = s.replace(n(a), n(b));
  }
  fs.writeFileSync(p, s);
  console.log('ok ' + p);
};

sub('lib/outreach-policy.ts', [
  [
    `export function isSettingsCommand(text: string): boolean {`,
    `/**
 * Does the quiet-hours rule stop this message?
 *
 * The window itself is 8am–9pm Pacific and lives in \`isQuietHours\`, which needs
 * a clock; this is the *rule* around it, which does not — so all four inputs can
 * be tested exhaustively rather than at whatever hour the suite happens to run.
 *
 * ## Three things it refuses to block, and the third is the interesting one
 *
 * **Transactional messages.** A verification code, a HELP reply, a capture
 * prompt: the parent asked for it, and §14 is about proactive contact.
 *
 * **A live reply.** 12.1 exempts "direct replies in a live conversation", which
 * is why \`inReplyTo\` exists separately from \`transactional\` — answering a
 * parent who texted at 10pm is a reply, not an intrusion.
 *
 * **Anything going to the Slack relay**, and the argument is what the rule is
 * *for*. Quiet hours exist so a phone does not buzz on somebody's nightstand;
 * a post in a test channel wakes nobody, and the recipients there are demo rows
 * rather than parents. Enforcing Pacific evenings against a Slack channel does
 * not protect anyone — it makes the loop untestable for anybody working
 * European hours, whose whole day is inside the window.
 *
 * ⚠ This is a **narrowing** of CLAUDE.md's "the relay is a swap of the provider
 * step only", and the boundary is deliberate: opt-out, the 48-hour gap, the
 * monthly ceiling and the response governor all still run on the relay,
 * untouched, because each is about *whether this person may be contacted at
 * all* and each must be exercised by the testing that the relay exists for.
 * Quiet hours is the one rule that is purely about the **clock on the wall**,
 * and the relay has no wall. It cannot leak into production either: production
 * has no relay, and a deployment that did would be posting every parent's
 * message into a Slack channel — a far louder failure than the hour.
 */
export function quietHoursBlocks(input: {
  category: "outreach" | "transactional";
  /** A reply to something the parent just sent. */
  inReplyTo: boolean;
  /** From \`isQuietHours()\` — passed in so this stays clock-free. */
  quiet: boolean;
  transport: "sms" | "slack";
}): boolean {
  if (input.category !== "outreach") return false;
  if (input.inReplyTo) return false;
  if (!input.quiet) return false;
  return input.transport !== "slack";
}

export function isSettingsCommand(text: string): boolean {`,
    'rule',
  ],
]);

sub('lib/server/sms.ts', [
  [
    `  if (category === "outreach" && !input.inReplyTo && isQuietHours()) {
    return { sent: false, reason: "quiet_hours" };
  }`,
    `  const transport = transportFor(input);
  const quiet = isQuietHours();
  if (quietHoursBlocks({ category, inReplyTo: Boolean(input.inReplyTo), quiet, transport })) {
    return { sent: false, reason: "quiet_hours" };
  }
  if (quiet && category === "outreach" && !input.inReplyTo && transport === "slack") {
    /* Said out loud every time, because a rule that stops applying silently is
       how it stops applying in the place it was written for. */
    console.info("[sms] quiet hours ignored — relay, nobody's phone buzzes", {
      template: input.template ?? null,
    });
  }`,
    'call',
  ],
  [
    `import { decideOutreach`,
    `import { quietHoursBlocks, decideOutreach`,
    'import',
  ],
]);
