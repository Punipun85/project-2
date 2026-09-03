"use client";

import { LoaderCircle, Mail } from "lucide-react";
import { FormEvent, useState } from "react";
import { friendlyAuthError, isValidEmail } from "@/lib/supabase/auth-errors";
import { createSupabaseBrowserClient, type PublicSupabaseConfig } from "@/lib/supabase/browser";

export function MagicLinkForm({ config }: { config: PublicSupabaseConfig }) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (!isValidEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient(config);
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
          shouldCreateUser: true,
        },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (authError) {
      setError(friendlyAuthError(authError, "We could not send the magic link. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="auth-success" role="status">
        <span><Mail size={20} /></span>
        <div><strong>Check your email</strong><p>We sent you a secure login link at {email.trim()}.</p></div>
        <button type="button" onClick={() => setSent(false)}>Use another email</button>
      </div>
    );
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <label htmlFor="magic-email">Email address</label>
      <div className="auth-input-wrap">
        <Mail size={17} />
        <input id="magic-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(error)} />
      </div>
      {error && <p className="auth-message error" role="alert">{error}</p>}
      <button className="auth-submit" disabled={loading || !config.isConfigured}>
        {loading && <LoaderCircle className="auth-spinner" size={17} />}
        {loading ? "Sending secure link…" : "Send Magic Link"}
      </button>
    </form>
  );
}
