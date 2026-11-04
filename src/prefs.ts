export type Prefs = {
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  // Site background: "auto" follows the seasonal theme picked by admins, "" is the classic dark look.
  siteTheme: string;
  // Falling snow, petals, stars and other background animations.
  effects: boolean;
};

const KEY = "reelroom:prefs";
const EVENT = "reelroom:prefs";
const DEFAULTS: Prefs = { autoplay: true, muted: false, loop: false, siteTheme: "auto", effects: true };

export function getPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function setPrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function updatePrefs(patch: Partial<Prefs>) {
  setPrefs({ ...getPrefs(), ...patch });
}

export function onPrefsChange(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
