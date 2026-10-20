/**
 * -------------------------------------------------------------------------
 * @file   theme-picker.test.tsx
 * @brief  Covers switching the color theme from Preferences.
 *
 * @description
 *  Checks that the picker starts on the document's current theme, that
 *  choosing Light switches the document's theme attribute and dark class
 *  at once and remembers the choice in the theme cookie, and that each
 *  tile previews its own theme.
 *
 * @see
 *  components/tracer/theme-picker.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ThemePicker } from "@/components/tracer/theme-picker";

describe("theme picker", () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
    document.cookie = "tracer-theme=; path=/; max-age=0";
  });

  afterEach(() => {
    cleanup();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
  });

  it("starts on the current theme and applies Light at once", () => {
    const { container } = render(<ThemePicker />);
    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect([...container.querySelectorAll("[data-theme]")].map((el) => el.getAttribute("data-theme"))).toEqual(["dark", "light", "midnight", "blossom", "blossom-dark"]);

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));

    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain("tracer-theme=light");

    fireEvent.click(screen.getByRole("radio", { name: "Midnight" }));
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("tracer-theme=midnight");

    fireEvent.click(screen.getByRole("radio", { name: "Blossom" }));
    expect(document.documentElement.dataset.theme).toBe("blossom");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.cookie).toContain("tracer-theme=blossom");

    fireEvent.click(screen.getByRole("radio", { name: "Blossom Dark" }));
    expect(document.documentElement.dataset.theme).toBe("blossom-dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("tracer-theme=blossom-dark");

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("tracer-theme=dark");
  });
});
