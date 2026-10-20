/**
 * -------------------------------------------------------------------------
 * @file   report-fonts.ts
 * @brief  Names the Geist font files the report PDF embeds.
 *
 * @description
 *  Lists Geist Regular and SemiBold as TTF paths relative to the working
 *  directory, inside the installed `geist` package.
 *
 * @remarks
 *  The PDF renderer reads these paths, and the Trigger.dev build copies the
 *  same files to the same relative paths in the deployed image, so one list
 *  serves both. This module has no imports so the Trigger.dev config can
 *  read it without loading the renderer.
 *
 * @see
 *  data/report-pdf.tsx
 *  trigger.config.ts
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
export const reportFontPaths = {
  regular: "node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf",
  semibold: "node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.ttf",
} as const;
