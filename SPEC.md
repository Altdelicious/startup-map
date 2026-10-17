# Map my city's startups — Data Spec

Oct 16, 2026 · @bhavesh · updated Oct 17, 2026 with the decisions taken while building the repo

This file is the source of truth. When a schema, `taxonomy.yaml` or a doc disagrees with it, change this file first and then bring the others into line.

## Overview

The map is a static website built from plain data files in a public GitHub repo: one YAML file per startup, one folder per city, no database, no logins. Anyone adds or corrects an entry by opening a pull request; automated checks validate it, a maintainer approves it, and the site rebuilds on merge.

Design principles:

- **One file per entity.** Pull requests stay small, easy to review, and rarely conflict.
- **Strict schema, checked by machines.** Contributors get errors before a human looks at anything.
- **Deep-tech first.** Categories are specific (quantum, AI chips, synthetic biology), not generic ("Deeptech", "SaaS").
- **Multi-city from day one.** Cambridge first; London, Oxford and Paris use the same schema.
- **Open data.** Code under MIT, data under CC BY 4.0, downloadable as CSV and JSON.

## Repo layout

Data, schema and site code live in separate top-level folders, so contributors only ever touch `data/`.

```
startup-map/
├── data/
│   ├── taxonomy.yaml            # categories + sub-tags (shared by all cities)
│   ├── universities.yaml        # institutions that spin out companies
│   └── cities/
│       ├── _template/           # copied to start a new city; ignored by checks
│       └── cambridge/
│           ├── city.yaml        # name, map centre, bounding box, areas
│           ├── startups/
│           │   └── <id>.yaml
│           ├── investors/
│           ├── ecosystem/       # labs, incubators, lab space
│           └── logos/           # <id>.svg|png
├── schema/
│   ├── startup.schema.json
│   ├── investor.schema.json
│   ├── ecosystem.schema.json
│   ├── city.schema.json
│   ├── taxonomy.schema.json
│   └── universities.schema.json
├── scripts/
│   ├── validate.ts              # runs all CI checks locally
│   ├── geocode.ts               # postcode → lat/lng, cached in geocode-cache.json
│   ├── geocode-cache.json
│   └── export.ts                # builds data.csv / data.json
├── tests/                       # validator tests: 1 valid + 3 broken fixtures
├── site/                        # Astro + MapLibre
├── .github/
│   ├── workflows/validate.yml   # every PR
│   ├── workflows/stale.yml      # monthly last_verified check → cleanup issue
│   ├── workflows/deploy.yml     # GitHub Pages on push to main
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/add-startup.yml
│   └── CODEOWNERS
├── README.md
├── CONTRIBUTING.md
└── LICENSE / LICENSE-DATA
```

File names are the entry's `id`: lowercase, hyphenated, matching the `id` field inside the file.

## Startup entry schema

Ten fields are required; everything else is optional so a first contribution takes two minutes.

