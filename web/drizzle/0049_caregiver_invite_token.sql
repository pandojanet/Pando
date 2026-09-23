-- 0049 — the invite a parent sends names the recommendation it came from.
--
-- Until now the address in that invite was `pando.is/caregiver` with no token,
-- and the reasoning was recorded on the page itself: Pando holds no contact
-- detail for a nominated caregiver (invariant 13), so there was "nothing to key a
-- per-person link against". An admin then matched a sign-up to a nomination by
-- first name and last initial on `/admin/claims`, which is exactly the judgement
-- `cards.ts` refuses to make anywhere else — two people called Maria G. are two
-- people, and a name typed slightly differently by the parent and by the
-- caregiver matched nothing at all.
--
-- There was always something to key it against: **the nomination**. A token on
-- the recommendation identifies which card an arrival came from, and says nothing
-- about how to reach anybody — so invariant 13 is untouched. It is not
-- authentication either: the caregiver still proves her number with a code, and
-- an admin still confirms the sign-up. What the token removes is the guessing.
--
-- ## Two columns, and why each is where it is
--
-- `caregiver_nominations.invite_token` — on the **nomination**, not the
-- caregiver, because one caregiver can be recommended by several families, and
-- "who recommended her" is a fact about one card. Sixteen characters from
-- [a-z0-9], generated in the browser when the card is finished so the message
-- can be shown at once — including on a card held on the phone until the
-- parent's code is confirmed. A client choosing its own token can only affect its
-- own nomination; the unique index refuses a collision rather than letting one
-- card claim another's.
--
-- `caregiver_claims.via_nomination_id` — which card a sign-up arrived through,
-- resolved **server-side** from the token. `on delete set null`: deleting the
-- recommending parent's card must not delete the caregiver's own sign-up, which
-- is hers.

ALTER TABLE "caregiver_nominations" ADD COLUMN IF NOT EXISTS "invite_token" text;
--> statement-breakpoint
ALTER TABLE "caregiver_nominations" ADD CONSTRAINT "caregiver_nominations_invite_token_shape"
  CHECK ("invite_token" IS NULL OR "invite_token" ~ '^[a-z0-9]{16}$');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "caregiver_nominations_invite_token_uniq"
  ON "caregiver_nominations" ("invite_token") WHERE "invite_token" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "caregiver_claims" ADD COLUMN IF NOT EXISTS "via_nomination_id" uuid
  REFERENCES "caregiver_nominations"("id") ON DELETE SET NULL;
