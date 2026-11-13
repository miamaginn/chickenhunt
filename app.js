import { createStore, isLive } from "./store.js";
import { DEFAULT_BARS, POT_PER_PERSON, MAP_AREA } from "./config.js";
import { mapsAvailable, createHuntMap, createPinEditor, searchPlaces } from "./map.js";

// ───────────────────────── helpers ─────────────────────────
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LS = {
  get(k, d = null) {
    try { const v = localStorage.getItem("ch:" + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem("ch:" + k, JSON.stringify(v)); } catch {} },
};
const pad = (n) => String(n).padStart(2, "0");
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dur = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${m}:${pad(x)}`;
};
const durWords = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m} min`;
};
const money = (n) => "$" + (Math.round(n * 100) / 100).toFixed(Number.isInteger(n) ? 0 : 2);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MASCOTS = ["🐷", "🐮", "🐑", "🐴", "🦆", "🐐", "🐰", "🦊", "🐶", "🐱", "🦃", "🐸"];

// ───────────────────────── state ─────────────────────────
const S = {
  game: {},
  teams: [],
  myVisits: [],
  allVisits: {},
  myTeamId: LS.get("myTeam"),
  view: LS.get("view", "team"),
  loaded: { game: false, teams: false },
};
let store;
let myVisitsUnsub = null, myVisitsFor = null;
const godUnsubs = new Map();
let barsDirty = false;

const barName = (b) => (typeof b === "string" ? b : b?.name || "");
const bars = () => (S.game.bars?.length ? S.game.bars : DEFAULT_BARS.map(barName)).filter(Boolean);
// Map pins: ones written in config.js, overridden by ones the chickens dropped.
function pins() {
  const m = new Map();
  DEFAULT_BARS.forEach((b) => typeof b === "object" && isFinite(b.lat) && isFinite(b.lng) && m.set(b.name, { lat: +b.lat, lng: +b.lng }));
  (S.game.barPins || []).forEach((p) => m.set(p.name, { lat: p.lat, lng: p.lng }));
  return m;
}
let huntMap = null, pinMap = null, pinSel = null;
const myTeam = () => S.teams.find((t) => t.id === S.myTeamId);
// How long after the roost something happened ("" if the chickens hadn't roosted yet).
const roostGap = (at) => (S.game.roostedAt && at >= S.game.roostedAt ? durWords(at - S.game.roostedAt) : "");
const chickenOk = () => !!S.game.chickenHash && LS.get("chickenHash") === S.game.chickenHash;
const potLeft = () => (S.game.pot?.start || 0) - (S.game.spends || []).reduce((a, s) => a + (+s.amt || 0), 0);

// ───────────────────────── boot ─────────────────────────
init();

async function init() {
  $("#demoRibbon").hidden = isLive;
  buildCreateForm();
  bindUI();
  setView(S.view);
  setInterval(tick, 1000);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  updateAlertsBtn();

  try {
    store = await createStore();
  } catch (e) {
    showFatal("Couldn't reach the coop 😿 Check your internet connection and the database settings in config.js.", e);
    return;
  }
  const onErr = (e) => showFatal("The coop's database said no 😿 Did you run supabase.sql? (see README)", e);
  store.onGame((g) => { S.game = g || {}; S.loaded.game = true; onGameChange(); render(); }, onErr);
  store.onTeams((ts) => { S.teams = ts; S.loaded.teams = true; onTeamsChange(); render(); }, onErr);
  render();
}

function showFatal(msg, err) {
  console.error(err);
  $("#statusBanner").className = "banner";
  $("#statusBanner").style.background = "var(--pink)";
  $("#statusBanner").innerHTML = `<div class="b-emoji">🙀</div><div><div class="b-title">Uh oh!</div><div class="b-sub">${esc(msg)}</div></div>`;
}

// ───────────────────────── subscriptions ─────────────────────────
function syncMyVisits() {
  const id = myTeam()?.id || null;
  if (id === myVisitsFor) return;
  myVisitsUnsub?.();
  myVisitsUnsub = null;
  myVisitsFor = id;
  S.myVisits = [];
  if (id) myVisitsUnsub = store.onVisits(id, (vs) => { S.myVisits = vs; renderTeam(); renderMap(); });
}

function syncGodVisits() {
  const want = chickenOk() ? new Set(S.teams.map((t) => t.id)) : new Set();
  for (const [id, un] of godUnsubs) if (!want.has(id)) { un(); godUnsubs.delete(id); delete S.allVisits[id]; }
  for (const id of want)
    if (!godUnsubs.has(id)) godUnsubs.set(id, store.onVisits(id, (vs) => { S.allVisits[id] = vs; renderChicken(); }));
}

