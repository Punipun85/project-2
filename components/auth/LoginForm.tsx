"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { friendlyAuthError, isValidEmail } from "@/lib/supabase/auth-errors";
import { createSupabaseBrowserClient, type PublicSupabaseConfig } from "@/lib/supabase/browser";
import { GoogleButton } from "./GoogleButton";
import { MagicLinkForm } from "./MagicLinkForm";

export function LoginForm({ config, initialError = "" }: { config: PublicSupabaseConfig; initialError?: string }) {
  const [method, setMethod] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initialError);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient(config);
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      if (!data.session) throw new Error("No session was returned.");
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data.session),
      });
      if (!response.ok) throw new Error("We could not create your secure session.");
      window.location.assign("/dashboard");
    } catch (authError) {
      setError(friendlyAuthError(authError, "Sign-in failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth-panel">
      <div className="auth-heading"><span>WELCOME BACK</span><h2>Welcome Back</h2><p>Sign in to continue discovering your next favorite movies and series.</p></div>
      {!config.isConfigured && <p className="auth-message error" role="alert">Authentication is not configured yet. Add your Supabase URL and anon key.</p>}
      <GoogleButton config={config} label="Continue with Google" disabled={!config.isConfigured} onError={setError} />
      <div className="auth-divider"><span>OR</span></div>
      <div className="auth-method-tabs" role="tablist" aria-label="Email sign-in method">
        <button type="button" role="tab" aria-selected={method === "magic"} className={method === "magic" ? "active" : ""} onClick={() => { setMethod("magic"); setError(""); }}>Magic link</button>
        <button type="button" role="tab" aria-selected={method === "password"} className={method === "password" ? "active" : ""} onClick={() => { setMethod("password"); setError(""); }}>Password</button>
      </div>
      {method === "magic" ? <MagicLinkForm config={config} /> : (
        <form className="auth-form" onSubmit={submitPassword} noValidate>
          <label htmlFor="login-email">Email address</label>
          <div className="auth-input-wrap"><Mail size={17} /><input id="login-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="auth-label-row"><label htmlFor="login-password">Password</label><Link href="/auth/forgot-password">Forgot password?</Link></div>
          <div className="auth-input-wrap"><KeyRound size={17} /><input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          {error && <p className="auth-message error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={loading || !config.isConfigured}>{loading && <LoaderCircle className="auth-spinner" size={17} />}{loading ? "Signing in…" : "Sign In"}</button>
        </form>
      )}
      {method === "magic" && error && <p className="auth-message error" role="alert">{error}</p>}
      <p className="auth-switch">Don&apos;t have an account? <Link href="/auth/signup">Create account</Link></p>
    </section>
  );
}
