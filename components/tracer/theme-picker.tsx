/**
 * -------------------------------------------------------------------------
 * @file   theme-picker.tsx
 * @brief  Lets a user switch Tracer's color theme.
 *
 * @description
 *  Shows each theme as a selectable tile holding a miniature of the app
 *  drawn in that theme's own tokens. Choosing one applies it at once and
 *  remembers it in a cookie for this browser.
 *
 * @remarks
 *  Adapted from the ReUI card radio group pattern (c-radio-group-12), the
 *  same composition as the avatar picker. Each miniature sets `data-theme`
 *  on itself, so it renders with the real token block for its theme
 *  whatever theme the page is in. Mount it only on the client, after data
 *  loads, since it reads the current theme from the document.
 *
 * @see
 *  data/theme.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useState } from "react";

import { Field, FieldLabel } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { resolveTheme, themeCookie, themes, type Theme, type ThemeId } from "@/data/theme";

const oneYearSeconds = 60 * 60 * 24 * 365;

/** Switches the document to a theme and remembers it for this browser. */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.classList.toggle("dark", theme.scheme === "dark");
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${themeCookie}=${theme.id}; path=/; max-age=${oneYearSeconds}; samesite=lax${secure}`;
}

/** A miniature app frame: sidebar, header bar, and two content panels. */
function ThemePreview({ id }: { id: ThemeId }) {
  return (
    <div data-theme={id} aria-hidden="true" className="flex h-20 w-full overflow-hidden rounded-md border border-border bg-background">
      <div className="flex w-1/4 flex-col gap-1 border-r border-border bg-sidebar p-1.5">
        <div className="h-1.5 w-3/4 rounded-sm bg-foreground/70" />
        <div className="h-1.5 w-full rounded-sm bg-sidebar-accent" />
        <div className="h-1.5 w-2/3 rounded-sm bg-muted-foreground/40" />
        <div className="h-1.5 w-3/4 rounded-sm bg-muted-foreground/40" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
        <div className="h-2 w-1/3 rounded-sm bg-foreground/80" />
        <div className="flex flex-1 gap-1.5">
          <div className="flex flex-1 flex-col justify-end gap-1 rounded-sm border border-border bg-card p-1">
            <div className="h-1 w-2/3 rounded-sm bg-muted-foreground/50" />
            <div className="h-1.5 w-1/3 rounded-sm bg-primary" />
          </div>
          <div className="flex flex-1 items-end gap-0.5 rounded-sm border border-border bg-card p-1">
            <div className="h-1/3 flex-1 rounded-[1px] bg-chart-3" />
            <div className="h-2/3 flex-1 rounded-[1px] bg-chart-2" />
            <div className="h-1/2 flex-1 rounded-[1px] bg-chart-1" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function ThemePicker() {
  const [value, setValue] = useState<ThemeId>(() => resolveTheme(document.documentElement.dataset.theme).id);

  function choose(next: ThemeId) {
    const theme = resolveTheme(next);
    setValue(theme.id);
    applyTheme(theme);
  }

  return (
    <RadioGroup value={value} onValueChange={(next) => choose(String(next) as ThemeId)} className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {themes.map((theme) => {
        const id = `theme-${theme.id}`;
        return (
          <FieldLabel key={theme.id} htmlFor={id} className="p-0!">
            <Field className="gap-2.5">
              <ThemePreview id={theme.id} />
              <div className="flex items-center justify-between gap-2">
                <span id={`${id}-name`} className="text-sm font-medium">{theme.label}</span>
                {/* Base UI moves `id` to its hidden input, so name the visible radio directly. */}
                <RadioGroupItem value={theme.id} id={id} aria-labelledby={`${id}-name`} />
              </div>
            </Field>
          </FieldLabel>
        );
      })}
    </RadioGroup>
  );
}