// ───────────────────────── announcements ─────────────────────────
const seen = new Set(LS.get("seen", []));
const modalQueue = [];
function markSeen(k) { seen.add(k); LS.set("seen", [...seen].slice(-200)); }

function onGameChange() {
  const g = S.game;
  if (g.roostedAt)
    announce({
      key: "roost:" + g.roostedAt,
      emoji: "🐔🪺",
      title: "The chickens have roosted!",
      body: "They've settled in at their secret bar and the timer is running. Keep hunting, and remember: one drink at every bar you check! 🍺",
      big: true,
    });
  if (g.winner) {
    const w = g.winner, mine = w.teamId === S.myTeamId;
    const gap = roostGap(w.at);
    const when = gap ? `, ${gap} after the chickens roosted` : "";
    announce({
      key: `win:${w.teamId}:${w.at}`,
      emoji: "🏆",
      title: mine ? "YOU found the chickens!" : `${w.emoji || ""} ${w.name} found the chickens!`,
      body: mine
        ? `Found at ${clock(w.at)}${when}. Drinks are on the pot now! 🍻`
        : `Found at ${clock(w.at)}${when}. The pot is open and drinks are on the chickens. Race there before it runs dry! 🍻`,
      big: true,
      celebrate: true,
    });
  }
  if (g.roostedAt && potLeft() <= 0 && g.pot?.start && g.winner)
    announce({ key: "potdry:" + g.roostedAt, emoji: "🪹", title: "The pot is empty!", body: "The nest egg is all gone. Thanks for playing! 🐣", big: true });
}

function onTeamsChange() {
  if (S.loaded.teams && S.myTeamId && !myTeam()) { S.myTeamId = null; LS.set("myTeam", null); }
  for (const t of S.teams) {
    if (t.foundAt && t.findRank > 1 && Date.now() - t.foundAt < 60 * 60 * 1000) {
      const mine = t.id === S.myTeamId;
      announce({
        key: `find:${t.id}:${t.foundAt}`,
        title: mine ? `You made it! You're the ${ordinal(t.findRank)} team to find the chickens 🐔` : `${t.emoji} ${t.name} also found the chickens! (${ordinal(t.findRank)})`,
      });
    }
  }
  syncMyVisits();
  syncGodVisits();
}

function announce({ key, emoji = "🐔", title, body = "", big = false, celebrate = false }) {
  if (seen.has(key)) return;
  markSeen(key);
  cluck();
  try { navigator.vibrate?.([120, 60, 120, 60, 200]); } catch {}
  notify(title, body);
  if (big) {
    modalQueue.push({ emoji, title, body, celebrate });
    if (!$("#modalRoot").firstChild) nextAnnouncement();
  } else toast(title);
}

function nextAnnouncement() {
  const a = modalQueue.shift();
  if (!a) return;
  if (a.celebrate) feathers();
  openModal(
    `<div class="m-emoji">${a.emoji}</div><h2>${esc(a.title)}</h2><p>${esc(a.body)}</p>
     <div class="modal-actions"><button class="btn btn-primary" data-close>Bawk bawk! 🐓</button></div>`,
    { celebrate: true, onClose: nextAnnouncement }
  );
}

// ───────────────────────── sound / notifications / fx ─────────────────────────
let actx;
function audio() {
  try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === "suspended") actx.resume(); } catch {}
  return actx;
}
function cluck() {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + 0.02;
  [0, 0.13, 0.26, 0.5].forEach((d, i) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = "square";
    const f0 = i === 3 ? 900 : 620 + i * 60;
    o.frequency.setValueAtTime(f0, t0 + d);
    o.frequency.exponentialRampToValueAtTime(f0 / 2, t0 + d + (i === 3 ? 0.22 : 0.09));
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + (i === 3 ? 0.25 : 0.11));
    o.connect(g).connect(a.destination);
    o.start(t0 + d);
    o.stop(t0 + d + 0.3);
  });
}

async function notify(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !document.hidden) return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification("🐓 " + title, { body, icon: "icon.svg", badge: "icon.svg" });
    else new Notification("🐓 " + title, { body, icon: "icon.svg" });
  } catch {}
}

function updateAlertsBtn() {
  const b = $("#alertsBtn");
  if (!("Notification" in window)) {
    b.disabled = true;
    b.textContent = "🔕 This browser can't do notifications (on iPhone: Share → Add to Home Screen first)";
    b.style.whiteSpace = "normal";
  } else if (Notification.permission === "granted") {
    b.textContent = "✅ Alerts are on (tap to test)";
  } else if (Notification.permission === "denied") {
    b.textContent = "🔕 Alerts are blocked in your browser settings";
  }
}

