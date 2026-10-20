/**
 * -------------------------------------------------------------------------
 * @file   theme.ts
 * @brief  Lists Tracer's color themes and reads the stored choice.
 *
 * @description
 *  Each theme names the token block in app/globals.css that it selects
 *  through `data-theme`, and whether it is a dark or light scheme. The
 *  choice lives in a cookie so the root layout renders the right theme on
 *  the first response, before any script runs.
 *
 * @remarks
 *  The cookie is client-writable, so it is untrusted: any value off this
 *  list resolves to the default. Adding a theme means one entry here and
 *  one `[data-theme="..."]` token block in app/globals.css.
 *
 * @see
 *  app/globals.css
 *  components/tracer/theme-picker.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const themes = [
  { id: "dark", label: "Dark", scheme: "dark" },
  { id: "light", label: "Light", scheme: "light" },
  { id: "midnight", label: "Midnight", scheme: "dark" },
  { id: "blossom", label: "Blossom", scheme: "light" },
  { id: "blossom-dark", label: "Blossom Dark", scheme: "dark" },
] as const;

export type Theme = (typeof themes)[number];
export type ThemeId = Theme["id"];

export const defaultTheme: Theme = themes[0];

export const themeCookie = "tracer-theme";

/** Resolves a stored theme id; anything off the list is the default. */
export function resolveTheme(value: string | null | undefined): Theme {
  return themes.find((theme) => theme.id === value) ?? defaultTheme;
}
