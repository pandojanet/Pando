import "server-only";

import { plainYes } from "@/lib/deep-dive";
import {
  acceptsIntro,
  asksForIntro,
  introTarget,
  INTRO_ALREADY,
  INTRO_NOTHING,
  INTRO_REQUESTED,
} from "@/lib/introductions";
import { notifyAdmins } from "@/lib/server/notify";
import { requestIntroExplicitly, takeIntroOffer } from "@/lib/server/repo/introductions";

/**
 * Introductions — the parent's side (21 Oct). The rules and statuses are in
 * `lib/introductions.ts`; the admin's side is `/admin/introductions`.
 *
 * Two ways in: INTRO (or "INTRO <name>") taking the offer an answer carried or
 * asking about any recent answer — never a bare yes; and an explicit "can you introduce me to a parent who goes there?",
 * which is about the answers they were sent in the last 14 days.
 *
 * A request only ever notifies the team, with a kind and a link. Pando never
 * texts the other parent: a person does, outside the app, and only their yes
 * leads to a chat.
 */
export async function introStep(input: {
  personId: string;
  phone: string;
  body: string;
  isTest?: boolean;
}): Promise<{ reply: string; template: string } | null> {
  const body = input.body.trim();
  /* "INTRO Little Maestros": which record, when they say (21 Oct, any answer). */
  const target = introTarget(body);
  const word = acceptsIntro(body) || target !== null;
  /* A bare yes takes an open intro offer and nothing else. By the time it
     gets here the freshness ping, "did it help?", the Network Ask offer and the
     deep-dive offer have each passed on it unless the intro offer is newer
     (inbound.ts compares the times; second review, 21 Oct). */
  if (!word && plainYes(body)) {
    const taken = await takeIntroOffer(input.personId);
    if (!taken) return null;
    if (taken.already) return { reply: INTRO_ALREADY, template: "intro_already" };
    await notifyAdmins({ kind: "introduction" }, { is_test: input.isTest === true });
    return { reply: INTRO_REQUESTED, template: "intro_requested" };
  }
  const explicit = !word && asksForIntro(body);
  if (!word && !explicit) return null;

  /* A bare INTRO takes the open offer; a named one goes to that record. */
  let made = word && !target ? await takeIntroOffer(input.personId) : null;
  /* Otherwise about the answers they were sent: the record they named, else the latest. */
  if (!made && (word || explicit)) {
    made = await requestIntroExplicitly({
      personId: input.personId,
      phone: input.phone,
      named: target ?? (explicit ? body : null),
      strict: target !== null,
    });
  }
  /* A plain yes with no intro offer open belongs to somebody else's question;
     "connect me with a parent who knows…" with no recent answer is a question
     of its own, and is answered as one. Only INTRO itself gets "nothing yet". */
  if (!made && explicit) return null;
  /* "Intro classes for toddlers in Altadena" names no record: on a miss it is a
     question about beginner classes and is answered as one (review, 21 Oct). */
  if (!made && target && /\b(class|classes|lessons?|courses?|program|programs|for|near|in|around|toddlers?|kids|beginners?|baby|babies)\b/i.test(target)) {
    return null;
  }

  if (!made) return { reply: INTRO_NOTHING, template: "intro_nothing" };
  if (made.already) return { reply: INTRO_ALREADY, template: "intro_already" };
  await notifyAdmins({ kind: "introduction" }, { is_test: input.isTest === true });
  return { reply: INTRO_REQUESTED, template: "intro_requested" };
}