function toast(text) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  $("#toasts").append(el);
  setTimeout(() => el.classList.add("out"), 4200);
  setTimeout(() => el.remove(), 4700);
}

function feathers() {
  const box = $("#feathers");
  const bits = ["🪶", "🪶", "🐣", "🥚", "🎉", "🌾", "🐥"];
  for (let i = 0; i < 46; i++) {
    const s = document.createElement("span");
    s.className = "feather";
    s.textContent = bits[i % bits.length];
    s.style.left = Math.random() * 100 + "vw";
    s.style.setProperty("--dx", (Math.random() * 160 - 80).toFixed(0) + "px");
    s.style.setProperty("--rot", (Math.random() * 720 - 360).toFixed(0) + "deg");
    s.style.animationDuration = (2.8 + Math.random() * 2.6).toFixed(2) + "s";
    s.style.animationDelay = (Math.random() * 1.2).toFixed(2) + "s";
    box.append(s);
    setTimeout(() => s.remove(), 7000);
  }
}

// ───────────────────────── modal ─────────────────────────
function openModal(html, { celebrate = false, onClose } = {}) {
  const root = $("#modalRoot");
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${celebrate ? "celebrate" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
  const close = () => { root.innerHTML = ""; onClose?.(); };
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop") || e.target.closest("[data-close]")) close();
  });
  return { el: root.querySelector(".modal"), close };
}

function confirmBox(title, body, yes = "Yes", { danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const m = openModal(
      `<h2>${esc(title)}</h2><p>${esc(body)}</p>
       <div class="modal-actions"><button class="btn" data-close>Cancel</button>
       <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-yes>${esc(yes)}</button></div>`,
      { onClose: () => { resolve(answer); nextAnnouncement(); } }
    );
    m.el.querySelector("[data-yes]").addEventListener("click", () => { answer = true; m.close(); });
  });
}

// ───────────────────────── team forms ─────────────────────────
function emojiGrid(container, name, selected) {
  container.innerHTML = MASCOTS.map(
    (e) => `<label><input type="radio" name="${name}" value="${e}" ${e === selected ? "checked" : ""}/><span>${e}</span></label>`
  ).join("");
}

function membersEditor(container, names) {
  container.innerHTML = "";
  const add = (val = "") => {
    const row = document.createElement("div");
    row.className = "member-row";
    row.innerHTML = `<input name="member" maxlength="30" placeholder="Name" value="${esc(val)}" />
      <button type="button" class="icon-btn" title="Remove">✕</button>`;
    row.querySelector("button").onclick = () => row.remove();
    container.insertBefore(row, addBtn);
  };
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "btn btn-small";
  addBtn.textContent = "+ Add a chick";
  addBtn.onclick = () => { add(); $$("input", container).at(-1).focus(); };
  container.append(addBtn);
  (names.length ? names : ["", ""]).forEach(add);
}
const readMembers = (container) => $$("input[name=member]", container).map((i) => i.value.trim()).filter(Boolean);

function buildCreateForm() {
  emojiGrid($("#createEmojiGrid"), "emoji", MASCOTS[Math.floor(Math.random() * MASCOTS.length)]);
  membersEditor($("#createMembers"), []);
}

function nameTaken(name, exceptId) {
  const n = name.trim().toLowerCase();
  return S.teams.some((t) => t.id !== exceptId && t.name.trim().toLowerCase() === n);
}

function editTeam() {
  const t = myTeam();
  if (!t) return;
  const m = openModal(
    `<h2>✏️ Edit your flock</h2>
     <form id="editTeamForm" autocomplete="off">
       <label class="field"><span>Team name</span><input name="name" maxlength="40" required value="${esc(t.name)}"/></label>
       <div class="field"><span>Mascot</span><div class="emoji-grid" id="editEmoji"></div></div>
       <div class="field"><span>Members</span><div class="members-editor" id="editMembers"></div></div>
       <p class="error" id="editErr"></p>
       <div class="modal-actions"><button type="button" class="btn" data-close>Cancel</button><button class="btn btn-primary">Save</button></div>
     </form>`,
    { onClose: nextAnnouncement }
  );
  emojiGrid($("#editEmoji", m.el), "emoji", t.emoji);
  membersEditor($("#editMembers", m.el), t.members || []);
  $("#editTeamForm", m.el).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, name = f.elements.namedItem("name").value.trim();
    if (nameTaken(name, t.id)) return ($("#editErr", m.el).textContent = "Another team already has that name!");
    await store.updateTeam(t.id, { name, emoji: f.emoji.value || t.emoji, members: readMembers(f) });
    m.close();
    toast("Flock updated 🐥");
  });
}

