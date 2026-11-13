// Data layer. Two interchangeable backends with the same API:
//   • Supabase (live, shared between everyone's phones)  ← set up via supabase.sql
//   • Firebase Firestore (alternative)
//   • Local demo mode (localStorage, synced between tabs on one device)
//
// Layout (Firestore):
//   games/{GAME_ID}                          → game doc (roost time, winner, pot, bars…)
//   games/{GAME_ID}/teams/{teamId}           → team (name, emoji, members, barCount, foundAt…)
//   games/{GAME_ID}/teams/{teamId}/visits/…  → which bars that team has checked
//
// Other teams only ever subscribe to the team docs (which hold a bar *count*),
// never to another team's visits, so the dashboard doesn't show who went where.

import { SUPABASE_URL, SUPABASE_KEY, FIREBASE_CONFIG, GAME_ID } from "./config.js";

export const backend = SUPABASE_URL && SUPABASE_KEY ? "supabase" : FIREBASE_CONFIG?.apiKey ? "firebase" : "demo";
export const isLive = backend !== "demo";

export function createStore() {
  if (backend === "supabase") return supabaseStore();
  if (backend === "firebase") return firebaseStore();
  return localStore();
}

const HUNT_RESET = { roostedAt: null, winner: null, findCount: 0, spends: [] };
const TEAM_RESET = { barCount: 0, foundAt: null, findRank: null, lastVisitAt: null };
const byTime = (a, b) => (a.at || 0) - (b.at || 0);
const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);

