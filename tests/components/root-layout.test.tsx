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

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-geist" }),
}));

import RootLayout from "@/app/layout";
import Home from "@/app/page";

describe("root layout", () => {
  it("applies dark mode and semantic theme tokens", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <Home />
      </RootLayout>,
    );

    expect(markup).toContain('<html lang="en" class="dark"');
    expect(markup).toContain("bg-background");
    expect(markup).toContain("text-foreground");
    expect(markup).toContain("Tracer");
    expect(markup).toContain("Application skeleton");
  });
});
