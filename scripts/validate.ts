// Runs every data check described in SPEC.md ("Validation and safety checks").
//
//   npm run validate                      # all checks, geocodes postcodes over the network
//   npm run validate -- --offline         # no network: geocode cache only, no URL checks
//   npm run validate -- --check-urls      # also check that websites and sources respond
//
// CI-only flags: --changed-files <file> (one path per line), --base-ref <git ref>, --actor <github login>,
// --stale-report <file.md> (writes a Markdown list of stale entries).
//
// Errors make the process exit 1. Warnings never fail the run.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import {
  ENTITY_FOLDERS,
  loadRepo,
  normaliseName,
  normaliseWebsite,
  taxonomyIndex,
} from "./lib/data.ts";
import { Geocoder, isValidPostcodeFormat } from "./lib/geocode.ts";
import { resolveLocation, type CityConfig } from "./lib/location.ts";
import { checkLogo } from "./lib/logo.ts";

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;

export interface Issue {
  level: "error" | "warning";
  file: string;
  message: string;
}

export interface ValidateOptions {
  root: string;
  offline?: boolean;
  checkUrls?: boolean;
  changedFiles?: string[];
  baseRef?: string;
  actor?: string;
  /** Override "today" in tests. */
  today?: Date;
}

export interface ValidateResult {
  errors: Issue[];
  warnings: Issue[];
  stale: { file: string; name: string; last_verified: string }[];
}

