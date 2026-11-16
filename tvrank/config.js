// ─────────────────────────────────────────────────────────────
//  📺 Binge — settings
// ─────────────────────────────────────────────────────────────

// Paste your Supabase project URL and publishable/anon key here
// (see README → "Connect Supabase"). Both are designed to be public.
// While these are empty the app runs in DEMO MODE: your data is saved only on
// this device, and three pretend friends are added so you can see how
// friend rankings look.
export const SUPABASE_URL = "";
export const SUPABASE_KEY = "";

export const APP_NAME = "Binge";

// Shows that appear on Discover before anyone has searched for anything.
// Each one is looked up on TVmaze (free show database) the first time the app
// opens. `platform` is optional and overrides what TVmaze says — handy because
// TVmaze lists the original channel (e.g. "FX") rather than where it streams ("Hulu").
export const STARTER_SHOWS = [
  { q: "The Bear", platform: "Hulu" },
  { q: "Severance" },
  { q: "The White Lotus" },
  { q: "Stranger Things" },
  { q: "Succession" },
  { q: "Shogun", platform: "Hulu" },
  { q: "Abbott Elementary", platform: "Hulu" },
  { q: "The Last of Us" },
  { q: "Ted Lasso" },
  { q: "Only Murders in the Building", platform: "Hulu" },
  { q: "Breaking Bad", platform: "Netflix" },
  { q: "Better Call Saul", platform: "Netflix" },
  { q: "The Office", platform: "Peacock" },
  { q: "Fleabag", platform: "Prime Video" },
  { q: "The Crown" },
  { q: "Squid Game" },
  { q: "Wednesday" },
  { q: "Beef" },
  { q: "Baby Reindeer" },
  { q: "Adolescence" },
  { q: "The Pitt" },
  { q: "Slow Horses" },
  { q: "Reacher" },
  { q: "The Boys" },
  { q: "Hacks" },
  { q: "Normal People", platform: "Hulu" },
  { q: "Chernobyl" },
  { q: "Mare of Easttown" },
  { q: "Game of Thrones" },
  { q: "Euphoria" },
  { q: "Bridgerton" },
  { q: "Love Is Blind" },
  { q: "The Traitors", platform: "Peacock" },
  { q: "Yellowjackets", platform: "Paramount+" },
  { q: "Andor" },
  { q: "Arcane" },
];