// ───────────────────────── Supabase ─────────────────────────
// Tables + functions come from supabase.sql. Realtime events tell us
// "something changed" and we re-fetch; we also re-fetch after our own writes,
// when the phone wakes up, and every 30s as a safety net for flaky bar Wi-Fi.
async function supabaseStore() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  const call = async (fn, args) => ok(await sb.rpc(fn, args));

  const refetchers = new Set();
  const kick = () => refetchers.forEach((r) => r());
  document.addEventListener("visibilitychange", () => !document.hidden && kick());
  setInterval(() => !document.hidden && kick(), 30000);

  function live(table, load, cb, onErr) {
    let alive = true, seq = 0, first = true;
    const run = async () => {
      const my = ++seq;
      try {
        const d = await load();
        if (alive && my === seq) cb(d);
      } catch (e) {
        if (first && onErr) onErr(e); else console.warn(e);
      }
      first = false;
    };
    const ch = sb
      .channel(`${table}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, run)
      .subscribe((status) => status === "SUBSCRIBED" && run());
    refetchers.add(run);
    run();
    return () => { alive = false; refetchers.delete(run); sb.removeChannel(ch); };
  }

  const teamRow = (r) => ({ id: r.id, ...r.data, createdAt: r.data.createdAt ?? Date.parse(r.created_at) });
  const write = async (p) => { const r = await p; kick(); return r; };

  return {
    onGame: (cb, onErr) =>
      live("ch_games", async () => ok(await sb.from("ch_games").select("data").eq("id", GAME_ID).maybeSingle())?.data || {}, cb, onErr),
    onTeams: (cb, onErr) =>
      live("ch_teams", async () => ok(await sb.from("ch_teams").select("id,data,created_at").eq("game_id", GAME_ID)).map(teamRow).sort(byCreated), cb, onErr),
    onVisits: (id, cb) =>
      live("ch_visits", async () => ok(await sb.from("ch_visits").select("id,bar,at").eq("team_id", id)).map((v) => ({ ...v, at: +v.at })).sort(byTime), cb),

    createTeam: (data) =>
      write((async () => ok(await sb.from("ch_teams").insert({ game_id: GAME_ID, data: { ...data, ...TEAM_RESET, createdAt: Date.now() } }).select("id").single()).id)()),
    updateTeam: (id, patch) => write(call("ch_update_team", { tid: id, patch })),
    deleteTeam: (id) => write((async () => ok(await sb.from("ch_teams").delete().eq("id", id)))()),
    addVisit: (id, bar) => write(call("ch_add_visit", { gid: GAME_ID, tid: id, bar_name: bar, at_ms: Date.now() })),
    removeVisit: (id, visitId) => write(call("ch_remove_visit", { tid: id, vid: visitId })),
    updateGame: (patch) => write(call("ch_update_game", { gid: GAME_ID, patch })),
    claimFind: (id) => write(call("ch_claim_find", { gid: GAME_ID, tid: id, at_ms: Date.now() })),
    unFind: (id) => write(call("ch_unfind", { gid: GAME_ID, tid: id })),
    resetHunt: (wipe) => write(call("ch_reset_hunt", { gid: GAME_ID, wipe: !!wipe })),
  };
}

// ───────────────────────── Firebase ─────────────────────────
async function firebaseStore() {
  const V = "10.12.2";
  const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`);
  const f = await import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`);

  const db = f.getFirestore(initializeApp(FIREBASE_CONFIG));
  const gameRef = f.doc(db, "games", GAME_ID);
  const teamsCol = f.collection(gameRef, "teams");
  const teamRef = (id) => f.doc(teamsCol, id);
  const visitsCol = (id) => f.collection(teamRef(id), "visits");
  const rows = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  return {
    onGame: (cb, onErr) => f.onSnapshot(gameRef, (s) => cb(s.exists() ? s.data() : {}), onErr),
    onTeams: (cb, onErr) => f.onSnapshot(teamsCol, (s) => cb(rows(s).sort(byCreated)), onErr),
    onVisits: (id, cb) => f.onSnapshot(visitsCol(id), (s) => cb(rows(s).sort(byTime))),

    async createTeam(data) {
      const ref = await f.addDoc(teamsCol, { ...data, ...TEAM_RESET, createdAt: Date.now() });
      return ref.id;
    },
    updateTeam: (id, patch) => f.updateDoc(teamRef(id), patch),
    async deleteTeam(id) {
      const vs = await f.getDocs(visitsCol(id));
      const b = f.writeBatch(db);
      vs.forEach((d) => b.delete(d.ref));
      b.delete(teamRef(id));
      await b.commit();
    },

    async addVisit(id, bar) {
      const now = Date.now();
      const b = f.writeBatch(db);
      b.set(f.doc(visitsCol(id)), { bar, at: now });
      b.update(teamRef(id), { barCount: f.increment(1), lastVisitAt: now });
      await b.commit();
    },
    async removeVisit(id, visitId) {
      const b = f.writeBatch(db);
      b.delete(f.doc(visitsCol(id), visitId));
      b.update(teamRef(id), { barCount: f.increment(-1) });
      await b.commit();
    },

    updateGame: (patch) => f.setDoc(gameRef, patch, { merge: true }),

    // First team to claim becomes the winner; the transaction makes sure two
    // teams tapping at the same moment can't both be #1.
    claimFind: (id) =>
      f.runTransaction(db, async (tx) => {
        const g = await tx.get(gameRef);
        const t = await tx.get(teamRef(id));
        if (!t.exists()) throw new Error("Team not found");
        const team = t.data();
        if (team.foundAt) return { rank: team.findRank, already: true };
        const game = g.exists() ? g.data() : {};
        const now = Date.now();
        const rank = (game.findCount || 0) + 1;
        tx.update(teamRef(id), { foundAt: now, findRank: rank });
        const gp = { findCount: rank };
        if (!game.winner) gp.winner = { teamId: id, name: team.name, emoji: team.emoji, at: now };
        tx.set(gameRef, gp, { merge: true });
        return { rank };
      }),

    async unFind(id) {
      const g = await f.getDoc(gameRef);
      await f.updateDoc(teamRef(id), { foundAt: null, findRank: null });
      if (g.exists() && g.data().winner?.teamId === id) await f.setDoc(gameRef, { winner: null }, { merge: true });
    },

    async resetHunt(wipeTeams) {
      const ts = await f.getDocs(teamsCol);
      for (const t of ts.docs) {
        const vs = await f.getDocs(visitsCol(t.id));
        const b = f.writeBatch(db);
        vs.forEach((d) => b.delete(d.ref));
        if (wipeTeams) b.delete(t.ref);
        else b.update(t.ref, TEAM_RESET);
        await b.commit();
      }
      await f.setDoc(gameRef, HUNT_RESET, { merge: true });
    },
  };
}

// ───────────────────────── Local demo ─────────────────────────
function localStore() {
  const KEY = `chickenhunt-demo:${GAME_ID}`;
  const blank = () => ({ game: {}, teams: {}, visits: {} });
  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || blank(); } catch { return blank(); }
  };
  let st = load();
  const L = { game: new Set(), teams: new Set(), visits: new Map() };
  let chan = null;
  try { chan = new BroadcastChannel(KEY); } catch {}

  const emit = () => {
    L.game.forEach((cb) => cb({ ...st.game }));
    const teams = Object.entries(st.teams).map(([id, t]) => ({ id, ...t })).sort(byCreated);
    L.teams.forEach((cb) => cb(teams));
    L.visits.forEach((set, id) => {
      const vs = Object.entries(st.visits[id] || {}).map(([vid, v]) => ({ id: vid, ...v })).sort(byTime);
      set.forEach((cb) => cb(vs));
    });
  };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {}
    try { chan && chan.postMessage("changed"); } catch {}
    setTimeout(emit, 0);
  };
  const reload = () => { st = load(); emit(); };
  if (chan) chan.onmessage = reload;
  window.addEventListener("storage", (e) => e.key === KEY && reload());

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const sub = (set, cb) => { set.add(cb); setTimeout(emit, 0); return () => set.delete(cb); };

  return {
    onGame: (cb) => sub(L.game, cb),
    onTeams: (cb) => sub(L.teams, cb),
    onVisits(id, cb) {
      if (!L.visits.has(id)) L.visits.set(id, new Set());
      return sub(L.visits.get(id), cb);
    },
    async createTeam(data) {
      const id = uid();
      st.teams[id] = { ...data, ...TEAM_RESET, createdAt: Date.now() };
      save();
      return id;
    },
    async updateTeam(id, patch) { Object.assign(st.teams[id], patch); save(); },
    async deleteTeam(id) { delete st.teams[id]; delete st.visits[id]; save(); },
    async addVisit(id, bar) {
      const now = Date.now();
      (st.visits[id] ||= {})[uid()] = { bar, at: now };
      st.teams[id].barCount = (st.teams[id].barCount || 0) + 1;
      st.teams[id].lastVisitAt = now;
      save();
    },
    async removeVisit(id, vid) {
      if (st.visits[id]?.[vid]) {
        delete st.visits[id][vid];
        st.teams[id].barCount = Math.max(0, (st.teams[id].barCount || 1) - 1);
      }
      save();
    },
    async updateGame(patch) { Object.assign(st.game, patch); save(); },
    async claimFind(id) {
      const team = st.teams[id];
      if (team.foundAt) return { rank: team.findRank, already: true };
      const now = Date.now();
      const rank = (st.game.findCount || 0) + 1;
      Object.assign(team, { foundAt: now, findRank: rank });
      st.game.findCount = rank;
      if (!st.game.winner) st.game.winner = { teamId: id, name: team.name, emoji: team.emoji, at: now };
      save();
      return { rank };
    },
    async unFind(id) {
      Object.assign(st.teams[id], { foundAt: null, findRank: null });
      if (st.game.winner?.teamId === id) st.game.winner = null;
      save();
    },
    async resetHunt(wipeTeams) {
      st.visits = {};
      if (wipeTeams) st.teams = {};
      else Object.values(st.teams).forEach((t) => Object.assign(t, TEAM_RESET));
      Object.assign(st.game, HUNT_RESET);
      save();
    },
  };
}
