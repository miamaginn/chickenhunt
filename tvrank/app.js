import { createStore, mode, scoreOf } from "./store.js";
import { loadStarters, searchShows, getShow, PLATFORMS, LENGTHS, DECADES } from "./catalog.js";
import { APP_NAME } from "./config.js";

// ───────────────────────── state ─────────────────────────
const S = {
  store: null,
  me: null,
  friends: [],
  requests: { incoming: [], outgoing: [] },
  people: new Map(), // userId → profile (me, friends, and anyone we've looked up)
  shows: new Map(), // showId → show
  myLogs: new Map(), // showId → my log
  logs: [], // every log I'm allowed to see (mine + friends' + tagged)
  stats: {}, // showId → { avg, count } across everyone
  catalogIds: new Set(), // shows to list on Discover when not searching
  search: { q: "", ids: null, loading: false, error: "" },
  userSearch: { q: "", results: [] },
  drafts: new Map(), // showId → unsaved log edits
  starterLoading: true,
  rankTab: "ranked",
  filters: loadPref("filters", { genre: "", platform: "", length: "", format: "", decade: "", status: "", friends: false, sort: "overall" }),
};

const $main = document.getElementById("main");
const $toast = document.getElementById("toast");

function loadPref(k, d) { try { return { ...d, ...JSON.parse(localStorage.getItem("binge.pref." + k)) }; } catch { return d; } }
function savePref(k, v) { try { localStorage.setItem("binge.pref." + k, JSON.stringify(v)); } catch {} }

// ───────────────────────── helpers ─────────────────────────
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const fmt = (n) => (n == null ? "–" : (Math.round(n * 10) / 10).toFixed(1));
const friendIds = () => new Set(S.friends.map((f) => f.id));
const personName = (id) => (id === S.me?.id ? "you" : S.people.get(id)?.name || S.people.get(id)?.username || "someone");
const STATUS_LABEL = { watching: "Watching", finished: "Finished", want: "Want to watch", dropped: "Dropped" };
const STATUS_VERB = { watching: "is watching", finished: "finished", want: "wants to watch", dropped: "dropped" };

function toast(msg) {
  $toast.textContent = msg;
  $toast.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => $toast.classList.remove("show"), 2400);
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stars(value, { key = "", size = "", label = "" } = {}) {
  const pct = ((value || 0) / 5) * 100;
  const interactive = key ? `data-stars="${esc(key)}" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="5" aria-valuenow="${value || 0}" aria-label="${esc(label || "Rating")}"` : `aria-label="${value ? fmt(value) + " out of 5" : "not rated"}"`;
  return `<span class="stars ${size} ${key ? "interactive" : ""}" ${interactive}><span class="stars-bg">★★★★★</span><span class="stars-fg" style="width:${pct}%">★★★★★</span></span>`;
}

