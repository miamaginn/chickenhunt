// Show catalog. Show details come from TVmaze (https://www.tvmaze.com/api),
// a free TV database that needs no API key and works straight from the browser.
//
// Every show in the app has this shape:
//   { id: "tvm:169", name, year, endYear, genres: [], platform, runtime,
//     seasons: [{ n, episodes }], format: "limited" | "series",
//     status: "airing" | "finished" | "upcoming", image, imageLg, summary }

import { STARTER_SHOWS } from "./config.js";

const API = "https://api.tvmaze.com";
const CACHE_KEY = "binge.showcache.v1";
const CACHE_DAYS = 3;

// TVmaze lists the channel a show first aired on. Map those to where people
// actually stream it, so the platform filter is useful.
const PLATFORM_MAP = {
  "HBO": "HBO Max", "HBO Max": "HBO Max", "Max": "HBO Max", "Cinemax": "HBO Max",
  "Netflix": "Netflix",
  "Hulu": "Hulu", "FX": "Hulu", "FXX": "Hulu", "FX on Hulu": "Hulu", "ABC": "Hulu", "Freeform": "Hulu",
  "Disney+": "Disney+", "Disney Channel": "Disney+", "National Geographic": "Disney+",
  "Prime Video": "Prime Video", "Amazon Prime Video": "Prime Video", "Amazon Freevee": "Prime Video",
  "Apple TV+": "Apple TV", "Apple TV": "Apple TV",
  "Peacock": "Peacock", "NBC": "Peacock", "Bravo": "Peacock", "USA Network": "Peacock",
  "Paramount+": "Paramount+", "CBS": "Paramount+", "Showtime": "Paramount+", "Comedy Central": "Paramount+", "MTV": "Paramount+",
  "AMC": "AMC+", "AMC+": "AMC+",
  "BBC One": "BBC", "BBC Two": "BBC", "BBC Three": "BBC", "BBC iPlayer": "BBC",
  "Crunchyroll": "Crunchyroll", "Starz": "Starz", "The CW": "The CW", "FOX": "Fox", "Adult Swim": "Adult Swim",
};
export const PLATFORMS = ["Netflix", "Hulu", "HBO Max", "Disney+", "Prime Video", "Apple TV", "Peacock", "Paramount+", "AMC+", "BBC"];
export const LENGTHS = [
  { id: "short", label: "Under 25 min", test: (m) => m > 0 && m <= 25 },
  { id: "half", label: "About 30 min", test: (m) => m > 25 && m <= 40 },
  { id: "hour", label: "About an hour", test: (m) => m > 40 && m <= 65 },
  { id: "long", label: "Over an hour", test: (m) => m > 65 },
];
export const DECADES = [
  { id: "2020", label: "2020s", test: (y) => y >= 2020 },
  { id: "2010", label: "2010s", test: (y) => y >= 2010 && y < 2020 },
  { id: "2000", label: "2000s", test: (y) => y >= 2000 && y < 2010 },
  { id: "1990", label: "1990s", test: (y) => y >= 1990 && y < 2000 },
  { id: "old", label: "Before 1990", test: (y) => y > 0 && y < 1990 },
];
export const lengthLabel = (m) => (m ? `${m} min` : "");

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const stripHtml = (h) => (h || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export function normalizePlatform(name) {
  if (!name) return "";
  return PLATFORM_MAP[name] || name;
}

// TVmaze show JSON (with embedded seasons) → our show shape
export function fromTvmaze(t, override = {}) {
  const seasons = (t._embedded?.seasons || [])
    .filter((s) => s.number > 0 && (s.premiereDate || s.episodeOrder))
    .map((s) => ({ n: s.number, episodes: s.episodeOrder || null }));
  const status = t.status === "Ended" ? "finished" : t.status === "In Development" ? "upcoming" : "airing";
  const year = t.premiered ? +t.premiered.slice(0, 4) : 0;
  return {
    id: `tvm:${t.id}`,
    name: t.name,
    year,
    endYear: t.ended ? +t.ended.slice(0, 4) : null,
    genres: t.genres?.length ? t.genres : t.type && t.type !== "Scripted" ? [t.type] : [],
    platform: override.platform || normalizePlatform(t.webChannel?.name || t.network?.name),
    runtime: t.averageRuntime || t.runtime || 0,
    seasons: seasons.length ? seasons : [{ n: 1, episodes: null }],
    format: (status === "finished" && seasons.length <= 1) || /mini/i.test(t.type || "") ? "limited" : "series",
    status,
    image: t.image?.medium || "",
    imageLg: t.image?.original || t.image?.medium || "",
    summary: stripHtml(t.summary),
    rating: t.rating?.average || null,
  };
}

// ── tiny rate-limited fetch queue (TVmaze allows ~20 calls / 10 s) ──
let chain = Promise.resolve();
function tvFetch(path) {
  const p = chain.then(async () => {
    const res = await fetch(API + path);
    if (res.status === 429) { await new Promise((r) => setTimeout(r, 2000)); return fetch(API + path); }
    return res;
  });
  chain = p.then(() => new Promise((r) => setTimeout(r, 450)), () => {});
  return p.then(async (res) => {
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TVmaze ${res.status}`);
    return res.json();
  });
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; }
}
function writeCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch {}
}
const fresh = (e) => e && Date.now() - e.at < CACHE_DAYS * 864e5;

export async function searchShows(q) {
  const res = await tvFetch(`/search/shows?q=${encodeURIComponent(q)}`);
  // search results don't include seasons; fetch details for the top few
  const top = (res || []).slice(0, 8).map((r) => r.show);
  return Promise.all(top.map((t) => getShow(`tvm:${t.id}`).catch(() => fromTvmaze(t))));
}

export async function getShow(id) {
  const cache = readCache();
  if (fresh(cache[id])) return cache[id].show;
  if (!id.startsWith("tvm:")) return cache[id]?.show || fallbackById(id);
  const t = await tvFetch(`/shows/${id.slice(4)}?embed=seasons`);
  if (!t) return null;
  const show = fromTvmaze(t, cache[id]?.override);
  cache[id] = { at: Date.now(), show, override: cache[id]?.override };
  writeCache(cache);
  return show;
}

// Starter shows: looked up once (then cached), streamed into `onShow` as they arrive.
export async function loadStarters(onShow) {
  const cache = readCache();
  const out = [];
  let offline = false;
  for (const s of STARTER_SHOWS) {
    const key = `q:${slug(s.q)}`;
    let show = fresh(cache[key]) ? cache[key].show : null;
    if (!show && !offline) {
      try {
        const t = await tvFetch(`/singlesearch/shows?q=${encodeURIComponent(s.q)}&embed=seasons`);
        if (t) {
          show = fromTvmaze(t, s);
          cache[key] = cache[show.id] = { at: Date.now(), show, override: s.platform ? { platform: s.platform } : undefined };
          writeCache(cache);
        }
      } catch {
        offline = true; // TVmaze unreachable: use the built-in details below
      }
    }
    if (!show) show = cache[key]?.show || fallbackFor(s.q);
    if (show) { out.push(show); onShow?.(show); }
  }
  return out;
}

// ── Built-in details for the starter shows, used if TVmaze can't be reached ──
// name | first year | last year | genres | platform | minutes | seasons | status
const FALLBACK = `
The Bear|2022||Drama,Comedy|Hulu|33|4|airing
Severance|2022||Drama,Science-Fiction,Thriller|Apple TV|52|2|airing
The White Lotus|2021||Comedy,Drama|HBO Max|60|3|airing
Stranger Things|2016|2025|Drama,Horror,Science-Fiction|Netflix|62|5|finished
Succession|2018|2023|Drama|HBO Max|62|4|finished
Shogun|2024||Drama,History,War|Hulu|60|1|airing
Abbott Elementary|2021||Comedy|Hulu|22|5|airing
The Last of Us|2023||Drama,Action,Horror|HBO Max|58|2|airing
Ted Lasso|2020||Comedy,Sports|Apple TV|40|3|airing
Only Murders in the Building|2021||Comedy,Mystery|Hulu|33|5|airing
Breaking Bad|2008|2013|Drama,Crime,Thriller|Netflix|48|5|finished
Better Call Saul|2015|2022|Drama,Crime,Legal|Netflix|50|6|finished
The Office|2005|2013|Comedy|Peacock|22|9|finished
Fleabag|2016|2019|Comedy,Drama|Prime Video|25|2|finished
The Crown|2016|2023|Drama,History|Netflix|58|6|finished
Squid Game|2021|2025|Drama,Thriller|Netflix|55|3|finished
Wednesday|2022||Comedy,Mystery,Supernatural|Netflix|50|2|airing
Beef|2023||Comedy,Drama|Netflix|35|1|airing
Baby Reindeer|2024|2024|Drama,Thriller|Netflix|33|1|finished
Adolescence|2025|2025|Drama,Crime|Netflix|60|1|finished
The Pitt|2025||Drama,Medical|HBO Max|50|1|airing
Slow Horses|2022||Drama,Espionage,Thriller|Apple TV|45|5|airing
Reacher|2022||Action,Crime|Prime Video|50|3|airing
The Boys|2019||Action,Comedy,Crime|Prime Video|60|4|airing
Hacks|2021||Comedy,Drama|HBO Max|30|4|airing
Normal People|2020|2020|Drama,Romance|Hulu|30|1|finished
Chernobyl|2019|2019|Drama,History|HBO Max|65|1|finished
Mare of Easttown|2021|2021|Drama,Crime,Mystery|HBO Max|58|1|finished
Game of Thrones|2011|2019|Drama,Adventure,Fantasy|HBO Max|60|8|finished
Euphoria|2019||Drama|HBO Max|58|2|airing
Bridgerton|2020||Drama,Romance|Netflix|60|3|airing
Love Is Blind|2020||Reality,Romance|Netflix|55|8|airing
The Traitors|2023||Reality,Game Show|Peacock|60|3|airing
Yellowjackets|2021||Drama,Horror,Mystery|Paramount+|55|3|airing
Andor|2022|2025|Drama,Science-Fiction,Action|Disney+|45|2|finished
Arcane|2021|2024|Animation,Action,Fantasy|Netflix|40|2|finished
`.trim().split("\n").map((line) => {
  const [name, y, ey, genres, platform, min, seasons, status] = line.split("|");
  return {
    id: `seed:${slug(name)}`, name, year: +y, endYear: ey ? +ey : null, genres: genres.split(","), platform,
    runtime: +min, seasons: Array.from({ length: +seasons }, (_, i) => ({ n: i + 1, episodes: null })),
    format: status === "finished" && +seasons === 1 ? "limited" : "series", status,
    image: "", imageLg: "", summary: "", rating: null,
  };
});
const fallbackFor = (q) => FALLBACK.find((s) => s.name.toLowerCase() === q.toLowerCase()) || null;
const fallbackById = (id) => FALLBACK.find((s) => s.id === id) || null;
