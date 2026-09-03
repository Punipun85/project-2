"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";
import { FormEvent, useState } from "react";

export function UpdatePasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password.length < 8) return setError("Password must contain at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setLoading(true);
    const response = await fetch("/api/auth/update-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(payload.error ?? "We could not update your password.");
      setLoading(false);
      return;
    }
    window.location.assign("/dashboard");
  };

  return (
    <section className="auth-panel compact">
      <div className="auth-heading"><span>SECURE YOUR ACCOUNT</span><h2>Choose a new password</h2><p>Use at least eight characters that you don&apos;t use elsewhere.</p></div>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="new-password">New password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <label htmlFor="confirm-new-password">Confirm new password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="confirm-new-password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
        {error && <p className="auth-message error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={loading}>{loading && <LoaderCircle className="auth-spinner" size={17} />}{loading ? "Updating password…" : "Update Password"}</button>
      </form>
    </section>
  );
}