// ───────────────────────── UI events ─────────────────────────
function setView(v) {
  if (!["team", "coop", "map", "rules", "chicken"].includes(v)) v = "team";
  S.view = v;
  LS.set("view", v);
  $$(".view").forEach((s) => (s.hidden = s.dataset.view !== v));
  $$(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === v));
  window.scrollTo({ top: 0 });
  // Leaflet needs a visible container to measure itself.
  setTimeout(() => {
    if (v === "map") { renderMap(); huntMap?.refresh(); }
    if (v === "chicken") { renderPins(); pinMap?.refresh(); }
  }, 30);
}

function bindUI() {
  document.addEventListener("pointerdown", audio, { once: true });

  $$(".tabbar button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.tab)));

  $("#createTeamForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!store) return;
    const f = e.target, name = f.elements.namedItem("name").value.trim();
    if (!name) return;
    if (nameTaken(name)) return toast("A team with that name already exists 🐔 pick another!");
    const btn = f.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      const id = await store.createTeam({ name, emoji: f.emoji.value || "🐥", members: readMembers($("#createMembers")) });
      S.myTeamId = id;
      LS.set("myTeam", id);
      f.reset();
      buildCreateForm();
      toast(`Welcome to the hunt, ${name}! 🐣`);
      render();
    } finally { btn.disabled = false; }
  });

  $("#customBarForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = myTeam(), bar = e.target.bar.value.trim();
    if (!t || !bar) return;
    await store.addVisit(t.id, bar);
    e.target.reset();
    toast(`Checked ${bar}. Bottoms up! 🍺`);
  });

  // Chicken lock
  $("#chickenLock").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = $("#lockInput").value;
    if (!pass) return;
    const h = await sha256("chickenhunt:" + pass);
    if (!S.game.chickenHash) {
      await store.updateGame({ chickenHash: h });
      LS.set("chickenHash", h);
      toast("Passcode set. Welcome, chicken! 🐔");
    } else if (h === S.game.chickenHash) {
      LS.set("chickenHash", h);
      toast("Welcome back, chicken! 🐔");
    } else {
      $("#lockError").textContent = "Bawk! That's not it. 🙅";
      return;
    }
    $("#lockInput").value = "";
    $("#lockError").textContent = "";
    syncGodVisits();
    render();
  });

  $("#potStartForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = parseFloat(e.target.start.value);
    if (!(v >= 0)) return;
    await store.updateGame({ pot: { start: v } });
    e.target.reset();
    toast(`Pot set to ${money(v)} 💰`);
  });

  $("#spendForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amt = parseFloat(e.target.amt.value);
    if (!(amt > 0)) return;
    await spend(amt, e.target.note.value.trim());
    e.target.reset();
  });

  $("#barsEditor").addEventListener("input", () => (barsDirty = true));

  $("#pinBar").addEventListener("change", (e) => {
    pinSel = e.target.value;
    $("#pinSearch").value = [pinSel, MAP_AREA].filter(Boolean).join(", ");
    $("#pinResults").innerHTML = "";
    const p = pins().get(pinSel);
    if (p) pinMap?.flyTo(p.lat, p.lng);
    renderPins();
  });

  $("#pinSearchForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#pinSearch").value.trim();
    if (!q) return;
    const out = $("#pinResults");
    out.innerHTML = `<li class="hint">Searching… 🔎</li>`;
    try {
      const rs = await searchPlaces(q);
      out.innerHTML = rs.length
        ? rs.map((r) => `<li><button type="button" data-action="pick-place" data-lat="${r.lat}" data-lng="${r.lng}">📍 ${esc(r.name)}</button></li>`).join("")
        : `<li class="hint">Nothing found. Try adding the street or city, or just tap the map.</li>`;
    } catch {
      out.innerHTML = `<li class="hint">Search isn't working right now. Tap the map to drop the pin instead.</li>`;
    }
  });

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el || !store) return;
    const a = el.dataset.action, id = el.dataset.id;
    const t = myTeam();
    switch (a) {
      case "join": {
        S.myTeamId = id;
        LS.set("myTeam", id);
        const team = S.teams.find((x) => x.id === id);
        toast(`You joined ${team?.emoji || ""} ${team?.name || "the team"}!`);
        render();
        break;
      }
      case "leave":
        if (await confirmBox("Switch teams?", "This only changes which team this phone is following. Your team and its bars stay put.", "Switch")) {
          S.myTeamId = null;
          LS.set("myTeam", null);
          render();
        }
        break;
      case "edit-team": editTeam(); break;
      case "visit":
        if (!t) return;
            el.disabled = true;
        await store.addVisit(t.id, el.dataset.bar);
        toast(`Checked ${el.dataset.bar}. Bottoms up! 🍺`);
        break;
      case "unvisit":
        if (t && (await confirmBox("Undo this bar?", "Remove this bar from your crawl?", "Undo it"))) await store.removeVisit(t.id, id);
        break;
      case "found":
        if (!t) return;
        if (await confirmBox("You found the chickens?! 🐔", "Only tap this if you're standing next to the chickens right now. Everyone will be notified. No fibbing!", "YES, we found them!")) {
          const r = await store.claimFind(t.id);
          if (r.rank > 1) toast(`You're the ${ordinal(r.rank)} team to find the chickens! 🐔`);
        }
        break;
      case "alerts":
        if (!("Notification" in window)) return;
        audio();
        if (Notification.permission === "granted") { cluck(); toast("🔔 This is what an alert sounds like!"); }
        else { await Notification.requestPermission(); updateAlertsBtn(); if (Notification.permission === "granted") { cluck(); toast("🔔 Alerts on!"); } }
        break;

      // ── chickens ──
      case "roost":
        if (await confirmBox("Roosted? 🪺", "This starts the timer and pings every hunter that you've settled in!", "We've roosted! Start the hunt")) {
          await store.updateGame({ roostedAt: Date.now() });
        }
        break;
      case "unroost":
        if (await confirmBox("Un-roost?", "This stops the hunt timer (bar visits stay).", "Un-roost", { danger: true }))
          await store.updateGame({ roostedAt: null });
        break;
      case "spend": await spend(parseFloat(el.dataset.amt), ""); break;
      case "unspend": {
        const spends = [...(S.game.spends || [])];
        spends.splice(+el.dataset.i, 1);
        await store.updateGame({ spends });
        break;
      }
      case "save-bars": {
        const list = $("#barsEditor").value.split("\n").map((s) => s.trim()).filter(Boolean);
        if (!list.length) return toast("The bar list can't be empty!");
        await store.updateGame({ bars: list });
        barsDirty = false;
        toast(`Saved ${plural(list.length, "bar")} 🗺️`);
        break;
      }
      case "chick-find": await store.claimFind(id); break;
      case "chick-unfind":
        if (await confirmBox("Undo this find?", "Mark this team as not having found you yet?", "Undo", { danger: true })) await store.unFind(id);
        break;
      case "chick-del": {
        const team = S.teams.find((x) => x.id === id);
        if (await confirmBox(`Delete ${team?.name}?`, "This removes the team and all of its bar visits.", "Delete", { danger: true })) await store.deleteTeam(id);
        break;
      }
      case "reset-hunt":
        if (await confirmBox("Restart the hunt?", "Clears the timer, winner, pot spending and every team's bars. Teams stay.", "Restart", { danger: true })) {
          await store.resetHunt(false);
          toast("Fresh hunt! 🥚");
        }
        break;
      case "wipe-all":
        if (await confirmBox("Delete EVERYTHING?", "All teams, bars, and the hunt are deleted. The passcode and bar list stay.", "Delete it all", { danger: true })) {
          await store.resetHunt(true);
          toast("Coop swept clean 🧹");
        }
        break;
      case "locate":
        huntMap?.locate((msg) => toast(msg));
        break;
      case "fit-map": huntMap?.fit(); break;
      case "pick-place":
        await placePin({ lat: +el.dataset.lat, lng: +el.dataset.lng });
        pinMap?.flyTo(+el.dataset.lat, +el.dataset.lng);
        $("#pinResults").innerHTML = "";
        break;
      case "unpin":
        if (!pinSel) return;
        await store.updateGame({ barPins: (S.game.barPins || []).filter((p) => p.name !== pinSel) });
        toast(`Removed the pin for ${pinSel}`);
        break;
      case "lock":
        LS.set("chickenHash", null);
        syncGodVisits();
        render();
        break;
    }
  });
}

