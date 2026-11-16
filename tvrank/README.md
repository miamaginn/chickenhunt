# 📺 Binge — rank TV shows with your friends

A phone-first web app (PWA) for logging and ranking TV shows, season by season, and seeing what your friends thought.

- **Profiles + friends**: sign up, find people by name or @username, send/accept friend requests, share an invite link.
- **Discover**: search any show (via the free [TVmaze](https://www.tvmaze.com/api) database) and filter by
  **genre, platform** (Netflix, Hulu, HBO Max…), **episode length, limited vs multi-season, decade released,
  and finished vs still airing**. Sort by top rated, friends' favorites, newest or A–Z.
- **Rate by season**: give Season 1 five stars and Season 2 three. Half stars supported. Your show score is your
  overall rating, or the average of your season ratings if you leave overall empty.
- **Friends' opinions on every show**: each friend's rating and season ratings, the **friends' average**, the
  **everyone average**, and a season-by-season chart (friends vs you) so you can see where a show declined.
- **Watched with**: tag friends you watched with. They get a "watched with you — rate it" prompt on their feed.
- **Feed**: what friends are watching and rating, plus "your friends love" picks.
- **My shows**: your ranked list, plus Watching / Want to watch / Dropped. Friends get a **taste match %**.

Plain HTML/CSS/JS, no build step. Data lives in a free **Supabase** database.

## Try it now (demo mode)

With `SUPABASE_URL` empty in [`config.js`](config.js), the app runs in **demo mode**: everything saves on your
device only, and pretend friends (Alex, Jordan, Sam, plus a pending request from Riley) are added so you can see the
social features. Run it locally:

```bash
cd tvrank && python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Go live with real accounts (≈5 minutes, free)

1. In <https://supabase.com/dashboard> create a project (or reuse your Chicken Hunt one; all tables here start with `tv_`).
2. **SQL Editor → New query**, paste all of [`supabase.sql`](supabase.sql), **Run**.
3. **Authentication → Sign In / Providers → Email**: keep Email enabled. For the easiest start with friends, turn
   **Confirm email** off; if you leave it on, also add your site's URL under **Authentication → URL Configuration**
   so the confirmation link comes back to the app.
4. **Project Settings → API Keys**: copy the Project URL and the publishable (or legacy anon) key into
   [`config.js`](config.js). Both are safe to commit; the database rules in `supabase.sql` control who sees what.

**Privacy rules** (enforced in the database): your ratings are visible to you, your accepted friends, and anyone you
tagged as "watched with". The "everyone" average only exposes the average and count, never individual ratings.

## Put it on your phone

Host the `tvrank` folder anywhere static: Vercel, Netlify or GitHub Pages. In this repo it's served at
`/tvrank/` on the same site as Chicken Hunt. On Vercel you can also make a separate project with
**Root Directory = `tvrank`**.

- **iPhone**: open the link in Safari → Share → **Add to Home Screen**.
- **Android**: Chrome → ⋮ → **Install app**. (The profile page also has an Install button when the browser offers one.)

It opens full-screen with its own icon. The service worker (`sw.js`) caches the app and show posters so it opens
instantly. **After you change app files, bump `VERSION` in `sw.js`** so phones pick up the update.

## Customize

- `STARTER_SHOWS` in `config.js`: the shows on Discover before anyone searches. Add `platform: "Hulu"` to override.
- `PLATFORM_MAP` in `catalog.js`: maps original channels (FX, NBC…) to streaming services (Hulu, Peacock…).
  TVmaze knows where a show *first aired*, not every service it streams on, so this mapping is a best guess.

## Files

| File | What it does |
| --- | --- |
| `index.html`, `styles.css` | App shell and look |
| `app.js` | Screens: feed, discover, show page + rating, my shows, friends, profile |
| `store.js` | Data layer (Supabase or local demo) |
| `catalog.js` | TVmaze lookups, platform/length/decade filters, offline starter data |
| `supabase.sql` | Tables + privacy rules |
| `manifest.json`, `sw.js`, `icon*` | What makes it installable as an app |
