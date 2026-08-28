import type { Option } from "../types";

/**
 * Types for the chat-seeding interface (estimate 1.4).
 *
 * The conversation is data, not code: each share type is a `Script` of `Step`s,
 * and each step declares the widget that captures it and the field it writes.
 * That is what keeps "feels like a text chat" and "lands in structured fields"
 * from fighting each other — and it's the shape the server could later drive turn
 * by turn (spec §16.1, POST /api/seed/chat) without the UI changing.
 */

export type ShareKind = "activity" | "caregiver" | "place" | "tip";

export type WidgetKind =
  | "quick" // one tap, advances immediately
  | "chips" // multi-select, then Continue
  | "text" // short free text
  | "ages" // the age grid
  | "name" // first name + last initial (caregivers only)
  | "phone";

export type FieldValue = string | string[] | number[];

export type Fields = Record<string, FieldValue>;

export interface Step {
  /** Also the field key written into the draft. */
  id: string;
  /** What Pando says. */
  prompt: string;
  /** A quieter second line — rules, reassurance, why we're asking. */
  aside?: string;
  widget: WidgetKind;
  options?: Option[];
  optional?: boolean;
  /** `text` only. */
  maxLength?: number;
  placeholder?: string;
  /**
   * Wording for the way out, when "Skip" is the wrong word for it. The caveat
   * question counts "nothing comes to mind" as an answer for Founding purposes, so
   * the button has to read like one.
   */
  skipLabel?: string;
  /** Skip the step unless this returns true. */
  when?: (fields: Fields) => boolean;
  /**
   * Ends the card early and kindly. Used for the no-minors gate (spec §12,
   * estimate 11.2) — the nomination is discarded, never saved as pending.
   */
  stopIf?: (value: FieldValue) => string | null;
  /**
   * Keeps the card, but marks it for a human before it can ever be used in an
   * answer. "Would you hire them again? — No" is the case the client asked for:
   * we still want to know, and the parent should be told plainly that it lands on
   * a person's desk rather than in a recommendation.
   *
   * Writes `review_hold` + `hold_reason` into the card's fields, so the hold
   * travels with the payload without a second channel.
   */
  holdIf?: (value: FieldValue) => string | null;
}

export interface Script {
  kind: ShareKind;
  /** Menu label. */
  label: string;
  /** Menu one-liner. */
  hint: string;
  /** Message Pando opens the card with. */
  intro: string;
  steps: Step[];
  /** Field key → label, in the order the recap should read. */
  recap: Array<{ field: string; label: string }>;
}

export interface Submission {
  id: string;
  kind: ShareKind;
  fields: Fields;
  created_at: string;
  /** True once the backend confirmed the write. */
  persisted: boolean;
  /** The request itself failed — worth offering a retry. */
  error?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "pando" | "parent";
  text?: string;
  aside?: string;
  /** Renders the structured recap of a finished card. */
  card?: Submission;
  /**
   * The message the parent sends to a nominated caregiver (C11). Rendered with a
   * copy button — Pando never sends it, and never contacts them.
   */
  invite?: string;
  /** Set on parent messages so "change my last answer" can rewind precisely. */
  step_id?: string;
  /**
   * The parent skipped this step. Rendered as a quiet marker rather than a green
   * bubble — a filled pill where a button just was reads as tappable.
   */
  skipped?: boolean;
}

export interface ChatDraft {
  id: string;
  kind: ShareKind;
  fields: Fields;
  step_index: number;
  /**
   * Set when the parent tapped a row on a finished card to correct it. Only that
   * one step is re-asked; answering it updates the saved card and returns to the
   * menu instead of walking the rest of the script again.
   */
  editing?: { submission_id: string; step_id: string };
}

export interface ChatState {
  messages: ChatMessage[];
  draft: ChatDraft | null;
  submissions: Submission[];
  /** "menu" between cards, "card" mid-card, "closed" once they're done. */
  mode: "menu" | "card" | "closed";
  /**
   * Estimate 1.8's confirm-back, when one is being asked.
   *
   * Its own state rather than a script step: the trigger is a property of the
   * *finished* card, and a step would have to exist in every script and be
   * skipped in most of them. The card is not persisted while this is set — the
   * whole point is to save it once, with the fuller answer, rather than to save
   * a thin one and patch it.
   */
  confirm_back?: {
    submission_id: string;
    field: string;
    question: string;
  } | null;
}