async function placePin({ lat, lng }) {
  if (!pinSel || !store) return toast("Pick a bar first!");
  const round = (n) => Math.round(n * 1e6) / 1e6;
  const name = pinSel, isNew = !pins().has(name);
  const rest = (S.game.barPins || []).filter((p) => p.name !== name);
  await store.updateGame({ barPins: [...rest, { name, lat: round(lat), lng: round(lng) }] });
  toast(`📍 Pinned ${name}`);
  // Setting up from scratch? Hop to the next bar that still needs a pin.
  if (isNew) {
    const pm = pins(), next = bars().find((b) => !pm.has(b) && b !== name);
    if (next && pinSel === name) {
      pinSel = next;
      $("#pinSearch").value = [next, MAP_AREA].filter(Boolean).join(", ");
      $("#pinResults").innerHTML = "";
      renderPins();
    }
  }
}

async function spend(amt, note) {
  if (!(amt > 0)) return;
  const spends = [...(S.game.spends || []), { amt, note, at: Date.now() }];
  await store.updateGame({ spends });
  toast(`Paid ${money(amt)} from the pot 🍻`);
}

// ───────────────────────── rendering ─────────────────────────
function render() {
  renderBanner();
  tick();
  renderTeam();
  renderCoop();
  renderChicken();
  renderMap();
}

