import "server-only";

import { TIERS, type BlastTier } from "@/lib/blast-tiers";
import { formatCents } from "@/lib/payments";

/**
 * M13.5 — the one place Pando talks to Stripe.
 *
 * Same shape and same discipline as `lib/server/sms.ts`: **one module, one
 * caller, inert until provisioned.** Nothing else in the app may create a
 * checkout session, for the reason invariant 6 gives for SMS — the order of the
 * checks is the story, and a second path around them is how the rule gets broken
 * by somebody who did not know it existed.
 *
 * ## Why `fetch` and not the `stripe` package
 *
 * Two calls are needed — create a Checkout Session, and create a Refund — and
 * both are a form POST with a Basic-auth header. The SDK brings a large
 * dependency, its own retry and telemetry behaviour, and a version surface to
 * keep in step with an API version; against two endpoints that is a bad trade in
 * a repo whose whole dependency list is seven packages. The API version is
 * pinned in a header instead, which is the thing that actually matters: without
 * it Stripe applies whatever version the *account* is set to, so somebody
 * upgrading it in the dashboard could change these responses with no deploy.
 *
 * ## Unprovisioned answers honestly
 *
 * No `STRIPE_SECRET_KEY` ⇒ `{ ok: false, reason: "not_provisioned" }`, and the
 * admin page says payments are not switched on yet. The same rule as
 * `persisted: false` and `not_provisioned` for SMS: never pretend.
 */

const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Pinned, deliberately. Stripe applies the account's default version when this
 * is absent, which means a dashboard setting somebody else changes can alter the
 * shape of these responses without a deploy.
 */
const STRIPE_API_VERSION = "2024-06-20";

