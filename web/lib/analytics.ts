/**
 * Funnel instrumentation (estimate 3.1 / M3).
 *
 * PostHog itself is not wired yet — no key, no consent copy signed off. This is
 * the call-site layer: every event the funnel needs is already emitted with its
 * final name and properties, so switching PostHog on is one provider file, not
 * a hunt through components.
 *
 * Never pass a phone number, name, or free text into props (spec §19: never log
 * personal data).
 */

export type SeedEvent =
  | "seed_link_opened"
  | "seed_invite_valid"
  | "seed_invite_invalid"
  | "seed_phone_captured"
  | "seed_phone_skipped"
  | "seed_profile_started"
  | "seed_profile_resumed"
  | "seed_question_answered"
  | "seed_question_skipped"
  | "seed_other_submitted"
  | "seed_screen_advanced"
  | "seed_screen_back"
  | "seed_profile_review_viewed"
  | "seed_profile_saved"
  | "seed_profile_save_failed"
  | "seed_chat_opened"
  | "seed_card_started"
  | "seed_card_step_answered"
  | "seed_card_step_skipped"
  | "seed_card_answer_undone"
  | "seed_card_field_edit_started"
  | "seed_card_field_edited"
  | "seed_card_aborted"
  | "seed_card_review_hold"
  | "seed_card_saved"
  /**
   * Estimate 1.8's confirm-back, and estimate 3.1 lists "confirm-back shown" by
   * name among the funnel events. The pair is what makes it measurable: how often
   * a card was thin enough to ask about, and how often asking actually produced
   * something.
   */
  | "seed_confirm_back_shown"
  | "seed_confirm_back_answered"
  | "seed_card_held"
  | "seed_verify_requested"
  | "seed_verify_send_blocked"
  | "seed_verify_failed"
  | "seed_verify_confirmed"
  /**
   * The code step was reached, and then passed, at the end of the profile. Its own
   * pair because this is the flow's biggest single gate: everything after it is
   * saved as it happens, and everyone who drops between the two leaves nothing
   * behind at all. The gap between them is the number to watch.
   */
  | "seed_verify_reached"
  | "seed_verified"
  /** A write was refused mid-flow: the session fell back to holding on the phone. */
  | "seed_verification_expired"
  | "seed_demand_response_shown"
  | "seed_referral_copied"
  | "seed_submit_flushed"
  | "seed_submit_failed"
  | "seed_card_save_failed"
  | "seed_chat_finished"
  | "seed_completion_viewed"
  /* The completion screen is three pages (1.7). These two are the funnel between
     them — the split added two places to leave before the consent is answered, and
     without them a drop-off there is invisible. */
  | "seed_done_continue"
  | "seed_done_next_opened"
  | "seed_demand_captured"
  | "seed_demand_skipped"
  | "seed_follow_up_answered"
  | "seed_completion_recorded"
  | "seed_completion_failed"
  | "seed_return_clicked"
  | "seed_session_abandoned";

type Props = Record<string, string | number | boolean | null | undefined>;

interface PostHogLike {
  capture: (event: string, props?: Props) => void;
  /**
   * Optional because `window.posthog` is whatever the provider put there, and a
   * stale bundle or a stub in a test may only have `capture`. Called through
   * `?.` for the same reason — a missing method must not break the flow.
   */
  register?: (props: Props) => void;
}

declare global {
  interface Window {
    posthog?: PostHogLike;
    /** QA hook: every event fired this session, in order. */
    __pandoEvents?: Array<{ event: SeedEvent; props?: Props; at: string }>;
  }
}

export function track(event: SeedEvent, props?: Props): void {
  if (typeof window === "undefined") return;

  const entry = { event, props, at: new Date().toISOString() };
  (window.__pandoEvents ??= []).push(entry);

  window.posthog?.capture(event, props);

  if (process.env.NODE_ENV !== "production") {
    console.debug("[pando:event]", event, props ?? {});
  }
}

/**
 * Which shared link this parent arrived on, attached to **every** event from
 * here on.
 *
 * ## Why a super-property and not a prop
 *
 * Estimate 3.1 asks for the funnel to be "segmented by which shared link the
 * parent arrived from", and 2.2 for drop-off as a per-link funnel. Neither was
 * reachable: the code appeared in no event at all — `seed_link_opened` carried
 * `source` (`qr` vs `link`), which says the *channel* and never *which group*,
 * and every event after it carried nothing about the arrival. A PostHog funnel
 * can only break down by a property present on its steps, so "which link brought
 * contributors" was answerable in our own admin (`invites.opens` plus the
 * completion counts) and nowhere in PostHog.
 *
 * `register` puts it in PostHog's own persisted store, so it rides on every
 * subsequent capture — including the ones fired on later pages, which is the
 * whole point: the drop-off worth measuring happens three screens after the
 * link was opened.
 *
 * **Safe under invariant 7.** An invite code is one per *group*, never per
 * parent (12 Aug) — `mops-altadena`, not a person — so this is an enum, not an
 * identifier. Nothing here carries a name, a number or free text.
 *
 * Overwritten rather than merged when a parent arrives on a second link: the
 * most recent arrival is the one whose funnel they are in.
 */
export function identifyArrival(props: {
  invite_code: string | null;
  invite_group: string | null;
  source: string | null;
}): void {
  if (typeof window === "undefined") return;
  window.posthog?.register?.({
    invite_code: props.invite_code,
    invite_group: props.invite_group,
    arrival_source: props.source,
  });
}

/**
 * Fires once when the parent leaves mid-flow, with the last step reached —
 * the drop-off number the pilot is judged on.
 */
export function trackAbandonOnHide(getProps: () => Props): () => void {
  if (typeof document === "undefined") return () => {};
  let sent = false;
  const onHide = () => {
    if (sent || document.visibilityState !== "hidden") return;
    sent = true;
    track("seed_session_abandoned", getProps());
  };
  document.addEventListener("visibilitychange", onHide);
  return () => document.removeEventListener("visibilitychange", onHide);
}
