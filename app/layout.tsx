/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Defines Tracer's root application layout.
 *
 * @description
 *  Applies Instrument Sans and Geist Mono, the chosen color theme, metadata, and
 *  semantic theme classes globally. The ibex favicon comes from app/icon.png.
 *
 * @remarks
 *  The color theme comes from the theme cookie, so the first response is
 *  already in the chosen theme. `dark` marks dark-scheme themes for
 *  components' dark: variants; `data-theme` selects the token block.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { resolveTheme, themeCookie } from "@/data/theme";

import "./globals.css";

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Tracer",
  description: "Spurlock Labs call tracking",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const theme = resolveTheme((await cookies()).get(themeCookie)?.value);
  return (
    <html lang="en" data-theme={theme.id} className={theme.scheme === "dark" ? "dark" : undefined}>
      <body
        className={`${instrumentSans.variable} ${geistMono.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
