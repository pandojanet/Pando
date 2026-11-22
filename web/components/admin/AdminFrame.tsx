"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { AdminShell } from "@/components/admin/Shell";

/**
 * The admin's frame, except where a page stands alone (20 Nov): the Claude connect screen is a sign-in
 * step another service sends a person to, so it is drawn on its own, like the login, not inside the
 * admin's menu.
 */
const BARE = ["/admin/connect"];

export function AdminFrame({ user, children }: { user: string; children: ReactNode }) {
  const pathname = usePathname();
  if (BARE.some((p) => pathname === p || pathname?.startsWith(`${p}/`))) return <>{children}</>;
  return <AdminShell user={user}>{children}</AdminShell>;
}
