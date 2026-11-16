import type { Metadata } from "next";
import TravelPage from "@/components/ops/TravelPage";

export const metadata: Metadata = { title: "EventFlow Twin · before you travel" };

export default function Page() {
  return <TravelPage />;
}
