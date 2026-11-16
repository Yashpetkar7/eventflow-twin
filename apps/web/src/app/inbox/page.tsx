import type { Metadata } from "next";
import OpsInboxPage from "@/components/ops/OpsInboxPage";

export const metadata: Metadata = { title: "EventFlow Twin · duty inbox" };

export default function Page() {
  return <OpsInboxPage />;
}