const STALE_MONTHS = 12;
const SOFT_FILE_LIMIT = 5;
/** String fields that hold URLs or paths and are exempt from the "no HTML" text check. */
const URL_KEYS = new Set(["website", "careers_url", "source", "logo", "linkedin", "github", "crunchbase"]);
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function validate(opts: ValidateOptions): Promise<ValidateResult> {
  const root = resolve(opts.root);
  const issues: Issue[] = [];
  const error = (file: string, message: string) => issues.push({ level: "error", file, message });
  const warn = (file: string, message: string) => issues.push({ level: "warning", file, message });
  const today = opts.today ?? new Date();
  const stale: ValidateResult["stale"] = [];

  const repo = loadRepo(root);
  for (const p of repo.parseErrors) error(p.rel, p.message);
  for (const f of repo.strayFiles) {
    error(f, `only .yaml files belong here; logos go in the city's logos/ folder`);
  }

  // ---- JSON Schema ------------------------------------------------------------------------
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, allowUnionTypes: true });
  addFormats(ajv);
  const schemaNames = ["startup", "investor", "ecosystem", "city", "taxonomy", "universities"] as const;
  const schemas = {} as Record<(typeof schemaNames)[number], ValidateFunction>;
  for (const name of schemaNames) {
    ajv.addSchema(JSON.parse(readFileSync(join(root, "schema", `${name}.schema.json`), "utf8")), `${name}.schema.json`);
  }
  for (const name of schemaNames) schemas[name] = ajv.getSchema(`${name}.schema.json`)!;
  const locationSchema = ajv.getSchema("startup.schema.json#/properties/location")!;

  const checkSchema = (fn: ValidateFunction, data: unknown, file: string) => {
    if (fn(data)) return true;
    for (const msg of formatAjvErrors(fn.errors ?? [])) error(file, msg);
    return false;
  };

  if (repo.taxonomy) checkSchema(schemas.taxonomy, repo.taxonomy.data, repo.taxonomy.rel);
  if (repo.universities) checkSchema(schemas.universities, repo.universities.data, repo.universities.rel);

  // ---- Taxonomy ---------------------------------------------------------------------------
  const taxonomy = taxonomyIndex(repo);
  const categoryKeys = (repo.taxonomy?.data?.categories ?? []).map((c: any) => c.key);
  for (const dup of duplicates(categoryKeys)) error("data/taxonomy.yaml", `category "${dup}" is listed more than once`);
  const schemaCategories: string[] = JSON.parse(readFileSync(join(root, "schema/startup.schema.json"), "utf8"))
    .properties.category.enum;
  if ([...schemaCategories].sort().join() !== [...new Set(categoryKeys)].sort().join()) {
    error(
      "schema/startup.schema.json",
      `properties.category.enum must list exactly the category keys in data/taxonomy.yaml (schema: ${schemaCategories.join(", ")}; taxonomy: ${categoryKeys.join(", ")})`,
    );
  }

  // ---- Universities -----------------------------------------------------------------------
  const universityIds: string[] = (repo.universities?.data?.universities ?? []).map((u: any) => u.id);
  for (const dup of duplicates(universityIds)) error("data/universities.yaml", `university "${dup}" is listed more than once`);
  const universitySet = new Set(universityIds);

  // ---- Cities -----------------------------------------------------------------------------
  const cities = new Map<string, CityConfig>();
  for (const city of repo.cities) {
    if (!city.file) continue;
    const c = city.file.data as CityConfig;
    if (!checkSchema(schemas.city, c, city.file.rel)) continue;
    const file = city.file.rel;
    if (c.id !== city.id) error(file, `id "${c.id}" must equal the folder name "${city.id}"`);
    const [s, w, n, e] = c.bbox;
    if (!(s < n && w < e)) error(file, "bbox must be [south, west, north, east] with south < north and west < east");
    if (!inBox(c.bbox, c.center)) error(file, "center is outside bbox");
    for (const dup of duplicates(c.areas.map((a) => a.id))) error(file, `area "${dup}" is listed more than once`);
    for (const a of c.areas) if (!inBox(c.bbox, a.center)) error(file, `area "${a.id}" centre is outside bbox`);
    cities.set(city.id, c);
  }

  // ---- Entities ---------------------------------------------------------------------------
  const geocoder = Geocoder.forRepo(root, opts.offline);
  const investorIdsByCity = new Map<string, Set<string>>();
  for (const e of repo.entities) {
    if (e.type !== "investor" || !e.data?.id) continue;
    if (!investorIdsByCity.has(e.city)) investorIdsByCity.set(e.city, new Set());
    investorIdsByCity.get(e.city)!.add(e.data.id);
  }

  const seen = {
    id: new Map<string, string>(),
    website: new Map<string, string>(),
    name: new Map<string, string>(),
  };
  const referencedLogos = new Set<string>();

  for (const ent of repo.entities) {
    const { rel: file, data } = ent;
    const city = cities.get(ent.city);
    checkSchema(schemas[ent.type], data, file);
    if (!data || typeof data !== "object") continue;

    // File name and uniqueness (per entity type, across all cities).
    if (typeof data.id === "string" && data.id !== ent.stem) {
      error(file, `id "${data.id}" must equal the file name "${ent.stem}.yaml"`);
    }
    if (!SLUG.test(ent.stem)) error(file, "file name must be a lowercase, hyphenated slug");
    claimUnique(seen.id, `${ent.type}:${data.id}`, file, (other) => `id "${data.id}" is already used by ${other}`);
    if (typeof data.website === "string") {
      claimUnique(seen.website, `${ent.type}:${normaliseWebsite(data.website)}`, file,
        (other) => `website ${data.website} is already in the dataset (${other})`);
    }
    if (typeof data.name === "string") {
      claimUnique(seen.name, `${ent.type}:${normaliseName(data.name)}`, file,
        (other) => `name "${data.name}" is already in the dataset (${other})`);
    }

    // Plain-text fields: no HTML anywhere, no links in the tagline.
    for (const [path, value] of textFields(data)) {
      if (/[<>]/.test(value)) error(file, `${path} must be plain text (no < or >)`);
    }
    if (typeof data.tagline === "string" && /(https?:\/\/|www\.)/i.test(data.tagline)) {
      error(file, "tagline must not contain links");
    }

    // last_verified: not in the future, warn when stale.
    if (typeof data.last_verified === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.last_verified)) {
      const verified = new Date(`${data.last_verified}T00:00:00Z`);
      if (verified.getTime() > today.getTime() + 86_400_000) error(file, "last_verified is in the future");
      const cutoff = new Date(today);
      cutoff.setUTCMonth(cutoff.getUTCMonth() - STALE_MONTHS);
      if (verified < cutoff) {
        warn(file, `last_verified ${data.last_verified} is more than ${STALE_MONTHS} months old; please re-check this entry`);
        stale.push({ file, name: data.name ?? ent.stem, last_verified: data.last_verified });
      }
    }

    // Startup-only cross-file rules.
    if (ent.type === "startup") {
      const cat = taxonomy.get(data.category);
      if (cat && Array.isArray(data.tags)) {
        for (const tag of data.tags) {
          if (typeof tag === "string" && !(tag in cat.tags)) {
            error(file, `tag "${tag}" is not a sub-tag of category "${data.category}" (allowed: ${Object.keys(cat.tags).join(", ")})`);
          }
        }
      }
      if (data.origin?.type === "university-spinout" && data.origin.institution && !universitySet.has(data.origin.institution)) {
        error(file, `origin.institution "${data.origin.institution}" is not an id in data/universities.yaml`);
      }
      if (typeof data.founded === "number" && data.founded > today.getUTCFullYear()) {
        error(file, `founded ${data.founded} is in the future`);
      }
      if (data.acquired_by && data.status !== "acquired") warn(file, "acquired_by is set but status is not acquired");
      for (const inv of Array.isArray(data.investors) ? data.investors : []) {
        if (typeof inv === "string" && SLUG.test(inv) && !investorIdsByCity.get(ent.city)?.has(inv)) {
          warn(file, `investor "${inv}" looks like an id but there is no ${ent.city}/investors/${inv}.yaml; it will show as plain text`);
        }
      }
    }

    // Location.
    // Checked even when other fields fail, as long as the location block itself is well-formed.
    if (city && data.location && locationSchema(data.location)) {
      const loc = data.location;
      if (loc.postcode && !isValidPostcodeFormat(city.postcode_format, loc.postcode)) {
        error(file, `location.postcode "${loc.postcode}" is not a valid ${city.postcode_format.toUpperCase()} postcode`);
      } else {
        const r = await resolveLocation(loc, city, geocoder);
        r.errors.forEach((m) => error(file, m));
        r.warnings.forEach((m) => warn(file, m));
      }
    } else if (!city) {
      error(file, `city "${ent.city}" has no valid city.yaml`);
    }

    // Logo.
    if (typeof data.logo === "string" && /^logos\/[a-z0-9-]+\.(svg|png)$/.test(data.logo)) {
      const logoRel = `data/cities/${ent.city}/${data.logo}`;
      referencedLogos.add(logoRel);
      for (const m of checkLogo(join(root, logoRel))) error(file, `${data.logo}: ${m}`);
    }
  }
  geocoder.save();

  for (const city of repo.cities) {
    const dir = join(city.dir, "logos");
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (name === ".gitkeep" || name === ".DS_Store") continue;
      const rel = `data/cities/${city.id}/logos/${name}`;
      if (!/\.(svg|png)$/.test(name)) error(rel, "logos must be .svg or .png");
      else if (!referencedLogos.has(rel)) warn(rel, "logo is not referenced by any entry");
    }
  }

  // ---- Pull-request scope -----------------------------------------------------------------
  if (opts.changedFiles) {
    const changed = opts.changedFiles.filter(Boolean);
    const maintainers = globalMaintainers(root, opts.baseRef);
    const isMaintainer = !!opts.actor && maintainers.has(opts.actor.toLowerCase());
    if (!isMaintainer) {
      for (const f of changed) {
        if (!f.startsWith("data/")) error(f, "contributors may only change files under data/ (a maintainer must make this change)");
      }
    }
    const entityPaths = new Set(
      changed
        .map((f) => f.match(new RegExp(`^data/cities/[^/]+/(${Object.values(ENTITY_FOLDERS).join("|")})/[^/]+\\.yaml$`)))
        .filter(Boolean)
        .map((m) => m![0]),
    );
    if (changed.length > SOFT_FILE_LIMIT || entityPaths.size > 1) {
      warn(
        changed[0] ?? "data",
        `this pull request changes ${changed.length} files (${entityPaths.size} entries); please keep to one entry per pull request (soft limit ${SOFT_FILE_LIMIT} files)`,
      );
    }
  }

  // ---- URLs -------------------------------------------------------------------------------
  if (opts.checkUrls && !opts.offline) {
    const changed = opts.changedFiles ? new Set(opts.changedFiles) : null;
    const targets = repo.entities.filter((e) => !changed || changed.has(e.rel));
    const jobs: (() => Promise<void>)[] = [];
    for (const ent of targets) {
      for (const [path, url] of urlFields(ent.data)) {
        jobs.push(async () => {
          const problem = await checkUrl(url);
          if (problem) warn(ent.rel, `${path} ${url} ${problem}`);
        });
      }
    }
    await runLimited(jobs, 8);
  }

  return {
    errors: issues.filter((i) => i.level === "error"),
    warnings: issues.filter((i) => i.level === "warning"),
    stale,
  };

  function claimUnique(map: Map<string, string>, key: string, file: string, msg: (other: string) => string) {
    const other = map.get(key);
    if (other && other !== file) error(file, msg(other));
    else map.set(key, file);
  }
}

