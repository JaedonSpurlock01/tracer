/**
 * PROTOTYPE - OpenStreetMap tile mosaic with one marker, plus a Nominatim
 * geocode hook. No dependency: the tiles around the point are laid out as
 * plain images for the measured box. The real component (also meant for
 * GMB pins and a Service Area ring) should move to Leaflet or MapLibre
 * with OSM tiles and geocode on the server with a cache per Workspace.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { MapPin } from "lucide-react";

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

const tileSize = 256;

/** World pixel position of a point at a zoom, in the Web Mercator tile grid. */
function project(point: MapPoint, zoom: number): { x: number; y: number } {
  const scale = tileSize * 2 ** zoom;
  const lat = (Math.min(85, Math.max(-85, point.lat)) * Math.PI) / 180;
  return {
    x: ((point.lon + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * scale,
  };
}

/** Renders OSM tiles around `point` in the box, or the `placeholder` when there is no point. */
export function OsmMap({ point, zoom = 12, title, className = "", placeholder }: { point: MapPoint | null; zoom?: number; title: string; className?: string; placeholder?: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
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
  const centre = project(point, zoom);
  const tiles: Array<{ x: number; y: number; left: number; top: number }> = [];
  if (size) {
    const left = centre.x - size.width / 2;
    const top = centre.y - size.height / 2;
    const max = 2 ** zoom;
    for (let x = Math.floor(left / tileSize); x * tileSize < left + size.width; x += 1) {
      for (let y = Math.floor(top / tileSize); y * tileSize < top + size.height; y += 1) {
        if (y < 0 || y >= max) continue;
        tiles.push({ x: ((x % max) + max) % max, y, left: x * tileSize - left, top: y * tileSize - top });
      }
    }
  }
  return (
    <div ref={box} role="img" aria-label={title} className={`relative overflow-hidden rounded-lg border bg-muted ${className}`}>
      <div className="absolute inset-0 dark:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.6)]">
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${tile.x}-${tile.y}`} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} alt="" width={tileSize} height={tileSize} className="absolute max-w-none" style={{ left: tile.left, top: tile.top }} />
        ))}
      </div>
      <MapPin className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-full fill-brand text-background drop-shadow" aria-hidden="true" />
      <a href={`https://www.openstreetmap.org/#map=${zoom}/${point.lat.toFixed(5)}/${point.lon.toFixed(5)}`} target="_blank" rel="noreferrer" className="absolute bottom-0 right-0 bg-background/80 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:underline">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
