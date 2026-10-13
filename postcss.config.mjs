/**
 * -------------------------------------------------------------------------
 * @file   postcss.config.mjs
 * @brief  Configures Tailwind CSS processing for Tracer.
 *
 * @description
 *  Registers the Tailwind CSS PostCSS plugin used by Next.js builds.
 *
 * @remarks
 *  Tailwind CSS 4 owns the CSS-first theme compilation pipeline.
 *
 * @see
 *  app/globals.css
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
const postcssConfig = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default postcssConfig;
