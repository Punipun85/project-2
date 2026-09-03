"use client";

import { LoaderCircle } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { friendlyAuthError } from "@/lib/supabase/auth-errors";
import { createSupabaseBrowserClient, type PublicSupabaseConfig } from "@/lib/supabase/browser";

type GoogleButtonProps = {
  config: PublicSupabaseConfig;
  label: string;
  disabled?: boolean;
  onError: (message: string) => void;
};

export function GoogleButton({ config, label, disabled, onError }: GoogleButtonProps) {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    onError("");
    try {
      const supabase = createSupabaseBrowserClient(config);
      const redirectTo = `${window.location.origin}/auth/callback?next=/dashboard`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          scopes: "openid email profile",
          queryParams: { access_type: "offline", prompt: "select_account" },
        },
      });
      if (error) throw error;
    } catch (error) {
      setLoading(false);
      onError(friendlyAuthError(error, "Google sign-in failed. Please try again."));
    }
  };

  return (
    <button className="google-auth-button" type="button" onClick={signIn} disabled={disabled || loading}>
      {loading ? <LoaderCircle className="auth-spinner" size={18} /> : (
        <Image src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" width={18} height={18} unoptimized />
      )}
      {loading ? "Connecting to Google…" : label}
    </button>
  );
}
