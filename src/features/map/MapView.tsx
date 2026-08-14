import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { geoMercator, geoPath } from "d3-geo";
import type { GeoProjection } from "d3-geo";
import { select } from "d3-selection";
import { zoom, zoomIdentity } from "d3-zoom";
import type { D3ZoomEvent, ZoomBehavior, ZoomTransform } from "d3-zoom";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";

import { ipc, type GeoAsset } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";
import { reverseGeocodeBatch, type PlaceLabel } from "./reverseGeocode";

const WORLD_URL = `${import.meta.env.BASE_URL}geo/countries-50m.json`;
const CLUSTER_CELL = 36;
const OCEAN = "#d6e6f2";
const LAND = "#eef1ec";
const BORDER = "#8ea8b8";
const DEFAULT_MAP_SIZE = { width: 1280, height: 720 };

let worldPromise: Promise<FeatureCollection<Geometry>> | null = null;
function loadWorld(): Promise<FeatureCollection<Geometry>> {
  if (!worldPromise) {
    worldPromise = fetch(WORLD_URL)
      .then((response) => {
        if (!response.ok) throw new Error("world_map_load_failed");
        return response.json();
      })
      .then((topology: unknown) => {
        const countries = (topology as { objects?: { countries?: unknown } }).objects?.countries;
        if (!countries) throw new Error("world_map_countries_missing");
        return feature(topology as never, countries as never) as unknown as FeatureCollection<Geometry>;
      });
  }
  return worldPromise;
}

interface ProjectedPoint { x: number; y: number; asset: GeoAsset; }
interface Cluster { x: number; y: number; assets: GeoAsset[]; }

