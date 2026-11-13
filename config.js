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
//    edit this list from the 🐔 Chickens tab during the game.
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

// 4) How much each person chips into the pot (used to suggest the pot size).
export const POT_PER_PERSON = 20;
