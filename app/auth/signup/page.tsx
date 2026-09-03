import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/SignupForm";
import { createSupabaseConfig } from "@/lib/supabase/config";

export default function SignupPage() {
  return <AuthShell><SignupForm config={createSupabaseConfig()} /></AuthShell>;
}