function renderMap() {
  if (S.view !== "map" || !S.loaded.game) return;
  const empty = $("#mapEmpty");
  if (!mapsAvailable()) {
    empty.hidden = false;
    empty.textContent = "The map couldn't load 😿 Check your internet connection.";
    return;
  }
  huntMap ||= createHuntMap($("#huntMap"));
  const visited = new Map();
  if (myTeam()) S.myVisits.forEach((v) => !visited.has(v.bar) && visited.set(v.bar, v));
  const n = huntMap.update({ bars: bars(), pins: pins(), visited });
  $("#mapCount").textContent = n ? `${n} ${n === 1 ? "bar" : "bars"} pinned` : "";
  empty.hidden = n > 0;
  if (!n) empty.innerHTML = "🪺<br/>No bars are pinned yet.<br/>The chickens can add pins from the 🐔 tab.";
}

function renderPins() {
  if (S.view !== "chicken" || !chickenOk() || !mapsAvailable()) return;
  const list = bars(), pm = pins();
  if (!pinSel || !list.includes(pinSel)) {
    pinSel = list.find((b) => !pm.has(b)) || list[0];
    $("#pinSearch").value = [pinSel, MAP_AREA].filter(Boolean).join(", ");
  }
  const sel = $("#pinBar");
  if (document.activeElement !== sel)
    sel.innerHTML = list.map((b, i) => `<option value="${esc(b)}" ${b === pinSel ? "selected" : ""}>${pm.has(b) ? "📍" : "⚪️"} ${i + 1}. ${esc(b)}</option>`).join("");
  $("#pinCount").textContent = `${list.filter((b) => pm.has(b)).length} of ${list.length} pinned`;
  $("#unpinBtn").hidden = !pm.has(pinSel);
  pinMap ||= createPinEditor($("#pinMap"), { onPlace: placePin });
  pinMap.update({ bars: list, pins: pm, selected: pinSel });
}

function tick() {
  const pill = $("#timerPill");
  const g = S.game;
  if (g.roostedAt) {
    pill.classList.add("live");
    pill.textContent = "⏱️ " + dur(Date.now() - g.roostedAt);
  } else {
    pill.classList.remove("live");
    pill.textContent = S.loaded.game ? "🪺 not roosted" : "🥚 loading…";
  }
  $$("[data-since]").forEach((el) => (el.textContent = dur(Date.now() - +el.dataset.since)));
}

function renderBanner() {
  if (!S.loaded.game) return;
  const g = S.game, b = $("#statusBanner");
  b.style.background = "";
  if (g.winner) {
    const w = g.winner;
    const gap = roostGap(w.at);
    const after = gap ? ` (${gap} after roosting)` : "";
    const pot = g.pot?.start ? ` · ${money(Math.max(0, potLeft()))} left in the pot` : "";
    b.className = "banner won";
    b.innerHTML = `<div class="b-emoji">🏆</div><div><div class="b-title">${esc(w.emoji || "")} ${esc(w.name)} found the chickens!</div>
      <div class="b-sub">at ${clock(w.at)}${after}. Race there before the pot runs out!${pot}</div></div>`;
  } else if (g.roostedAt) {
    b.className = "banner live";
    b.innerHTML = `<div class="b-emoji">🐔</div><div><div class="b-title">The chickens have roosted!</div>
      <div class="b-sub">Roosted at ${clock(g.roostedAt)} · hunting for <b data-since="${g.roostedAt}">${dur(Date.now() - g.roostedAt)}</b></div></div>`;
  } else {
    b.className = "banner waiting";
    b.innerHTML = `<div class="b-emoji">🪺</div><div><div class="b-title">The chickens haven't roosted yet…</div>
      <div class="b-sub">Once the hunt begins, start searching and log every bar you check. The timer starts when the chickens settle in. 🔊</div></div>`;
  }
}