function poster(show, cls = "") {
  if (show?.image) return `<img class="poster ${cls}" src="${esc(show.image)}" alt="" loading="lazy" />`;
  const name = show?.name || "?";
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<div class="poster ph ${cls}" style="--h:${h}"><span>${esc(name)}</span></div>`;
}

const avatar = (p, cls = "") => `<span class="avatar ${cls}" title="${esc(p?.name || p?.username || "")}">${esc(p?.emoji || "🙂")}</span>`;

function seasonChips(seasons) {
  const entries = Object.entries(seasons || {}).filter(([, v]) => v > 0).sort((a, b) => a[0] - b[0]);
  if (!entries.length) return "";
  return `<span class="season-chips">${entries.map(([n, v]) => `<span class="schip">S${n} <b>${fmt(v)}</b></span>`).join("")}</span>`;
}

function showMeta(show) {
  const bits = [];
  if (show.year) bits.push(show.endYear && show.endYear !== show.year ? `${show.year}–${show.endYear}` : show.status === "airing" ? `${show.year}–` : `${show.year}`);
  if (show.platform) bits.push(show.platform);
  return bits.join(" · ");
}

// friend + everyone numbers for one show
function showNumbers(id) {
  const fids = friendIds();
  const friendLogs = S.logs.filter((l) => l.showId === id && fids.has(l.userId));
  const fScores = friendLogs.map((l) => l.score ?? scoreOf(l)).filter((x) => x != null);
  return {
    mine: S.myLogs.get(id),
    friendLogs,
    friendAvg: avg(fScores),
    friendRated: fScores.length,
    all: S.stats[id] || null,
  };
}

// ───────────────────────── data loading ─────────────────────────
function addShows(list) {
  for (const s of list) if (s && s.id) S.shows.set(s.id, { ...S.shows.get(s.id), ...s });
}

async function ensurePeople(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !S.people.has(id));
  if (!missing.length) return;
  const got = await Promise.all(missing.map((id) => S.store.getProfile(id).catch(() => null)));
  got.forEach((p, i) => S.people.set(missing[i], p || { id: missing[i], name: "someone", emoji: "🙂" }));
  render();
}

async function ensureShows(ids) {
  const missing = [...new Set(ids)].filter((id) => !S.shows.has(id));
  if (!missing.length) return;
  const got = await Promise.all(missing.map((id) => getShow(id).catch(() => null)));
  addShows(got.filter(Boolean));
  render();
}

let statsTimer;
function refreshStats() {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(async () => {
    try {
      S.stats = { ...S.stats, ...(await S.store.stats([...S.shows.keys()])) };
      render();
    } catch (e) { console.warn(e); }
  }, 250);
}

async function refreshSocial() {
  const st = S.store;
  const [friends, requests, mine, logs] = await Promise.all([st.friends(), st.requests(), st.myLogs(), st.visibleLogs()]);
  S.friends = friends;
  S.requests = requests;
  S.myLogs = new Map(mine.map((l) => [l.showId, l]));
  S.logs = logs;
  for (const p of [S.me, ...friends, ...requests.incoming.map((r) => r.profile), ...requests.outgoing.map((r) => r.profile)]) if (p) S.people.set(p.id, p);
  ensurePeople(logs.flatMap((l) => [l.userId, ...(l.watchedWith || [])]));
  ensureShows(logs.map((l) => l.showId));
  updateBadge();
  render();
  refreshStats();
}

async function loadCatalog() {
  try {
    const cached = await S.store.cachedShows();
    addShows(cached);
    cached.forEach((s) => S.catalogIds.add(s.id));
  } catch (e) { console.warn(e); }
  render();
  let n = 0;
  const starters = await loadStarters((show) => {
    addShows([show]);
    S.catalogIds.add(show.id);
    if (++n % 6 === 0) render();
  });
  S.starterLoading = false;
  if (S.store.seedDemo(starters)) await refreshSocial();
  render();
  refreshStats();
}

async function afterSignIn() {
  S.people.set(S.me.id, S.me);
  await refreshSocial();
  loadCatalog();
}

// ───────────────────────── views ─────────────────────────
function viewAuth() {
  const demo = mode === "demo";
  const tab = S.authTab || "up";
  const emojis = ["📺", "🍿", "🎬", "🛋️", "🦄", "🐸", "🌮", "👾", "🌙", "🔥", "🐱", "🎧"];
  return `
  <section class="auth">
    <div class="hero">
      <div class="hero-art" aria-hidden="true">📺</div>
      <h1>${esc(APP_NAME)}</h1>
      <p>Log every show you watch, rank it season by season, and see what your friends really thought.</p>
    </div>
    ${demo ? `<div class="note">🧪 <b>Demo mode.</b> Your profile and ratings are saved on this device only, and a few pretend friends are added so you can try everything. Connect Supabase to use real accounts (see README).</div>` : `
    <div class="seg" role="tablist">
      <button class="${tab === "up" ? "on" : ""}" data-action="auth-tab" data-tab="up">Create account</button>
      <button class="${tab === "in" ? "on" : ""}" data-action="auth-tab" data-tab="in">Sign in</button>
    </div>`}
    <form id="authForm" class="card form" data-kind="${demo ? "up" : tab}" novalidate>
      ${!demo ? `
        <label>Email<input name="email" type="email" autocomplete="email" required /></label>
        <label>Password<input name="password" type="password" autocomplete="${tab === "up" ? "new-password" : "current-password"}" minlength="6" required /></label>` : ""}
      ${demo || tab === "up" ? `
        <label>Your name<input name="name" autocomplete="given-name" maxlength="40" required placeholder="Jamie" /></label>
        <label>Username <span class="hint">friends find you by this</span><input name="username" autocapitalize="none" autocomplete="username" pattern="[a-zA-Z0-9_.]{3,20}" maxlength="20" required placeholder="jamie_watches" /></label>
        <fieldset class="emoji-pick"><legend>Pick an avatar</legend>
          ${emojis.map((e, i) => `<label><input type="radio" name="emoji" value="${e}" ${i === 0 ? "checked" : ""} /><span>${e}</span></label>`).join("")}
        </fieldset>` : ""}
      <p class="form-error" id="authError" role="alert"></p>
      <button class="btn primary big" type="submit">${demo ? "Start logging" : tab === "up" ? "Create account" : "Sign in"}</button>
    </form>
  </section>`;
}

function viewFeed() {
  const fids = friendIds();
  const tagged = S.logs.filter((l) => l.userId !== S.me.id && (l.watchedWith || []).includes(S.me.id) && !S.myLogs.has(l.showId));
  const items = S.logs.filter((l) => l.userId !== S.me.id && fids.has(l.userId)).slice(0, 80);

  // shows your friends rate highest
  const byShow = new Map();
  for (const l of items) if (l.score != null) (byShow.get(l.showId) || byShow.set(l.showId, []).get(l.showId)).push(l.score);
  const loved = [...byShow].filter(([id, xs]) => S.shows.has(id) && xs.length >= 2).map(([id, xs]) => ({ id, a: avg(xs), n: xs.length })).sort((a, b) => b.a - a.a || b.n - a.n).slice(0, 12);

  if (!S.friends.length) {
    return `<section class="empty">
      <div class="empty-art">👋</div>
      <h2>Your feed is quiet</h2>
      <p>Add friends to see what they're watching and how they rank it.</p>
      <a class="btn primary" href="#/friends">Find friends</a>
      <a class="btn ghost" href="#/discover">Log a show</a>
    </section>`;
  }
  return `
  ${tagged.length ? `<section class="block">
    <h2 class="h2">Watched with you</h2>
    ${tagged.map((l) => { const s = S.shows.get(l.showId); return s ? `
      <div class="card tag-card">
        ${poster(s, "xs")}
        <div class="grow"><b>${esc(personName(l.userId))}</b> says you watched <b>${esc(s.name)}</b> together.</div>
        <a class="btn small primary" href="#/show/${encodeURIComponent(s.id)}">Rate it</a>
      </div>` : ""; }).join("")}
  </section>` : ""}
  ${loved.length ? `<section class="block">
    <h2 class="h2">Your friends love</h2>
    <div class="rail">${loved.map(({ id, a, n }) => { const s = S.shows.get(id); return `
      <a class="rail-item" href="#/show/${encodeURIComponent(id)}">${poster(s)}<span class="rail-name">${esc(s.name)}</span><span class="rail-score">★ ${fmt(a)} <small>· ${n} friends</small></span></a>`; }).join("")}
    </div>
  </section>` : ""}
  <section class="block">
    <h2 class="h2">Friend activity</h2>
    ${items.length ? items.map(feedItem).join("") : `<p class="muted">Nothing yet. Your friends haven't logged anything.</p>`}
  </section>`;
}

function feedItem(l) {
  const s = S.shows.get(l.showId);
  const p = S.people.get(l.userId);
  if (!s) return "";
  const ww = (l.watchedWith || []).map(personName);
  return `<a class="card feed-item" href="#/show/${encodeURIComponent(s.id)}">
    ${poster(s, "sm")}
    <div class="grow">
      <div class="feed-line">${avatar(p, "xs")} <b>${esc(p?.name || "Someone")}</b> ${STATUS_VERB[l.status] || "logged"} <b>${esc(s.name)}</b></div>
      ${l.score != null ? `<div class="feed-stars">${stars(l.score)} <span class="muted">${fmt(l.score)}</span></div>` : ""}
      ${seasonChips(l.seasons)}
      ${ww.length ? `<div class="muted small">👯 with ${esc(ww.join(", "))}</div>` : ""}
      ${l.note ? `<div class="feed-note">“${esc(l.note)}”</div>` : ""}
      <div class="muted small">${ago(l.updatedAt)}</div>
    </div>
  </a>`;
}

function allGenres() {
  const g = new Set();
  for (const id of S.catalogIds) (S.shows.get(id)?.genres || []).forEach((x) => g.add(x));
  return [...g].sort();
}

function applyFilters(list) {
  const f = S.filters;
  const len = LENGTHS.find((x) => x.id === f.length);
  const dec = DECADES.find((x) => x.id === f.decade);
  const fids = friendIds();
  let out = list.filter((s) =>
    (!f.genre || s.genres?.includes(f.genre)) &&
    (!f.platform || (f.platform === "other" ? !PLATFORMS.includes(s.platform) : s.platform === f.platform)) &&
    (!len || len.test(s.runtime)) &&
    (!f.format || s.format === f.format) &&
    (!dec || dec.test(s.year)) &&
    (!f.status || s.status === f.status) &&
    (!f.friends || S.logs.some((l) => l.showId === s.id && fids.has(l.userId)))
  );
  const sorters = {
    overall: (a, b) => (S.stats[b.id]?.avg ?? -1) - (S.stats[a.id]?.avg ?? -1) || (b.rating || 0) - (a.rating || 0),
    friends: (a, b) => (showNumbers(b.id).friendAvg ?? -1) - (showNumbers(a.id).friendAvg ?? -1),
    newest: (a, b) => (b.year || 0) - (a.year || 0),
    az: (a, b) => a.name.localeCompare(b.name),
  };
  if (!S.search.ids || f.sort !== "overall") out = out.sort(sorters[f.sort] || sorters.overall);
  return out;
}

function select(name, label, options, value) {
  return `<label class="filter ${value ? "on" : ""}"><span class="sr">${label}</span>
    <select data-filter="${name}">${options.map(([v, t]) => `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`;
}

function viewDiscover() {
  const f = S.filters;
  const searching = S.search.ids !== null;
  const base = (searching ? S.search.ids : [...S.catalogIds]).map((id) => S.shows.get(id)).filter(Boolean);
  const list = applyFilters(base);
  const active = ["genre", "platform", "length", "format", "decade", "status"].filter((k) => f[k]).length + (f.friends ? 1 : 0);
  return `
  <form class="searchbar" id="searchForm" role="search">
    <input id="searchInput" type="search" placeholder="Search any TV show…" value="${esc(S.search.q)}" autocomplete="off" enterkeyhint="search" />
    ${searching ? `<button type="button" class="btn small ghost" data-action="clear-search">Clear</button>` : ""}
  </form>
  <div class="filters">
    ${select("sort", "Sort", [["overall", "⭐ Top rated"], ["friends", "👯 Friends' favorites"], ["newest", "🆕 Newest"], ["az", "🔤 A–Z"]], f.sort)}
    ${select("genre", "Genre", [["", "Genre"], ...allGenres().map((g) => [g, g])], f.genre)}
    ${select("platform", "Platform", [["", "Platform"], ...PLATFORMS.map((p) => [p, p]), ["other", "Other"]], f.platform)}
    ${select("length", "Episode length", [["", "Episode length"], ...LENGTHS.map((l) => [l.id, l.label])], f.length)}
    ${select("format", "Format", [["", "Format"], ["limited", "Limited / mini series"], ["series", "Multi-season"]], f.format)}
    ${select("decade", "Released", [["", "Released"], ...DECADES.map((d) => [d.id, d.label])], f.decade)}
    ${select("status", "Status", [["", "Status"], ["finished", "Finished"], ["airing", "New episodes coming"], ["upcoming", "Not out yet"]], f.status)}
    <button class="filter chip ${f.friends ? "on" : ""}" data-action="toggle-friends-filter" aria-pressed="${f.friends}">👯 Friends watched</button>
    ${active ? `<button class="filter chip clear" data-action="clear-filters">✕ Clear ${active}</button>` : ""}
  </div>
  ${S.search.loading ? `<p class="muted center">Searching…</p>` : ""}
  ${S.search.error ? `<p class="form-error center">${esc(S.search.error)}</p>` : ""}
  ${searching && !S.search.loading ? `<p class="muted small">${list.length} result${list.length === 1 ? "" : "s"} for “${esc(S.search.q)}”</p>` : ""}
  <div class="grid">${list.map(showCard).join("")}</div>
  ${!list.length && !S.search.loading ? `<div class="empty small"><p>No shows match. ${active ? "Try clearing some filters," : ""} or search for a show by name.</p></div>` : ""}
  ${!searching && S.starterLoading ? `<p class="muted center small">Loading shows…</p>` : ""}`;
}

function showCard(s) {
  const n = showNumbers(s.id);
  const myScore = n.mine ? n.mine.score ?? scoreOf(n.mine) : null;
  return `<a class="show-card" href="#/show/${encodeURIComponent(s.id)}">
    <div class="poster-wrap">${poster(s)}
      ${n.mine ? `<span class="mine-badge">${myScore != null ? "★ " + fmt(myScore) : STATUS_LABEL[n.mine.status]}</span>` : ""}
      ${s.format === "limited" ? `<span class="fmt-badge">Limited</span>` : ""}
    </div>
    <div class="sc-name">${esc(s.name)}</div>
    <div class="sc-meta">${esc(showMeta(s))}</div>
    <div class="sc-scores">
      <span title="Friends' average">👯 ${n.friendRated ? fmt(n.friendAvg) : "–"}</span>
      <span title="Everyone's average">🌍 ${n.all ? fmt(n.all.avg) : "–"}</span>
    </div>
  </a>`;
}

function viewShow(id) {
  const s = S.shows.get(id);
  if (!s) { ensureShows([id]); return `<p class="muted center">Loading…</p>`; }
  const n = showNumbers(id);
  const mine = n.mine;
  const d = S.drafts.get(id) || (mine ? structuredClone(mine) : { showId: id, status: "finished", rating: null, seasons: {}, watchedWith: [], note: "" });
  S.drafts.set(id, d);
  const fids = friendIds();
  const others = S.logs.filter((l) => l.showId === id && l.userId !== S.me.id && (fids.has(l.userId) || (l.watchedWith || []).includes(S.me.id)));
  const seasonFriendAvg = (num) => avg(n.friendLogs.map((l) => l.seasons?.[num]).filter((v) => v > 0));
  const myScore = mine ? mine.score ?? scoreOf(mine) : null;
  const seasonCount = s.seasons.length;
  const statusText = { finished: "Finished", airing: "New episodes coming", upcoming: "Not out yet" }[s.status];

  return `
  <article class="show">
    <a class="back" href="#/discover" data-action="back">‹ Back</a>
    <header class="show-head">
      ${s.imageLg ? `<div class="show-bg" style="background-image:url('${esc(s.imageLg)}')"></div>` : ""}
      ${poster(s, "lg")}
      <div class="show-title">
        <h1>${esc(s.name)}</h1>
        <div class="muted">${esc(showMeta(s))}</div>
        <div class="tags">
          <span class="tag">${s.format === "limited" ? "Limited series" : `${seasonCount} season${seasonCount === 1 ? "" : "s"}`}</span>
          <span class="tag ${s.status}">${statusText}</span>
          ${s.runtime ? `<span class="tag">~${s.runtime} min</span>` : ""}
          ${(s.genres || []).map((g) => `<span class="tag soft">${esc(g)}</span>`).join("")}
        </div>
      </div>
    </header>

    <div class="score-tiles">
      <div class="tile"><span class="tile-label">You</span><span class="tile-num">${fmt(myScore)}</span>${stars(myScore, { size: "sm" })}</div>
      <div class="tile"><span class="tile-label">Friends${n.friendRated ? ` (${n.friendRated})` : ""}</span><span class="tile-num">${fmt(n.friendAvg)}</span>${stars(n.friendAvg, { size: "sm" })}</div>
      <div class="tile"><span class="tile-label">Everyone${n.all ? ` (${n.all.count})` : ""}</span><span class="tile-num">${fmt(n.all?.avg)}</span>${stars(n.all?.avg, { size: "sm" })}</div>
    </div>

    ${s.summary ? `<p class="summary">${esc(s.summary)}</p>` : ""}

    <section class="card block log" id="logEditor">
      <h2 class="h2">${mine ? "Your log" : "Log this show"}</h2>
      <div class="seg wrap" role="radiogroup" aria-label="Status">
        ${Object.entries(STATUS_LABEL).map(([k, t]) => `<button type="button" class="${d.status === k ? "on" : ""}" role="radio" aria-checked="${d.status === k}" data-action="draft-status" data-status="${k}">${t}</button>`).join("")}
      </div>
      ${d.status !== "want" ? `
      <div class="row-rate overall">
        <span class="rate-label">Overall</span>
        ${stars(d.rating, { key: "overall", size: "lg", label: "Overall rating" })}
        <span class="rate-val">${d.rating ? fmt(d.rating) : `<span class="muted small">${scoreOf({ seasons: d.seasons }) != null ? "avg " + fmt(scoreOf({ seasons: d.seasons })) : "tap to rate"}</span>`}</span>
      </div>
      <p class="muted small">Leave overall empty to use the average of your season ratings. Tap a star's left half for ½.</p>
      <div class="seasons">
        ${s.seasons.map((se) => { const fa = seasonFriendAvg(se.n); return `
          <div class="row-rate">
            <span class="rate-label">Season ${se.n}${se.episodes ? `<small>${se.episodes} eps</small>` : ""}</span>
            ${stars(d.seasons?.[se.n], { key: "s" + se.n, label: `Season ${se.n} rating` })}
            <span class="rate-val">${d.seasons?.[se.n] ? fmt(d.seasons[se.n]) : ""}${fa != null ? `<small class="muted" title="Friends' average for this season">👯 ${fmt(fa)}</small>` : ""}</span>
          </div>`; }).join("")}
      </div>` : ""}
      <div class="ww">
        <span class="rate-label">Watched with</span>
        ${S.friends.length ? `<div class="chips">${S.friends.map((f) => `<button type="button" class="chip ${d.watchedWith?.includes(f.id) ? "on" : ""}" data-action="draft-ww" data-user="${esc(f.id)}">${esc(f.emoji)} ${esc(f.name || f.username)}</button>`).join("")}</div>` : `<p class="muted small">Add friends to tag who you watched with.</p>`}
      </div>
      <label class="note-field"><span class="rate-label">Notes</span><textarea id="draftNote" rows="2" maxlength="500" placeholder="Season 2 fell off a cliff…">${esc(d.note)}</textarea></label>
      <div class="actions">
        <button class="btn primary" data-action="save-log">${mine ? "Save changes" : "Save to my shows"}</button>
        ${mine ? `<button class="btn ghost danger" data-action="delete-log">Remove</button>` : ""}
      </div>
    </section>

    <section class="block">
      <h2 class="h2">Friends who've seen it</h2>
      ${others.length ? others.map((l) => { const p = S.people.get(l.userId); const ww = (l.watchedWith || []).map(personName); return `
        <a class="card friend-log" href="#/u/${encodeURIComponent(l.userId)}">
          ${avatar(p)}
          <div class="grow">
            <div><b>${esc(p?.name || p?.username || "Friend")}</b> <span class="muted small">· ${STATUS_LABEL[l.status]} · ${ago(l.updatedAt)}</span></div>
            ${l.score != null ? `<div>${stars(l.score, { size: "sm" })} <b>${fmt(l.score)}</b></div>` : ""}
            ${seasonChips(l.seasons)}
            ${ww.length ? `<div class="muted small">👯 with ${esc(ww.join(", "))}</div>` : ""}
            ${l.note ? `<div class="feed-note">“${esc(l.note)}”</div>` : ""}
          </div>
        </a>`; }).join("") : `<p class="muted">None of your friends have logged this yet.</p>`}
    </section>
    ${seasonCount > 1 && n.friendLogs.length ? seasonChart(s, n.friendLogs, mine) : ""}
  </article>`;
}

// little bar chart: friends' average per season vs yours
function seasonChart(s, friendLogs, mine) {
  const rows = s.seasons.map((se) => ({ n: se.n, f: avg(friendLogs.map((l) => l.seasons?.[se.n]).filter((v) => v > 0)), m: mine?.seasons?.[se.n] || null }));
  if (!rows.some((r) => r.f != null)) return "";
  return `<section class="block card">
    <h2 class="h2">Season by season</h2>
    <div class="chart" role="img" aria-label="Average rating per season">
      ${rows.map((r) => `<div class="bar-col">
        <div class="bars">
          <span class="bar f" style="height:${((r.f || 0) / 5) * 100}%" title="Friends: ${fmt(r.f)}"></span>
          ${r.m ? `<span class="bar m" style="height:${(r.m / 5) * 100}%" title="You: ${fmt(r.m)}"></span>` : ""}
        </div>
        <span class="bar-val">${fmt(r.f)}</span>
        <span class="bar-label">S${r.n}</span>
      </div>`).join("")}
    </div>
    <div class="legend"><span><i class="f"></i>Friends' avg</span>${mine ? `<span><i class="m"></i>You</span>` : ""}</div>
  </section>`;
}

function rankedList(logs, { linkUser } = {}) {
  const tabs = { ranked: (l) => l.score != null, watching: (l) => l.status === "watching", want: (l) => l.status === "want", dropped: (l) => l.status === "dropped" };
  const list = logs.filter(tabs[S.rankTab] || tabs.ranked).sort((a, b) => S.rankTab === "ranked" ? (b.score ?? 0) - (a.score ?? 0) || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt);
  const count = (k) => logs.filter(tabs[k]).length;
  return `
  <div class="seg wrap">
    ${[["ranked", "Ranked"], ["watching", "Watching"], ["want", "Want to watch"], ["dropped", "Dropped"]].map(([k, t]) => `<button class="${S.rankTab === k ? "on" : ""}" data-action="rank-tab" data-tab="${k}">${t} <small>${count(k)}</small></button>`).join("")}
  </div>
  ${list.length ? `<ol class="rank-list">${list.map((l, i) => { const s = S.shows.get(l.showId); if (!s) return ""; return `
    <li><a class="card rank-item" href="#/show/${encodeURIComponent(s.id)}">
      ${S.rankTab === "ranked" ? `<span class="rank-num">${i + 1}</span>` : ""}
      ${poster(s, "sm")}
      <div class="grow">
        <div class="rank-name">${esc(s.name)}</div>
        <div class="muted small">${esc(showMeta(s))}</div>
        ${l.score != null ? `<div>${stars(l.score, { size: "sm" })} <b>${fmt(l.score)}</b></div>` : ""}
        ${seasonChips(l.seasons)}
        ${(l.watchedWith || []).length ? `<div class="muted small">👯 with ${esc(l.watchedWith.map(personName).join(", "))}</div>` : ""}
      </div>
    </a></li>`; }).join("")}</ol>` : `<div class="empty small"><p>${linkUser ? "Nothing here yet." : `Nothing here yet. <a href="#/discover">Find a show</a> to log.`}</p></div>`}`;
}

function viewRank() {
  return `<h1 class="h1">My shows</h1>${rankedList([...S.myLogs.values()])}`;
}

function viewFriends() {
  const fids = friendIds();
  const outIds = new Set(S.requests.outgoing.map((r) => r.profile.id));
  const inIds = new Set(S.requests.incoming.map((r) => r.profile.id));
  return `
  <h1 class="h1">Friends</h1>
  <form class="searchbar" id="userSearchForm" role="search">
    <input id="userSearchInput" type="search" placeholder="Find people by name or username" value="${esc(S.userSearch.q)}" autocapitalize="none" autocomplete="off" />
  </form>
  ${S.userSearch.q ? `<section class="block">${S.userSearch.results.length ? S.userSearch.results.map((p) => `
    <div class="card person">
      ${avatar(p)}<div class="grow"><b>${esc(p.name)}</b><div class="muted small">@${esc(p.username)}</div></div>
      ${fids.has(p.id) ? `<span class="muted small">Friends ✓</span>` : outIds.has(p.id) ? `<span class="muted small">Requested</span>` : `<button class="btn small primary" data-action="add-friend" data-user="${esc(p.id)}">${inIds.has(p.id) ? "Accept" : "Add"}</button>`}
    </div>`).join("") : `<p class="muted">No one found.</p>`}</section>` : ""}
  <div class="card invite">
    <div class="grow"><b>Invite friends</b><div class="muted small">Send them the link. Your username is <b>@${esc(S.me.username)}</b>.</div></div>
    <button class="btn small" data-action="share">Share</button>
  </div>
  ${S.requests.incoming.length ? `<section class="block"><h2 class="h2">Friend requests</h2>${S.requests.incoming.map((r) => `
    <div class="card person">
      ${avatar(r.profile)}<div class="grow"><b>${esc(r.profile.name)}</b><div class="muted small">@${esc(r.profile.username)}</div></div>
      <button class="btn small primary" data-action="accept" data-id="${esc(r.id)}">Accept</button>
      <button class="btn small ghost" data-action="decline" data-user="${esc(r.profile.id)}">Decline</button>
    </div>`).join("")}</section>` : ""}
  <section class="block">
    <h2 class="h2">Your friends <span class="muted">${S.friends.length}</span></h2>
    ${S.friends.length ? S.friends.map((p) => { const c = S.logs.filter((l) => l.userId === p.id).length; const m = tasteMatch(p.id); return `
      <a class="card person" href="#/u/${encodeURIComponent(p.id)}">
        ${avatar(p)}<div class="grow"><b>${esc(p.name)}</b><div class="muted small">@${esc(p.username)} · ${c} show${c === 1 ? "" : "s"}</div></div>
        ${m ? `<span class="match" title="How closely your ratings line up on ${m.n} shared shows">${m.pct}% match</span>` : ""}
      </a>`; }).join("") : `<p class="muted">No friends yet. Search above or share your link.</p>`}
  </section>
  ${S.requests.outgoing.length ? `<section class="block"><h2 class="h2">Sent requests</h2>${S.requests.outgoing.map((r) => `
    <div class="card person">${avatar(r.profile)}<div class="grow"><b>${esc(r.profile.name)}</b><div class="muted small">@${esc(r.profile.username)} · waiting</div></div>
    <button class="btn small ghost" data-action="decline" data-user="${esc(r.profile.id)}">Cancel</button></div>`).join("")}</section>` : ""}`;
}

// how similar your scores are on shows you've both rated
function tasteMatch(userId) {
  const diffs = [];
  for (const l of S.logs) {
    if (l.userId !== userId || l.score == null) continue;
    const m = S.myLogs.get(l.showId);
    const ms = m && (m.score ?? scoreOf(m));
    if (ms != null) diffs.push(Math.abs(ms - l.score));
  }
  if (diffs.length < 2) return null;
  return { pct: Math.round(100 - (avg(diffs) / 4) * 100), n: diffs.length };
}

function viewUser(id) {
  if (id === S.me.id) { location.hash = "#/rank"; return ""; }
  const p = S.people.get(id);
  if (!p) { ensurePeople([id]); return `<p class="muted center">Loading…</p>`; }
  const isFriend = friendIds().has(id);
  const logs = S.logs.filter((l) => l.userId === id);
  const m = tasteMatch(id);
  return `
  <a class="back" href="#/friends" data-action="back">‹ Back</a>
  <header class="profile-head">
    ${avatar(p, "xl")}
    <div><h1 class="h1">${esc(p.name)}</h1><div class="muted">@${esc(p.username)}</div>
    ${m ? `<div class="match">${m.pct}% taste match · ${m.n} shows in common</div>` : ""}</div>
  </header>
  ${isFriend ? rankedList(logs, { linkUser: true }) + `<button class="btn ghost danger" data-action="unfriend" data-user="${esc(id)}">Remove friend</button>` : `
    <div class="empty small"><p>Become friends to see ${esc(p.name)}'s rankings.</p>
    <button class="btn primary" data-action="add-friend" data-user="${esc(id)}">Add friend</button></div>`}`;
}

function viewMe() {
  const mine = [...S.myLogs.values()];
  const scored = mine.map((l) => l.score).filter((x) => x != null);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return `
  <header class="profile-head">
    ${avatar(S.me, "xl")}
    <div><h1 class="h1">${esc(S.me.name)}</h1><div class="muted">@${esc(S.me.username)}</div></div>
  </header>
  <div class="score-tiles">
    <div class="tile"><span class="tile-label">Shows</span><span class="tile-num">${mine.length}</span></div>
    <div class="tile"><span class="tile-label">Avg rating</span><span class="tile-num">${fmt(avg(scored))}</span></div>
    <div class="tile"><span class="tile-label">Friends</span><span class="tile-num">${S.friends.length}</span></div>
  </div>
  <form id="profileForm" class="card form">
    <h2 class="h2">Edit profile</h2>
    <label>Name<input name="name" value="${esc(S.me.name)}" maxlength="40" required /></label>
    <label>Avatar emoji<input name="emoji" value="${esc(S.me.emoji)}" maxlength="4" required /></label>
    <button class="btn" type="submit">Save</button>
  </form>
  ${!standalone ? `<div class="card">
    <h2 class="h2">📲 Put ${esc(APP_NAME)} on your home screen</h2>
    ${S.installPrompt ? `<button class="btn primary" data-action="install">Install app</button>` : ios
      ? `<p>In Safari, tap <b>Share</b> <span aria-hidden="true">⬆️</span>, then <b>Add to Home Screen</b>.</p>`
      : `<p>In Chrome, open the <b>⋮</b> menu and tap <b>Install app</b> (or <b>Add to Home screen</b>).</p>`}
  </div>` : ""}
  <div class="card">
    <p class="muted small">${mode === "demo" ? "🧪 Demo mode: everything is saved on this device only. Signing out erases the demo so you can start over." : "Signed in. Your ratings are visible to your friends."}</p>
    <button class="btn ghost danger" data-action="sign-out">${mode === "demo" ? "Reset demo" : "Sign out"}</button>
  </div>
  <p class="muted small center">Show info from <a href="https://www.tvmaze.com" target="_blank" rel="noopener">TVmaze</a>.</p>`;
}

// ───────────────────────── render + router ─────────────────────────
function route() {
  const [, name = "feed", arg] = location.hash.match(/^#\/([^/]*)\/?(.*)$/) || [];
  return { name: name || "feed", arg: arg ? decodeURIComponent(arg) : "" };
}

let lastRoute = "";
function render() {
  if (!S.store) return;
  const r = route();
  document.body.classList.toggle("signed-out", !S.me);
  if (!S.me) { $main.innerHTML = viewAuth(); return; }
  const views = { feed: viewFeed, discover: viewDiscover, rank: viewRank, friends: viewFriends, me: viewMe, show: () => viewShow(r.arg), u: () => viewUser(r.arg) };
  const key = r.name + "/" + r.arg;
  // keep focus + caret in text inputs across re-renders
  const active = document.activeElement;
  const keepId = active && ["INPUT", "TEXTAREA"].includes(active.tagName) && active.id ? active.id : null;
  const caret = keepId ? [active.selectionStart, active.selectionEnd] : null;
  $main.innerHTML = (views[r.name] || viewFeed)();
  if (keepId) { const el = document.getElementById(keepId); if (el) { el.focus(); try { el.setSelectionRange(...caret); } catch {} } }
  if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === r.name || (r.name === "show" && a.dataset.tab === "discover") || (r.name === "u" && a.dataset.tab === "friends")));
  document.getElementById("meBtn").innerHTML = avatar(S.me);
}

function updateBadge() {
  const n = S.requests.incoming.length;
  const b = document.getElementById("friendBadge");
  b.textContent = n;
  b.hidden = !n;
}

// ───────────────────────── interactions ─────────────────────────
function starValue(el, clientX) {
  const r = el.getBoundingClientRect();
  return Math.min(5, Math.max(0.5, Math.ceil(((clientX - r.left) / r.width) * 10) / 2));
}
function setDraftStars(key, val) {
  const id = route().arg;
  const d = S.drafts.get(id);
  if (!d) return;
  if (key === "overall") d.rating = d.rating === val ? null : val;
  else { const n = key.slice(1); d.seasons = { ...d.seasons }; if (d.seasons[n] === val) delete d.seasons[n]; else d.seasons[n] = val; }
  render();
}

document.addEventListener("click", async (e) => {
  const starEl = e.target.closest("[data-stars]");
  if (starEl) { setDraftStars(starEl.dataset.stars, starValue(starEl, e.clientX)); return; }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;
  const id = route().arg;
  const d = S.drafts.get(id);
  try {
    switch (a) {
      case "auth-tab": S.authTab = el.dataset.tab; render(); break;
      case "back": if (history.length > 1) { e.preventDefault(); history.back(); } break;
      case "draft-status": d.status = el.dataset.status; render(); break;
      case "draft-ww": {
        const u = el.dataset.user;
        d.watchedWith = d.watchedWith?.includes(u) ? d.watchedWith.filter((x) => x !== u) : [...(d.watchedWith || []), u];
        render(); break;
      }
      case "save-log": {
        el.disabled = true;
        d.note = document.getElementById("draftNote")?.value.trim() || "";
        if (d.status === "want") { d.rating = null; d.seasons = {}; }
        const show = S.shows.get(id);
        await S.store.saveShow(show);
        await S.store.saveLog(d);
        S.drafts.delete(id);
        S.catalogIds.add(id);
        await refreshSocial();
        toast(S.myLogs.get(id)?.score != null ? `Saved: ${show.name} ★ ${fmt(S.myLogs.get(id).score)}` : `Saved ${show.name}`);
        break;
      }
      case "delete-log":
        if (!confirm("Remove this show from your list?")) return;
        await S.store.deleteLog(id);
        S.drafts.delete(id);
        await refreshSocial();
        toast("Removed");
        break;
      case "toggle-friends-filter": S.filters.friends = !S.filters.friends; savePref("filters", S.filters); render(); break;
      case "clear-filters": Object.assign(S.filters, { genre: "", platform: "", length: "", format: "", decade: "", status: "", friends: false }); savePref("filters", S.filters); render(); break;
      case "clear-search": S.search = { q: "", ids: null, loading: false, error: "" }; render(); break;
      case "rank-tab": S.rankTab = el.dataset.tab; render(); break;
      case "add-friend":
        e.preventDefault();
        await S.store.addFriend(el.dataset.user);
        await refreshSocial();
        toast(friendIds().has(el.dataset.user) ? "You're now friends 🎉" : "Friend request sent");
        break;
      case "accept": await S.store.acceptRequest(el.dataset.id); await refreshSocial(); toast("You're now friends 🎉"); break;
      case "decline": await S.store.removeFriendship(el.dataset.user); await refreshSocial(); break;
      case "unfriend":
        if (!confirm("Remove this friend?")) return;
        await S.store.removeFriendship(el.dataset.user);
        await refreshSocial();
        location.hash = "#/friends";
        break;
      case "share": {
        const url = location.href.split("#")[0];
        const text = `Rank TV shows with me on ${APP_NAME}! Add me: @${S.me.username}`;
        if (navigator.share) await navigator.share({ title: APP_NAME, text, url }).catch(() => {});
        else { await navigator.clipboard?.writeText(`${text} ${url}`); toast("Link copied"); }
        break;
      }
      case "install": S.installPrompt?.prompt(); S.installPrompt = null; render(); break;
      case "sign-out":
        if (mode === "demo" && !confirm("Erase the demo data on this device?")) return;
        await S.store.signOut();
        Object.assign(S, { me: null, friends: [], logs: [], myLogs: new Map(), drafts: new Map(), stats: {} });
        location.hash = "#/feed";
        if (mode === "demo") location.reload();
        render();
        break;
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "Something went wrong");
    el.disabled = false;
  }
});

// keyboard support for star sliders
document.addEventListener("keydown", (e) => {
  const el = e.target.closest?.("[data-stars]");
  if (!el || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  const cur = +el.getAttribute("aria-valuenow") || 0;
  const next = Math.min(5, Math.max(0.5, cur + (e.key === "ArrowRight" || e.key === "ArrowUp" ? 0.5 : -0.5)));
  if (next !== cur) setDraftStars(el.dataset.stars, next);
  document.querySelector(`[data-stars="${el.dataset.stars}"]`)?.focus();
});

document.addEventListener("change", (e) => {
  const f = e.target.dataset.filter;
  if (f) { S.filters[f] = e.target.value; savePref("filters", S.filters); render(); }
});

let searchTimer, searchSeq = 0;
async function runSearch(q) {
  const my = ++searchSeq;
  S.search = { ...S.search, q, loading: true, error: "" };
  render();
  try {
    const res = await searchShows(q);
    if (my !== searchSeq) return;
    addShows(res);
    S.search = { q, ids: res.map((s) => s.id), loading: false, error: "" };
    refreshStats();
  } catch (err) {
    if (my !== searchSeq) return;
    S.search = { q, ids: [], loading: false, error: "Couldn't reach the show database. Check your connection." };
  }
  render();
}

let userTimer;
document.addEventListener("input", (e) => {
  if (e.target.id === "searchInput") {
    const q = e.target.value.trim();
    S.search.q = e.target.value;
    clearTimeout(searchTimer);
    if (!q) { S.search = { q: "", ids: null, loading: false, error: "" }; render(); return; }
    searchTimer = setTimeout(() => runSearch(q), 450);
  }
  if (e.target.id === "userSearchInput") {
    S.userSearch.q = e.target.value;
    clearTimeout(userTimer);
    userTimer = setTimeout(async () => {
      S.userSearch.results = await S.store.searchUsers(S.userSearch.q).catch(() => []);
      render();
    }, 300);
  }
  if (e.target.id === "draftNote") { const d = S.drafts.get(route().arg); if (d) d.note = e.target.value; }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (form.id === "searchForm") { const q = document.getElementById("searchInput").value.trim(); if (q) { clearTimeout(searchTimer); runSearch(q); document.activeElement.blur(); } return; }
  if (form.id === "userSearchForm") return;
  const data = Object.fromEntries(new FormData(form));
  const btn = form.querySelector("[type=submit]");
  if (form.id === "profileForm") {
    S.me = await S.store.updateProfile({ name: data.name.trim(), emoji: data.emoji.trim() });
    S.people.set(S.me.id, S.me);
    toast("Profile saved");
    render();
    return;
  }
  if (form.id === "authForm") {
    const err = document.getElementById("authError");
    err.textContent = "";
    const kind = form.dataset.kind;
    try {
      btn.disabled = true;
      if (kind === "up") {
        const username = (data.username || "").trim();
        if (!data.name?.trim()) throw new Error("Add your name.");
        if (!/^[a-zA-Z0-9_.]{3,20}$/.test(username)) throw new Error("Usernames are 3–20 letters, numbers, _ or .");
        if (mode !== "demo" && (!data.email || (data.password || "").length < 6)) throw new Error("Enter an email and a password of at least 6 characters.");
        if (!(await S.store.usernameAvailable(username))) throw new Error(`@${username} is taken. Try another.`);
        const res = await S.store.signUp({ email: data.email, password: data.password, username, name: data.name.trim(), emoji: data.emoji || "📺" });
        if (res.needsConfirm) { err.textContent = "Check your email for a confirmation link, then come back and sign in."; S.authTab = "in"; btn.disabled = false; return; }
        S.me = res.me;
      } else {
        S.me = await S.store.signIn({ email: data.email, password: data.password });
      }
      await afterSignIn();
      location.hash = S.friends.length ? "#/feed" : "#/discover";
      render();
    } catch (ex) {
      err.textContent = ex.message || "Something went wrong.";
      btn.disabled = false;
    }
  }
});

window.addEventListener("hashchange", render);
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); S.installPrompt = e; });
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.me) refreshSocial().catch(() => {}); });

// ───────────────────────── boot ─────────────────────────
(async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  document.getElementById("demoRibbon").hidden = mode !== "demo";
  try {
    S.store = await createStore();
    S.me = await S.store.init();
    S.store.onAuthChange(async (me) => {
      const was = S.me?.id;
      S.me = me;
      if (me && me.id !== was) await afterSignIn();
      render();
    });
    if (S.me) await afterSignIn();
  } catch (err) {
    console.error(err);
    $main.innerHTML = `<div class="empty"><div class="empty-art">📡</div><h2>Can't connect</h2><p class="muted">${esc(err.message || err)}</p><p class="muted small">If you just set up Supabase, make sure you ran supabase.sql.</p><button class="btn primary" onclick="location.reload()">Try again</button></div>`;
    return;
  }
  render();
})();
