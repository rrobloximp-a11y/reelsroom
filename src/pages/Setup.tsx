import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, bannerUrl } from "../api";
import { hueFor } from "../format";
import { cropImage } from "../media";
import { useAuth } from "../auth";
import { Avatar } from "../components/Avatar";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_.-]+/g, "").slice(0, 30);

export default function Setup() {
  const { ready, user, channel, refresh } = useAuth();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [touchedHandle, setTouchedHandle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    if (channel) {
      setName(channel.name);
      setHandle(channel.handle);
      setBio(channel.bio);
      setTouchedHandle(true);
    } else if (user?.name) {
      setName(user.name);
    }
  }, [channel, user]);

  useEffect(() => {
    if (!touchedHandle) setHandle(slug(name.replace(/\s+/g, "")));
  }, [name, touchedHandle]);

  if (!ready) return <div className="page-loading"><span className="spinner" /></div>;
  if (!user) return <Navigate to="/signin?next=/setup" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { channel: c } = await api("/me/channel", { json: { name, handle, bio } });
      await refresh();
      navigate(params.get("next") || `/c/${c.handle}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <header className="page-head">
        <span className="kicker">{channel ? "Channel settings" : "Step 1 of 1"}</span>
        <h1>{channel ? "Edit your channel" : "Open your room"}</h1>
      </header>
      <form className="panel setup" onSubmit={submit}>
        <div className="setup-preview">
          <Avatar name={name || "?"} handle={handle || "x"} id={channel?.id} v={channel?.avatarVersion} frame={channel?.frame} size={72} />
          <div>
            <strong>{name || "Channel name"}</strong>
            <span>@{handle || "handle"}</span>
          </div>
        </div>
        <label className="field">
          <span>Channel name</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marisol Cooks Late" />
        </label>
        <label className="field">
          <span>Handle</span>
          <div className="input-prefix">
            <b>@</b>
            <input
              required
              pattern="[a-z0-9_.\-]{3,30}"
              value={handle}
              onChange={(e) => {
                setTouchedHandle(true);
                setHandle(slug(e.target.value));
              }}
            />
          </div>
          <small>3–30 characters. Lowercase letters, numbers, _ . -</small>
        </label>
        <label className="field">
          <span>About</span>
          <textarea rows={4} maxLength={1000} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="What do you make? When do you post?" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-accent" disabled={busy}>{busy ? <span className="spinner" /> : channel ? "Save changes" : "Create channel"}</button>
      </form>
      {channel && <ChannelArt />}
      {channel && (
        <p className="muted small art-foot">
          Need to change your password? <Link to="/account" className="link">Account settings</Link>
        </p>
      )}
    </div>
  );
}

function ChannelArt() {
  const { channel, setChannel } = useAuth();
  const [busy, setBusy] = useState<"avatar" | "banner" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  if (!channel) return null;

  const upload = async (kind: "avatar" | "banner", file: File | undefined) => {
    if (!file) return;
    setBusy(kind);
    setError(null);
    try {
      const blob = kind === "avatar" ? await cropImage(file, 400, 400) : await cropImage(file, 2048, 512);
      const { channel: c } = await api(`/me/${kind}`, { method: "PUT", body: blob });
      setChannel({ ...channel, ...c });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kind: "avatar" | "banner") => {
    setBusy(kind);
    setError(null);
    try {
      const { channel: c } = await api(`/me/${kind}`, { method: "DELETE" });
      setChannel({ ...channel, ...c });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove it.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="panel art">
      <h2 className="art-title">Channel art</h2>
      <div className="art-block">
        <span className="art-label">Banner</span>
        {channel.bannerVersion ? (
          <div className="art-banner banner-image" style={{ backgroundImage: `url("${bannerUrl(channel.id, channel.bannerVersion)}")` }} />
        ) : (
          <div className="art-banner banner" style={{ ["--h" as string]: hueFor(channel.handle) }}>
            <span className="art-empty">No banner yet</span>
          </div>
        )}
        <small className="muted">Wide images work best — we crop to 4:1 (2048×512).</small>
        <div className="row">
          <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => bannerInput.current?.click()}>
            {busy === "banner" ? <span className="spinner" /> : channel.bannerVersion ? "Change banner" : "Upload banner"}
          </button>
          {!!channel.bannerVersion && (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => remove("banner")}>Remove</button>
          )}
        </div>
        <input ref={bannerInput} type="file" accept="image/*" hidden onChange={(e) => { upload("banner", e.target.files?.[0]); e.target.value = ""; }} />
      </div>

      <div className="art-block art-icon">
        <Avatar name={channel.name} handle={channel.handle} id={channel.id} v={channel.avatarVersion} frame={channel.frame} size={96} />
        <div>
          <span className="art-label">Channel icon</span>
          <small className="muted">Square images look best. We crop to a circle.</small>
          <div className="row">
            <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => avatarInput.current?.click()}>
              {busy === "avatar" ? <span className="spinner" /> : channel.avatarVersion ? "Change icon" : "Upload icon"}
            </button>
            {!!channel.avatarVersion && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => remove("avatar")}>Remove</button>
            )}
          </div>
        </div>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { upload("avatar", e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}
