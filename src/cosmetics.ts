// Catalog of profile decorations. Shared by the browser and the API (which checks prices and ownership).

export type Cosmetic = {
  id: string;
  name: string;
  price: number; // coins; 0 = free for everyone
  tag?: string; // e.g. "Christmas"
};

export type Frame = Cosmetic & { kind: "frame"; badge?: string };
export type Theme = Cosmetic & {
  kind: "theme";
  // Preview swatch for pickers.
  swatch: string;
  effect?: "snow" | "petals" | "stars" | "embers" | "bats";
};

export const FRAMES: Frame[] = [
  { kind: "frame", id: "snow", name: "Snowflake", price: 0, tag: "Christmas", badge: "❄️" },
  { kind: "frame", id: "santa", name: "Santa hat", price: 0, tag: "Christmas" },
  { kind: "frame", id: "candy", name: "Candy cane", price: 150, tag: "Christmas", badge: "🍬" },
  { kind: "frame", id: "wreath", name: "Christmas wreath", price: 250, tag: "Christmas", badge: "🎀" },
  { kind: "frame", id: "gift", name: "Present", price: 200, tag: "Christmas", badge: "🎁" },
  { kind: "frame", id: "gold", name: "Gold ring", price: 400, badge: "✨" },
  { kind: "frame", id: "neon", name: "Neon pulse", price: 300 },
  { kind: "frame", id: "rainbow", name: "Rainbow spin", price: 500 },
  { kind: "frame", id: "fire", name: "On fire", price: 500, badge: "🔥" },
  { kind: "frame", id: "hearts", name: "Hearts", price: 250, badge: "💖" },
  { kind: "frame", id: "star", name: "Superstar", price: 600, badge: "🌟" },
  { kind: "frame", id: "crown", name: "Crown", price: 1000, badge: "👑" },
];

export const THEMES: Theme[] = [
  { kind: "theme", id: "christmas", name: "Christmas", price: 0, tag: "Christmas", effect: "snow", swatch: "linear-gradient(135deg,#1d4a2e,#5c1616 70%,#e7b44c)" },
  { kind: "theme", id: "winter", name: "Winter night", price: 0, tag: "Christmas", effect: "snow", swatch: "linear-gradient(160deg,#0f2440,#24507a 60%,#cfe6ff)" },
  { kind: "theme", id: "gingerbread", name: "Gingerbread", price: 150, tag: "Christmas", effect: "snow", swatch: "linear-gradient(135deg,#4a2a14,#8a5226 60%,#f5e6d0)" },
  { kind: "theme", id: "aurora", name: "Aurora", price: 200, effect: "stars", swatch: "linear-gradient(135deg,#0b2a2a,#1f8a70 50%,#7b4ae2)" },
  { kind: "theme", id: "ocean", name: "Deep ocean", price: 200, swatch: "linear-gradient(160deg,#04223a,#0a5f86 60%,#3fd0d4)" },
  { kind: "theme", id: "sunset", name: "Sunset", price: 200, swatch: "linear-gradient(160deg,#2b1240,#b23a5a 55%,#f5a35b)" },
  { kind: "theme", id: "forest", name: "Forest", price: 200, swatch: "linear-gradient(160deg,#0f2416,#2f6b3a 60%,#b6d77a)" },
  { kind: "theme", id: "sakura", name: "Sakura", price: 300, effect: "petals", swatch: "linear-gradient(160deg,#3a1630,#b05a8a 60%,#ffd1e6)" },
  { kind: "theme", id: "galaxy", name: "Galaxy", price: 400, effect: "stars", swatch: "radial-gradient(circle at 30% 30%,#7b4ae2,#1a0f3a 55%,#05030f)" },
  { kind: "theme", id: "lava", name: "Lava", price: 400, effect: "embers", swatch: "linear-gradient(160deg,#1a0703,#8a1e08 55%,#ff8a2a)" },
  { kind: "theme", id: "halloween", name: "Halloween", price: 200, effect: "bats", swatch: "linear-gradient(160deg,#1a0f22,#4a1d5e 55%,#ff7a1a)" },
];

export const findFrame = (id: string | null | undefined) => FRAMES.find((f) => f.id === id);
export const findTheme = (id: string | null | undefined) => THEMES.find((t) => t.id === id);
export const findCosmetic = (id: string): Frame | Theme | undefined => findFrame(id) ?? findTheme(id);
