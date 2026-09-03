import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { createSupabaseConfig } from "@/lib/supabase/config";

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  const config = createSupabaseConfig();
  const params = await searchParams;
  return <AuthShell><LoginForm config={config} initialError={params?.error ?? ""} /></AuthShell>;
}
