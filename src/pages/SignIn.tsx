import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AuthError, MissingIdentityError, login, requestPasswordRecovery, signup } from "@netlify/identity";
import { useAuth } from "../auth";

type Tab = "signin" | "signup" | "forgot";

function message(e: unknown) {
  if (e instanceof MissingIdentityError) return "Accounts aren't available in this environment yet.";
  if (e instanceof AuthError) {
    if (e.status === 401) return "That email and password don't match.";
    if (e.status === 403) return "New sign-ups are closed right now.";
    if (e.status === 422) return e.message || "Check your email and password (6+ characters).";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

export default function SignIn() {
  const [tab, setTab] = useState<Tab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { user, channel, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/";

  useEffect(() => {
    if (user) navigate(channel ? next : `/setup?next=${encodeURIComponent(next)}`, { replace: true });
  }, [user, channel, next, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      if (tab === "signin") {
        await login(email, password);
        await refresh();
      } else if (tab === "signup") {
        const u = await signup(email, password, { full_name: name });
        if (u.confirmedAt) await refresh();
        else setInfo("Check your inbox — click the confirmation link to finish creating your account.");
      } else {
        await requestPasswordRecovery(email);
        setInfo("If that email has an account, a reset link is on its way.");
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-side">
        <span className="kicker">Reelroom</span>
        <h1>Your work, <em>on the big screen.</em></h1>
        <p>Upload videos, build an audience, and talk with the people who watch.</p>
      </div>
      <form className="auth-card pop" onSubmit={submit}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "signin"} onClick={() => setTab("signin")}>Sign in</button>
          <button type="button" role="tab" aria-selected={tab === "signup"} onClick={() => setTab("signup")}>Create account</button>
        </div>
        {tab === "forgot" && <h2 className="auth-sub">Reset your password</h2>}
        {tab === "signup" && (
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        {tab !== "forgot" && (
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={tab === "signup" ? "new-password" : "current-password"}
            />
          </label>
        )}
        {error && <p className="form-error">{error}</p>}
        {info && <p className="form-info">{info}</p>}
        <button className="btn btn-accent btn-block" disabled={busy}>
          {busy ? <span className="spinner" /> : tab === "signin" ? "Sign in" : tab === "signup" ? "Create account" : "Send reset link"}
        </button>
        <div className="auth-links">
          {tab === "signin" ? (
            <button type="button" className="link" onClick={() => setTab("forgot")}>Forgot password?</button>
          ) : tab === "forgot" ? (
            <button type="button" className="link" onClick={() => setTab("signin")}>Back to sign in</button>
          ) : null}
          <Link to="/" className="link">Keep browsing</Link>
        </div>
      </form>
    </div>
  );
}
