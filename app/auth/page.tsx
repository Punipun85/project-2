"use client";

import { ArrowLeft, KeyRound, Mail, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function AuthPage() {
  const [mode, setMode] = useState<"login" | "register" | "magic">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setStatus("");
    const endpoint = mode === "magic" ? "magic-link" : mode;
    try {
      const response = await fetch(`/api/auth/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, username }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Authentication failed");
      if (mode === "magic") setStatus("Magic link sent. Check your email.");
      else if (payload.confirmationRequired) setStatus("Check your email to confirm the account.");
      else window.location.assign("/profile");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="auth-page">
      <Link href="/" className="auth-back"><ArrowLeft size={15} /> Back to NexaPlay</Link>
      <section className="auth-card">
        <div className="auth-brand"><span><Sparkles size={20} /></span><div><h1>NexaPlay <i>AI</i></h1><p>Your entertainment universe, remembered.</p></div></div>
        <div className="auth-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Sign in</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Create account</button><button className={mode === "magic" ? "active" : ""} onClick={() => setMode("magic")}>Magic link</button></div>
        <form onSubmit={submit}>
          {mode === "register" && <label>Username<div><Sparkles size={15} /><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Your display name" /></div></label>}
          <label>Email<div><Mail size={15} /><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></div></label>
          {mode !== "magic" && <label>Password<div><KeyRound size={15} /><input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></div></label>}
          <button className="primary-action" disabled={loading}>{loading ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : "Send magic link"}</button>
          {status && <p className="auth-status">{status}</p>}
        </form>
        <small>Authentication is handled by Supabase. NexaPlay never stores your password.</small>
      </section>
    </main>
  );
}