function clusterByPixel(points: ProjectedPoint[]): Cluster[] {
  const buckets = new Map<string, ProjectedPoint[]>();
  for (const point of points) {
    const key = `${Math.floor(point.x / CLUSTER_CELL)}:${Math.floor(point.y / CLUSTER_CELL)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(point);
    else buckets.set(key, [point]);
  }
  return Array.from(buckets.values(), (assets) => ({
    x: assets.reduce((total, point) => total + point.x, 0) / assets.length,
    y: assets.reduce((total, point) => total + point.y, 0) / assets.length,
    assets: assets.map((point) => point.asset),
  }));
}

/** H2 kalitesinde offline kartografi: Natural Earth sinirlari, Mercator, pan/zoom ve ekran-uzayi kumelemesi. */
export function MapView() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [svg, setSvg] = useState<SVGSVGElement | null>(null);
  const [size, setSize] = useState(DEFAULT_MAP_SIZE);
  const [world, setWorld] = useState<FeatureCollection<Geometry> | null>(null);
  const [worldError, setWorldError] = useState(false);
  const [places, setPlaces] = useState<Map<string, PlaceLabel>>(new Map());
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const { data, loading, error } = useIpcQuery<GeoAsset[]>(() => ipc.geoAssets(), []);
  const selectedId = useUiStore((state) => state.selectedId);
  const setViewMode = useUiStore((state) => state.setViewMode);
  const setGeoListIds = useUiStore((state) => state.setGeoListIds);
  const points = data ?? [];
  const pointIdentity = points.map((point) => `${point.id}:${point.latitude}:${point.longitude}`).join("|");

  useEffect(() => {
    let alive = true;
    void loadWorld()
      .then((result) => {
        if (alive) {
          setWorld(result);
          setWorldError(false);
        }
      })
      .catch(() => alive && setWorldError(true));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    void reverseGeocodeBatch(points.map((p) => ({ id: String(p.id), lat: p.latitude, lon: p.longitude })), "tr").then((result) => { if (alive) setPlaces(result); });
    return () => { alive = false; };
  }, [pointIdentity]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      // WebView ilk frame'de zaman zaman 0×0 raporlayabiliyor. Bu gecici degeri
      // kullanmak SVG'nin tum cizimini gorunmez yapar; son gecerli olcuyu koru.
      if (width > 0 && height > 0) setSize({ width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const projection = useMemo<GeoProjection | null>(() => {
    const { width, height } = size;
    if (width <= 0 || height <= 0) return null;
    const projection = geoMercator();
    if (points.length === 0) {
      projection.scale(width / (2 * Math.PI)).center([0, 0]).translate([width / 2, height / 2]);
      return projection;
    }
    let minLon = Infinity; let maxLon = -Infinity; let minLat = Infinity; let maxLat = -Infinity;
    let sumLon = 0; let sumLat = 0;
    for (const point of points) {
      minLon = Math.min(minLon, point.longitude); maxLon = Math.max(maxLon, point.longitude);
      minLat = Math.min(minLat, point.latitude); maxLat = Math.max(maxLat, point.latitude);
      sumLon += point.longitude; sumLat += point.latitude;
    }
    const centerLon = sumLon / points.length;
    const centerLat = sumLat / points.length;
    const minSpan = 28;
    if (maxLon - minLon < minSpan) { minLon = centerLon - minSpan / 2; maxLon = centerLon + minSpan / 2; }
    if (maxLat - minLat < minSpan) { minLat = centerLat - minSpan / 2; maxLat = centerLat + minSpan / 2; }
    minLat = Math.max(minLat, -82); maxLat = Math.min(maxLat, 82);
    projection.fitExtent([[48, 48], [width - 48, height - 48]], {
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: {}, geometry: { type: "MultiPoint", coordinates: [[minLon, minLat], [maxLon, maxLat]] } }],
    });
    return projection;
  }, [points, size]);

  useEffect(() => { setTransform(zoomIdentity); }, [projection]);

  const countryPaths = useMemo(() => {
    if (!world || !projection) return [];
    const path = geoPath(projection);
    return world.features.map((country) => path(country) ?? "");
  }, [projection, world]);

  const clusters = useMemo(() => {
    if (!projection) return [];
    const projected: ProjectedPoint[] = [];
    for (const point of points) {
      const base = projection([point.longitude, point.latitude]);
      if (!base) continue;
      const x = transform.applyX(base[0]); const y = transform.applyY(base[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) projected.push({ x, y, asset: point });
    }
    return clusterByPixel(projected);
  }, [points, projection, transform]);

  useEffect(() => {
    if (!svg) return undefined;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.35, 80])
      .on("zoom", (event: D3ZoomEvent<SVGSVGElement, unknown>) => setTransform(event.transform));
    const selection = select(svg);
    selection.call(behavior);
    selection.on("dblclick.zoom", null);
    zoomRef.current = behavior;
    return () => { selection.on(".zoom", null); zoomRef.current = null; };
  }, [svg]);

  const applyTransform = useCallback((next: ZoomTransform) => {
    if (svg && zoomRef.current) zoomRef.current.transform(select(svg), next);
  }, [svg]);

  const openAssetsInExplorer = useCallback((assets: GeoAsset[]) => {
    const ids = Array.from(new Set(assets.map((asset) => asset.id)));
    if (ids.length === 0) return;
    setGeoListIds(ids);
    setViewMode("explorer");
  }, [setGeoListIds, setViewMode]);

  const openAllInExplorer = useCallback(() => {
    openAssetsInExplorer(points);
  }, [openAssetsInExplorer, points]);

  const clickCluster = useCallback((cluster: Cluster) => {
    openAssetsInExplorer(cluster.assets);
  }, [openAssetsInExplorer]);

  if (loading) return <p className="p-5 text-sm text-text-muted">{t("list.loading")}</p>;
  if (error || worldError) return <p className="p-5 text-sm text-danger">{t("view.map_error")}</p>;

  const isZoomed = transform.k !== 1 || transform.x !== 0 || transform.y !== 0;
  return <section ref={containerRef} className="relative h-full min-h-0 w-full overflow-hidden bg-[#d6e6f2]">
    <div className="pointer-events-none absolute start-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-white/70 bg-white/80 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-xs text-white">●</span>
      {t("view.map_count", { count: points.length })}
    </div>
    <div className="pointer-events-none absolute bottom-3 start-4 z-10 rounded bg-white/65 px-2 py-1 text-[10px] text-slate-600 backdrop-blur">Natural Earth · public domain</div>
    {points.length > 0 && <button type="button" onClick={openAllInExplorer} className="absolute bottom-3 end-4 z-10 rounded border border-white/80 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-white">Tümünü Kaşifte aç</button>}
    <div className="absolute end-4 top-4 z-10 flex gap-1">
      <button type="button" onClick={() => applyTransform(transform.scale(1.35))} title={t("view.map_zoom_in")} aria-label={t("view.map_zoom_in")} className="grid h-8 w-8 place-items-center rounded border border-white/80 bg-white/90 text-lg text-slate-700 shadow-sm hover:bg-white">+</button>
      <button type="button" onClick={() => applyTransform(transform.scale(0.74))} title={t("view.map_zoom_out")} aria-label={t("view.map_zoom_out")} className="grid h-8 w-8 place-items-center rounded border border-white/80 bg-white/90 text-lg text-slate-700 shadow-sm hover:bg-white">−</button>
      {isZoomed && <button type="button" onClick={() => applyTransform(zoomIdentity)} title={t("view.map_reset")} className="rounded border border-white/80 bg-white/90 px-2 text-xs text-slate-700 shadow-sm hover:bg-white">{t("view.map_reset")}</button>}
    </div>
    {points.length === 0 && <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6"><div className="max-w-md rounded-xl border border-white/70 bg-white/85 p-5 text-center shadow-lg backdrop-blur"><h2 className="font-display text-base font-semibold text-slate-800">{t("view.map")}</h2><p className="mt-2 text-sm text-slate-600">{t("view.map_empty")}</p><p className="mt-1 text-xs text-slate-500">{t("view.map_hint")}</p></div></div>}
    {size.width > 0 && size.height > 0 && <svg ref={setSvg} width={size.width} height={size.height} role="img" aria-label={t("view.map")} className="block h-full w-full touch-none cursor-grab active:cursor-grabbing" style={{ background: OCEAN }}>
      <g transform={transform.toString()}>{countryPaths.map((path, index) => <path key={index} d={path} fill={LAND} stroke={BORDER} strokeWidth="0.7" vectorEffect="non-scaling-stroke" />)}</g>
      <g>{clusters.map((cluster, index) => {
        const count = cluster.assets.length;
        const selected = cluster.assets.some((asset) => asset.id === selectedId);
        const radius = count === 1 ? (selected ? 8 : 6) : Math.min(24, 12 + Math.log2(count) * 4);
        const place = places.get(String(cluster.assets[0]?.id)); const label = count === 1 ? (place ? `${place.city}, ${place.country}` : cluster.assets[0].file_name) : t("view.map_cluster", { count });
        return <g key={index} className="cursor-pointer" onClick={() => clickCluster(cluster)}>
          {selected && <circle cx={cluster.x} cy={cluster.y} r={radius + 7} fill="none" stroke="#f59e0b" strokeWidth="2.5" opacity=".9" />}
          <circle cx={cluster.x} cy={cluster.y} r={radius} fill={count === 1 ? "#4f46e5" : "#3730a3"} fillOpacity=".92" stroke="white" strokeWidth={count === 1 ? "2" : "2.5"} />
          {count > 1 && <text x={cluster.x} y={cluster.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white" style={{ pointerEvents: "none", userSelect: "none" }}>{count}</text>}
          {count === 1 && <text x={cluster.x + radius + 7} y={cluster.y + 4} fontSize="11" fontWeight="600" fill="#22323d" stroke="white" strokeWidth="3" paintOrder="stroke" style={{ userSelect: "none" }}>{places.get(String(cluster.assets[0].id)) ? `${places.get(String(cluster.assets[0].id))?.city}, ${places.get(String(cluster.assets[0].id))?.country}` : cluster.assets[0].file_name.slice(0, 28)}</text>}
          {count > 1 && place && <text x={cluster.x} y={cluster.y + radius + 14} textAnchor="middle" fontSize="11" fontWeight="600" fill="#22323d" stroke="white" strokeWidth="3" paintOrder="stroke" style={{ pointerEvents: "none", userSelect: "none" }}>{place.city}, {place.country}</text>}
          <title>{label}</title>
        </g>;
      })}</g>
    </svg>}
  </section>;
}