// The map/grid app. Everything from data.json is rendered with textContent or
// setAttribute on vetted URLs — never innerHTML — so a bad entry cannot inject markup.
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre finds its worker next to its own module, which breaks once bundled; point it at Vite's copy.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);

// ---- Types (mirror scripts/export.ts) --------------------------------------------------------

type EntryType = "startup" | "investor" | "ecosystem";
interface Pin { lat: number; lng: number; precision: "coordinates" | "postcode" | "area" }
interface Entry {
  type: EntryType;
  city: string;
  id: string;
  name: string;
  website: string;
  tagline: string;
  category?: string;
  tags?: string[];
  status?: string;
  stage?: string;
  founded?: number;
  team_size?: string;
  location: { postcode?: string; area?: string };
  origin?: { type: string; institution?: string; department?: string };
  investors?: string[];
  investor_type?: string;
  focus?: string[];
  ecosystem_type?: string;
  acquired_by?: string;
  careers_url?: string;
  links?: Record<string, string>;
  logo: string | null;
  source: string;
  last_verified: string;
  pin: Pin | null;
}
interface Category { key: string; label: string; colour: string; tags: { key: string; label: string }[] }
interface City { id: string; name: string; center: [number, number]; zoom: number; bbox: number[]; areas: { id: string; label: string }[] }
interface Data { taxonomy: Category[]; cities: City[]; universities: { id: string; name: string }[]; entries: Entry[] }

// ---- Vocabulary labels --------------------------------------------------------------------------

const LAYERS: Record<EntryType, string> = { startup: "Startups", investor: "Investors", ecosystem: "Labs & spaces" };
const STAGES: Record<string, string> = {
  "pre-seed": "Pre-seed", seed: "Seed", "series-a": "Series A", "series-b": "Series B",
  "series-c-plus": "Series C+", "grant-funded": "Grant-funded", bootstrapped: "Bootstrapped", public: "Public",
};
const ORIGINS: Record<string, string> = {
  "university-spinout": "University spin-out", "corporate-spinout": "Corporate spin-out", independent: "Independent",
};
const STATUS: Record<string, string> = { active: "Active", acquired: "Acquired", closed: "Closed" };
const INVESTOR_TYPES: Record<string, string> = {
  vc: "Venture capital", "angel-network": "Angel network", "corporate-vc": "Corporate VC",
  "university-fund": "University fund", "public-fund": "Public fund",
};
const ECOSYSTEM_TYPES: Record<string, string> = {
  "university-lab": "University lab", incubator: "Incubator", accelerator: "Accelerator",
  "lab-space": "Lab space", coworking: "Coworking", "tech-transfer-office": "Tech transfer office",
};
const LINK_LABELS: Record<string, string> = { linkedin: "LinkedIn", github: "GitHub", crunchbase: "Crunchbase" };
const TYPE_COLOUR: Record<Exclude<EntryType, "startup">, string> = { investor: "#111827", ecosystem: "#6b7280" };
const FOLDERS: Record<EntryType, string> = { startup: "startups", investor: "investors", ecosystem: "ecosystem" };

// ---- State, kept in the URL so filtered views can be shared --------------------------------------

