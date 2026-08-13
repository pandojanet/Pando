import { redirect } from "next/navigation";

/**
 * The consent file moved into Contributors, where the people it is about already
 * are (13 Aug). This stays because the old address is in somebody's bookmarks and
 * in the audit trail, and a dead link is a worse answer than a redirect.
 */
export default function ConsentsPage() {
  redirect("/admin/contributors?view=consents");
}
