/**
 * -------------------------------------------------------------------------
 * @file   root-layout.test.tsx
 * @brief  Verifies the Tracer root layout foundation.
 *
 * @description
 *  Renders the public root interface and checks dark semantic theme usage.
 *
 * @remarks
 *  The M1 page remains static and contains no product behavior.
 *
 * @see
 *  app/layout.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "tracer-theme" && cookie.value !== undefined ? { name, value: cookie.value } : undefined) }),
}));

vi.mock("next/font/google", () => ({
  Instrument_Sans: () => ({ variable: "font-instrument-sans" }),
  Geist_Mono: () => ({ variable: "font-geist-mono" }),
}));

import RootLayout from "@/app/layout";

describe("root layout", () => {
  async function markupFor(value: string | undefined): Promise<string> {
    cookie.value = value;
    return renderToStaticMarkup(await RootLayout({ children: <main>Tracer content</main> }));
  }

  it("applies the dark theme by default with semantic theme tokens", async () => {
    const markup = await markupFor(undefined);

    expect(markup).toContain('<html lang="en" data-theme="dark" class="dark"');
    expect(markup).toContain("bg-background");
    expect(markup).toContain("text-foreground");
    expect(markup).toContain("<main>Tracer content</main>");
  });

  it("applies the light theme from its cookie without the dark class", async () => {
    expect(await markupFor("light")).toContain('<html lang="en" data-theme="light">');
  });

  it("ignores an unknown theme cookie", async () => {
    expect(await markupFor("neon\" onload=\"x")).toContain('<html lang="en" data-theme="dark" class="dark"');
  });
});
