import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";
import { CanonicalRedirect } from "@/components/canonical-redirect";
import { GoogleAnalytics } from "@/components/google-analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { BUSINESS_NAME, SITE_URL } from "@/lib/legal";
import { DEFAULT_OG_IMAGE, PRIMARY_KEYWORDS, SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/seo";
import "./globals.css";

const display = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: true,
  preload: false,
});

const body = Manrope({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
  adjustFontFallback: true,
  preload: false,
});

const mono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400"],
  display: "optional",
  adjustFontFallback: true,
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BUSINESS_NAME} — ${SITE_TAGLINE}`,
    template: `%s — ${BUSINESS_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: BUSINESS_NAME,
  authors: [{ name: BUSINESS_NAME, url: SITE_URL }],
  creator: BUSINESS_NAME,
  publisher: BUSINESS_NAME,
  category: "technology",
  keywords: [...PRIMARY_KEYWORDS],
  referrer: "origin-when-cross-origin",
  alternates: { canonical: SITE_URL },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: BUSINESS_NAME,
    title: `${BUSINESS_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: DEFAULT_OG_IMAGE,
        width: 1200,
        height: 630,
        alt: `${BUSINESS_NAME} — ${SITE_TAGLINE}`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BUSINESS_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
  appleWebApp: {
    capable: true,
    title: BUSINESS_NAME,
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
    shortcut: "/icons/favicon-32.png",
  },
  other: {
    "msapplication-TileColor": "#0f6e56",
    "msapplication-TileImage": "/icons/mstile-150.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3efe6" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1411" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <head>
        {/* Static, deploy-rewritten API endpoint. Must run before app code so the
            first request already knows where the API lives. */}
        <script src="/config.js" />
      </head>
      <body className={`${body.className} min-h-full antialiased`}>
        <GoogleAnalytics />
        <CanonicalRedirect />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
