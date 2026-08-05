import { adminConfigured, adminUsers } from "@/lib/admin/auth";
import { LoginForm } from "@/components/admin/LoginForm";

/**
 * Admin sign-in (estimate 2.1). One shared password, plus which of the configured
 * people you are — so every audit row has a name against it.
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
      configured={adminConfigured()}
      next={next.startsWith("/admin") ? next : "/admin"}
    />
  );
}
