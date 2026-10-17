// Runs scripts/validate.ts against one valid and three deliberately broken fixtures.
// Each fixture folder mirrors data/cities/cambridge/ and is copied into a throwaway repo root
// alongside the real schema/, taxonomy, universities and Cambridge city.yaml. Runs offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validate, type Issue } from "../scripts/validate.ts";

const repoRoot = join(import.meta.dirname, "..");
const today = new Date("2026-10-17T12:00:00Z");

async function run(...fixtures: string[]) {
  const root = mkdtempSync(join(tmpdir(), "startup-map-test-"));
  try {
    for (const p of ["schema", "data/taxonomy.yaml", "data/universities.yaml", "data/cities/cambridge/city.yaml", "scripts/geocode-cache.json"]) {
      cpSync(join(repoRoot, p), join(root, p), { recursive: true });
    }
    const city = join(root, "data/cities/cambridge");
    for (const f of fixtures) cpSync(join(repoRoot, "tests/fixtures", f), city, { recursive: true });
    mkdirSync(join(city, "startups"), { recursive: true });
    return await validate({ root, offline: true, today });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const has = (issues: Issue[], fragment: string) =>
  assert.ok(
    issues.some((i) => i.message.includes(fragment)),
    `expected an issue containing "${fragment}", got:\n${issues.map((i) => `  ${i.file}: ${i.message}`).join("\n")}`,
  );

test("valid fixture passes with no errors or warnings", async () => {
  const r = await run("valid");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test("broken-taxonomy: tag from another category, bad stage, unknown field", async () => {
  const { errors } = await run("broken-taxonomy");
  has(errors, `tag "drug-discovery" is not a sub-tag of category "quantum"`);
  has(errors, "stage: must be equal to one of the allowed values");
  has(errors, `unknown field "funding_total"`);
});

test("broken-identity-location: id/file mismatch, duplicate website, bad postcode", async () => {
  const { errors } = await run("valid", "broken-identity-location");
  has(errors, `id "some-other-id" must equal the file name "renamed-file.yaml"`);
  has(errors, "website https://www.example-quantum.co.uk/ is already in the dataset");
  has(errors, `"XX1 2YY" is not a valid UK postcode`);
  assert.ok(errors.every((e) => !e.file.includes("example-quantum-co")), "the valid entry must stay clean");
});

test("lat/lng outside the bounding box is an error", async () => {
  const root = mkdtempSync(join(tmpdir(), "startup-map-test-"));
  // Covered separately because a malformed postcode stops location checks for the entry above.
  const { resolveLocation } = await import("../scripts/lib/location.ts");
  const { Geocoder } = await import("../scripts/lib/geocode.ts");
  const city = { id: "cambridge", name: "Cambridge", country: "GB", postcode_format: "uk" as const, center: [52.2, 0.12] as [number, number], zoom: 12, bbox: [52.05, -0.05, 52.35, 0.35] as [number, number, number, number], areas: [] };
  const r = await resolveLocation({ lat: 51.5074, lng: -0.1278 }, city, new Geocoder(join(root, "cache.json"), true));
  rmSync(root, { recursive: true, force: true });
  assert.equal(r.pin, null);
  has(r.errors.map((message) => ({ level: "error", file: "", message })), "outside the Cambridge bounding box");
});

test("broken-safety: HTML, links, missing acquired_by, unknown university, unsafe logo, stale date", async () => {
  const { errors, warnings } = await run("broken-safety");
  has(errors, "name must be plain text");
  has(errors, "tagline: must be plain text with no HTML or links");
  has(errors, "must have required property 'acquired_by'");
  has(errors, `origin.institution "mit" is not an id in data/universities.yaml`);
  has(errors, "founded 2099 is in the future");
  has(errors, `location.area "no-such-area" is not in cambridge/city.yaml`);
  has(errors, "SVG logo contains a <script> element");
  has(errors, "SVG logo contains an event handler attribute");
  has(errors, "SVG logo links to an external resource");
  has(errors, "logo must be square (it is 200 × 100)");
  has(warnings, "last_verified 2024-01-01 is more than 12 months old");
});
