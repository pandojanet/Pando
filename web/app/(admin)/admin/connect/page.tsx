import { cookies } from "next/headers";
import { ConnectScreen } from "@/components/admin/ConnectScreen";
import { ADMIN_COOKIE } from "@/lib/admin/auth";
import { readAdminSession } from "@/lib/server/admin-auth";

/**
 * Connecting Claude to Pando MCP (20 Nov): the OAuth consent screen, drawn on its own without the
 * admin's menu (`AdminFrame` leaves this path bare). The signed-in admin's name is read here, on the
 * server, so the screen can say whose access Claude is being given.
 */
export default async function ConnectPage() {
  const session = await readAdminSession((await cookies()).get(ADMIN_COOKIE)?.value);
  return <ConnectScreen user={session?.user ?? ""} />;
}