function renderTeam() {
  const t = myTeam();
  $("#welcome").hidden = !!t;
  $("#myTeam").hidden = !t;

  if (!t) {
    $("#joinList").innerHTML = S.teams.length
      ? S.teams.map((x) => `<li class="join-item"><div class="avatar sm">${esc(x.emoji)}</div>
          <div class="info"><div class="name">${esc(x.name)}</div><div class="members">${esc((x.members || []).join(" · ") || "no members yet")}</div></div>
          <button class="btn btn-small btn-primary" data-action="join" data-id="${x.id}">Join</button></li>`).join("")
      : `<li class="empty">${S.loaded.teams ? "No teams yet. Be the first to hatch one! 🥚" : "Loading the coop…"}</li>`;
    return;
  }

  $("#teamHeader").innerHTML = `<div class="avatar">${esc(t.emoji)}</div>
    <div class="info"><h1>${esc(t.name)}</h1>
      <div class="members">${esc((t.members || []).join(" · ") || "Add your flock members!")}</div>
      <div class="team-actions"><button class="link-btn" data-action="edit-team">✏️ Edit flock</button>
      <button class="link-btn" data-action="leave">↔️ Switch team</button></div></div>`;

  const list = bars();
  const byBar = new Map();
  S.myVisits.forEach((v) => !byBar.has(v.bar) && byBar.set(v.bar, v));
  const extras = S.myVisits.filter((v) => !list.includes(v.bar));
  const row = (name, v, n) => `<li class="bar ${v ? "visited" : ""}">
      <span class="bar-num">${v ? "✓" : n}</span><span class="bar-name">${esc(name)}</span>
      ${v
        ? `<span class="stamp">${clock(v.at)}</span><button class="icon-btn" data-action="unvisit" data-id="${v.id}" title="Undo" aria-label="Undo">↩︎</button>`
        : `<button class="btn btn-small" data-action="visit" data-bar="${esc(name)}">🍺 We're here</button>`}
    </li>`;
  $("#barList").innerHTML = list.map((b, i) => row(b, byBar.get(b), i + 1)).join("") + extras.map((v) => row(v.bar, v, "★")).join("");
  $("#barProgress").textContent = `${S.myVisits.length} of ${list.length} checked`;

  let found;
  if (t.foundAt) {
    const won = S.game.winner?.teamId === t.id;
    const gap = roostGap(t.foundAt);
    const after = gap ? ` (${gap} after the chickens roosted)` : S.game.roostedAt ? "" : " (before they even roosted! 😱)";
    found = `<div class="card found-card done"><div class="big">${won ? "🏆" : "🐔"}</div>
      <h2>${won ? "You found the chickens first!" : `You were the ${ordinal(t.findRank)} team to find the chickens!`}</h2>
      <p>Found at ${clock(t.foundAt)}${after}, ${plural(t.barCount || 0, "bar")} in. ${won ? "Drinks are on the pot! 🍻" : "Grab a drink before the pot runs out! 🍻"}</p></div>`;
  } else {
    found = `<button class="btn btn-huge" data-action="found">🐔 WE FOUND THE CHICKENS!</button>`;
  }
  $("#foundArea").innerHTML = found;
}

function potCard() {
  const p = S.game.pot;
  if (!p?.start) return "";
  const left = potLeft(), pct = Math.max(0, Math.min(100, (left / p.start) * 100));
  return `<div class="pot-row"><span>🪙 Nest egg</span><span class="pot-big">${money(Math.max(0, left))}</span></div>
    <div class="pot-meter" role="progressbar" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
    <div class="hint">${money(p.start)} to start · ${money(p.start - left)} spent${left <= 0 ? " · the pot is dry! 🪹" : ""}</div>`;
}

function renderCoop() {
  const g = S.game;
  $("#winnerCard").innerHTML = g.winner
    ? `<div class="card winner-card"><div class="trophy">🏆</div><h2>${esc(g.winner.emoji || "")} ${esc(g.winner.name)}</h2>
       <p>Found the chickens at <b>${clock(g.winner.at)}</b>${roostGap(g.winner.at) ? `, <b>${roostGap(g.winner.at)}</b> after they roosted` : ""}.</p></div>`
    : "";
  const pc = potCard();
  $("#potCard").innerHTML = pc ? `<div class="card">${pc}</div>` : "";

  const teams = [...S.teams].sort((a, b) => {
    if (a.foundAt && b.foundAt) return a.findRank - b.findRank;
    if (a.foundAt || b.foundAt) return a.foundAt ? -1 : 1;
    return (b.barCount || 0) - (a.barCount || 0) || (a.createdAt || 0) - (b.createdAt || 0);
  });
  $("#coopCount").textContent = S.teams.length ? plural(S.teams.length, "team") : "";
  $("#coopList").innerHTML = teams.length
    ? teams.map((t) => {
        const n = t.barCount || 0, mine = t.id === S.myTeamId;
        const score = t.foundAt
          ? `<div class="count">${t.findRank === 1 ? "🏆" : "🐔"}</div><div class="small">${ordinal(t.findRank)} · ${clock(t.foundAt)}</div>`
          : `<div class="count">${n}</div><div class="small">${n === 1 ? "bar" : "bars"} checked</div><div class="beers">${"🍺".repeat(Math.min(n, 10)) || "🪺"}</div>`;
        return `<li class="coop-team ${mine ? "mine" : ""} ${t.foundAt ? "found" : ""}">
          <div class="avatar sm">${esc(t.emoji)}</div>
          <div class="info"><div class="name">${esc(t.name)} ${mine ? '<span class="chip">you</span>' : ""}</div>
          <div class="members">${esc((t.members || []).join(" · "))}</div></div>
          <div class="score">${score}</div></li>`;
      }).join("")
    : `<li class="empty">${S.loaded.teams ? "The coop is empty. Go hatch a team! 🥚" : "Loading…"}</li>`;
}

function renderChicken() {
  if (!S.loaded.game) return;
  const ok = chickenOk();
  $("#chickenLock").hidden = ok;
  $("#chickenPanel").hidden = !ok;
  if (!ok) {
    const first = !S.game.chickenHash;
    $("#lockTitle").textContent = first ? "Set up the hen house" : "Chickens only!";
    $("#lockHint").textContent = first
      ? "No passcode yet. Chickens: choose a secret passcode to lock this panel. Share it only with your fellow chicken!"
      : "Hunters, shoo! 🐾 Chickens: enter your passcode.";
    $("#lockBtn").textContent = first ? "Set passcode" : "Enter the hen house";
    return;
  }

  const g = S.game;
  $("#roostCtl").innerHTML = g.roostedAt
    ? `<h2>🪺 Roosted at ${clock(g.roostedAt)}</h2>
       <p>Hunting for <b data-since="${g.roostedAt}">${dur(Date.now() - g.roostedAt)}</b>. ${g.winner ? `First found by ${esc(g.winner.emoji || "")} <b>${esc(g.winner.name)}</b> at ${clock(g.winner.at)}.` : "No one has found you yet. 🤫"}</p>
       <button class="btn btn-small btn-ghost" data-action="unroost">Undo roost</button>`
    : `<h2>🐔 Ready to roost?</h2><p>Once you're settled at your secret bar, tap this. Every hunter gets pinged and the timer starts.</p>
       <button class="btn btn-huge" data-action="roost">🪺 We've roosted! Start the hunt</button>`;

  $("#potSummary").innerHTML = potCard() || `<p class="hint">No pot set yet.</p>`;
  const people = S.teams.reduce((a, t) => a + (t.members?.length || 0), 0) + 2;
  $("#potSuggest").textContent = `${people} people (incl. 2 chickens) × ${money(POT_PER_PERSON)} = ${money(people * POT_PER_PERSON)}`;
  const spends = g.spends || [];
  $("#spendList").innerHTML = spends
    .map((s, i) => ({ s, i }))
    .reverse()
    .map(({ s, i }) => `<li><span>${clock(s.at)}</span><span class="what">${esc(s.note || "Drink")}</span><b>-${money(+s.amt)}</b>
      <button class="icon-btn" data-action="unspend" data-i="${i}" aria-label="Remove">✕</button></li>`)
    .join("");

  renderPins();
  const ed = $("#barsEditor");
  if (!barsDirty && document.activeElement !== ed) ed.value = bars().join("\n");

  $("#godView").innerHTML = S.teams.length
    ? S.teams.map((t) => {
        const vs = S.allVisits[t.id] || [];
        return `<div class="god-team"><header><div class="avatar sm">${esc(t.emoji)}</div>
          <div class="info"><div class="name"><b>${esc(t.name)}</b></div><div class="members">${esc((t.members || []).join(" · "))}</div></div>
          <div class="score"><div class="count">${t.foundAt ? (t.findRank === 1 ? "🏆" : "🐔") : vs.length}</div></div></header>
          ${vs.length ? `<ul>${vs.map((v) => `<li>${esc(v.bar)} <span class="muted">${clock(v.at)}</span></li>`).join("")}</ul>` : `<p class="hint">No bars yet.</p>`}
          <div class="actions">${t.foundAt
            ? `<span class="muted">Found ${clock(t.foundAt)} (${ordinal(t.findRank)})</span><button class="btn btn-small" data-action="chick-unfind" data-id="${t.id}">Undo find</button>`
            : `<button class="btn btn-small" data-action="chick-find" data-id="${t.id}">They found us!</button>`}
          <button class="btn btn-small btn-danger" data-action="chick-del" data-id="${t.id}">Delete</button></div></div>`;
      }).join("")
    : `<p class="empty">No teams yet.</p>`;
}
