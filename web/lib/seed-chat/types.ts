import type { Option } from "../types";
import type { Subcategory } from "./subcategories";

export type { Subcategory } from "./subcategories";

/**
 * Types for the chat-seeding interface (estimate 1.4).
 *
 * The conversation is data, not code: each share type is a `Script` of `Step`s,
 * and each step declares the widget that captures it and the field it writes.
 * That is what keeps "feels like a text chat" and "lands in structured fields"
 * from fighting each other — and it's the shape the server could later drive turn
 * by turn (spec §16.1, POST /api/seed/chat) without the UI changing.
 */

export type ShareKind = "activity" | "caregiver" | "place" | "tip" | "doctor";

export type WidgetKind =
  | "quick" // one tap, advances immediately
  /**
   * A searchable single-select over one of the market directories, with the
   * typed name as a first-class fallback (10 Sep).
   *
   * ⚠ It is the only widget that writes **two** fields: the canonical name and,
   * when the record is one Pando already holds, the town it is in. That is what
   * takes the activity card from seven questions to her six — see `PlaceStep`.
   */
  | "place"
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
  /**
   * `place` only — which directory to search. A `MarketCategory`, kept as a
   * string here so this file stays free of the market types the engine tests
   * load without.
   */
  searchCategory?: string;
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
  /**
   * The last of the button's context questions (9 Oct): once it is answered the
   * chat asks `/api/seed/assist` which sub-category this is, and carries on in
   * that sub-category's script — or in this one when the answer is "unsure".
   */
  classifyAfter?: boolean;
  /**
   * Asked once, straight after this step, when the answer is empty or too thin
   * (9 Oct, the developer: *"required and descriptive questions"*). `ask` is the
   * canonical wording; the model may rephrase it. See `follow-up.ts`.
   */
  followUp?: { ask: string; on: "empty" | "empty_or_thin" };
  /**
   * The wording when the card is a friend's experience (9 Oct, the walk: "How
   * old was your child when you went?" to a parent who never went). Fixed, not
   * the model's — a question with buttons is never reworded.
   */
  friendPrompt?: string;
  /**
   * The wording once the card has a name, with `{thing}` where it goes (12 Oct:
   * "In a line or two, what is Green & Bisque Clayhouse?"). Filled by the
   * script, not the model — the context question comes before the first call.
   */
  namedPrompt?: string;
  /**
   * Other ways to say a question asked before the model's first turn (12 Oct,
   * the developer: *"many questions lack personalisation"* — the opening
   * questions were the same words on every card). `{thing}` is the card's
   * name, `{parent}` the parent's first name, both filled on the device; one
   * is chosen per card (`openerFor`). `prompt` stays the canonical wording.
   */
  variants?: string[];
}

export interface Script {
  kind: ShareKind;
  /** Set on a sub-category's script; absent on a button's general one. */
  subcategory?: Subcategory;
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
  /**
   * May this one recommendation carry the parent's first name? (10 Sep.)
   *
   * Its own field rather than an entry in `fields`, and the distinction is the
   * one `submissions.fields` exists to keep: that map is the verbatim record of
   * what the parent answered about the *place*, and this is a decision about
   * Pando. Mixing them would put a privacy setting into the evidence of what
   * somebody said.
   *
   * Seeded from `people.attribution` when the card is finished and false
   * wherever that is anything but "use my first name" — the standing answer is
   * the default, never the decision.
   */
  show_name?: boolean;
  /**
   * A caregiver card's invite token (23 Sep, `drizzle/0049`) — minted when the
   * card is finished so the message can be shown at once, and sent beside
   * `fields` for the same reason as `show_name`: it is a fact about Pando's
   * invite, not something the parent said about the caregiver.
   */
  invite_token?: string;
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
  /**
   * The sub-category the classifier chose (9 Oct). Null = asked as the general
   * category; absent = not classified yet.
   */
  subcategory?: Subcategory | null;
  /** The model's wording for the steps still to come, by step id. */
  prompts?: Record<string, string>;
  /** The model's wording for each step's follow-up, by step id. */
  followups?: Record<string, string>;
  /** Pando's reactions on the last turns, "" for none — sent back so the next is not the same (12 Oct). */
  reactions?: string[];
  /** The parent was addressed by name on this card — once is enough (12 Oct). */
  named?: boolean;
  /**
   * How many times this card has used their name, and at which turn last (12 Oct,
   * the developer: *"not enough addressing the parent, sometimes by name"*):
   * up to `NAMES_PER_CARD`, `NAME_GAP` turns apart.
   */
  names_used?: number;
  named_at_turn?: number;
  /** Model turns taken on this card — the clock for `NAME_GAP`. */
  turns?: number;
  /** "pending" while `/api/seed/assist` is answering; "done" once it has. */
  assist?: "pending" | "done";
  /**
   * A follow-up being asked about `step_id`, with the answer it follows up —
   * kept so an undo can put it back.
   */
  followup?: { step_id: string; question: string; before: FieldValue } | null;
}

export interface ChatState {
  messages: ChatMessage[];
  draft: ChatDraft | null;
  submissions: Submission[];
  /** "menu" between cards, "card" mid-card, "closed" once they're done. */
  mode: "menu" | "card" | "closed";
  /*
   * `confirm_back` (estimate 1.8's end-of-card follow-up) was removed on 9 Oct:
   * follow-ups are asked straight after each step now (`ChatDraft.followup`). A
   * session saved with one pending is read without it, and the held card is
   * sent by the held-card pass on the next open.
   */
}
