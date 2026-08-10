import { adminAuthMode, adminUsers } from "@/lib/admin/auth";
import { LoginForm } from "@/components/admin/LoginForm";

/**
 * Admin sign-in (estimate 2.1). Each person has their own password, so the name
 * on every audit row is one they proved rather than one they picked.
 *
 * The mode is passed down and shown, because "which authentication is this
 * deployment actually running" should not be something you have to read the env
 * to find out.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/admin";

  return (
    <LoginForm
      users={adminUsers()}
      mode={adminAuthMode()}
      next={next.startsWith("/admin") ? next : "/admin"}
    />
  );
}
