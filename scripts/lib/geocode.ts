// Postcode format checks and postcode → lat/lng lookups, with an on-disk cache.
// UK: postcodes.io (free, no key). France: the IGN Géoplateforme geocoder (free, no key).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PostcodeFormat = "uk" | "fr";

const FORMATS: Record<PostcodeFormat, RegExp> = {
  // Covers every current UK postcode shape, including GIR 0AA.
  uk: /^(GIR 0AA|[A-PR-UWYZ][0-9]{1,2} [0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][A-HK-Y][0-9]{1,2} [0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][0-9][A-HJKPS-UW] [0-9][ABD-HJLNP-UW-Z]{2}|[A-PR-UWYZ][A-HK-Y][0-9][ABEHMNPRV-Y] [0-9][ABD-HJLNP-UW-Z]{2})$/,
  fr: /^[0-9]{5}$/,
};

export function normalisePostcode(format: PostcodeFormat, raw: string): string {
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  if (format === "uk" && compact.length > 3) return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return compact;
}

export function isValidPostcodeFormat(format: PostcodeFormat, raw: string): boolean {
  return FORMATS[format].test(normalisePostcode(format, raw));
}

export type GeocodeResult =
  | { status: "ok"; lat: number; lng: number }
  | { status: "not-found" }
  | { status: "unavailable"; reason: string };

type CacheEntry = { lat: number; lng: number } | { notFound: true };

export class Geocoder {
  private cache: Record<string, CacheEntry> = {};
  private dirty = false;

  constructor(
    private cacheFile: string,
    /** When true, only the cache is used and missing postcodes come back "unavailable". */
    private offline = false,
  ) {
    if (existsSync(cacheFile)) this.cache = JSON.parse(readFileSync(cacheFile, "utf8"));
  }

  static forRepo(root: string, offline = false) {
    return new Geocoder(join(root, "scripts", "geocode-cache.json"), offline);
  }

  async lookup(format: PostcodeFormat, raw: string): Promise<GeocodeResult> {
    const postcode = normalisePostcode(format, raw);
    const key = `${format}:${postcode}`;
    const hit = this.cache[key];
    if (hit) return "notFound" in hit ? { status: "not-found" } : { status: "ok", ...hit };
    if (this.offline) return { status: "unavailable", reason: "offline mode and postcode not in cache" };

    let result: GeocodeResult;
    try {
      result = format === "uk" ? await lookupUk(postcode) : await lookupFr(postcode);
    } catch (e) {
      return { status: "unavailable", reason: (e as Error).message };
    }
    if (result.status === "ok") this.cache[key] = { lat: result.lat, lng: result.lng };
    if (result.status === "not-found") this.cache[key] = { notFound: true };
    if (result.status !== "unavailable") this.dirty = true;
    return result;
  }

  save() {
    if (!this.dirty) return;
    const sorted = Object.fromEntries(Object.entries(this.cache).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(this.cacheFile, JSON.stringify(sorted, null, 2) + "\n");
    this.dirty = false;
  }
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "startup-map-validator" } });
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  return { status: res.status, body };
}

async function lookupUk(postcode: string): Promise<GeocodeResult> {
  const enc = encodeURIComponent(postcode);
  const live = await getJson(`https://api.postcodes.io/postcodes/${enc}`);
  if (live.status === 200 && live.body?.result?.latitude != null) {
    return { status: "ok", lat: live.body.result.latitude, lng: live.body.result.longitude };
  }
  if (live.status !== 404) return { status: "unavailable", reason: `postcodes.io returned HTTP ${live.status}` };
  // Recently retired postcodes still have a known location.
  const old = await getJson(`https://api.postcodes.io/terminated_postcodes/${enc}`);
  if (old.status === 200 && old.body?.result?.latitude != null) {
    return { status: "ok", lat: old.body.result.latitude, lng: old.body.result.longitude };
  }
  return old.status === 404 ? { status: "not-found" } : { status: "unavailable", reason: `postcodes.io returned HTTP ${old.status}` };
}

async function lookupFr(postcode: string): Promise<GeocodeResult> {
  const { status, body } = await getJson(
    `https://data.geopf.fr/geocodage/search?q=${postcode}&index=address&type=municipality&limit=5`,
  );
  if (status !== 200) return { status: "unavailable", reason: `Géoplateforme returned HTTP ${status}` };
  const match = (body?.features ?? []).find((f: any) => f.properties?.postcode === postcode);
  if (!match) return { status: "not-found" };
  const [lng, lat] = match.geometry.coordinates;
  return { status: "ok", lat, lng };
}

/** bbox is [south, west, north, east] as in city.yaml. */
export function insideBbox(bbox: number[], lat: number, lng: number): boolean {
  const [south, west, north, east] = bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
}
