// Data layer with two interchangeable backends that share one API:
//   • Supabase  (real accounts, shared between everyone)  ← set up with supabase.sql
//   • Demo      (localStorage on this device, with pretend friends)
//
// A "log" is one person's entry for one show:
//   { userId, showId, status: "watching"|"finished"|"want"|"dropped",
//     rating: 0.5–5 | null,          overall stars (optional)
//     seasons: { "1": 5, "2": 3 },    stars per season (optional)
//     watchedWith: [userId…], note, score, updatedAt }
// `score` is the number used for rankings: the overall rating, or if that's
// empty, the average of the season ratings.

import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

export const mode = SUPABASE_URL && SUPABASE_KEY ? "supabase" : "demo";

export function scoreOf(log) {
  if (log.rating) return +log.rating;
  const vals = Object.values(log.seasons || {}).filter((v) => v > 0);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
}

export function createStore() {
  return mode === "supabase" ? supabaseStore() : demoStore();
}

// ───────────────────────── Supabase ─────────────────────────
async function supabaseStore() {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm");
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
  const ok = ({ data, error }) => { if (error) throw error; return data; };
  let me = null;

  const profileRow = (r) => r && { id: r.id, username: r.username, name: r.name, emoji: r.emoji };
  const logRow = (r) => ({
    userId: r.user_id, showId: r.show_id, status: r.status, rating: r.rating == null ? null : +r.rating,
    seasons: r.seasons || {}, watchedWith: r.watched_with || [], note: r.note || "",
    score: r.score == null ? null : +r.score, updatedAt: Date.parse(r.updated_at),
  });
  const LOG_COLS = "user_id,show_id,status,rating,seasons,watched_with,note,score,updated_at";

  async function loadMe() {
    const { data } = await sb.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return (me = null);
    me = profileRow(ok(await sb.from("tv_profiles").select("*").eq("id", uid).maybeSingle()));
    if (!me) {
      // Profile is normally made by a database trigger at sign-up; make it here if that was skipped.
      const m = data.session.user.user_metadata || {};
      me = profileRow(ok(await sb.from("tv_profiles").insert({ id: uid, username: m.username || `user${uid.slice(0, 6)}`, name: m.name || "", emoji: m.emoji || "📺" }).select().single()));
    }
    return me;
  }

  async function friendships() {
    return ok(await sb.from("tv_friendships").select("id,requester,addressee,status").or(`requester.eq.${me.id},addressee.eq.${me.id}`));
  }
  async function profiles(ids) {
    if (!ids.length) return [];
    return ok(await sb.from("tv_profiles").select("*").in("id", ids)).map(profileRow);
  }

  return {
    mode: "supabase",
    me: () => me,
    init: loadMe,
    onAuthChange: (cb) => sb.auth.onAuthStateChange((ev) => { if (ev !== "TOKEN_REFRESHED") setTimeout(async () => cb(await loadMe()), 0); }),

    async usernameAvailable(u) { return ok(await sb.rpc("tv_username_available", { uname: u })); },
    async signUp({ email, password, username, name, emoji }) {
      const res = ok(await sb.auth.signUp({ email, password, options: { data: { username, name, emoji }, emailRedirectTo: location.href.split("#")[0] } }));
      if (!res.session) return { needsConfirm: true };
      return { me: await loadMe() };
    },
    async signIn({ email, password }) { ok(await sb.auth.signInWithPassword({ email, password })); return loadMe(); },
    async signOut() { await sb.auth.signOut(); me = null; },
    async updateProfile(patch) { me = profileRow(ok(await sb.from("tv_profiles").update(patch).eq("id", me.id).select().single())); return me; },

    async searchUsers(q) {
      const term = q.replace(/[%,()]/g, "").trim();
      if (!term) return [];
      return ok(await sb.from("tv_profiles").select("*").or(`username.ilike.%${term}%,name.ilike.%${term}%`).neq("id", me.id).limit(20)).map(profileRow);
    },
    async getProfile(id) { return (await profiles([id]))[0] || null; },

    async friends() {
      const ids = (await friendships()).filter((f) => f.status === "accepted").map((f) => (f.requester === me.id ? f.addressee : f.requester));
      return profiles(ids);
    },
    async requests() {
      const all = (await friendships()).filter((f) => f.status === "pending");
      const ps = await profiles(all.map((f) => (f.requester === me.id ? f.addressee : f.requester)));
      const by = Object.fromEntries(ps.map((p) => [p.id, p]));
      return {
        incoming: all.filter((f) => f.addressee === me.id).map((f) => ({ id: f.id, profile: by[f.requester] })).filter((r) => r.profile),
        outgoing: all.filter((f) => f.requester === me.id).map((f) => ({ id: f.id, profile: by[f.addressee] })).filter((r) => r.profile),
      };
    },
    async addFriend(userId) {
      // If they already asked us, accept instead of making a second request.
      const existing = (await friendships()).find((f) => f.requester === userId || f.addressee === userId);
      if (existing) {
        if (existing.status === "pending" && existing.addressee === me.id) ok(await sb.from("tv_friendships").update({ status: "accepted" }).eq("id", existing.id));
        return;
      }
      ok(await sb.from("tv_friendships").insert({ requester: me.id, addressee: userId }));
    },
    async acceptRequest(id) { ok(await sb.from("tv_friendships").update({ status: "accepted" }).eq("id", id)); },
    async removeFriendship(userId) {
      ok(await sb.from("tv_friendships").delete().or(`and(requester.eq.${me.id},addressee.eq.${userId}),and(requester.eq.${userId},addressee.eq.${me.id})`));
    },

    async saveShow(show) { ok(await sb.from("tv_shows").upsert({ id: show.id, data: show, updated_at: new Date().toISOString() })); },
    async cachedShows() { return ok(await sb.from("tv_shows").select("data").order("updated_at", { ascending: false }).limit(500)).map((r) => r.data); },

    async myLogs() { return ok(await sb.from("tv_logs").select(LOG_COLS).eq("user_id", me.id)).map(logRow); },
    async logsOf(userId) { return ok(await sb.from("tv_logs").select(LOG_COLS).eq("user_id", userId)).map(logRow); },
    // Everything this person may see (their own, friends', and logs they were tagged in).
    async visibleLogs() { return ok(await sb.from("tv_logs").select(LOG_COLS).order("updated_at", { ascending: false }).limit(2000)).map(logRow); },
    async saveLog(log) {
      const score = scoreOf(log);
      ok(await sb.from("tv_logs").upsert({
        user_id: me.id, show_id: log.showId, status: log.status, rating: log.rating || null, seasons: log.seasons || {},
        watched_with: log.watchedWith || [], note: log.note || "", score, updated_at: new Date().toISOString(),
      }));
    },
    async deleteLog(showId) { ok(await sb.from("tv_logs").delete().eq("user_id", me.id).eq("show_id", showId)); },
    async stats(showIds) {
      if (!showIds.length) return {};
      const rows = ok(await sb.rpc("tv_show_stats", { ids: showIds }));
      return Object.fromEntries(rows.map((r) => [r.show_id, { avg: +r.avg, count: +r.count }]));
    },
    seedDemo() {},
  };
}

