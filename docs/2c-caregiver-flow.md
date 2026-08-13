# 2C — the caregiver's own flow, and how to test it

Estimate note first: **2C is not a row in the estimate.** It is Part 2C of the
client's July question set (Part 1 = the parent profile, 2A = activities, 2B = the
caregiver nomination, 2C = this, D = the closing questions). Parts 1, 2A and 2B map
onto estimate rows 1.2, 1.5 and 1.6; 2C maps onto nothing, because it arrived after
the estimate was written. It is built now because the client marked it BUILD NOW —
the scope conversation about which line item pays for it is still open.

---

## The problem this design exists to solve

The invite a parent sends is `pando.is/caregiver` — **one shared link with no
token**. That is not laziness; there is nothing to key a token against, because
Pando holds no contact detail for a nominated caregiver at all (invariant 13). So a
caregiver arrives self-identified and we do not know which nomination is theirs.

Three things follow, and each one closes a door:

1. **We cannot match them by name.** `cards.ts` already refuses to fold two
   nominations of "Maria G." together, because a first name and an initial are not
   an identifier, and blending two people would blend their strengths, their pay
   bands and their consent state.
2. **They must not create their own listing.** The client's rule, from the kickoff
   call: *"the only way that a caregiver can be on Pando is if a parent has sent
   them a link."*
3. **A self-made record must not look vouched.** Invariant 4 says a "vouched by a
   parent" label needs `provenance = parent_submitted` *and* a real contributor
   behind it. A caregiver row created by its own subject would be indistinguishable
   from one a family put forward.

So the flow writes a **claim** — `caregiver_claims`, keyed to the caregiver's own
verified `people` identity, invisible to every answering path — and an admin decides
which nomination it belongs to.

## What the caregiver sees

| Step | Screen | Notes |
|---|---|---|
| G2 | Consent to hold a profile | **First**, before any question. Declining ends the flow and stores nothing |
| G1 | First name, initial, phone, SMS consent | Continue is disabled until all four are there |
| G3 | Kind of work wanted | Skippable |
| G4 | Ages they've cared for | Skippable |
| G4b | Strengths | The **same closed list** the parent's nomination uses |
| G5 | Areas + whether they drive | Skippable |
| G6 | Days + when they can start + a note | "When they can start" is a window, not a date |
| G7 | Rate band | A range, never a number |
| G8–G10 | Three separate permissions | See below |
| — | OTP | Nothing is stored before this |
| — | "You're not listed yet" | Says so plainly, and reflects the permissions they chose |

**Every tap screen is skippable.** A caregiver who only wants to say "occasional
sitting, evenings, these two neighborhoods" has said something useful, and demanding
a full CV before they have decided to be listed is the wrong trade.

## The three permissions

| | What it allows | Consent scope |
|---|---|---|
| G9 · Appear in answers | first name, strengths, areas, rate range — **never the number** | `caregiver_listing` |
| G10 · Be introduced | contact passed on, after asking them each time | `caregiver_introduction` |
| G8 · References | a former family may be asked to vouch | `caregiver_reference` |

G10 is strictly more exposure than G9, so **it cannot be the only yes**. Revoking G9
clears G10 in three places — the UI disables and unchecks it, the write route forces
it false rather than rejecting the whole claim, and `claim_ladder_order` refuses the
pair at the database. Three layers because the UI is the one that can be bypassed and
the CHECK is the one that cannot be argued with.

Finishing with **all three refused** is a real, supported outcome: a profile that
exists and is visible to nobody. The copy promises that, so it has to be reachable.

## What the admin does — `/admin/claims`

The decision is **identity**, not quality: is this Rosa R. the Rosa R. a family put
forward? The page offers a shortlist scoped to the same market, the same first name
and the same initial, showing each candidate's nomination count and ladder state.
Two same-named nominations both appear; the admin chooses.

Linking, in one transaction:

- `caregivers.consent_status` → `consented`, with real evidence
  (`method: signed_link`, a note, a timestamp)
- `caregivers.profile_person_id` → their own identity
- `caregiver_profiles` written from the claim
- claim → `linked`, with who resolved it and when
- an `audit_log` row, in the same transaction

**What linking does not do:** raise `active`, `discoverable` or `introducible`. Those
stay false and are a separate action with its own checks. Consent is not visibility,
and the ladder only ever increases.

## The leak rule

Nothing in the caregiver's flow, and nothing on `/admin/claims`, carries what a
parent wrote about them — no nomination text, no strengths a family chose, and above
all no private note or the reason behind a hesitant "would you hire them again"
(invariant 12).

The cheapest way to keep that true is structural: `lib/server/repo/caregiver.ts` has
**no query at all** against `caregiver_nominations` or `restricted_notes`. If a
future change needs one, that is the moment to stop and think.

## How to test it

The full walkthrough is in
[test-plan-by-estimate.md](test-plan-by-estimate.md#2c--the-caregivers-own-flow-g1g10).
The short version, and the four things most worth checking:

```bash
# 1. Nothing is stored before the code.
#    Reach the OTP screen, then:
select count(*) from caregiver_claims;   -- 0
```

```bash
# 2. A claim is not a listing.
select count(*) from caregivers;         -- unchanged by the whole flow
```

```bash
# 3. Four consents per submission, and a revision updates rather than duplicates.
select scope, status from consents where source = 'caregiver_flow';
select count(*) from caregiver_claims;   -- still 1 after running the flow twice
```

```bash
# 4. After linking: consented, and still invisible.
select consent_status, active, discoverable, introducible, provenance
from caregivers where profile_person_id is not null;
```

## Not built

- **DELETE by text.** The consent copy promises it ("text DELETE and the whole
  profile goes"), and the SMS channel does not exist until Phase 2. This is a
  promise the product is currently making and cannot yet keep — worth saying out
  loud before the pilot, and the fastest honest fix is an admin-side delete plus a
  line telling them to reply to the text.
- Everything *after* being listed: introductions, freshness, appearing in a real
  answer. Phase 2.
