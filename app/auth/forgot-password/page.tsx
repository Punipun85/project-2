import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { createSupabaseConfig } from "@/lib/supabase/config";

export default function ForgotPasswordPage() {
  return <AuthShell><ForgotPasswordForm config={createSupabaseConfig()} /></AuthShell>;
}
