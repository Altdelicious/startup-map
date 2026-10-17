// Builds the open-data downloads and the site's data:
//   site/public/data/data.json  — every entry, the taxonomy, cities and universities
//   site/public/data/data.csv   — one row per entry (startups, investors, ecosystem), flat columns
//   site/public/logos/<city>/…  — logo files referenced by entries
// Postcodes are geocoded here (see scripts/lib/geocode.ts); run `npm run validate` first.
//
//   npm run export                 # geocode over the network, using scripts/geocode-cache.json
//   npm run export -- --offline    # cache only; entries with uncached postcodes fall back to their area
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepo } from "./lib/data.ts";
import { Geocoder } from "./lib/geocode.ts";
import { resolveLocation, type CityConfig, type Pin } from "./lib/location.ts";

export const CSV_COLUMNS = [
  "type", "city", "id", "name", "website", "tagline", "category", "tags", "status", "stage", "founded",
  "team_size", "origin_type", "origin_institution", "origin_department", "investors", "investor_type",
  "focus", "ecosystem_type", "acquired_by", "postcode", "area", "lat", "lng", "pin_precision",
  "careers_url", "linkedin", "github", "crunchbase", "source", "last_verified",
] as const;

export async function exportData(root: string, outDir: string, offline = false) {
  const repo = loadRepo(root);
  if (repo.parseErrors.length) {
    throw new Error(`cannot export: ${repo.parseErrors.map((e) => `${e.rel}: ${e.message}`).join("; ")}`);
  }
  const geocoder = Geocoder.forRepo(root, offline);
  const cities = new Map<string, CityConfig>(repo.cities.filter((c) => c.file).map((c) => [c.id, c.file!.data]));

  const logoOut = join(outDir, "..", "logos");
  rmSync(logoOut, { recursive: true, force: true });
  mkdirSync(join(outDir), { recursive: true });

  const entries: any[] = [];
  for (const ent of repo.entities) {
    const city = cities.get(ent.city);
    if (!city) continue;
    const d = ent.data;
    let pin: Pin | null = null;
    if (d.location) {
      const r = await resolveLocation(d.location, city, geocoder);
      pin = r.pin;
      // Offline or geocoder down: fall back to the area centre rather than dropping the pin.
      if (!pin && d.location.area) {
        const area = city.areas.find((a) => a.id === d.location.area);
        if (area) pin = { lat: area.center[0], lng: area.center[1], precision: "area" };
      }
      if (!pin) console.warn(`no map pin for ${ent.rel}: ${[...r.errors, ...r.warnings].join("; ")}`);
    }
    let logo: string | null = null;
    if (typeof d.logo === "string") {
      const src = join(root, "data/cities", ent.city, d.logo);
      if (existsSync(src)) {
        logo = `logos/${ent.city}/${d.logo.slice("logos/".length)}`;
        mkdirSync(join(logoOut, ent.city), { recursive: true });
        copyFileSync(src, join(outDir, "..", logo));
      }
    }
    entries.push({ type: ent.type, city: ent.city, ...d, logo, pin });
  }
  geocoder.save();

  const typeOrder = { startup: 0, investor: 1, ecosystem: 2 } as const;
  entries.sort((a, b) => typeOrder[a.type as keyof typeof typeOrder] - typeOrder[b.type as keyof typeof typeOrder] || a.name.localeCompare(b.name));

  const json = {
    title: "Map my city's startups",
    license: { data: "CC BY 4.0", code: "MIT" },
    generated_at: new Date().toISOString(),
    taxonomy: (repo.taxonomy?.data.categories ?? []).map((c: any) => ({
      key: c.key,
      label: c.label,
      colour: c.colour,
      tags: Object.entries(c.tags).map(([key, label]) => ({ key, label })),
    })),
    cities: [...cities.values()].map(({ maintainers: _m, ...c }) => c),
    universities: repo.universities?.data.universities ?? [],
    entries,
  };
  writeFileSync(join(outDir, "data.json"), JSON.stringify(json));
  writeFileSync(join(outDir, "data.csv"), toCsv(entries));
  return { count: entries.length, unplaced: entries.filter((e) => !e.pin).length };
}

function toCsv(entries: any[]): string {
  const rows = entries.map((e) => {
    const row: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      type: e.type, city: e.city, id: e.id, name: e.name, website: e.website, tagline: e.tagline,
      category: e.category, tags: e.tags?.join(";"), status: e.status, stage: e.stage, founded: e.founded,
      team_size: e.team_size, origin_type: e.origin?.type, origin_institution: e.origin?.institution,
      origin_department: e.origin?.department, investors: e.investors?.join(";"), investor_type: e.investor_type,
      focus: e.focus?.join(";"), ecosystem_type: e.ecosystem_type, acquired_by: e.acquired_by,
      postcode: e.location?.postcode, area: e.location?.area, lat: e.pin?.lat, lng: e.pin?.lng,
      pin_precision: e.pin?.precision, careers_url: e.careers_url, linkedin: e.links?.linkedin,
      github: e.links?.github, crunchbase: e.links?.crunchbase, source: e.source, last_verified: e.last_verified,
    };
    return CSV_COLUMNS.map((c) => csvCell(row[c])).join(",");
  });
  return [CSV_COLUMNS.join(","), ...rows].join("\r\n") + "\r\n";
}

function csvCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  // Stop spreadsheet apps from treating a text cell as a formula (numbers such as -0.05 are fine).
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { count, unplaced } = await exportData(root, join(root, "site/public/data"), process.argv.includes("--offline"));
  console.log(`Exported ${count} entries to site/public/data/ (${unplaced} without a map pin).`);
}
