// Turns an entry's `location` block into a map pin, the same way for validation and export.
import { Geocoder, insideBbox, type PostcodeFormat } from "./geocode.ts";

export interface CityConfig {
  id: string;
  name: string;
  country: string;
  postcode_format: PostcodeFormat;
  center: [number, number];
  zoom: number;
  bbox: [number, number, number, number];
  maintainers?: string[];
  areas: { id: string; label: string; center: [number, number] }[];
}

export interface Location {
  postcode?: string;
  area?: string;
  lat?: number;
  lng?: number;
}

/** How the pin position was obtained, from most to least precise. */
export type Precision = "coordinates" | "postcode" | "area";

export type Pin = { lat: number; lng: number; precision: Precision };

export interface Resolved {
  pin: Pin | null;
  errors: string[];
  warnings: string[];
}

export async function resolveLocation(loc: Location, city: CityConfig, geocoder: Geocoder): Promise<Resolved> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const area = loc.area ? city.areas.find((a) => a.id === loc.area) : undefined;
  if (loc.area && !area) {
    errors.push(`location.area "${loc.area}" is not in ${city.id}/city.yaml (allowed: ${city.areas.map((a) => a.id).join(", ")})`);
  }

  let pin: Pin | null = null;
  if (loc.lat != null && loc.lng != null) {
    if (insideBbox(city.bbox, loc.lat, loc.lng)) pin = { lat: loc.lat, lng: loc.lng, precision: "coordinates" };
    else errors.push(`location.lat/lng (${loc.lat}, ${loc.lng}) is outside the ${city.name} bounding box`);
  }

  if (loc.postcode) {
    const geo = await geocoder.lookup(city.postcode_format, loc.postcode);
    if (geo.status === "not-found") {
      errors.push(`location.postcode "${loc.postcode}" was not found by the geocoder`);
    } else if (geo.status === "unavailable") {
      warnings.push(`could not geocode postcode "${loc.postcode}" (${geo.reason})`);
    } else if (!insideBbox(city.bbox, geo.lat, geo.lng)) {
      // Only an error when the postcode is what places the pin.
      if (loc.lat == null) errors.push(`location.postcode "${loc.postcode}" is outside the ${city.name} bounding box`);
    } else if (!pin) {
      pin = { lat: geo.lat, lng: geo.lng, precision: "postcode" };
    }
  }

  if (!pin && area && errors.length === 0) {
    pin = { lat: area.center[0], lng: area.center[1], precision: "area" };
  }
  return { pin, errors, warnings };
}
