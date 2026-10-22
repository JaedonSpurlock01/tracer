/**
 * PROTOTYPE - OpenStreetMap embed with one marker, plus a Nominatim
 * geocode hook. No dependency: the openstreetmap.org export iframe draws
 * tiles, attribution, and the marker. The real component (also meant for
 * GMB pins and a Service Area ring) should move to Leaflet or MapLibre
 * with OSM tiles and geocode on the server with a cache per Workspace.
 */
"use client";

import { useEffect, useRef, useState } from "react";

export interface MapPoint {
  lat: number;
  lon: number;
}

export type GeocodeStatus = "idle" | "loading" | "found" | "missing" | "failed";

/** Geocodes a free-text place through Nominatim, debounced so typing does not spam it. */
export function useGeocode(query: string): { point: MapPoint | null; label: string; status: GeocodeStatus } {
  const [state, setState] = useState<{ point: MapPoint | null; label: string; status: GeocodeStatus }>({ point: null, label: "", status: "idle" });
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState((previous) => ({ ...previous, status: "loading" }));
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`, { signal: controller.signal });
        const rows = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
        const row = rows[0];
        if (!row) setState({ point: null, label: "", status: "missing" });
        else setState({ point: { lat: Number(row.lat), lon: Number(row.lon) }, label: row.display_name, status: "found" });
      } catch (error) {
        if ((error as Error).name !== "AbortError") setState({ point: null, label: "", status: "failed" });
      }
    }, 700);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);
  return trimmed ? state : { point: null, label: "", status: "idle" };
}

/** Renders an OSM embed centred on `point`, or the `placeholder` when there is no point. */
export function OsmMap({ point, span = 0.12, title, className = "", placeholder }: { point: MapPoint | null; span?: number; title: string; className?: string; placeholder?: React.ReactNode }) {
  // The embed's Leaflet sizes itself once on load, so the iframe is re-keyed when its box changes.
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState("");
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let last = "";
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const next = `${Math.round(width / 40)}x${Math.round(height / 40)}`;
      if (last && next !== last) setSize(next);
      last = next;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [point]);
  if (!point) {
    return (
      <div className={`flex items-center justify-center rounded-lg border border-dashed bg-muted/40 p-4 text-center text-sm text-muted-foreground ${className}`}>
        {placeholder ?? "No location yet."}
      </div>
    );
  }
  const half = span / 2;
  const bbox = [point.lon - half, point.lat - half * 0.6, point.lon + half, point.lat + half * 0.6].map((value) => value.toFixed(5)).join(",");
  return (
    <div ref={box} className={`overflow-hidden rounded-lg border ${className}`}>
      <iframe
        key={size}
        title={title}
        className="block size-full dark:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.6)]"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${point.lat.toFixed(5)},${point.lon.toFixed(5)}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
