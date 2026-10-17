// Geocodes every postcode in data/ and stores the results in scripts/geocode-cache.json,
// so builds and offline validation don't need to call the geocoder again.
// Export (scripts/export.ts) uses the same cache and fills it in as it goes; this script
// is for refreshing the cache on its own, e.g. after adding many entries.
//
//   npm run geocode
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRepo } from "./lib/data.ts";
import { Geocoder, type PostcodeFormat } from "./lib/geocode.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = loadRepo(root);
const geocoder = Geocoder.forRepo(root);
const formats = new Map<string, PostcodeFormat>(
  repo.cities.filter((c) => c.file).map((c) => [c.id, c.file!.data.postcode_format]),
);

let ok = 0;
const problems: string[] = [];
for (const ent of repo.entities) {
  const postcode = ent.data?.location?.postcode;
  const format = formats.get(ent.city);
  if (!postcode || !format) continue;
  const r = await geocoder.lookup(format, postcode);
  if (r.status === "ok") ok++;
  else problems.push(`${ent.rel}: ${postcode} → ${r.status === "not-found" ? "not found" : r.reason}`);
}
geocoder.save();
console.log(`Geocoded ${ok} postcodes.`);
if (problems.length) {
  console.log(problems.join("\n"));
  process.exitCode = 1;
}
