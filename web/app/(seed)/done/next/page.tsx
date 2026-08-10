import { WhatsNext } from "@/components/seed/done/WhatsNext";

/**
 * Estimate 1.7, screen 3 of 3 — what happens after they close the tab, plus D2.
 *
 * Reads nothing back from the parent, so it sits behind the completion write.
 */
export default function DoneNextPage() {
  return <WhatsNext />;
}
