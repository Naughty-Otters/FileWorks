import type { Metadata } from "next";
import { ApiPage } from "@/components/api-page";
import { BUSINESS_NAME } from "@/lib/legal";

export const metadata: Metadata = {
  title: `Convert API — ${BUSINESS_NAME}`,
  description:
    "FileWorks convert API: upload a file and get Markdown, HTML, TXT, or JSON. Examples in curl, Python, and JavaScript.",
};

export default function DocsRoute() {
  return <ApiPage />;
}
