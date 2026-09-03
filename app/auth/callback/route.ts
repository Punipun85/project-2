import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createSupabaseConfig } from "@/lib/supabase/config";
import { appendSessionCookies, ensureIdentityProfile } from "@/lib/supabase/server";

type CookieEntry = { name: string; value: string; options?: CookieOptions };

function parseCookies(request: Request): CookieEntry[] {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...value] = part.split("=");
      return { name, value: decodeURIComponent(value.join("=")) };
    });
}

function serializeCookie(cookie: CookieEntry): string {
  const options = cookie.options ?? {};
  const values = [`${cookie.name}=${encodeURIComponent(cookie.value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) values.push(`Max-Age=${options.maxAge}`);
  if (options.domain) values.push(`Domain=${options.domain}`);
  if (options.sameSite) values.push(`SameSite=${String(options.sameSite)}`);
  if (options.httpOnly) values.push("HttpOnly");
  if (options.secure) values.push("Secure");
  return values.join("; ");
}

function safeDestination(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const destination = safeDestination(requestUrl.searchParams.get("next"));
  const config = createSupabaseConfig();

  if (!code || !config.isConfigured) {
    const message = encodeURIComponent("The sign-in link is invalid or authentication is not configured.");
    return Response.redirect(new URL(`/auth/login?error=${message}`, requestUrl.origin), 303);
  }

  const cookieJar = new Map(parseCookies(request).map((cookie) => [cookie.name, cookie.value]));
  const responseCookies: CookieEntry[] = [];
  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll: () => Array.from(cookieJar, ([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const cookie of cookies) {
          cookieJar.set(cookie.name, cookie.value);
          responseCookies.push(cookie);
        }
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  const { data: sessionData } = error ? { data: { session: null } } : await supabase.auth.getSession();
  if (error || !sessionData.session) {
    const message = encodeURIComponent(error?.message ?? "We could not complete sign-in. Please try again.");
    return Response.redirect(new URL(`/auth/login?error=${message}`, requestUrl.origin), 303);
  }

  await ensureIdentityProfile(config, sessionData.session).catch(() => null);
  const response = Response.redirect(new URL(destination, requestUrl.origin), 303);
  for (const cookie of responseCookies) response.headers.append("set-cookie", serializeCookie(cookie));
  appendSessionCookies(response, sessionData.session);
  return response;
}
