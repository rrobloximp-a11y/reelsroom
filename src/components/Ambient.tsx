import { useEffect, useMemo, useState } from "react";
import { findTheme, type Theme } from "../cosmetics";
import { getPrefs, onPrefsChange } from "../prefs";

const GLYPHS: Record<NonNullable<Theme["effect"]>, string[]> = {
  snow: ["❄", "❅", "•", "•", "•"],
  petals: ["🌸", "❀", "•"],
  stars: ["✦", "•", "·", "✧"],
  embers: ["•", "•", "·"],
  bats: ["🦇", "•"],
};

function usePrefs() {
  const [prefs, set] = useState(getPrefs);
  useEffect(() => onPrefsChange(() => set(getPrefs())), []);
  return prefs;
}

/** Falling snow, drifting petals, twinkling stars… drawn behind/over a themed area. */
export function Ambient({ theme, contained = false, count = 36 }: { theme?: string; contained?: boolean; count?: number }) {
  const { effects } = usePrefs();
  const t = findTheme(theme);
  const effect = t?.effect;
  const flakes = useMemo(() => {
    if (!effect) return [];
    const glyphs = GLYPHS[effect];
    return Array.from({ length: count }, (_, i) => ({
      key: i,
      glyph: glyphs[i % glyphs.length],
      left: Math.random() * 100,
      size: 8 + Math.random() * (effect === "bats" || effect === "petals" ? 14 : 10),
      delay: -Math.random() * 20,
      duration: 9 + Math.random() * 14,
      drift: (Math.random() - 0.5) * 120,
      top: Math.random() * 100,
    }));
  }, [effect, count]);
  if (!effect || !effects) return null;
  return (
    <div className={`ambient ambient-${effect} ${contained ? "ambient-contained" : ""}`} aria-hidden>
      {flakes.map((f) => (
        <span
          key={f.key}
          style={{
            left: `${f.left}%`,
            top: effect === "stars" ? `${f.top}%` : undefined,
            fontSize: f.size,
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
            ["--drift" as string]: `${f.drift}px`,
          }}
        >
          {f.glyph}
        </span>
      ))}
    </div>
  );
}

/** The background the signed-in viewer sees across the whole site. */
export function useSiteTheme(season: string) {
  const prefs = usePrefs();
  const id = prefs.siteTheme === "auto" ? season : prefs.siteTheme;
  const theme = findTheme(id)?.id ?? "";
  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme]);
  return theme;
}
