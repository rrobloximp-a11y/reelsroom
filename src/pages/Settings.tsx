import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AuthError, login, updateUser } from "@netlify/identity";
import { api } from "../api";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";
import { getPrefs, setPrefs, type Prefs } from "../prefs";

type Section = "account" | "security" | "coins" | "playback";
const SECTIONS: { id: Section; label: string; hint: string }[] = [
  { id: "account", label: "Account", hint: "Email and channel" },
  { id: "security", label: "Password", hint: "Keep your account safe" },
  { id: "coins", label: "Coins", hint: "Balance and top-ups" },
  { id: "playback", label: "Playback", hint: "How videos play, effects" },
];

export default function Settings() {
  const loc = useLocation();
  const navigate = useNavigate();
  const fromHash = loc.hash.slice(1) as Section;
  const initial: Section = loc.pathname === "/coins" ? "coins" : SECTIONS.some((s) => s.id === fromHash) ? fromHash : "account";
  const [section, setSection] = useState<Section>(initial);

  useEffect(() => {
    if (loc.pathname === "/coins") setSection("coins");
    else if (SECTIONS.some((s) => s.id === fromHash)) setSection(fromHash);
  }, [loc.pathname, fromHash]);

  const go = (s: Section) => {
    setSection(s);
    navigate(`/settings#${s}`, { replace: true });
  };

  return (
    <div className="page settings">
      <header className="page-head">
        <span className="kicker">Settings</span>
        <h1>Your room, your rules</h1>
      </header>
      <div className="settings-grid">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? "active" : ""} onClick={() => go(s.id)}>
              <strong>{s.label}</strong>
              <span>{s.hint}</span>
            </button>
          ))}
        </nav>
        <div className="settings-body rise" key={section}>
          {section === "account" && <AccountSection />}
          {section === "security" && <PasswordSection />}
          {section === "coins" && <CoinsSection />}
          {section === "playback" && <PlaybackSection />}
        </div>
      </div>
    </div>
  );
}

function AccountSection() {
  const { user, channel, logout } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const changeEmail = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(null);
    const next = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return setError("Enter a valid email address.");
    if (next === user?.email.toLowerCase()) return setError("That's already your email.");
    setBusy(true);
    try {
      await updateUser({ email: next });
      setOk(`We sent a confirmation link to ${next}. Your email changes once you click it.`);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {channel && (
        <section className="panel settings-channel">
          <Avatar name={channel.name} handle={channel.handle} id={channel.id} v={channel.avatarVersion} frame={channel.frame} size={64} />
          <div>
            <h2>{channel.name}</h2>
            <p className="muted small">@{channel.handle}{channel.isAdmin ? " · Admin" : ""}</p>
          </div>
          <div className="settings-actions">
            <Link to={`/c/${channel.handle}`} className="btn btn-outline btn-sm">View channel</Link>
            <Link to="/setup" className="btn btn-ghost btn-sm">Edit name, icon &amp; banner</Link>
          </div>
        </section>
      )}

      <form className="panel" onSubmit={changeEmail}>
        <h2>Email</h2>
        <p className="muted small">Signed in as <b>{user?.email}</b></p>
        <label className="field">
          <span>New email address</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
        </label>
        {error && <p className="form-error">{error}</p>}
        {ok && <p className="form-ok">{ok}</p>}
        <button className="btn btn-accent" disabled={busy}>{busy ? <span className="spinner" /> : "Send confirmation link"}</button>
      </form>

      <section className="panel">
        <h2>Session</h2>
        <p className="muted small">Sign out of Reelroom on this device.</p>
        <button
          className="btn btn-outline"
          onClick={async () => {
            await logout();
            navigate("/");
          }}
        >
          Sign out
        </button>
      </section>
    </>
  );
}

function PasswordSection() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (next.length < 6) return setError("Use at least 6 characters.");
    if (next !== confirm) return setError("The new passwords don't match.");
    if (next === current) return setError("Pick a password you're not already using.");
    setBusy(true);
    try {
      // Re-check the current password first so a borrowed, signed-in browser can't change it.
      try {
        await login(user!.email, current);
      } catch (err) {
        if (err instanceof AuthError && (err.status === 400 || err.status === 401)) throw new Error("Your current password is wrong.");
        throw err;
      }
      await updateUser({ password: next });
      setOk(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={submit}>
      <h2>Change password</h2>
      <label className="field">
        <span>Current password</span>
        <input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
      </label>
      <label className="field">
        <span>New password</span>
        <input type="password" required minLength={6} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </label>
      <label className="field">
        <span>Confirm new password</span>
        <input type="password" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
      </label>
      {error && <p className="form-error">{error}</p>}
      {ok && <p className="form-ok">Password changed. Use the new one next time you sign in.</p>}
      <button className="btn btn-accent" disabled={busy}>{busy ? <span className="spinner" /> : "Update password"}</button>
    </form>
  );
}

