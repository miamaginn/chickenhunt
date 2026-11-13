// ─────────────────────────────────────────────────────────────
//  🐓 Chicken Hunt — settings
//  Edit this file (you can do it right on github.com with the ✏️ button).
// ─────────────────────────────────────────────────────────────

// 1) Paste your Firebase web config here (see README → "Connect Firebase").
//    While apiKey is empty the site runs in DEMO MODE: everything is saved
//    only on the current device, which is handy for trying it out.
export const FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// 2) Name of this game. Change it to start a completely fresh game
//    (e.g. for next year's birthday) without deleting the old one.
export const GAME_ID = "birthday-hunt";

// 3) The bars the chickens might be roosting at. The chickens can also
//    edit this list (and drop map pins) from the 🐔 Chickens tab.
//    Optional: add map pins here instead by writing a bar like
//      { name: "The Rusty Rooster", lat: 30.2672, lng: -97.7431 },
//    (In Google Maps, right-click a spot and click the numbers to copy them.)
export const DEFAULT_BARS = [
  "Bar #1",
  "Bar #2",
  "Bar #3",
  "Bar #4",
  "Bar #5",
  "Bar #6",
  "Bar #7",
  "Bar #8",
  "Bar #9",
  "Bar #10",
];

// 4) Town or neighbourhood, added to map searches so "The Pub" finds the
//    right one, e.g. "Austin, TX".
export const MAP_AREA = "";

// 5) How much each person chips into the pot (used to suggest the pot size).
export const POT_PER_PERSON = 20;