// ───────────────────────── Demo (this device only) ─────────────────────────
function demoStore() {
  const KEY = "binge.demo.v1";
  const uid = () => Math.random().toString(36).slice(2, 10);
  const FAKES = [
    { id: "demo-alex", username: "alex", name: "Alex", emoji: "🍿", friend: true, bias: 0.3 },
    { id: "demo-jordan", username: "jordan", name: "Jordan", emoji: "🎧", friend: true, bias: -0.4 },
    { id: "demo-sam", username: "sam", name: "Sam", emoji: "🌵", friend: true, bias: 0 },
    { id: "demo-riley", username: "riley", name: "Riley", emoji: "🦊", friend: "incoming", bias: 0.1 },
    { id: "demo-casey", username: "casey", name: "Casey", emoji: "🐙", friend: false, bias: -0.2 },
    { id: "demo-morgan", username: "morgan", name: "Morgan", emoji: "🌻", friend: false, bias: 0.5 },
  ];
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  let db = load() || { me: null, profiles: {}, friendships: [], logs: [], shows: {}, seeded: {} };
  for (const f of FAKES) db.profiles[f.id] ||= { id: f.id, username: f.username, name: f.name, emoji: f.emoji };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} };
  save();

  const me = () => (db.me ? db.profiles[db.me] : null);
  const areFriends = (a, b) => db.friendships.some((f) => f.status === "accepted" && ((f.requester === a && f.addressee === b) || (f.requester === b && f.addressee === a)));
  const canSee = (log) => log.userId === db.me || areFriends(db.me, log.userId) || (log.watchedWith || []).includes(db.me);
  const clone = (x) => JSON.parse(JSON.stringify(x));

  function makeFriendships() {
    for (const f of FAKES) {
      if (f.friend === true) db.friendships.push({ id: uid(), requester: f.id, addressee: db.me, status: "accepted" });
      if (f.friend === "incoming") db.friendships.push({ id: uid(), requester: f.id, addressee: db.me, status: "pending" });
    }
    // the pretend friends are friends with each other, so "watched with" works for them
    for (const a of FAKES) for (const b of FAKES) if (a.id < b.id && a.friend === true && b.friend === true) db.friendships.push({ id: uid(), requester: a.id, addressee: b.id, status: "accepted" });
  }

  // deterministic pseudo-random numbers so the demo looks the same every time
  const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };

  return {
    mode: "demo",
    me,
    async init() { return me(); },
    onAuthChange() {},
    async usernameAvailable(u) { return !Object.values(db.profiles).some((p) => p.username.toLowerCase() === u.toLowerCase()); },
    async signUp({ username, name, emoji }) {
      const id = "me-" + uid();
      db.profiles[id] = { id, username, name, emoji };
      db.me = id;
      makeFriendships();
      save();
      return { me: me() };
    },
    async signIn() { throw new Error("Demo mode has no passwords. Make a profile instead."); },
    async signOut() {
      // Demo: signing out wipes this device's demo data so you can start over.
      localStorage.removeItem(KEY);
      db = { me: null, profiles: {}, friendships: [], logs: [], shows: {}, seeded: {} };
      for (const f of FAKES) db.profiles[f.id] = { id: f.id, username: f.username, name: f.name, emoji: f.emoji };
      save();
    },
    async updateProfile(patch) { Object.assign(db.profiles[db.me], patch); save(); return me(); },

    async searchUsers(q) {
      const t = q.trim().toLowerCase();
      return Object.values(db.profiles).filter((p) => p.id !== db.me && t && (p.username.includes(t) || p.name.toLowerCase().includes(t))).map(clone);
    },
    async getProfile(id) { return db.profiles[id] ? clone(db.profiles[id]) : null; },
    async friends() {
      return db.friendships.filter((f) => f.status === "accepted" && (f.requester === db.me || f.addressee === db.me))
        .map((f) => clone(db.profiles[f.requester === db.me ? f.addressee : f.requester]));
    },
    async requests() {
      const pend = db.friendships.filter((f) => f.status === "pending");
      return {
        incoming: pend.filter((f) => f.addressee === db.me).map((f) => ({ id: f.id, profile: clone(db.profiles[f.requester]) })),
        outgoing: pend.filter((f) => f.requester === db.me).map((f) => ({ id: f.id, profile: clone(db.profiles[f.addressee]) })),
      };
    },
    async addFriend(userId) {
      const ex = db.friendships.find((f) => (f.requester === db.me && f.addressee === userId) || (f.requester === userId && f.addressee === db.me));
      if (ex) { if (ex.addressee === db.me) ex.status = "accepted"; }
      else {
        // pretend people accept straight away in the demo
        db.friendships.push({ id: uid(), requester: db.me, addressee: userId, status: "accepted" });
      }
      save();
    },
    async acceptRequest(id) { const f = db.friendships.find((x) => x.id === id); if (f) f.status = "accepted"; save(); },
    async removeFriendship(userId) {
      db.friendships = db.friendships.filter((f) => !((f.requester === db.me && f.addressee === userId) || (f.requester === userId && f.addressee === db.me)));
      save();
    },

    async saveShow(show) { db.shows[show.id] = show; save(); },
    async cachedShows() { return Object.values(db.shows).map(clone); },
    async myLogs() { return db.logs.filter((l) => l.userId === db.me).map(clone); },
    async logsOf(userId) { return db.logs.filter((l) => l.userId === userId && canSee(l)).map(clone); },
    async visibleLogs() { return db.logs.filter(canSee).sort((a, b) => b.updatedAt - a.updatedAt).map(clone); },
    async saveLog(log) {
      const row = { ...log, userId: db.me, score: scoreOf(log), updatedAt: Date.now() };
      db.logs = db.logs.filter((l) => !(l.userId === db.me && l.showId === log.showId));
      db.logs.push(row);
      save();
    },
    async deleteLog(showId) { db.logs = db.logs.filter((l) => !(l.userId === db.me && l.showId === showId)); save(); },
    async stats(showIds) {
      const out = {};
      for (const id of showIds) {
        const s = db.logs.filter((l) => l.showId === id && l.score != null).map((l) => l.score);
        if (s.length) out[id] = { avg: s.reduce((a, b) => a + b, 0) / s.length, count: s.length };
      }
      return out;
    },

    // Give the pretend people opinions about the starter shows.
    seedDemo(shows) {
      let changed = false;
      const friendIds = FAKES.filter((f) => f.friend === true).map((f) => f.id);
      for (const show of shows) {
        if (db.seeded[show.id]) continue;
        db.seeded[show.id] = true;
        changed = true;
        const base = 2.6 + hash(show.id) * 2.2;
        for (const f of FAKES) {
          const r = hash(f.id + show.id);
          if (r < 0.45) continue; // hasn't seen it
          const seasons = {};
          const nSeasons = show.status === "airing" && r > 0.85 ? Math.max(1, show.seasons.length - 1) : show.seasons.length;
          let drift = 0;
          for (let n = 1; n <= nSeasons; n++) {
            drift += (hash(f.id + show.id + n) - 0.55) * 0.9;
            seasons[n] = Math.min(5, Math.max(1, Math.round((base + f.bias + drift) * 2) / 2));
          }
          const watched = nSeasons < show.seasons.length || r > 0.93 ? "watching" : "finished";
          const ww = f.friend === true && r > 0.75 ? [friendIds[(friendIds.indexOf(f.id) + 1) % friendIds.length]] : [];
          db.logs.push({
            userId: f.id, showId: show.id, status: watched, rating: null, seasons, watchedWith: ww, note: "",
            score: scoreOf({ seasons }), updatedAt: Date.now() - Math.floor(hash(show.id + f.id + "t") * 21 * 864e5),
          });
        }
      }
      if (changed) save();
      return changed;
    },
  };
}
