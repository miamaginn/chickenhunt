# 🐓 Chicken Hunt

A cute, farm-themed dashboard for a birthday **Chicken Hunt** bar crawl.

- **Teams** hatch a team (name, mascot, members) or join one, right on their phones.
- **Chickens** tap *"We've roosted!"* → every hunter gets a cluck 🔊 + pop-up, and the hunt timer starts.
- Each team ticks off the **bars they've checked**. Other teams only see the *number* of bars, not which ones.
- The first team to tap **"We found the chickens!"** wins → everyone gets a 🏆 pop-up with the team and time.
  Later teams are logged as 2nd, 3rd, and so on.
- A **🗺️ Map** of every bar: your team's checked bars turn ✅, there's a "Where am I?" button,
  and each pin has a directions link. Free OpenStreetMap, no API key needed.
- The chickens have a passcode-locked **🐔 Chickens** tab: start the hunt, track the **pot** as drinks are bought
  (everyone sees how much is left), edit the bar list, drop map pins, see where every team has been, and fix mistakes.

It's a plain static site (HTML/CSS/JS, no build step). Live data syncs through a free **Supabase** database
(Firebase also works as an alternative).

---

## 1. Connect Supabase (≈5 minutes, free)

1. In <https://supabase.com/dashboard>, create a **New project** (any name, e.g. `chickenhunt`; save the database password somewhere, it isn't needed here).
2. Open **SQL Editor → New query**, paste in all of [`supabase.sql`](supabase.sql), and click **Run**.
   This creates three small tables (`ch_games`, `ch_teams`, `ch_visits`), turns on live updates, and adds the game's functions.
3. Click **Connect** at the top of the project, or go to **Project Settings → API Keys**. Copy:
   - the **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - the **publishable** key (`sb_publishable_…`) or the legacy **anon public** key. **Not** the secret/service_role key!
4. Paste them into [`config.js`](config.js) as `SUPABASE_URL` and `SUPABASE_KEY`. Both are designed to be public, so it's fine to commit them.

⚠️ Free Supabase projects **pause after a week with no activity**. Open the site (or the dashboard) a day or two before the party
so it's awake, and if it ever shows "paused", hit **Restore** in the dashboard.

While the Supabase settings are empty, the site runs in **demo mode**: everything is saved only on the current device, which is good for trying it out.

<details>
<summary>Using Firebase instead</summary>

1. <https://console.firebase.google.com> → **Add project**.
2. **Build → Firestore Database → Create database** (production mode), then paste [`firestore.rules`](firestore.rules) into the **Rules** tab and **Publish**.
3. **Project settings → Your apps → `</>` Web**, register an app, and copy the `firebaseConfig` values into `FIREBASE_CONFIG` in `config.js`.
   Leave the Supabase settings empty.
</details>

## 2. Put in your bars

Edit `DEFAULT_BARS` in [`config.js`](config.js) (already filled in with the Santa Monica list) and `MAP_AREA` (set to `"Santa Monica, CA"`).
The chickens can also edit the list during the game from the 🐔 tab.

**Map pins:** in the 🐔 tab → *Bar pins*, pick a bar, then search for it or tap the map to drop its pin
(it jumps to the next bar automatically). Drag the highlighted pin to fine-tune it.
Or put coordinates straight into `config.js`:
`{ name: "The Rusty Rooster", lat: 30.2672, lng: -97.7431 }` (in Google Maps, right-click a spot to copy its numbers).

## 3. Publish with GitHub Pages

1. On GitHub: **Settings → Pages**.
2. **Source:** *Deploy from a branch* → Branch **`main`**, folder **`/ (root)`** → **Save**.
3. After a minute your site is live at **https://miamaginn.github.io/chickenhunt/**. Share that link with everyone.

## 4. On the night

1. **Chickens:** open the 🐔 tab first and **set the chicken passcode** (the first person to open it sets it). Set the pot size.
2. **Hunters:** open the link, hatch or join a team. Tip: **Share → Add to Home Screen** makes it feel like an app.
3. Tap **Rules → Turn on alerts** to get notifications while the page is in the background.
   (On iPhone, notifications only work once the site is added to the Home Screen. With the page open, everyone always gets the cluck and the pop-up.)
4. Chickens: once you're settled, tap **"We've roosted! Start the hunt"**. 🐔
5. Hunters tap **🍺 We're here** at every bar (one drink each!) and **🐔 WE FOUND THE CHICKENS!** when they find them.
6. Chickens log drinks against the pot with the quick **-$5 / -$10** buttons.

To play again later, use **Restart the hunt** in the 🐔 tab, or change `GAME_ID` in `config.js` for a fresh game.

## Good to know

- This is honour-system security for a party. The chicken passcode and the "you can't see other teams' bars"
  rule keep honest people honest, but someone determined could peek with browser dev tools.
  The database is open to anyone with the site, so delete the Supabase project (or its `ch_` tables) after the party.
- Times come from each phone's clock, which is accurate enough for a bar crawl.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The dashboard |
| `map.js` | Maps (Leaflet + OpenStreetMap) |
| `store.js` | Data layer (Supabase, Firebase, or local demo mode) |
| `supabase.sql` | Database setup to run in Supabase |
| `config.js` | **Your settings:** database keys, bar list, $ per person |
| `firestore.rules` | Database rules (only if using Firebase) |
| `sw.js`, `manifest.json`, `icon.svg` | Notifications + "Add to Home Screen" |
