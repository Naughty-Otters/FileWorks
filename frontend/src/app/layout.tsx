import type { Metadata } from "next";
import { Fraunces, IBM_Plex_Mono, Manrope } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
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
  title: "FileWorks — Convert any format",
  description: "Convert and transform office docs, PDFs, images, and more into the format you need.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable} h-full`}>
      <body className={`${body.className} min-h-full antialiased`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
