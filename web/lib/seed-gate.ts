/**
 * The marker that says this browser arrived through an invite link.
 *
 * ## Why a cookie at all
 *
 * Access to the Seed Tool became link-only on 4 Sep, and `/join` enforces that
 * by resolving `?i=` during its own server render. The three screens *after* it
 * had no such door: `/profile` and `/share` are client components that mint a
 * fresh session when they find none — `ProfileFlow` says so in a comment ("a
 * parent can deep-link straight here from a forwarded URL; don't block them"),
 * and `newSession({ invite_code: null, … source: "direct" })` is exactly what
 * typing the address by hand produced. So closing only `/join` moved the open
 * door one URL to the right rather than shutting it.
 *
 * The session that would answer "did this browser come through an invite" lives
 * in `localStorage`, which the server cannot read — hence a cookie, set by the
 * proxy on a valid arrival and checked before the flow renders.
 *
 * ## What it is not
 *
 * **It is not authentication, and it carries nothing.** Presence is the whole
 * signal: attribution still comes from the session's own `invite_code`, which
 * the server re-resolves on every write (12 Aug), so nothing here can be forged
 * into a group a parent does not belong to. Nor is it signed — a hand-set cookie
 * gets somebody exactly what a forwarded link already gets them, and every write
 * behind it is still gated by phone verification (invariant 11).
 *
 * What it does close is the realistic way in: typing the address, following a
 * stale bookmark, or a crawler walking the app. A *hard* gate means a token per
 * parent, which the client has declined three times (31 Jul, 12 Aug, 27 Aug).
 *
 * ## The lifetime is long on purpose
 *
 * The flow is autosaved to the device and a parent legitimately comes back to it
 * days later. A cookie that expired mid-pilot would bounce them to the public
 * site with their own answers stranded in a `localStorage` key they cannot
 * reach, which is a worse failure than the one this prevents. Ninety days
 * outlives the pilot; their invite link still works either way.
 */
export const INVITE_COOKIE = "pando_invited";

/** Ninety days, in seconds. */
export const INVITE_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/**
 * The screens that may only be reached after a valid invite.
 *
 * `/join` is deliberately absent: it is the door itself, and it does its own
 * resolving. `/caregiver` is absent too, and that is the 11 Aug decision rather
 * than an oversight — the caregiver's own flow is reached at `pando.is/caregiver`
 * with **no token**, because Pando holds no contact detail for a nominee
 * (invariant 13) and there is nothing to key one against. It is a link a parent
 * sends; gating it would break the only path 2C has.
 */
export function isGatedSeedPath(pathname: string): boolean {
  return (
    pathname === "/profile" ||
    pathname === "/share" ||
    pathname === "/done" ||
    pathname.startsWith("/done/")
  );
}
