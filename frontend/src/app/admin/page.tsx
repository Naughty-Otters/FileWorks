import type { Metadata } from "next";
import { AdminPage } from "@/components/admin-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Admin",
  description: "FileWorks admin — inspect users and override plans.",
  path: "/admin",
  noIndex: true,
});

export default function AdminRoute() {
  return <AdminPage />;
}
