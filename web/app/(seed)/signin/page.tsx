import { SignIn } from "@/components/seed/SignIn";

/**
 * Coming back with a number and a code (7 Sep, her second instruction).
 *
 * No server work of its own: unlike `/join` there is no code to resolve and
 * nothing to attribute — the identity arrives from `/verify/check`, and
 * `/api/seed/me` reads it from the verification the server recorded rather than
 * from anything this page could pass down.
 */
export default function Page() {
  return <SignIn />;
}
