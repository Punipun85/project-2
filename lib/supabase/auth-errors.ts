export function friendlyAuthError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login credentials")) {
    return "Email or password is incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Please verify your email before signing in.";
  }
  if (normalized.includes("user already registered")) {
    return "An account with this email already exists.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (normalized.includes("password should be")) {
    return "Use at least 8 characters for your password.";
  }
  if (normalized.includes("fetch") || normalized.includes("network")) {
    return "We could not reach the authentication service. Please try again.";
  }

  return message && message !== "[object Object]" ? message : fallback;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
