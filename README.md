# 🐓 Chicken Hunt

A cute, farm-themed dashboard for a birthday **Chicken Hunt** bar crawl.

- **Teams** hatch a team (name, mascot, members) or join one, right on their phones.
- **Chickens** tap *"We've roosted!"* → every hunter gets a cluck 🔊 + pop-up, and the hunt timer starts.
- Each team ticks off the **bars they've checked**. Other teams only see the *number* of bars, not which ones.
- The first team to tap **"We found the chickens!"** wins → everyone gets a 🏆 pop-up with the team and time.
  Later teams are logged as 2nd, 3rd, and so on.
- The chickens have a passcode-locked **🐔 Chickens** tab: start the hunt, track the **pot** as drinks are bought
  (everyone sees how much is left), edit the bar list, see where every team has been, and fix mistakes.

It's a plain static site (HTML/CSS/JS, no build step). Live data syncs through a free **Firebase Firestore** database.

---

## 1. Connect Firebase (≈5 minutes, free)

1. Go to <https://console.firebase.google.com> → **Add project** (any name, e.g. `chickenhunt`). Google Analytics isn't needed.
2. In the project, open **Build → Firestore Database → Create database**. Pick a location near you and start in **production mode**.
3. Open the **Rules** tab, replace everything with the contents of [`firestore.rules`](firestore.rules), and click **Publish**.
4. Go to **Project settings** (⚙️) → **Your apps** → click the **`</>` Web** icon → register an app (no hosting needed).
5. Copy the `firebaseConfig` values it shows into [`config.js`](config.js) (`apiKey`, `authDomain`, `projectId`, …).
   These values are meant to be public, so it's fine to commit them.

While `apiKey` is empty, the site runs in **demo mode**: everything is saved only on the current device, which is good for trying it out.

## 2. Put in your bars

Edit `DEFAULT_BARS` in [`config.js`](config.js) with your 10 bars. The chickens can also edit the list during the game from the 🐔 tab.

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
  The database rules are open, so delete the Firebase project (or the data) after the party.
- Times come from each phone's clock, which is accurate enough for a bar crawl.

## Files

| File | What it is |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | The dashboard |
| `store.js` | Data layer (Firestore, or local demo mode) |
| `config.js` | **Your settings:** Firebase keys, bar list, $ per person |
| `firestore.rules` | Database rules to paste into Firebase |
| `sw.js`, `manifest.json`, `icon.svg` | Notifications + "Add to Home Screen" |
