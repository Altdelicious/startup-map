# Contributing

Thanks for helping map your city's deep-tech companies. The rules (fields, allowed values, what gets rejected) are in **[SPEC.md](SPEC.md)**. This page covers how to submit.

## Without Git

Open an issue with the **Add a startup** form. A maintainer checks it and turns it into a pull request.

## With a pull request

1. **Check it's in scope.** It must be a deep-tech company that fits a category in [`data/taxonomy.yaml`](data/taxonomy.yaml). List it once, in the city where its headquarters is. Search `data/` first to make sure it isn't already listed.
2. **Create one file:** `data/cities/<city>/startups/<id>.yaml`. The `id` is a lowercase, hyphenated slug and must match the file name. Start from this:

   ```yaml
   id: example-quantum-co
   name: Example Quantum Co
   website: https://example-quantum.co.uk
   tagline: Error-corrected photonic qubits for room-temperature quantum computing.
   category: quantum
   tags: [quantum-hardware, photonics]
   status: active
   location:
     postcode: CB4 0WS            # or `area:` from the city's city.yaml for stealth/remote teams
   source: https://example-quantum.co.uk/about
   last_verified: 2026-10-16      # today's date
   ```

   Optional fields (`stage`, `founded`, `team_size`, `origin`, `investors`, `careers_url`, `links`, `logo`, `acquired_by`) are described in SPEC.md, and there's a complete example in [`tests/fixtures/valid/`](tests/fixtures/valid/startups/example-quantum-co.yaml).
3. **Logo (optional):** add `data/cities/<city>/logos/<id>.svg` or `.png`. It must be square and at most 100 KB. SVGs can't contain scripts or link to external files.
4. **Validate (optional):** `npm install && npm run validate`. CI runs the same checks on your pull request. Errors block merging; warnings are shown as annotations on the "Files changed" tab.
5. **Open the pull request** with one entry per PR, and fill in the checklist.

## Corrections

On the map, open the entry and click **Suggest a correction**. That opens the file in GitHub's editor. Update `source` if needed, and set `last_verified` to today.

## Adding a city

Follow "Adding a city" in SPEC.md. Copy `data/cities/_template/`, fill in `city.yaml` (including a centre point for each area), add at least 10 sourced startups, and add yourself to `.github/CODEOWNERS` for that folder.

## What gets declined

- Companies that aren't deep tech, such as generic SaaS, agencies or consultancies
- Duplicates, including the same company in a second city
- Entries without a public source, or with marketing language in the tagline
- Changes outside `data/` from anyone who isn't a maintainer
