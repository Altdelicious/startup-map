# Map my city's startups

An open, community-maintained map of deep-tech startups, plus the investors who back them and the labs and spaces they grow out of. It starts with Cambridge. London, Oxford and Paris use the same format.

- **One YAML file per company** in `data/`. There's no database and no login.
- **Anyone can contribute** with a pull request or the "Add a startup" issue form. CI validates every change, and a maintainer approves it.
- **Open data:** code is MIT ([LICENSE](LICENSE)) and data is CC BY 4.0 ([LICENSE-DATA](LICENSE-DATA)). Download it as `data.csv` or `data.json` from the site.

**[SPEC.md](SPEC.md) is the source of truth** for the data format, controlled vocabularies, validation rules and repo policies. If anything here or in the schemas disagrees with it, the spec wins.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). In short, add `data/cities/<city>/startups/<id>.yaml` and open a pull request.

## Repo layout

| Path | What's there |
| --- | --- |
| `data/` | Taxonomy, universities, and one folder per city (`city.yaml`, `startups/`, `investors/`, `ecosystem/`, `logos/`). Contributors only touch this folder. |
| `data/cities/_template/` | A starter folder for adding a new city. |
| `schema/` | JSON Schemas for every file type in `data/`. |
| `scripts/validate.ts` | Runs every CI check locally. |
| `scripts/geocode.ts` | Refreshes `scripts/geocode-cache.json` (postcode → lat/lng). |
| `scripts/export.ts` | Builds `data.json`, `data.csv` and logo copies for the site. |
| `site/` | The static site: Astro and MapLibre. |
| `tests/` | Validator tests: one valid fixture and three broken ones. |
| `.github/` | CI workflows, CODEOWNERS, PR template and issue form. |

## Running locally

You need Node 22 or newer.

```bash
npm install
npm run validate        # all data checks (geocodes postcodes via postcodes.io)
npm run validate -- --offline --check-urls   # flags: --offline (cache only), --check-urls (link check)
npm test                # validator tests
npm run dev             # export data, then serve the site at http://localhost:4321
npm run build           # export data and build the static site into site/dist
```

Set `PUBLIC_REPO_URL=https://github.com/<org>/<repo>` when building to turn on "Suggest a correction" and the issue-form links.

## How it works

1. `scripts/validate.ts` loads every YAML file. Dates such as `last_verified` stay as text because YAML is parsed with the core schema. It then checks each file against `schema/*.json` and applies the cross-file rules in SPEC.md: tags belong to the category, the id matches the file name and is unique, postcodes geocode inside the city's bounding box, logos are safe, and so on.
2. `scripts/export.ts` turns pins into coordinates (explicit lat/lng, then postcode, then area centre) and writes `site/public/data/`.
3. The site loads `data.json` and renders everything as text, never as HTML. Filters live in the URL, so any view can be shared.

## Deploying

`.github/workflows/deploy.yml` publishes to GitHub Pages on every push to `main`. Before going live:

1. Create the GitHub repo `altdelicious/startup-map` (public) and push `main`. If you pick a different name, update the schema `$id`s.
2. In the repo settings, go to **Pages → Source** and choose **GitHub Actions**.
3. Protect `main`:
   - require the **Validate data** check
   - require one approving review, plus **review from Code Owners**
   - block force pushes

   Code-owner review is what actually stops contributors from changing code. The path check in CI is a second line of defence, because a pull request can edit the workflow it runs under.
4. Under **Actions → General**, require approval before workflows run for first-time contributors.