interface State {
  city: string;
  layer: Set<EntryType>;
  cat: Set<string>;
  tag: Set<string>;
  stage: Set<string>;
  origin: Set<string>;
  q: string;
  view: "map" | "grid";
  id: string | null; // "<type>:<id>" of the open detail panel
}
type Facet = "layer" | "cat" | "tag" | "stage" | "origin";
const FACETS: Facet[] = ["layer", "cat", "tag", "stage", "origin"];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export async function start() {
  const root = document.querySelector<HTMLElement>(".app")!;
  const base = root.dataset.base ?? "/";
  const repoUrl = root.dataset.repo ?? "";
  const data: Data = await fetch(`${base}data/data.json`).then((r) => r.json());

  const cats = new Map(data.taxonomy.map((c) => [c.key, c]));
  const tagLabels = new Map(data.taxonomy.flatMap((c) => c.tags.map((t) => [t.key, t.label] as const)));
  const universities = new Map(data.universities.map((u) => [u.id, u.name]));
  const byKey = new Map(data.entries.map((e) => [`${e.type}:${e.id}`, e]));
  const searchText = new Map(data.entries.map((e) => [e, haystack(e)]));

  const state = readUrl();

  // ---- Filtering ---------------------------------------------------------------------------

  function matches(e: Entry, s: State, skip?: Facet): boolean {
    if (e.city !== s.city && s.city !== "all") return false;
    if (skip !== "layer" && !s.layer.has(e.type)) return false;
    if (skip !== "cat" && s.cat.size) {
      const keys = e.type === "startup" ? [e.category] : e.type === "investor" ? (e.focus ?? []) : [];
      if (!keys.some((k) => k && s.cat.has(k))) return false;
    }
    // Tags, stage and origin only describe startups, so they hide other layers while active.
    if (skip !== "tag" && s.tag.size && !(e.tags ?? []).some((t) => s.tag.has(t))) return false;
    if (skip !== "stage" && s.stage.size && !(e.stage && s.stage.has(e.stage))) return false;
    if (skip !== "origin" && s.origin.size && !(e.origin && s.origin.has(e.origin.type))) return false;
    if (s.q) {
      const text = searchText.get(e)!;
      if (!s.q.toLowerCase().split(/\s+/).every((w) => text.includes(w))) return false;
    }
    return true;
  }

  function haystack(e: Entry) {
    return [
      e.name, e.tagline, e.category && cats.get(e.category)?.label, ...(e.tags ?? []).map((t) => tagLabels.get(t) ?? t),
      e.origin?.institution && (universities.get(e.origin.institution) ?? e.origin.institution), e.origin?.department,
      ...(e.investors ?? []).map((i) => byKey.get(`investor:${i}`)?.name ?? i), e.location.postcode, e.acquired_by,
    ].filter(Boolean).join(" ").toLowerCase();
  }

  // ---- Filter controls -----------------------------------------------------------------------

  const citySelect = $<HTMLSelectElement>("city");
  if (data.cities.length > 1) citySelect.append(new Option("All cities", "all"));
  for (const c of data.cities) citySelect.append(new Option(c.name, c.id));
  citySelect.value = state.city;
  citySelect.addEventListener("change", () => {
    state.city = citySelect.value;
    flyToCity();
    update();
  });

  const qInput = $<HTMLInputElement>("q");
  qInput.value = state.q;
  let qTimer: number | undefined;
  qInput.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = window.setTimeout(() => { state.q = qInput.value.trim(); update(); }, 150);
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    btn.addEventListener("click", () => { state.view = btn.dataset.view as State["view"]; update(); });
  }
  $("clear").addEventListener("click", () => {
    for (const f of FACETS) if (f !== "layer") state[f].clear();
    state.layer = new Set(Object.keys(LAYERS) as EntryType[]);
    state.q = "";
    qInput.value = "";
    update();
  });
  const filters = $("filters");
  const scrim = $("scrim");
  const setFiltersOpen = (open: boolean) => { filters.classList.toggle("open", open); scrim.hidden = !open; };
  $("filters-open").addEventListener("click", () => setFiltersOpen(true));
  $("filters-close").addEventListener("click", () => setFiltersOpen(false));
  scrim.addEventListener("click", () => { setFiltersOpen(false); closeDetail(); });

  function renderFacet(
    facet: Facet,
    container: HTMLElement,
    options: { value: string; label: string; colour?: string }[],
    style: "checks" | "chips",
  ) {
    const counts = new Map<string, number>();
    for (const e of data.entries) {
      if (!matches(e, state, facet)) continue;
      const values =
        facet === "layer" ? [e.type]
        : facet === "cat" ? (e.type === "startup" ? [e.category!] : e.type === "investor" ? (e.focus ?? []) : [])
        : facet === "tag" ? (e.tags ?? [])
        : facet === "stage" ? (e.stage ? [e.stage] : [])
        : e.origin ? [e.origin.type] : [];
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const selected = state[facet] as Set<string>;
    container.replaceChildren(
      ...options.map((o) => {
        const n = counts.get(o.value) ?? 0;
        const label = el("label", { class: style === "chips" ? "chip" : "check" });
        const input = el("input", { type: "checkbox", value: o.value }) as HTMLInputElement;
        input.checked = selected.has(o.value);
        input.addEventListener("change", () => {
          input.checked ? selected.add(o.value) : selected.delete(o.value);
          if (facet === "cat") for (const t of [...state.tag]) if (!tagAllowed(t)) state.tag.delete(t);
          update();
        });
        label.append(input);
        if (o.colour) {
          const dot = el("span", { class: facet === "layer" ? "dot ring" : "dot" });
          dot.style.background = o.colour;
          label.append(dot);
        }
        label.append(el("span", { class: "label" }, o.label), el("span", { class: "count" }, String(n)));
        label.classList.toggle("zero", n === 0 && !input.checked);
        return label;
      }),
    );
  }

  function tagAllowed(tag: string) {
    return [...state.cat].some((c) => cats.get(c)?.tags.some((t) => t.key === tag));
  }

  function renderFilters() {
    renderFacet("layer", $("f-layer"), Object.entries(LAYERS).map(([value, label]) => ({
      value, label, colour: value === "startup" ? undefined : TYPE_COLOUR[value as "investor"],
    })), "checks");
    renderFacet("cat", $("f-cat"), data.taxonomy.map((c) => ({ value: c.key, label: c.label, colour: c.colour })), "checks");
    const tagOptions = data.taxonomy.filter((c) => state.cat.has(c.key)).flatMap((c) => c.tags.map((t) => ({ value: t.key, label: t.label })));
    $("tags-set").hidden = tagOptions.length === 0;
    renderFacet("tag", $("f-tag"), tagOptions, "chips");
    renderFacet("stage", $("f-stage"), Object.entries(STAGES).map(([value, label]) => ({ value, label })), "chips");
    renderFacet("origin", $("f-origin"), Object.entries(ORIGINS).map(([value, label]) => ({ value, label })), "checks");
    const active = state.cat.size + state.tag.size + state.stage.size + state.origin.size + (state.layer.size < 3 ? 1 : 0) + (state.q ? 1 : 0);
    const badge = $("filter-badge");
    badge.hidden = active === 0;
    badge.textContent = String(active);
  }

  // ---- Map ---------------------------------------------------------------------------------

  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  const styleUrl = () => `https://tiles.openfreemap.org/styles/${dark.matches ? "dark" : "positron"}`;
  const startCity = data.cities.find((c) => c.id === state.city) ?? data.cities[0];
  const map = new maplibregl.Map({
    container: "map",
    style: styleUrl(),
    center: [startCity.center[1], startCity.center[0]],
    zoom: startCity.zoom,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  dark.addEventListener("change", () => map.setStyle(styleUrl()));

  let currentGeojson: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
  map.on("style.load", () => {
    map.addSource("entries", { type: "geojson", data: currentGeojson, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 });
    map.addLayer({
      id: "clusters", type: "circle", source: "entries", filter: ["has", "point_count"],
      paint: {
        "circle-color": dark.matches ? "#e5e7eb" : "#1f2937",
        "circle-opacity": 0.9,
        "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 30, 24],
        "circle-stroke-width": 2,
        "circle-stroke-color": dark.matches ? "#111827" : "#ffffff",
      },
    });
    map.addLayer({
      id: "cluster-count", type: "symbol", source: "entries", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-font": ["Noto Sans Bold"], "text-size": 12 },
      paint: { "text-color": dark.matches ? "#111827" : "#ffffff" },
    });
    map.addLayer({
      id: "points", type: "circle", source: "entries", filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": ["get", "colour"],
        "circle-radius": ["case", ["==", ["get", "type"], "startup"], 7, 6],
        "circle-stroke-width": 2,
        "circle-stroke-color": ["case", ["==", ["get", "type"], "startup"], "#ffffff", "#fbbf24"],
      },
    });
    map.addLayer({
      id: "selected", type: "circle", source: "entries", filter: ["==", ["get", "key"], state.id ?? ""],
      paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": dark.matches ? "#fbbf24" : "#111827" },
    });
  });

  map.on("click", "clusters", async (ev) => {
    const f = ev.features?.[0] as MapGeoJSONFeature | undefined;
    if (!f) return;
    const zoom = await (map.getSource("entries") as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  });
  map.on("click", "points", (ev) => {
    const key = ev.features?.[0]?.properties?.key;
    if (key) openDetail(key);
  });
  for (const layer of ["clusters", "points"]) {
    map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
  }
  const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "hover-pop" });
  map.on("mousemove", "points", (ev) => {
    const f = ev.features?.[0];
    if (!f) return;
    hover.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(f.properties.name).addTo(map);
  });
  map.on("mouseleave", "points", () => hover.remove());

  function flyToCity() {
    const c = data.cities.find((x) => x.id === state.city);
    if (c) map.flyTo({ center: [c.center[1], c.center[0]], zoom: c.zoom });
    else if (data.cities.length) {
      const b = new maplibregl.LngLatBounds();
      for (const x of data.cities) b.extend([x.bbox[1], x.bbox[0]]).extend([x.bbox[3], x.bbox[2]]);
      map.fitBounds(b, { padding: 40 });
    }
  }

  function toGeojson(entries: Entry[]): GeoJSON.FeatureCollection {
    return {
      type: "FeatureCollection",
      features: entries.filter((e) => e.pin).map((e) => {
        const [lng, lat] = spread(e);
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            key: `${e.type}:${e.id}`, name: e.name, type: e.type,
            colour: e.type === "startup" ? (cats.get(e.category!)?.colour ?? "#4f46e5") : TYPE_COLOUR[e.type],
          },
        };
      }),
    };
  }

  /** Area-only pins share one point; nudge each by a stable ~100 m so they can be told apart. */
  function spread(e: Entry): [number, number] {
    const { lat, lng, precision } = e.pin!;
    if (precision !== "area") return [lng, lat];
    let h = 0;
    for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const angle = (h % 360) * (Math.PI / 180);
    const r = 0.0006 + ((h >> 9) % 100) / 100000;
    return [lng + (r * Math.cos(angle)) / Math.cos((lat * Math.PI) / 180), lat + r * Math.sin(angle)];
  }

  function renderLegend() {
    const legend = $("legend");
    const items: [string, string][] = [];
    if (state.layer.has("investor")) items.push(["Investor", TYPE_COLOUR.investor]);
    if (state.layer.has("ecosystem")) items.push(["Lab or space", TYPE_COLOUR.ecosystem]);
    legend.replaceChildren(
      el("span", { class: "legend-item" }, "Startups: colour = category"),
      ...items.map(([label, colour]) => {
        const dot = el("span", { class: "dot ring" });
        dot.style.background = colour;
        return el("span", { class: "legend-item" }, dot, label);
      }),
    );
  }

  // ---- Grid --------------------------------------------------------------------------------

  function renderGrid(entries: Entry[]) {
    const grid = $("grid");
    grid.replaceChildren(
      ...entries.map((e) => {
        const card = el("button", { type: "button", class: "card" });
        card.addEventListener("click", () => openDetail(`${e.type}:${e.id}`));
        const head = el("div", { class: "card-head" }, logoEl(e), el("div", {}, el("h3", {}, e.name), el("p", { class: "muted small" }, subtitle(e))));
        card.append(head, el("p", { class: "tagline" }, e.tagline), chipsFor(e));
        return card;
      }),
    );
  }

  function subtitle(e: Entry) {
    if (e.type === "investor") return INVESTOR_TYPES[e.investor_type!] ?? "Investor";
    if (e.type === "ecosystem") return ECOSYSTEM_TYPES[e.ecosystem_type!] ?? "Ecosystem";
    return [cats.get(e.category!)?.label, e.founded && `founded ${e.founded}`, e.status !== "active" && STATUS[e.status!]]
      .filter(Boolean).join(" · ");
  }

  function chipsFor(e: Entry) {
    const wrap = el("div", { class: "card-chips" });
    const keys = e.type === "investor" ? (e.focus ?? []).map((k) => cats.get(k)?.label ?? k) : (e.tags ?? []).map((t) => tagLabels.get(t) ?? t);
    for (const k of keys) wrap.append(el("span", { class: "tag" }, k));
    if (e.stage) wrap.append(el("span", { class: "tag strong" }, STAGES[e.stage] ?? e.stage));
    if (e.origin?.type === "university-spinout") wrap.append(el("span", { class: "tag strong" }, "Spin-out"));
    return wrap;
  }

  function logoEl(e: Entry) {
    const box = el("div", { class: "logo" });
    if (e.logo) {
      const img = el("img", { alt: "", loading: "lazy", width: "44", height: "44" }) as HTMLImageElement;
      img.src = `${base}${e.logo}`;
      box.append(img);
    } else {
      box.textContent = initials(e.name);
      box.style.background = e.type === "startup" ? (cats.get(e.category!)?.colour ?? "#4f46e5") : TYPE_COLOUR[e.type];
      box.classList.add("initials");
    }
    return box;
  }

  // ---- Detail panel ------------------------------------------------------------------------

  function openDetail(key: string) {
    if (!byKey.has(key)) return;
    state.id = key;
    update();
  }
  function closeDetail() {
    if (!state.id) return;
    state.id = null;
    update();
  }
  $("detail-close").addEventListener("click", closeDetail);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { closeDetail(); setFiltersOpen(false); }
  });

  function renderDetail() {
    const panel = $("detail");
    const e = state.id ? byKey.get(state.id) : undefined;
    panel.hidden = !e;
    if (!e) return;
    const city = data.cities.find((c) => c.id === e.city);
    const body = $("detail-body");
    const rows = el("dl", { class: "facts" });
    const row = (label: string, ...value: (Node | string)[]) => {
      if (value.every((v) => v === "" || v == null)) return;
      rows.append(el("dt", {}, label), el("dd", {}, ...value));
    };

    if (e.type === "startup") {
      row("Category", cats.get(e.category!)?.label ?? e.category!);
      row("Status", STATUS[e.status!] + (e.acquired_by ? ` by ${e.acquired_by}` : ""));
      if (e.stage) row("Stage", STAGES[e.stage]);
      if (e.founded) row("Founded", String(e.founded));
      if (e.team_size) row("Team size", e.team_size);
      if (e.origin) {
        const inst = e.origin.institution ? (universities.get(e.origin.institution) ?? e.origin.institution) : "";
        row("Origin", [ORIGINS[e.origin.type], inst].filter(Boolean).join(" — ") + (e.origin.department ? ` (${e.origin.department})` : ""));
      }
      if (e.investors?.length) {
        const list = el("span", {});
        e.investors.forEach((name, i) => {
          if (i) list.append(", ");
          const inv = byKey.get(`investor:${name}`);
          if (inv) {
            const b = el("button", { type: "button", class: "link-button" }, inv.name);
            b.addEventListener("click", () => openDetail(`investor:${inv.id}`));
            list.append(b);
          } else list.append(name);
        });
        row("Investors", list);
      }
    }
    if (e.type === "investor") {
      row("Type", INVESTOR_TYPES[e.investor_type!]);
      row("Focus", (e.focus ?? []).map((k) => cats.get(k)?.label ?? k).join(", "));
      const backed = data.entries.filter((s) => s.investors?.includes(e.id));
      if (backed.length) {
        const list = el("span", {});
        backed.forEach((s, i) => {
          if (i) list.append(", ");
          const b = el("button", { type: "button", class: "link-button" }, s.name);
          b.addEventListener("click", () => openDetail(`startup:${s.id}`));
          list.append(b);
        });
        row("Portfolio here", list);
      }
    }
    if (e.type === "ecosystem") row("Type", ECOSYSTEM_TYPES[e.ecosystem_type!]);

    const area = city?.areas.find((a) => a.id === e.location.area)?.label;
    row("Location", [e.location.postcode, area, city?.name].filter(Boolean).join(", "));
    if (e.pin?.precision === "area") rows.append(el("dd", { class: "muted small" }, "Pin shows the area, not the exact address."));

    const links = el("ul", { class: "links" });
    const addLink = (label: string, url?: string) => {
      if (!url || !/^https:\/\//.test(url)) return;
      const a = el("a", { rel: "noopener noreferrer nofollow", target: "_blank" }, label) as HTMLAnchorElement;
      a.href = url;
      links.append(el("li", {}, a));
    };
    addLink("Website", e.website);
    addLink("Careers", e.careers_url);
    for (const [k, v] of Object.entries(e.links ?? {})) addLink(LINK_LABELS[k] ?? k, v);

    const footer = el("p", { class: "muted small" });
    const src = el("a", { rel: "noopener noreferrer nofollow", target: "_blank" }, "source") as HTMLAnchorElement;
    if (/^https:\/\//.test(e.source)) src.href = e.source;
    footer.append(`Last verified ${e.last_verified} (`, src, ")");
    if (repoUrl) {
      const edit = el("a", { rel: "noopener", target: "_blank" }, "Suggest a correction") as HTMLAnchorElement;
      edit.href = `${repoUrl}/edit/main/data/cities/${e.city}/${FOLDERS[e.type]}/${e.id}.yaml`;
      footer.append(" · ", edit);
    }

    body.replaceChildren(
      el("div", { class: "detail-head" }, logoEl(e), el("div", {}, el("h2", { id: "detail-name" }, e.name), el("p", { class: "muted small" }, LAYERS[e.type].replace(/s$/, "")))),
      el("p", { class: "tagline" }, e.tagline),
      chipsFor(e),
      rows,
      links,
      footer,
    );

    if (state.view === "map" && e.pin) {
      const [lng, lat] = spread(e);
      if (!map.getBounds().contains([lng, lat])) map.easeTo({ center: [lng, lat] });
    }
  }

  // ---- Render loop -------------------------------------------------------------------------

  function update(push = true) {
    const visible = data.entries.filter((e) => matches(e, state));
    renderFilters();
    renderLegend();

    const n = visible.length;
    const unplaced = visible.filter((e) => !e.pin).length;
    $("result-count").textContent = `${n} ${n === 1 ? "result" : "results"}` + (state.view === "map" && unplaced ? ` (${unplaced} not on the map)` : "");

    for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
      btn.setAttribute("aria-pressed", String(btn.dataset.view === state.view));
    }
    const isMap = state.view === "map";
    $("map").hidden = !isMap;
    $("legend").hidden = !isMap;
    $("grid").hidden = isMap;
    $("empty").hidden = n > 0;
    if (isMap) {
      currentGeojson = toGeojson(visible);
      (map.getSource("entries") as GeoJSONSource | undefined)?.setData(currentGeojson);
      map.resize();
    } else renderGrid(visible);

    if (map.getLayer("selected")) map.setFilter("selected", ["==", ["get", "key"], state.id ?? ""]);
    renderDetail();
    if (push) writeUrl();
  }

  // ---- URL <-> state -----------------------------------------------------------------------

  function readUrl(): State {
    const p = new URLSearchParams(location.search);
    const list = (k: string) => new Set((p.get(k) ?? "").split(",").filter(Boolean));
    const cityIds = data.cities.map((c) => c.id);
    const city = p.get("city") ?? "";
    const layer = list("layer");
    return {
      city: cityIds.includes(city) || (city === "all" && cityIds.length > 1) ? city : cityIds[0],
      layer: new Set((layer.size ? [...layer] : Object.keys(LAYERS)).filter((l): l is EntryType => l in LAYERS)),
      cat: new Set([...list("cat")].filter((c) => cats.has(c))),
      tag: list("tag"),
      stage: new Set([...list("stage")].filter((s) => s in STAGES)),
      origin: new Set([...list("origin")].filter((o) => o in ORIGINS)),
      q: p.get("q") ?? "",
      view: p.get("view") === "grid" ? "grid" : "map",
      id: p.get("id"),
    };
  }

  function writeUrl() {
    const p = new URLSearchParams();
    if (state.city !== data.cities[0]?.id) p.set("city", state.city);
    if (state.layer.size < Object.keys(LAYERS).length) p.set("layer", [...state.layer].join(","));
    for (const f of ["cat", "tag", "stage", "origin"] as const) if (state[f].size) p.set(f, [...state[f]].join(","));
    if (state.q) p.set("q", state.q);
    if (state.view !== "map") p.set("view", state.view);
    if (state.id) p.set("id", state.id);
    const qs = p.toString().replace(/%2C/g, ",").replace(/%3A/g, ":");
    const url = `${location.pathname}${qs ? `?${qs}` : ""}`;
    if (url !== `${location.pathname}${location.search}`) history.pushState(null, "", url);
  }

  window.addEventListener("popstate", () => {
    Object.assign(state, readUrl());
    citySelect.value = state.city;
    qInput.value = state.q;
    update(false);
  });

  map.once("load", () => update(false));
  update(false);
}

// ---- DOM helpers ---------------------------------------------------------------------------

function el(tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
}

function initials(name: string) {
  return name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}
