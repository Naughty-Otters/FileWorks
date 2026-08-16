import type { Metadata } from "next";
import { LoginScreen } from "@/components/login-screen";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Sign in",
  description: "Sign in to FileWorks with Google to convert PDF and Office files to Markdown, save history, and manage billing.",
  path: "/login",
  noIndex: true,
});

export default function LoginPage() {
  return <LoginScreen />;
}