export function isStripeProvisioned(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Whether the webhook can be verified at all. Separate: it is a separate secret. */
export function isStripeWebhookConfigured(): boolean {
  return Boolean(process.env.STRIPE_WEBHOOK_SECRET);
}

function baseUrl(): string {
  /**
   * The same value the Twilio verifier uses, and for the same reason: a
   * return URL built from a host header is a host header an attacker can set,
   * and here it would send a paying parent to somebody else's page after
   * checkout.
   */
  return (
    process.env.TWILIO_WEBHOOK_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "http://localhost:3000"
  );
}

async function stripePost(
  path: string,
  form: Record<string, string>,
  idempotencyKey?: string,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, error: "not_provisioned" };

  try {
    const res = await fetch(`${STRIPE_API}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": STRIPE_API_VERSION,
        /**
         * Stripe deduplicates on this for 24 hours, which is what makes a
         * retried checkout create one session rather than two — and, for a
         * refund, what stops a double-click refunding twice. Passed by the
         * caller so it can be something meaningful (the blast id), never a
         * random value, because a random key deduplicates nothing.
         */
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(15_000),
    });

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      /* Stripe's error message can echo request parameters back. Only the type
         and code are logged — invariant 7's rule applied to a payment
         processor, where the parameters include an amount and a URL. */
      const err = (data?.error ?? {}) as Record<string, unknown>;
      console.error("[stripe] rejected", {
        status: res.status,
        type: err.type ?? null,
        code: err.code ?? null,
      });
      return { ok: false, error: String(err.code ?? err.type ?? `http_${res.status}`) };
    }
    return { ok: true, data: data ?? {} };
  } catch (err) {
    console.error("[stripe] unreachable", {
      kind: err instanceof Error ? err.name : "unknown",
    });
    return { ok: false, error: "unreachable" };
  }
}

export interface CheckoutResult {
  ok: boolean;
  /** Where to send the parent. Absent on failure. */
  url?: string;
  session_id?: string;
  reason?: "not_provisioned" | "free" | "stripe_error";
  error?: string;
}

/**
 * 13.5 — a payment link for one Network Ask.
 *
 * **The price comes from `blast-tiers.ts`, never from a Stripe Price object.**
 * That is a decision worth stating: a Price in the Stripe dashboard would be a
 * second copy of a number this codebase already owns, editable by somebody who
 * cannot see the code, and it would silently disagree with the amount the
 * refund logic reads back. `price_data` sends the amount inline instead, so
 * there is exactly one price list and `drizzle/0029` freezes what was charged
 * onto the blast row.
 *
 * A free tier is refused rather than charged zero. Stripe will happily create a
 * $0 session and it is meaningless — 13.5's own words are "skipped entirely when
 * a free credit covers it", so the caller must not reach here at all in that
 * case, and being loud about it is better than a $0 receipt.
 */
export async function createCheckout(input: {
  blastId: string;
  tier: BlastTier;
  askerId: string;
  question: string;
}): Promise<CheckoutResult> {
  const spec = TIERS[input.tier];
  if (spec.price_cents === 0) return { ok: false, reason: "free" };
  if (!isStripeProvisioned()) return { ok: false, reason: "not_provisioned" };

  const site = baseUrl();
  const result = await stripePost(
    "/checkout/sessions",
    {
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(spec.price_cents),
      "line_items[0][price_data][product_data][name]": `Pando ${spec.label}`,
      /**
       * What the parent is buying, in the words the strategy uses — "three to
       * five carefully matched parents" is the product, and a receipt reading
       * "Network Ask" a month later would tell them nothing. It comes from
       * `receipt_description` rather than `note`, which is admin copy that opens
       * with the price — and neither ever contains the parent's question, because
       * a receipt is emailed, stored by Stripe and often forwarded onward.
       */
      "line_items[0][price_data][product_data][description]":
        spec.receipt_description ?? spec.label,
      /* The blast id, so the webhook knows what was paid for without trusting
         anything in the URL. `client_reference_id` is the field Stripe echoes
         back on the session for exactly this. */
      client_reference_id: input.blastId,
      "metadata[blast_id]": input.blastId,
      "metadata[tier]": input.tier,
      success_url: `${site}/ask/paid?blast=${input.blastId}`,
      cancel_url: `${site}/ask/cancelled?blast=${input.blastId}`,
      /**
       * Stripe expires an unpaid session after 24 hours by default; this makes
       * it 30 minutes. A Network Ask is a question somebody wants answered now,
       * and a checkout they finish tomorrow would activate a blast whose window
       * has already started ticking.
       */
      expires_at: String(Math.floor(Date.now() / 1000) + 1800),
    },
    /* Keyed to the blast: a parent who double-taps "pay" gets one session. */
    `blast-checkout-${input.blastId}`,
  );

  if (!result.ok) return { ok: false, reason: "stripe_error", error: result.error };
  const url = typeof result.data.url === "string" ? result.data.url : undefined;
  const id = typeof result.data.id === "string" ? result.data.id : undefined;
  if (!url || !id) return { ok: false, reason: "stripe_error", error: "no_session" };
  return { ok: true, url, session_id: id };
}

/**
 * 13.7 — refund a paid Ask.
 *
 * The estimate calls this "the manual refund flow for the first ~60 days, with
 * admin flags", and manual is the design rather than a shortcut: the guarantee
 * is about whether an answer was *useful*, which is a judgement. So nothing here
 * runs on a timer — an admin decides, and this is what carries the decision to
 * Stripe.
 *
 * **Refunded in full, always.** A partial refund would need a rule for how much
 * of a $15 Ask three mediocre answers are worth, and nobody has written one; the
 * strategy's promise is "no useful answer → not charged", which is all or
 * nothing. If partials are ever wanted, that is a client decision and a new
 * argument here, not a number somebody picks in the moment.
 */
export async function refundPayment(input: {
  paymentIntentId: string;
  blastId: string;
  /** Stripe's own enum. `requested_by_customer` is the honest one here. */
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
}): Promise<{ ok: boolean; refund_id?: string; error?: string }> {
  if (!isStripeProvisioned()) return { ok: false, error: "not_provisioned" };
  const result = await stripePost(
    "/refunds",
    {
      payment_intent: input.paymentIntentId,
      reason: input.reason ?? "requested_by_customer",
      "metadata[blast_id]": input.blastId,
    },
    /* Keyed to the blast, so a second click refunds nothing extra even if the
       first response was lost on the way back. */
    `blast-refund-${input.blastId}`,
  );
  if (!result.ok) return { ok: false, error: result.error };
  const id = typeof result.data.id === "string" ? result.data.id : undefined;
  return { ok: true, refund_id: id };
}

/**
 * What the admin page says about the configuration, without leaking any of it.
 *
 * Booleans only: a page that printed a key prefix to be helpful would put it in
 * a screenshot, a bug report and a support thread.
 */
export function stripeStatus(): {
  provisioned: boolean;
  webhook_configured: boolean;
  /** The live/test mode Stripe's own key prefix declares. */
  mode: "live" | "test" | null;
  prices: Array<{ tier: BlastTier; label: string; price: string }>;
} {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return {
    provisioned: isStripeProvisioned(),
    webhook_configured: isStripeWebhookConfigured(),
    mode: key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : null,
    /* Read from `blast-tiers.ts`, so the page cannot disagree with what a
       checkout would actually charge. */
    prices: Object.values(TIERS)
      .filter((t) => t.price_cents > 0)
      .map((t) => ({ tier: t.id, label: t.label, price: formatCents(t.price_cents) })),
  };
}