| Field | Required | Type | Rule |
| --- | --- | --- | --- |
| `id` | Yes | string | Lowercase slug, equals the file name, unique across all cities |
| `name` | Yes | string | 1–80 characters |
| `website` | Yes | URL | `https://` only; unique across the dataset |
| `tagline` | Yes | string | 10–140 characters, plain text, no marketing superlatives |
| `category` | Yes | enum | One top-level key from `taxonomy.yaml` |
| `tags` | Yes | list | 1–5 sub-tags, each valid under the chosen category |
| `location.postcode` | Yes, or area | string | Optional for stealth or remote teams if \`location.area\` is set; otherwise a valid postcode for the city's country, geocoded at build |
| `status` | Yes | enum | `active`, `acquired`, `closed` |
| `location.area` | No | enum | From the city's `areas` list (e.g. Science Park, Biomedical Campus); required if no postcode, and the pin then sits at that area's `center` in `city.yaml` |
| `location.lat` / `lng` | No | number | Overrides geocoding; must fall inside the city's bounding box |
| `stage` | No | enum | See controlled vocabularies |
| `founded` | No | integer | 1950 – current year |
| `team_size` | No | enum | `1-10`, `11-50`, `51-200`, `201-500`, `500+` |
| `origin.type` | No | enum | `university-spinout`, `corporate-spinout`, `independent` |
| `origin.institution` | No | enum / string | Required if spin-out. For `university-spinout`: a key from `universities.yaml`. For `corporate-spinout`: the company name as free text |
| `origin.department` | No | string | Lab or department, free text |
| `investors` | No | list | Investor `id`s from the same city's `investors/` folder (shown as links), or free text (shown as plain text). An id-shaped value with no matching file is a warning, not an error |
| `careers_url` | No | URL | Link out; no scraped job counts |
| `links` | No | object | `linkedin`, `github`, `crunchbase` |
| `logo` | No | path | File in `logos/`, SVG or PNG, ≤ 100 KB, square |
| `acquired_by` | No | string | Required if `status: acquired` |
| `source` | Yes | URL | Public page confirming the startup exists and is based here |
| `last_verified` | Yes | date (as text) | `YYYY-MM-DD`; YAML is parsed with the core schema so it stays a string; must not be in the future; CI warns when older than 12 months |

Example entry (fictional, so it lives in `tests/fixtures/valid/startups/example-quantum-co.yaml` rather than in `data/`):

```yaml
id: example-quantum-co
name: Example Quantum Co
website: https://example-quantum.co.uk
tagline: Error-corrected photonic qubits for room-temperature quantum computing.
category: quantum
tags: [quantum-hardware, photonics]
status: active
stage: series-a
founded: 2021
team_size: 11-50
location:
  postcode: CB4 0WS
  area: cambridge-science-park
origin:
  type: university-spinout
  institution: university-of-cambridge
  department: Cavendish Laboratory
investors: [example-ventures]
careers_url: https://example-quantum.co.uk/careers
links:
  linkedin: https://www.linkedin.com/company/example-quantum-co
