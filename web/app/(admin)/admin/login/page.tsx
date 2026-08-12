import { adminAuthMode } from "@/lib/admin/auth";
import { adminCredentials } from "@/lib/server/admin-auth";
import { LoginForm } from "@/components/admin/LoginForm";

/**
 * Admin sign-in (estimate 2.1). Each person has their own password, so the name
 * on every audit row is one they proved rather than one they picked.
 *
 * **Only the mode crosses to the client — never the list of people.** This page is
 * unauthenticated, and who holds admin access is not something it should hand out:
 * `verifyCredentials` hashes an unknown name against a throwaway salt so response
 * time cannot enumerate them, which would be pointless if the same page rendered
 * the list. The mode itself is shown deliberately — "which authentication is this
 * deployment actually running" should not need an env dump to answer.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/admin";
  const credentials = await adminCredentials();

  return (
    <LoginForm
      mode={adminAuthMode(credentials)}
      next={next.startsWith("/admin") ? next : "/admin"}
    />
  );
}
