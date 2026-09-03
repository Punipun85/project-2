"use client";

import { ArrowLeft, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { friendlyAuthError, isValidEmail } from "@/lib/supabase/auth-errors";
import { createSupabaseBrowserClient, type PublicSupabaseConfig } from "@/lib/supabase/browser";

export function ForgotPasswordForm({ config }: { config: PublicSupabaseConfig }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!isValidEmail(email)) return setError("Please enter a valid email address.");
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient(config);
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (authError) throw authError;
      setMessage("Password reset link sent. Check your inbox.");
    } catch (authError) {
      setError(friendlyAuthError(authError, "We could not send the reset link. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="auth-panel compact">
      <Link className="auth-inline-back" href="/auth/login"><ArrowLeft size={15} /> Back to sign in</Link>
      <div className="auth-heading"><span>ACCOUNT RECOVERY</span><h2>Reset your password</h2><p>Enter your email and we&apos;ll send you a secure reset link.</p></div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <label htmlFor="recovery-email">Email address</label><div className="auth-input-wrap"><Mail size={17} /><input id="recovery-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
        {error && <p className="auth-message error" role="alert">{error}</p>}
        {message && <p className="auth-message success" role="status">{message}</p>}
        <button className="auth-submit" disabled={loading || !config.isConfigured}>{loading && <LoaderCircle className="auth-spinner" size={17} />}{loading ? "Sending reset link…" : "Send Reset Link"}</button>
      </form>
    </section>
  );
}
