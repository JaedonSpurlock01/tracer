/**
 * -------------------------------------------------------------------------
 * @file   location-map.tsx
 * @brief  Shows one point on an OpenStreetMap tile map.
 *
 * @description
 *  Lays out the OpenStreetMap tiles around a point to fill the measured
 *  box, draws a pin at the centre, and links the attribution to the same
 *  view on openstreetmap.org. Without a point it renders the placeholder.
 *
 * @remarks
 *  Tiles come straight from tile.openstreetmap.org as plain images under
 *  its usage policy, so there is no map library and no credential; the
 *  map is a still picture rather than a pannable one. Under the dark
 *  theme the tiles are inverted so the map sits with the page. The Site
 *  settings Business section uses it for the Business's city, and a
 *  Google Business Profile location can reuse it.
 *
 * @see
 *  components/tracer/site-deal-settings.tsx
 *  https://operations.osmfoundation.org/policies/tiles/
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MapPin } from "lucide-react";

export interface MapPoint {
  latitude: number;
  longitude: number;
}

const tileSize = 256;

/** The point's pixel position in the Web Mercator tile grid at a zoom. */
function project(point: MapPoint, zoom: number): { x: number; y: number } {
  const scale = tileSize * 2 ** zoom;
  const latitude = (Math.min(85, Math.max(-85, point.latitude)) * Math.PI) / 180;
  return {
    x: ((point.longitude + 180) / 360) * scale,
    y: ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) / 2) * scale,
  };
}

export default function LocationMap({ point, zoom = 12, label, className = "", placeholder }: { point: MapPoint | null; zoom?: number; label: string; className?: string; placeholder?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
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
    const count = 2 ** zoom;
    for (let x = Math.floor(left / tileSize); x * tileSize < left + size.width; x += 1) {
      for (let y = Math.floor(top / tileSize); y * tileSize < top + size.height; y += 1) {
        if (y < 0 || y >= count) continue;
        tiles.push({ x: ((x % count) + count) % count, y, left: x * tileSize - left, top: y * tileSize - top });
      }
    }
  }
  return (
    <div ref={box} role="img" aria-label={label} className={`relative overflow-hidden rounded-lg border bg-muted ${className}`}>
      <div className="absolute inset-0 dark:[filter:invert(0.92)_hue-rotate(180deg)_saturate(0.6)]">
        {tiles.map((tile) => (
          // eslint-disable-next-line @next/next/no-img-element -- OpenStreetMap tiles are served as-is.
          <img key={`${tile.x}-${tile.y}`} src={`https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`} alt="" width={tileSize} height={tileSize} className="absolute max-w-none" style={{ left: tile.left, top: tile.top }} />
        ))}
      </div>
      <MapPin className="absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-full fill-brand text-background drop-shadow" aria-hidden="true" />
      <a href={`https://www.openstreetmap.org/#map=${zoom}/${point.latitude.toFixed(5)}/${point.longitude.toFixed(5)}`} target="_blank" rel="noreferrer" className="absolute bottom-0 right-0 bg-background/80 px-1.5 py-0.5 text-xs text-muted-foreground hover:underline">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}
