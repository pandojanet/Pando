import { ProfileSaved } from "@/components/seed/ProfileSaved";

/**
 * Handoff screen after the profile saves.
 *
 * The real completion screen with the founding badge and the return link is
 * estimate 1.7, and what comes after it is the chat-seeding interface (1.4).
 * This is the seam between them — deliberately small, and honest about the fact
 * that recommendation capture is the next build step.
 */
export default function DonePage() {
  return <ProfileSaved />;
}
