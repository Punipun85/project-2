"use client";

import { Eye, EyeOff, KeyRound, LoaderCircle, Mail, UserRound } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { friendlyAuthError, isValidEmail } from "@/lib/supabase/auth-errors";
import { createSupabaseBrowserClient, type PublicSupabaseConfig } from "@/lib/supabase/browser";
import { GoogleButton } from "./GoogleButton";

export function SignupForm({ config }: { config: PublicSupabaseConfig }) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (fullName.trim().length < 2) return setError("Please enter your full name.");
    if (!isValidEmail(email)) return setError("Please enter a valid email address.");
    if (password.length < 8) return setError("Password must contain at least 8 characters.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient(config);
      const { data, error: authError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          data: { full_name: fullName.trim(), username: fullName.trim() },
        },
      });
      if (authError) throw authError;
      if (data.session) {
        const response = await fetch("/api/auth/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data.session) });
        const sessionResult = await response.json();
        window.location.assign(sessionResult.next ?? "/onboarding");
        return;
      }
      setSuccess(true);
    } catch (authError) {
      setError(friendlyAuthError(authError, "Account creation failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return <section className="auth-panel"><div className="auth-success large"><span><Mail size={22} /></span><div><strong>Verify your email</strong><p>We sent an activation link to {email.trim()}. Open it to activate your Entertainment AI account.</p></div><Link href="/auth/login">Back to sign in</Link></div></section>;
  }

  return (
    <section className="auth-panel">
      <div className="auth-heading"><span>START YOUR JOURNEY</span><h2>Create Your Account</h2><p>Join Entertainment AI and get personalized recommendations.</p></div>
      {!config.isConfigured && <p className="auth-message error" role="alert">Authentication is not configured yet. Add your Supabase URL and anon key.</p>}
      <GoogleButton config={config} label="Sign up with Google" disabled={!config.isConfigured} onError={setError} />
      <div className="auth-divider"><span>OR</span></div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <label htmlFor="signup-name">Full Name</label><div className="auth-input-wrap"><UserRound size={17} /><input id="signup-name" autoComplete="name" placeholder="Your full name" value={fullName} onChange={(event) => setFullName(event.target.value)} /></div>
        <label htmlFor="signup-email">Email address</label><div className="auth-input-wrap"><Mail size={17} /><input id="signup-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        <label htmlFor="signup-password">Password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="signup-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="At least 8 characters" value={password} onChange={(event) => setPassword(event.target.value)} /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
        <label htmlFor="signup-confirm">Confirm Password</label><div className="auth-input-wrap"><KeyRound size={17} /><input id="signup-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Repeat your password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></div>
        {error && <p className="auth-message error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={loading || !config.isConfigured}>{loading && <LoaderCircle className="auth-spinner" size={17} />}{loading ? "Creating your account…" : "Create Account"}</button>
      </form>
      <p className="auth-switch">Already have an account? <Link href="/auth/login">Sign in</Link></p>
    </section>
  );
}
