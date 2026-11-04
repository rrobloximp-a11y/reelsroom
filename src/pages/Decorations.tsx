import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type MyChannel } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";
import { Ambient } from "../components/Ambient";
import { FRAMES, THEMES, findTheme, type Cosmetic } from "../cosmetics";
import { getPrefs, onPrefsChange, updatePrefs } from "../prefs";

const EFFECT_LABEL: Record<string, string> = {
  snow: "Falling snow",
  petals: "Cherry petals",
  stars: "Twinkling stars",
  embers: "Rising embers",
  bats: "Flying bats",
};

export default function Decorations() {
  const { channel, setChannel, site } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [siteTheme, setSiteTheme] = useState(getPrefs().siteTheme);
  useEffect(() => onPrefsChange(() => setSiteTheme(getPrefs().siteTheme)), []);
  if (!channel) return null;
  const me = channel;

  const owns = (item: Cosmetic) => item.price === 0 || me.isAdmin || (me.ownedCosmetics ?? []).includes(item.id);

  const run = async (key: string, fn: () => Promise<{ channel: MyChannel }>) => {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      setChannel(r.channel);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  };
  const equip = (patch: { frame?: string; theme?: string }) =>
    run(`equip:${patch.frame ?? patch.theme}`, () => api("/me/decorations", { method: "PATCH", json: patch }));
  const buy = (item: Cosmetic, then: { frame?: string; theme?: string }) =>
    run(`buy:${item.id}`, async () => {
      await api("/me/decorations/buy", { json: { id: item.id } });
      return api("/me/decorations", { method: "PATCH", json: then });
    });

  const action = (item: Cosmetic, slot: "frame" | "theme") => {
    const on = me[slot] === item.id;
    if (on) {
      return (
        <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => equip({ [slot]: "" })}>
          Take off
        </button>
      );
    }
    if (owns(item)) {
      return (
        <button className="btn btn-light btn-sm" disabled={!!busy} onClick={() => equip({ [slot]: item.id })}>
          {busy === `equip:${item.id}` ? <span className="spinner" /> : "Use"}
        </button>
      );
    }
    const short = me.coins < item.price;
    return (
      <button
        className="btn btn-accent btn-sm"
        disabled={!!busy || short}
        title={short ? "Not enough coins" : undefined}
        onClick={() => {
          if (confirm(`Buy "${item.name}" for ${item.price.toLocaleString("en-US")} coins?`)) void buy(item, { [slot]: item.id });
        }}
      >
        {busy === `buy:${item.id}` ? <span className="spinner" /> : <>🪙 {item.price.toLocaleString("en-US")}</>}
      </button>
    );
  };

  const priceTag = (item: Cosmetic, slot: "frame" | "theme") =>
    me[slot] === item.id ? (
      <span className="badge badge-ok">On</span>
    ) : owns(item) ? (
      <span className="badge">{item.price === 0 ? "Free" : "Owned"}</span>
    ) : null;

  const activeSite = siteTheme === "auto" ? site.season : siteTheme;

  return (
    <div className="page decorations">
      <header className="page-head">
        <span className="kicker">Decorations</span>
        <h1>Dress up your room</h1>
        <p className="muted">Frames show around your icon everywhere on Reelroom. Backgrounds decorate your channel page for every visitor.</p>
      </header>

      <section className={`deco-hero ${me.theme ? `theme-${me.theme} themed-box` : ""}`}>
        {me.theme && <Ambient theme={me.theme} contained count={22} />}
        <Avatar name={me.name} handle={me.handle} id={me.id} v={me.avatarVersion} frame={me.frame} size={96} />
        <div>
          <h2>{me.name}</h2>
          <p className="muted small">@{me.handle} · {findTheme(me.theme)?.name ?? "Classic"} background</p>
          <Link to={`/c/${me.handle}`} className="link small">See your channel →</Link>
        </div>
        <div className="deco-wallet">
          <span className="muted small">Your coins</span>
          <strong>🪙 {me.coins.toLocaleString("en-US")}</strong>
          <Link to="/coins" className="btn btn-outline btn-sm">Get more</Link>
        </div>
      </section>

      {error && <p className="form-error">{error}</p>}

      <h2 className="section-title">Avatar frames</h2>
      <div className="deco-grid">
        {FRAMES.map((f) => (
          <article className={`deco-card ${me.frame === f.id ? "is-on" : ""}`} key={f.id}>
            <div className="deco-preview">
              <Avatar name={me.name} handle={me.handle} id={me.id} v={me.avatarVersion} frame={f.id} size={64} />
            </div>
            <div className="deco-meta">
              <strong>{f.name}</strong>
              <span className="row">
                {f.tag && <span className="badge badge-xmas">🎄 {f.tag}</span>}
                {priceTag(f, "frame")}
              </span>
            </div>
            {action(f, "frame")}
          </article>
        ))}
      </div>

      <h2 className="section-title">Channel backgrounds</h2>
      <p className="muted small">Everyone who opens your channel sees this background.</p>
      <div className="deco-grid">
        {THEMES.map((t) => (
          <article className={`deco-card ${me.theme === t.id ? "is-on" : ""}`} key={t.id}>
            <div className="deco-swatch" style={{ background: t.swatch }}>
              {t.effect && <span>{EFFECT_LABEL[t.effect]}</span>}
            </div>
            <div className="deco-meta">
              <strong>{t.name}</strong>
              <span className="row">
                {t.tag && <span className="badge badge-xmas">🎄 {t.tag}</span>}
                {priceTag(t, "theme")}
              </span>
            </div>
            {action(t, "theme")}
          </article>
        ))}
      </div>

      <h2 className="section-title">Site background</h2>
      <p className="muted small">How Reelroom looks for you on this device. All of these are free.</p>
      <div className="deco-grid deco-grid-site">
        <button className={`deco-site ${siteTheme === "auto" ? "is-on" : ""}`} onClick={() => updatePrefs({ siteTheme: "auto" })}>
          <span className="deco-swatch" style={{ background: findTheme(site.season)?.swatch ?? "linear-gradient(160deg,#15110e,#2b241e)" }}>
            <span>Automatic</span>
          </span>
          <strong>Seasonal</strong>
          <span className="muted small">{site.season ? `Now: ${findTheme(site.season)?.name}` : "Classic until an event starts"}</span>
        </button>
        <button className={`deco-site ${siteTheme === "" ? "is-on" : ""}`} onClick={() => updatePrefs({ siteTheme: "" })}>
          <span className="deco-swatch" style={{ background: "linear-gradient(160deg,#15110e,#2b241e 60%,#ef5f3c)" }} />
          <strong>Classic dark</strong>
        </button>
        {THEMES.map((t) => (
          <button key={t.id} className={`deco-site ${siteTheme === t.id ? "is-on" : ""}`} onClick={() => updatePrefs({ siteTheme: t.id })}>
            <span className="deco-swatch" style={{ background: t.swatch }} />
            <strong>{t.name}</strong>
          </button>
        ))}
      </div>
      <p className="muted small">
        Showing: <b>{findTheme(activeSite)?.name ?? "Classic dark"}</b>. Turn falling snow and other effects off in{" "}
        <Link to="/settings#playback" className="link">Settings</Link>.
      </p>
    </div>
  );
}
