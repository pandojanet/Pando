import "server-only";

import { classifyDemand, needsHumanReview, type StoredDemand } from "@/lib/demand";
import { cleanId, cleanText } from "@/lib/sanitize";

/**
 * The D1 body a route receives → what it may store, or **null for nothing**.
 *
 * Three things the client asked for, none of which the browser is trusted with:
 * the classification is re-derived here, a sensitive question is only stored when
 * the parent agreed ("No — just needed to say it" means exactly that), and anything
 * not ordinary is marked for a person rather than entering the knowledge base.
 *
 * One function since 7 Oct, because two routes take a D1 now — `/api/seed/complete`
 * and `/api/seed/demand`, which edits it afterwards — and a second copy of this
 * rule would be the one that drifts.
 */
export function demandFromBody(input: unknown): StoredDemand | null {
  const d = (input && typeof input === "object" ? input : null) as {
    question_text?: unknown;
    category?: unknown;
    may_save?: unknown;
  } | null;
  const text = cleanText(d?.question_text, 300);
  if (!text) return null;

  const category = cleanId(d?.category);
  const sensitivity = classifyDemand(text, category);
  if (sensitivity !== "ordinary" && d?.may_save !== true) return null;

  return {
    question_text: text,
    category,
    sensitivity,
    requires_human_review: needsHumanReview(sensitivity),
  };
}
