import { Check, Clapperboard, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const highlights = [
  "AI-powered recommendations",
  "Personalized watch experience",
  "Discover movies, anime, and series",
];

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-experience">
      <section className="auth-story" aria-label="Entertainment AI introduction">
        <Link className="auth-logo" href="/" aria-label="Entertainment AI home">
          <span><Clapperboard size={20} /></span>
          <strong>Entertainment <i>AI</i></strong>
        </Link>

        <div className="auth-story-copy">
          <span className="auth-eyebrow"><Sparkles size={14} /> YOUR UNIVERSE, CURATED</span>
          <h1>Every story you love.<br /><em>Understood by AI.</em></h1>
          <p>Your personal AI movie, anime, and series companion.</p>
          <ul>
            {highlights.map((item) => <li key={item}><Check size={14} /> {item}</li>)}
          </ul>
        </div>

        <p className="auth-story-note">One account. Every entertainment universe.</p>
      </section>

      <section className="auth-form-side">
        <div className="auth-mobile-brand">
          <span><Clapperboard size={18} /></span>
          <strong>Entertainment <i>AI</i></strong>
        </div>
        {children}
        <p className="auth-legal">
          By continuing, you agree to our <Link href="/">Terms</Link> and <Link href="/">Privacy Policy</Link>.
        </p>
      </section>
    </main>
  );
}