// ---- helpers ------------------------------------------------------------------------------

function formatAjvErrors(errors: ErrorObject[]): string[] {
  const out = new Set<string>();
  for (const e of errors) {
    // "if" and "anyOf" only wrap the real failure, which is reported separately.
    if (e.keyword === "if" || e.keyword === "anyOf") continue;
    const where = e.instancePath ? e.instancePath.slice(1).replaceAll("/", ".") : "entry";
    let msg = `${where}: ${e.message}`;
    if (e.keyword === "enum") msg += ` (${(e.params as any).allowedValues.join(", ")})`;
    if (e.keyword === "additionalProperties") msg = `${where}: unknown field "${(e.params as any).additionalProperty}"`;
    if (e.keyword === "required" && e.instancePath === "/location") {
      msg = "location: needs a postcode, or an area from city.yaml";
    }
    if (e.keyword === "not" && e.instancePath === "/tagline") msg = "tagline: must be plain text with no HTML or links";
    out.add(msg);
  }
  return [...out];
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const v of values) (seen.has(v) ? dups : seen).add(v);
  return [...dups];
}

function inBox(bbox: number[], [lat, lng]: number[]) {
  return lat >= bbox[0] && lat <= bbox[2] && lng >= bbox[1] && lng <= bbox[3];
}