logo: logos/example-quantum-co.svg
source: https://example-quantum.co.uk/about
last_verified: 2026-10-16
```

## Other entity types

Three more entry types share the same file-per-entity pattern and appear as switchable map layers.

| Type | Folder | Extra required fields | Purpose |
| --- | --- | --- | --- |
| Investor | `investors/` | `investor_type` (`vc`, `angel-network`, `corporate-vc`, `university-fund`, `public-fund`), `focus` (category keys) | Lets startups link to backers; filter "who funds quantum here" |
| Ecosystem | `ecosystem/` | `ecosystem_type` (`university-lab`, `incubator`, `accelerator`, `lab-space`, `coworking`, `tech-transfer-office`) | Shows where deep-tech companies come from and where they can work |
| City | `city.yaml` | `name`, `country`, `center`, `zoom`, `bbox`, `areas` | Config for each city; see "Adding a city" |

Investor and ecosystem entries reuse `id`, `name`, `website`, `tagline`, `location`, `source` and `last_verified` from the startup schema.

## Category taxonomy

Twelve top-level categories, five of them AI, each with fixed sub-tags. A startup picks one category and up to five tags; new tags are added by pull request to `taxonomy.yaml`, reviewed by a maintainer.

| Category key | Label | Sub-tags |
| --- | --- | --- |
| `ai-foundation` | Foundation models & AI research | `llms`, `multimodal`, `reasoning`, `open-weights`, `alignment-safety`, `interpretability` |
| `ai-infra` | AI infrastructure & tooling | `training-infra`, `inference`, `mlops`, `evals`, `data-labelling`, `vector-db`, `agents-frameworks` |
| `ai-hardware` | AI chips & compute | `accelerators`, `neuromorphic`, `photonic-compute`, `edge-ai`, `chip-design-eda` |
| `ai-applied` | Applied AI (vertical) | `ai-legal`, `ai-finance`, `ai-industrial`, `ai-security`, `ai-code`, `ai-agents` |
| `ai-science` | AI for science & bio | `drug-discovery`, `protein-design`, `materials-discovery`, `ai-chemistry`, `scientific-ml` |
| `robotics` | Robotics & autonomy | `humanoids`, `industrial-robotics`, `autonomous-vehicles`, `drones`, `surgical-robotics` |
| `quantum` | Quantum | `quantum-hardware`, `quantum-software`, `quantum-sensing`, `quantum-networking`, `photonics` |
| `semiconductors` | Semiconductors & photonics | `chip-ip`, `compound-semis`, `silicon-photonics`, `sensors`, `manufacturing` |
| `biotech` | Biotech & synthetic biology | `synbio`, `genomics`, `cell-gene-therapy`, `diagnostics`, `biomanufacturing`, `lab-automation` |
| `climate` | Climate & energy tech | `batteries`, `fusion`, `hydrogen`, `carbon-capture`, `grid-software`, `alt-proteins` |
| `materials` | Advanced materials | `graphene-2d`, `metamaterials`, `polymers`, `nanotech` |
| `space` | Space & aerospace | `satellites`, `earth-observation`, `propulsion`, `space-software` |

The full machine-readable version lives in `data/taxonomy.yaml` (key, label, `colour` hex used for pins and chips, tags with labels). The `category` enum in `startup.schema.json` must list exactly the same keys; CI fails if they drift.

## Controlled vocabularies

Every closed-set field has a fixed list so filters stay clean and nobody invents "Series A+" or "pre-seed/seed".

| Field | Allowed values |
| --- | --- |
| `stage` | `pre-seed`, `seed`, `series-a`, `series-b`, `series-c-plus`, `grant-funded`, `bootstrapped`, `public` |
| `status` | `active`, `acquired`, `closed` |
| `team_size` | `1-10`, `11-50`, `51-200`, `201-500`, `500+` |
| `origin.type` | `university-spinout`, `corporate-spinout`, `independent` |

`grant-funded` matters for deep tech: many early companies run on Innovate UK, ARIA, ERC or Bpifrance grants before any equity round. `stage` is "latest publicly known" and must be backed by the `source` link or left blank.

Starting `universities.yaml` entries for the first four cities:

| City | Institutions |
| --- | --- |
| Cambridge | `university-of-cambridge`, `anglia-ruskin-university` |
| Oxford | `university-of-oxford`, `oxford-brookes-university` |
| London | `imperial-college-london`, `ucl`, `kings-college-london`, `queen-mary-university-of-london`, `lse`, `city-st-georges` |
| Paris | `psl-university`, `sorbonne-universite`, `institut-polytechnique-de-paris`, `universite-paris-saclay`, `inria`, `cnrs` |

Corporate spin-outs (e.g. from Arm, DeepMind, Microsoft Research) use `origin.type: corporate-spinout` with the company name in `origin.institution` as free text.

## Validation and safety checks

A GitHub Action runs `scripts/validate.ts` on every pull request; errors block merging, warnings appear as annotations on the PR's "Files changed" tab and in the run summary. (A read-only `pull_request` token cannot post comments on PRs from forks, so there is no bot comment.)

&#91;embedded content: contribution flow · PR or issue form to live site\]

Nothing reaches the live map without passing CI and a maintainer's approval; people without GitHub skills use the issue form instead.

| Check | Level | What it catches |
| --- | --- | --- |
| Schema validation (JSON Schema, Ajv) | Error | Missing or mistyped fields, invalid enums, bad tags for the category |
| File name equals `id`, `id` unique | Error | Duplicates and renamed files |
| Website and name not already in dataset | Error | Same startup submitted twice, also across cities |
| Location inside city `bbox` | Error | Pins in the wrong city or the sea |
| Postcode valid and geocodes, or area exists in `city.yaml` | Error | Typos in addresses. UK via postcodes.io, France via the IGN Géoplateforme; results cached in `scripts/geocode-cache.json`. If the geocoder is unreachable it is a warning, not an error |
| Logo: SVG or PNG, ≤ 100 KB, square; SVG sanitised (no `<script>`, no external refs) | Error | Oversized or malicious images |
| Paths: PR only touches `data/**` (unless author is a maintainer) | Error | Contributors changing site code or workflows. "Maintainer" = an owner of `*` in `.github/CODEOWNERS` on the base branch. Because a PR can edit its own workflow, the real guard is branch protection with required Code Owner review |
| One entity per PR (soft limit 5 files) | Warning | Bulk dumps that are hard to review |
| URLs resolve (HTTP 2xx/3xx) | Warning | Dead websites, wrong links |
| `last_verified` older than 12 months | Warning | Stale entries; also run monthly on `main` to open a cleanup issue |
| Text fields: no HTML, no URLs in `tagline` | Error | Injection and spam |

Repo-level safety settings:

- Branch protection on `main`: required status checks, one maintainer approval, no force pushes.
- `CODEOWNERS` assigns `data/cities/<city>/` to that city's maintainers and everything else to you; "Require review from Code Owners" is on.
- Workflows from first-time contributors need a maintainer's approval before they run.
- The validation workflow uses the `pull_request` trigger (not `pull_request_target`) with read-only permissions, so code from forks never runs with secrets.
- The site renders all data as text (never `innerHTML`), so a bad entry cannot inject script even if it slips through.
- Non-Git users file the `add-startup` issue form; a maintainer or a bot turns it into a PR.

## Adding a city

A new city is one pull request containing a `city.yaml` and at least 10 verified startups; the site picks it up automatically.

```yaml
# data/cities/cambridge/city.yaml
id: cambridge
name: Cambridge
country: GB
postcode_format: uk
center: [52.2053, 0.1218]   # lat, lng
zoom: 12
bbox: [52.05, -0.05, 52.35, 0.35]   # south, west, north, east
maintainers: [altdelicious]
areas:                              # center = where area-only pins go, [lat, lng]
  - { id: city-centre, label: City Centre, center: [52.2053, 0.1218] }
  - { id: cambridge-science-park, label: Cambridge Science Park, center: [52.2331, 0.1465] }
  - { id: biomedical-campus, label: Cambridge Biomedical Campus, center: [52.1750, 0.1407] }
  - { id: west-cambridge, label: West Cambridge, center: [52.2091, 0.0929] }
  - { id: st-johns-innovation-park, label: St John's Innovation Park, center: [52.2349, 0.1534] }
  - { id: granta-park, label: Granta Park, center: [52.1167, 0.2250] }
  - { id: babraham, label: Babraham Research Campus, center: [52.1327, 0.2055] }
  - { id: wider-cambridgeshire, label: Wider Cambridgeshire, center: [52.2400, 0.0600] }
```

`postcode_format` is `uk` or `fr`. Every area `center` must fall inside `bbox`.

Steps for a new city:

1. Copy `data/cities/_template/` to `data/cities/<city-id>/`.
2. Fill in `city.yaml`: centre, bounding box (from openstreetmap.org export), areas with a centre point each.
3. Add the city's universities to `universities.yaml` if missing.
4. Add at least 10 startups, each with a `source` link.
5. Add yourself under `maintainers` and to `CODEOWNERS` for that folder.
6. Open the pull request; CI checks the config and every entry.

## Decisions (formerly open questions)

- **Seed data:** research the first 50–100 Cambridge startups before launch, each with a public `source`.
- **Multi-city companies:** listed once, in the city of their HQ. `website` and `name` are unique across the whole dataset.
- **Non-deep-tech startups:** not included for now; declined in review.
- **Name and domain:** the project is called "Map my city's startups". The domain will be `startupmaps` (TLD to be chosen). Hosted on GitHub Pages until then.

## Hand-off to Claude Code, in order

1. Scaffold the repo with the layout above; add `schema/*.json` and `data/taxonomy.yaml` from this spec.
2. Write `scripts/validate.ts` and the `validate.yml` workflow; test it against one valid and three deliberately broken entries.
3. Build the site: MapLibre map with clustering, grid view, filters (city, category, tags, stage, origin, layer), search, shareable filter URLs.
4. Add the CSV/JSON export, README, CONTRIBUTING, PR template and issue form.
5. Deploy to GitHub Pages; turn on branch protection and CODEOWNERS (needs the real org/repo and maintainer handles).
