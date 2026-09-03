"use client";

import { useEffect, useState } from "react";

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Completing your secure sign-in…");

  useEffect(() => {
    const values = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = values.get("access_token");
    const refreshToken = values.get("refresh_token");
    if (!accessToken || !refreshToken) {
      const timeout = window.setTimeout(
        () => setMessage("The magic link is invalid or expired. Please request a new one."),
        0,
      );
      return () => window.clearTimeout(timeout);
    }
    void fetch("/api/auth/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
    }).then((response) => {
      if (!response.ok) throw new Error("session failed");
      window.history.replaceState(null, "", "/auth/callback");
      window.location.assign("/profile");
    }).catch(() => setMessage("We could not complete sign-in. Please request a new magic link."));
  }, []);

  return <main className="auth-page"><section className="auth-card"><h1>NexaPlay AI</h1><p>{message}</p></section></main>;
}
