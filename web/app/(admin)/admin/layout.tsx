import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AdminShell } from "@/components/admin/Shell";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";

export const metadata: Metadata = {
  title: { absolute: "Pando admin" },
  robots: { index: false, follow: false },
};

/**
 * Every admin page except the login screen renders inside the shell. `proxy.ts`
 * has already rejected unauthenticated requests before this runs; reading the
 * cookie here is only to know *whose* name to show and attribute actions to.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await readAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);

  // Unreachable in practice (proxy redirects first), and harmless if it happens.
  if (!session) return children;

  return <AdminShell user={session.user}>{children}</AdminShell>;
}
