import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, ChevronDown, Loader2, Mail, X } from "lucide-react";
import { COVERS, LOGO, PASSAGE_PARAGRAPHS } from "./concepts/shared";
import { PersuasionDemo } from "./PersuasionDemo";
import "./concepts/Concept2.css";

interface LandingPageProps {
  handleAuth: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  email: string;
  setEmail: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  authMode: "sign-in" | "sign-up";
  setAuthMode: (mode: "sign-in" | "sign-up") => void;
  busy: boolean;
  notice: string;
  colorScheme: "light" | "dark";
  onToggleColorScheme: () => void;
}

function GoogleIcon() {
  return (
    <svg className="auth-provider-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export function LandingPage({
  handleAuth,
  signInWithGoogle,
  email,
  setEmail,
  password,
  setPassword,
  authMode,
  setAuthMode,
  busy,
  notice
}: LandingPageProps) {
  const heroRef = useRef<HTMLElement>(null);
  const heroGlowRef = useRef<HTMLDivElement>(null);
  const heroWallLitRef = useRef<HTMLDivElement>(null);
  const heroTitleLitRef = useRef<HTMLHeadingElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const shelfLightRef = useRef<HTMLDivElement>(null);
  const finaleRef = useRef<HTMLElement>(null);
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [lit, setLit] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [authPane, setAuthPane] = useState<"choice" | "email">("choice");

  useEffect(() => {
    // A message that arrives with the page (for example after a Google sign-in
    // that came back without a session) belongs in the sign-in dialog.
    if (notice) setIsAuthOpen(true);
  }, [notice]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("landing-scroll");
    document.body.classList.add("landing-scroll");
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    mq.addEventListener("change", onMq);
    return () => {
      root.classList.remove("landing-scroll");
      document.body.classList.remove("landing-scroll");
      mq.removeEventListener("change", onMq);
    };
  }, []);

  useEffect(() => {
    const el = finaleRef.current;
    if (!el) return;
    if (reduced) {
      setLit(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setLit(true),
      { threshold: 0.45 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  useEffect(() => {
    const hero = heroRef.current;
    const glow = heroGlowRef.current;
    const wallLit = heroWallLitRef.current;
    const titleLit = heroTitleLitRef.current;
    if (!hero || !glow || reduced) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;
    let primed = false;
    let wallOffsetX = 0;
    let wallOffsetY = 0;
    let titleOffsetX = 0;
    let titleOffsetY = 0;

    const render = () => {
      raf = 0;
      x += (targetX - x) * 0.2;
      y += (targetY - y) * 0.2;
      glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (wallLit) {
        wallLit.style.setProperty("--c2-lit-x", `${x + wallOffsetX}px`);
        wallLit.style.setProperty("--c2-lit-y", `${y + wallOffsetY}px`);
      }
      if (titleLit) {
        titleLit.style.setProperty("--c2-title-x", `${x + titleOffsetX}px`);
        titleLit.style.setProperty("--c2-title-y", `${y + titleOffsetY}px`);
      }
      if (Math.abs(targetX - x) > 0.15 || Math.abs(targetY - y) > 0.15) {
        raf = requestAnimationFrame(render);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const rect = hero.getBoundingClientRect();
      const insideHero =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      // The nav floats over the hero; keep the light alive there, but let go
      // once the pointer reaches the demo or an open dialog covers the page.
      if (!insideHero || document.querySelector(".auth-modal-overlay")) {
        onLeave();
        return;
      }
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
      // Enter the section where the pointer actually is rather than sweeping
      // the light across from wherever it was last seen.
      if (!primed) {
        x = targetX;
        y = targetY;
        primed = true;
      }
      if (wallLit) {
        const wallRect = wallLit.getBoundingClientRect();
        wallOffsetX = wallRect.left - rect.left;
        wallOffsetY = wallRect.top - rect.top;
      }
      if (titleLit) {
        const titleRect = titleLit.getBoundingClientRect();
        titleOffsetX = titleRect.left - rect.left;
        titleOffsetY = titleRect.top - rect.top;
      }
      hero.classList.add("is-lit");
      if (!raf) raf = requestAnimationFrame(render);
    };

    const onLeave = () => {
      hero.classList.remove("is-lit");
      primed = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onLeave, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      hero.classList.remove("is-lit");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onLeave);
    };
  }, [reduced]);

  useEffect(() => {
    const shelf = shelfRef.current;
    const light = shelfLightRef.current;
    if (!shelf || !light || reduced) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      const r = shelf.getBoundingClientRect();
      x = e.clientX - r.left;
      y = e.clientY - r.top;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        light.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
        light.style.opacity = "1";
      });
    };
    const onLeave = () => {
      light.style.opacity = "0";
    };
    shelf.addEventListener("pointermove", onMove);
    shelf.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      shelf.removeEventListener("pointermove", onMove);
      shelf.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  const scrollToStory = () => storyRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });

  const handleOpenAuth = (mode: "sign-in" | "sign-up") => {
    setAuthMode(mode);
    setAuthPane("choice");
    setIsAuthOpen(true);
  };

  const handleCloseAuth = () => {
    setAuthPane("choice");
    setIsAuthOpen(false);
  };

  const wallParagraphs = [0, 1, 2].map((row) =>
    PASSAGE_PARAGRAPHS.map((paragraph, index) => <p key={`${row}-${index}`}>{paragraph}</p>)
  );

  return (
    <div className={`c2-root${reduced ? " c2-static" : ""}`}>
      <header className="c2-nav">
        <a className="c2-brand" href="#" aria-label="illume home">
          <img src={LOGO} alt="" width={30} height={30} />
          <span>illume</span>
        </a>
        <nav className="c2-nav-links" aria-label="Primary">
          <button type="button" className="c2-link" onClick={scrollToStory}>
            How it works
          </button>
          <button type="button" className="c2-link c2-hide-sm" onClick={() => handleOpenAuth("sign-in")}>
            Sign in
          </button>
          <button type="button" className="c2-btn c2-btn--small" onClick={() => handleOpenAuth("sign-up")}>
            Start free
          </button>
        </nav>
      </header>

      <main>
        <section className="c2-hero" ref={heroRef} aria-labelledby="c2-hero-title">
          <div className="c2-hero-wall" aria-hidden="true">
            <div className="c2-hero-wall-inner">{wallParagraphs}</div>
            <div className="c2-hero-wall-inner c2-hero-wall-lit" ref={heroWallLitRef}>
              {wallParagraphs}
            </div>
          </div>
          <div className="c2-hero-flame" aria-hidden="true" />
          <div className="c2-hero-content">
            <p className="c2-eyebrow">
              <span>illume</span> <em>/ɪˈluːm/</em> — to light up
            </p>
            <div className="c2-hero-title-wrap">
              <h1 id="c2-hero-title" className="c2-hero-title">
                Light up <span>every page.</span>
              </h1>
              <h1 className="c2-hero-title c2-hero-title-lit" aria-hidden="true" ref={heroTitleLitRef}>
                Light up <span>every page.</span>
              </h1>
            </div>
            <p className="c2-hero-sub">
              For minds that wander. Illume reads your books aloud, lights each word as it&apos;s spoken,
              and paints every scene — so you never lose the thread.
            </p>
            <div className="c2-hero-ctas">
              <button type="button" className="c2-btn" onClick={() => handleOpenAuth("sign-up")}>
                Start reading free <ArrowRight size={18} aria-hidden="true" />
              </button>
              <button type="button" className="c2-btn c2-btn--ghost" onClick={scrollToStory}>
                See it happen
              </button>
            </div>
          </div>
          <div className="c2-hero-glow" ref={heroGlowRef} aria-hidden="true">
            <span className="c2-hero-glow-core" />
          </div>
          <button type="button" className="c2-scroll-cue" onClick={scrollToStory} aria-label="Scroll to the demo">
            <span>Watch it light up</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </section>

        <section className="c2-story" ref={storyRef} aria-label="How Illume transforms a page">
          <PersuasionDemo />
        </section>

        <section className="c2-shelf-section" aria-labelledby="c2-shelf-title">
          <div className="c2-shelf-head">
            <h2 id="c2-shelf-title" className="c2-section-title">
              The classics, <span>by candlelight.</span>
            </h2>
            <p>Start with timeless books ready to read, hear and see — or bring your own.</p>
          </div>
          <div className="c2-shelf" ref={shelfRef}>
            <div className="c2-shelf-light" ref={shelfLightRef} aria-hidden="true" />
            <div className="c2-shelf-track">
              {[0, 1].map((copy) => (
                <ul className="c2-shelf-row" key={copy} aria-hidden={copy === 1 || undefined}>
                  {COVERS.map((c) => (
                    <li key={c.title}>
                      <button
                        type="button"
                        className="c2-cover"
                        onClick={() => handleOpenAuth("sign-up")}
                        aria-label={`Read ${c.title} by ${c.author}`}
                        tabIndex={copy === 1 ? -1 : undefined}
                      >
                        <img src={c.cover} alt="" loading="lazy" />
                        <span className="c2-cover-sheen" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
            <div className="c2-shelf-ledge" aria-hidden="true" />
          </div>
          <div className="c2-shelf-foot">
            <button type="button" className="c2-btn c2-btn--ghost" onClick={() => handleOpenAuth("sign-up")}>
              Browse the library <ArrowRight size={18} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section className={`c2-finale${lit ? " c2-finale--lit" : ""}`} ref={finaleRef} aria-labelledby="c2-finale-title">
          <div className="c2-finale-bloom" aria-hidden="true" />
          <h2 id="c2-finale-title" className="c2-finale-title">
            <span className="c2-finale-dim">Stop restarting the same chapter.</span>
            <span className="c2-finale-lit" aria-hidden="true">
              Stop restarting the same chapter.
            </span>
          </h2>
          <p className="c2-finale-sub">Your mind will wander. Illume brings it back.</p>
          <button type="button" className="c2-btn c2-btn--glow" onClick={() => handleOpenAuth("sign-up")}>
            Light up your first book <ArrowRight size={18} aria-hidden="true" />
          </button>
          <p className="c2-finale-note">Free plan · Pro when you want more</p>
        </section>
      </main>

      <footer className="c2-footer">
        <span className="c2-brand c2-brand--quiet">
          <img src={LOGO} alt="" width={22} height={22} />
          <span>illume</span>
        </span>
        <span>Made in London</span>
        <span>© 2026 Illume Reader</span>
      </footer>

      {isAuthOpen && (
        <div className="auth-modal-overlay" onClick={handleCloseAuth}>
          <div className="auth-modal-card illume-auth-card" onClick={(e) => e.stopPropagation()}>
            <button className="auth-modal-close" onClick={handleCloseAuth} title="Close" type="button">
              <X size={16} />
            </button>

            <div className="auth-modal-header">
              <img src="/landing/logo.webp" alt="" className="illume-auth-logo" />
              <h2>
                {authPane === "choice"
                  ? authMode === "sign-in"
                    ? "Sign in with email or Google"
                    : "Create your library"
                  : authMode === "sign-in"
                    ? "Sign in with email"
                    : "Create account with email"}
              </h2>
              <p>
                {authPane === "choice"
                  ? authMode === "sign-in"
                    ? "Choose how you want to get back to your books."
                    : "Choose how you want to start reading with illume."
                  : authMode === "sign-in"
                    ? "Enter your email and password to keep reading."
                    : "Add an email and password for your illume library."}
              </p>
            </div>

            {authPane === "choice" ? (
              <div className="auth-choice-pane">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAuthPane("email")}
                  className="auth-oauth-btn auth-choice-btn"
                >
                  <Mail size={18} />
                  <span>{authMode === "sign-in" ? "Sign in with email" : "Sign up with email"}</span>
                </button>

                <button type="button" disabled={busy} onClick={signInWithGoogle} className="auth-oauth-btn auth-choice-btn">
                  <GoogleIcon />
                  <span>Continue with Google</span>
                </button>
              </div>
            ) : (
              <form className="auth-modal-form" onSubmit={(event) => void handleAuth(event)}>
                <button type="button" className="auth-back-btn" onClick={() => setAuthPane("choice")}>
                  Back to options
                </button>

                <div className="auth-input-group">
                  <label htmlFor="auth-email">Email address</label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    placeholder="name@domain.com"
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="auth-input-field"
                  />
                </div>

                <div className="auth-input-group">
                  <label htmlFor="auth-password">Password</label>
                  <input
                    id="auth-password"
                    type="password"
                    required
                    minLength={6}
                    placeholder="........"
                    autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="auth-input-field"
                  />
                </div>

                <button type="submit" disabled={busy} className="auth-submit-btn">
                  {busy ? (
                    <>
                      <Loader2 className="spin" size={16} />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <span>{authMode === "sign-in" ? "Sign in" : "Create account"}</span>
                  )}
                </button>
              </form>
            )}

            <div className="auth-switch-mode">
              <button
                type="button"
                className="auth-switch-btn"
                onClick={() => {
                  setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
                  setAuthPane("choice");
                }}
              >
                {authMode === "sign-in" ? "Need an account? Sign up" : "Already have an account? Sign in"}
              </button>
            </div>

            {notice && <div className="auth-notice-toast">{notice}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
