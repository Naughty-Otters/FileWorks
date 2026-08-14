import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Legal, refunds, and contact — FileWorks",
  description:
    "FileWorks (fileworks.ai) customer service, refund and dispute policy, cancellation, returns, export restrictions, and promotions.",
};

export default function LegalRoute() {
  return <LegalPage />;
}
