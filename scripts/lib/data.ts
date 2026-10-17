// Loads every YAML file under data/ into plain objects.
// YAML is parsed with the "core" schema so dates such as `last_verified: 2026-10-16`
// stay strings (the YAML 1.1 schema would turn them into Date objects and fail the JSON Schema).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseDocument } from "yaml";

export type EntityType = "startup" | "investor" | "ecosystem";

export const ENTITY_FOLDERS: Record<EntityType, string> = {
  startup: "startups",
  investor: "investors",
  ecosystem: "ecosystem",
};

export interface LoadedFile<T = any> {
  /** Path relative to the repo root, with forward slashes. */
  rel: string;
  abs: string;
  data: T;
}

export interface Entity<T = any> extends LoadedFile<T> {
  type: EntityType;
  city: string;
  /** File name without .yaml */
  stem: string;
}

export interface City {
  id: string;
  dir: string;
  file: LoadedFile | null;
}

export interface Repo {
  root: string;
  taxonomy: LoadedFile | null;
  universities: LoadedFile | null;
  cities: City[];
  entities: Entity[];
  /** Files that could not be read or parsed. */
  parseErrors: { rel: string; message: string }[];
  /** Files in entity folders that are not .yaml (other than .gitkeep). */
  strayFiles: string[];
}

export function toRel(root: string, abs: string): string {
  return relative(root, abs).split("\\").join("/");
}

export function readYaml(root: string, abs: string, errors: Repo["parseErrors"]): LoadedFile | null {
  const rel = toRel(root, abs);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch (e) {
    errors.push({ rel, message: `cannot read file: ${(e as Error).message}` });
    return null;
  }
  const doc = parseDocument(text, { schema: "core", uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length) {
    errors.push({ rel, message: `invalid YAML: ${doc.errors[0].message.split("\n")[0]}` });
    return null;
  }
  return { rel, abs, data: doc.toJS() };
}

function listDir(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

export function loadRepo(root: string): Repo {
  const parseErrors: Repo["parseErrors"] = [];
  const strayFiles: string[] = [];
  const dataDir = join(root, "data");
  const repo: Repo = {
    root,
    taxonomy: readYaml(root, join(dataDir, "taxonomy.yaml"), parseErrors),
    universities: readYaml(root, join(dataDir, "universities.yaml"), parseErrors),
    cities: [],
    entities: [],
    parseErrors,
    strayFiles,
  };

  const citiesDir = join(dataDir, "cities");
  for (const cityId of listDir(citiesDir)) {
    const dir = join(citiesDir, cityId);
    // `_template` and dot-folders are not cities.
    if (cityId.startsWith("_") || cityId.startsWith(".") || !statSync(dir).isDirectory()) continue;
    const cityFile = join(dir, "city.yaml");
    const file = existsSync(cityFile) ? readYaml(root, cityFile, parseErrors) : null;
    if (!file) parseErrors.push({ rel: toRel(root, cityFile), message: "missing or unreadable city.yaml" });
    repo.cities.push({ id: cityId, dir, file });

    for (const [type, folder] of Object.entries(ENTITY_FOLDERS) as [EntityType, string][]) {
      const entDir = join(dir, folder);
      for (const name of listDir(entDir)) {
        const abs = join(entDir, name);
        if (name === ".gitkeep" || name === ".DS_Store") continue;
        if (!name.endsWith(".yaml")) {
          strayFiles.push(toRel(root, abs));
          continue;
        }
        const loaded = readYaml(root, abs, parseErrors);
        if (loaded) repo.entities.push({ ...loaded, type, city: cityId, stem: name.slice(0, -".yaml".length) });
      }
    }
  }
  return repo;
}

/** Map of category key → { label, colour, tags: { tagKey: label } } */
export function taxonomyIndex(repo: Repo) {
  const out = new Map<string, { label: string; colour: string; tags: Record<string, string> }>();
  for (const c of repo.taxonomy?.data?.categories ?? []) out.set(c.key, c);
  return out;
}

/** Normalises a website for duplicate detection: lowercase host, no www., no trailing slash/query. */
export function normaliseWebsite(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return host + path;
  } catch {
    return url.trim().toLowerCase();
  }
}

export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(ltd|limited|plc|inc|llc|sas|gmbh)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "");
}
