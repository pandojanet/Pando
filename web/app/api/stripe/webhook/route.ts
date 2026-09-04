import { NextResponse } from "next/server";
import { verifyStripeSignature } from "@/lib/stripe-signature";
import { confirmPayment, markCheckoutFailed } from "@/lib/server/repo/payments";

/**
 * M13.6 — Stripe's payment webhook.
 *
 * The only thing that can move a blast from "somebody opened a checkout" to
 * "paid, go ahead and ask five parents". The success page cannot: a return URL
 * is a link the parent's browser follows, so anybody who knows the shape of it
 * could activate their own Ask by typing it. **Stripe telling the server,
 * signed, is the only evidence of payment this app accepts.**
 *
 * ## Four rules, and each one is a way this goes wrong quietly
 *
 * **1. The raw body, before anything parses it.** The signature covers the exact
 * bytes Stripe sent, so `await request.text()` comes first and `JSON.parse` only
 * after the verdict. Parsing and re-serialising changes key order and whitespace,
 * and the signature then fails for a *legitimate* request — which looks like
 * Stripe being broken rather than like a bug here.
 *
 * **2. Unverified is a 400, not a 200.** Fail-closed, the same rule as the
 * Twilio webhook and `JOBS_SECRET`: an endpoint that skips verification when its
 * secret is missing is unauthenticated the moment somebody mis-deploys. A forged
 * `checkout.session.completed` would buy free Network Asks indefinitely and put
 * revenue on the payments page that does not exist in Stripe.
 *
 * **3. A handled event answers 200 even when it changed nothing.** Stripe
 * retries until it gets a 2xx, and it delivers the same event more than once by
 * design. Idempotency lives in the `where` clause and the unique index on
 * `blasts.stripe_session_id` (`drizzle/0029`), so the fifth delivery is a no-op
 * — and reporting it as a failure would make Stripe retry it for three days.
 *
 * **4. An unknown event type is 200 and ignored.** Stripe sends whatever the
 * endpoint is subscribed to, plus new types over time. Answering 400 to those
 * would fill the dashboard with red for events Pando does not care about, and
 * hide a real failure among them.
 *
 * ## The one deliberate 500
 *
 * A database that cannot be reached is the case where a retry genuinely helps:
 * the payment happened, the row does not know it yet, and the parent has been
 * charged for an Ask that is still a draft. That is the one thing worth having
 * Stripe try again for, so it is the one thing that answers 5xx.
 */

export async function POST(request: Request) {
  /* Raw first. See rule 1. */
  const rawBody = await request.text();

  const verdict = verifyStripeSignature({
    rawBody,
    header: request.headers.get("stripe-signature"),
    secret: process.env.STRIPE_WEBHOOK_SECRET ?? null,
  });
  if (!verdict.ok) {
    /* Enums only — the body carries an amount, a session id and an email. */
    console.warn("[stripe:webhook] refused", { reason: verdict.reason });
    return NextResponse.json({ error: "Unverified" }, { status: 400 });
  }

  let event: {
    id?: string;
    type?: string;
    data?: { object?: Record<string, unknown> };
  };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    /* Signed and still unparseable is not something a retry fixes. */
    return NextResponse.json({ error: "Malformed" }, { status: 400 });
  }

  const type = event.type ?? "";
  const object = event.data?.object ?? {};

  /**
   * `checkout.session.completed` fires when the customer finishes checkout, and
   * for a card that is also when the money is captured — `payment_status` on the
   * session says which. Anything else (an asynchronous method still processing)
   * is left alone, because activating on "completed but unpaid" would send a
   * blast for a payment that can still fail.
   */
  if (type === "checkout.session.completed" || type === "checkout.session.async_payment_succeeded") {
    const sessionId = typeof object.id === "string" ? object.id : null;
    const paid = object.payment_status === "paid" || object.payment_status === "no_payment_required";
    const intent =
      typeof object.payment_intent === "string" ? object.payment_intent : null;
    const amount = typeof object.amount_total === "number" ? object.amount_total : 0;

    if (!sessionId) return NextResponse.json({ ok: true, ignored: "no_session" });
    if (!paid) {
      console.info("[stripe:webhook] session completed but not paid yet", { type });
      return NextResponse.json({ ok: true, ignored: "not_paid" });
    }
    if (!intent) {
      /* `drizzle/0029` refuses a `paid` row with no payment reference, because
         13.7's refund has nothing to reverse without one. Better to leave the
         row pending and be told than to write a payment nobody can refund. */
      console.error("[stripe:webhook] paid session carried no payment_intent");
      return NextResponse.json({ error: "No payment reference" }, { status: 500 });
    }

    const result = await confirmPayment({
      sessionId,
      paymentIntentId: intent,
      amountCents: amount,
    });

    if (!result.ok) {
      if (result.reason === "unconfigured") {
        /* The one retryable case — see the note above. */
        return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
      }
      /* An unknown session or a mismatched amount will not become correct on a
         retry, so they are 200 with a reason rather than three days of red in
         the Stripe dashboard. Both are logged loudly: a mismatch means the row
         and Stripe disagree about money. */
      console.error("[stripe:webhook] could not apply payment", {
        reason: result.reason,
      });
      return NextResponse.json({ ok: true, ignored: result.reason });
    }

    console.info("[stripe:webhook] payment applied", {
      activated: result.activated,
      already: result.already,
    });
    return NextResponse.json({ ok: true, already: result.already });
  }

  /**
   * An expired or failed checkout. Recorded rather than ignored, so the payments
   * page can tell "nobody has paid yet" from "somebody tried and it did not
   * work" — the second is a parent who wanted to ask and could not.
   */
  if (type === "checkout.session.expired" || type === "checkout.session.async_payment_failed") {
    const sessionId = typeof object.id === "string" ? object.id : null;
    if (sessionId) await markCheckoutFailed(sessionId);
    return NextResponse.json({ ok: true });
  }

  /* Rule 4: not ours, and that is not an error. */
  return NextResponse.json({ ok: true, ignored: type || "unknown" });
}