/** Every string value outside URL fields, with its dotted path. */
function textFields(obj: any, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  if (Array.isArray(obj)) obj.forEach((v, i) => out.push(...textFields(v, `${prefix}[${i}]`)));
  else if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      if (URL_KEYS.has(k)) continue;
      out.push(...textFields(v, prefix ? `${prefix}.${k}` : k));
    }
  } else if (typeof obj === "string") out.push([prefix, obj]);
  return out;
}

function urlFields(data: any): [string, string][] {
  const out: [string, string][] = [];
  for (const k of ["website", "careers_url", "source"]) if (typeof data?.[k] === "string") out.push([k, data[k]]);
  for (const [k, v] of Object.entries(data?.links ?? {})) if (typeof v === "string") out.push([`links.${k}`, v]);
  return out;
}

async function checkUrl(url: string): Promise<string | null> {
  // Many sites (LinkedIn, Cloudflare-fronted pages) reject bots; those codes are not evidence of a dead link.
  const inconclusive = new Set([401, 403, 405, 406, 429, 999]);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; startup-map-link-check)" },
    });
    res.body?.cancel();
    if (res.status < 400 || inconclusive.has(res.status)) return null;
    return `returned HTTP ${res.status}`;
  } catch (e) {
    return `could not be reached (${(e as Error).cause ? String((e as any).cause.code ?? (e as any).cause) : (e as Error).message})`;
  }
}

async function runLimited(jobs: (() => Promise<void>)[], limit: number) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (next < jobs.length) await jobs[next++]();
    }),
  );
}

/**
 * GitHub logins that own `*` in CODEOWNERS. Read from the base branch when given,
 * so a pull request cannot make its own author a maintainer.
 */
function globalMaintainers(root: string, baseRef?: string): Set<string> {
  let text = "";
  try {
    text = baseRef
      ? execFileSync("git", ["show", `${baseRef}:.github/CODEOWNERS`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      : readFileSync(join(root, ".github/CODEOWNERS"), "utf8");
  } catch {
    return new Set();
  }
  const owners = new Set<string>();
  for (const line of text.split("\n")) {
    const [pattern, ...who] = line.trim().split(/\s+/);
    if (pattern !== "*") continue;
    for (const w of who) if (w.startsWith("@") && !w.includes("/")) owners.add(w.slice(1).toLowerCase());
  }
  return owners;
}

// ---- CLI ----------------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
    } else args[key] = true;
  }
  return args;
}

function report(result: ValidateResult) {
  const gh = process.env.GITHUB_ACTIONS === "true";
  const esc = (s: string) => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  const all = [...result.errors, ...result.warnings].sort((a, b) => a.file.localeCompare(b.file));
  let currentFile = "";
  for (const i of all) {
    if (gh) console.log(`::${i.level} file=${esc(i.file)}::${esc(i.message)}`);
    if (i.file !== currentFile) {
      console.log(`\n${i.file}`);
      currentFile = i.file;
    }
    console.log(`  ${i.level === "error" ? "✖ error  " : "⚠ warning"} ${i.message}`);
  }
  const summary = `${result.errors.length} error(s), ${result.warnings.length} warning(s)`;
  console.log(`\n${result.errors.length ? "✖" : "✔"} ${summary}`);

  if (gh && process.env.GITHUB_STEP_SUMMARY) {
    const rows = all.map((i) => `| ${i.level === "error" ? "❌ error" : "⚠️ warning"} | \`${i.file}\` | ${i.message.replace(/\|/g, "\\|")} |`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Data validation\n\n${summary}\n\n` + (rows.length ? `| Level | File | Problem |\n| --- | --- | --- |\n${rows.join("\n")}\n` : "All checks passed.\n"),
    );
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const root = typeof args.root === "string" ? args.root : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const changedFiles =
    typeof args["changed-files"] === "string" ? readFileSync(args["changed-files"], "utf8").split("\n").map((s) => s.trim()) : undefined;
  const result = await validate({
    root,
    offline: !!args.offline,
    checkUrls: !!args["check-urls"],
    changedFiles,
    baseRef: typeof args["base-ref"] === "string" ? args["base-ref"] : undefined,
    actor: typeof args.actor === "string" ? args.actor : process.env.GITHUB_ACTOR,
  });
  report(result);
  if (typeof args["stale-report"] === "string") {
    const lines = result.stale.map((s) => `- [ ] **${s.name}** — \`${s.file}\` (last verified ${s.last_verified})`);
    writeFileSync(args["stale-report"], lines.join("\n") + (lines.length ? "\n" : ""));
  }
  process.exit(result.errors.length ? 1 : 0);
}