type CoinPack = { id: string; coins: number; amount: number };

function CoinsSection() {
  const { channel, setChannel } = useAuth();
  const [params, setParams] = useSearchParams();
  const [packs, setPacks] = useState<CoinPack[] | null>(null);
  const [currency, setCurrency] = useState("pln");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  useEffect(() => {
    api<{ packs: CoinPack[]; currency?: string }>("/coins/packs")
      .then((d) => {
        setPacks(d.packs);
        if (d.currency) setCurrency(d.currency);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Back from Stripe Checkout.
  useEffect(() => {
    const sessionId = params.get("session_id");
    if (params.get("canceled")) {
      setError("Checkout was canceled. No money was taken.");
      setParams({}, { replace: true });
    }
    if (!sessionId || !channel) return;
    api<{ status: string; added?: number; coins?: number }>("/coins/confirm", { json: { sessionId } })
      .then((r) => {
        if (r.status === "paid") {
          if (typeof r.coins === "number") setChannel({ ...channel, coins: r.coins });
          setOk(r.added ? `Payment received — ${r.added.toLocaleString()} coins added.` : "Payment received. Your coins are already in your balance.");
        } else setOk("Your payment is still processing. Coins appear as soon as it clears.");
      })
      .catch((e) => setError(e.message))
      .finally(() => setParams({}, { replace: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buy = async (p: CoinPack) => {
    setBusy(p.id);
    setError(null);
    try {
      const r = await api<{ url: string }>("/coins/checkout", { json: { pack: p.id } });
      location.href = r.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start checkout.");
      setBusy(null);
    }
  };

  const money = (cents: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);

  return (
    <section className="panel">
      <h2>Coins</h2>
      <p className="settings-balance"><span className="coin-dot" /> {(channel?.coins ?? 0).toLocaleString()} <span className="muted">coins</span></p>
      <p className="muted small">Use coins in the Studio to promote your videos at the top of the home page.</p>
      {!packs ? (
        !error && <div className="page-loading"><span className="spinner" /></div>
      ) : (
        <div className="packs">
          {packs.map((p) => (
            <button key={p.id} className="pack" disabled={!!busy} onClick={() => buy(p)}>
              <strong>{busy === p.id ? <span className="spinner" /> : p.coins.toLocaleString()}</strong>
              <span>coins</span>
              <span className="pack-price">{money(p.amount)}</span>
            </button>
          ))}
        </div>
      )}
      {ok && <p className="form-ok">{ok}</p>}
      {error && <p className="form-error">{error}</p>}
      <p className="muted small">Payments are handled securely by Stripe.</p>
    </section>
  );
}

function PlaybackSection() {
  const [prefs, update] = useState<Prefs>(getPrefs);
  type Flag = "autoplay" | "muted" | "loop" | "effects";
  const toggle = (k: Flag) => {
    const next = { ...prefs, [k]: !prefs[k] };
    update(next);
    setPrefs(next);
  };
  const rows: { k: Flag; title: string; text: string }[] = [
    { k: "autoplay", title: "Autoplay", text: "Start videos as soon as the watch page opens." },
    { k: "muted", title: "Start muted", text: "Begin playback with the sound off." },
    { k: "loop", title: "Loop videos", text: "Replay a video from the start when it ends." },
    { k: "effects", title: "Background effects", text: "Falling snow, petals and stars on themed backgrounds." },
  ];
  return (
    <section className="panel">
      <h2>Playback &amp; look</h2>
      <p className="muted small">Saved on this device. Pick a background and avatar frame in <Link to="/decorations" className="link">Decorations</Link>.</p>
      <div className="switches">
        {rows.map((r) => (
          <label className="switch-row" key={r.k}>
            <div>
              <strong>{r.title}</strong>
              <span className="muted small">{r.text}</span>
            </div>
            <input type="checkbox" className="switch" checked={prefs[r.k]} onChange={() => toggle(r.k)} />
          </label>
        ))}
      </div>
    </section>
  );
}
