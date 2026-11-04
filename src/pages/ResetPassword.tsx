import { useState, type FormEvent } from "react";
import { AuthError, updateUser } from "@netlify/identity";
import { useAuth } from "../auth";
import { Logo } from "../components/Layout";

export default function ResetPassword() {
  const { clearRecovery, refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateUser({ password });
      await refresh();
      clearRecovery();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Couldn't update your password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth auth-solo">
      <form className="auth-card pop" onSubmit={submit}>
        <Logo />
        <h2 className="auth-sub">Choose a new password</h2>
        <label className="field">
          <span>New password</span>
          <input type="password" minLength={6} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-accent btn-block" disabled={busy}>{busy ? <span className="spinner" /> : "Save password"}</button>
      </form>
    </div>
  );
}
