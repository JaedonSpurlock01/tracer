/**
 * -------------------------------------------------------------------------
 * @file   layout.tsx
 * @brief  Defines Tracer's root application layout.
 *
 * @description
 *  Applies Geist, dark mode, metadata, and semantic theme classes globally.
 *
 * @remarks
 *  Tracer is dark-only, so the dark class is fixed on the root element.
 *
 * @see
 *  DESIGN.md
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import type { Metadata } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

export const metadata: Metadata = {
  title: "Tracer",
  description: "Spurlock Labs call tracking",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geist.variable} min-h-screen bg-background font-sans text-foreground antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
