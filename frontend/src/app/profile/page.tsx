import type { Metadata } from "next";
import { ProfilePage } from "@/components/profile-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Account",
  description: "Manage your FileWorks workspace role, Convert API keys, usage, and Stripe billing.",
  path: "/profile",
  noIndex: true,
});

export default function ProfileRoute() {
  return <ProfilePage />;
}
