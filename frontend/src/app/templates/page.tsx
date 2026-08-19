import type { Metadata } from "next";
import { TemplateLibrary } from "@/components/template-library";

export const metadata: Metadata = {
  title: "Document Templates · FileWorks",
  description: "Build and manage reusable document output templates.",
};

export default function TemplatesPage() {
  return <TemplateLibrary />;
}
