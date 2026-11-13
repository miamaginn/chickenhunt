// ─────────────────────────────────────────────────────────────
//  🐓 Chicken Hunt — settings
//  Edit this file (you can do it right on github.com with the ✏️ button).
// ─────────────────────────────────────────────────────────────

// 1) Paste your Supabase project URL and publishable/anon key here
//    (see README → "Connect Supabase"). Both are safe to make public.
//    While these are empty the site runs in DEMO MODE: everything is saved
//    only on the current device, which is handy for trying it out.
export const SUPABASE_URL = "https://lvnrlogawkjpnlswtwss.supabase.co";
export const SUPABASE_KEY = "sb_publishable_XNOxRgeh7tQgw5Mjsp2uiA_K8Owq4ev";

//    (Alternative: Firebase. Only used if the Supabase settings are empty.)
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
  "SoCal Vibes Co",
  "Courtside Lounge",
  "The Whaler",
  "Big Dean's",
  "Ye Olde King's Head",
  "Barney's Beanery",
  "Cabo Cantina",
  "1212",
];

// 4) Town or neighbourhood, added to map searches so "The Pub" finds the
//    right one, e.g. "Austin, TX".
export const MAP_AREA = "Santa Monica, CA";

// 5) How much each person chips into the pot (used to suggest the pot size).
export const POT_PER_PERSON = 20;
