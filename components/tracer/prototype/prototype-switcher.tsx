/**
 * PROTOTYPE - throwaway floating variant switcher. Hidden in production.
 * Three Call Detail variants, switchable via ?variant= on
 * /workspaces/[id]/calls/[callId]. ?demo=1 swaps the real Call for a rich
 * fixture with synthetic audio so density and playback can be judged.
 */
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

export const prototypeVariants = [
  { key: "A", name: "Studio" },
  { key: "B", name: "Reader" },
  { key: "C", name: "Dossier" },
] as const;

export type PrototypeVariantKey = (typeof prototypeVariants)[number]["key"];

export function usePrototypeVariant(): PrototypeVariantKey | null {
  const params = useSearchParams();
  const value = params.get("variant");
  if (process.env.NODE_ENV === "production") return null;
  return prototypeVariants.some((variant) => variant.key === value) ? (value as PrototypeVariantKey) : null;
}

export default function PrototypeSwitcher({ current, bottomClassName = "bottom-4" }: { current: PrototypeVariantKey; bottomClassName?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const index = prototypeVariants.findIndex((variant) => variant.key === current);

  function go(offset: number) {
    const next = prototypeVariants[(index + offset + prototypeVariants.length) % prototypeVariants.length];
    const search = new URLSearchParams(params.toString());
    search.set("variant", next.key);
    router.replace(`${pathname}?${search.toString()}`);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      // The player owns plain arrow keys for seeking; the switcher takes Shift+arrows.
      if (!event.shiftKey) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className={`fixed left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full border border-amber-400/60 bg-amber-300 px-3 py-1.5 font-mono text-xs text-black shadow-lg ${bottomClassName}`}>
      <button type="button" onClick={() => go(-1)} aria-label="Previous variant" className="px-1">&larr;</button>
      <span>PROTOTYPE {current} ({prototypeVariants[index].name})</span>
      <button type="button" onClick={() => go(1)} aria-label="Next variant" className="px-1">&rarr;</button>
    </div>
  );
}
