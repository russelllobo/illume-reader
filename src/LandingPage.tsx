import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  AudioLines,
  BookOpen,
  ChevronDown,
  Highlighter,
  ImageIcon,
  Loader2,
  Mail,
  Pause,
  X
} from "lucide-react";
import { COVERS, LOGO, PASSAGE_BOOK, PASSAGE_PARAGRAPHS } from "./concepts/shared";
import "./concepts/Concept2.css";

const BARS = 28;
const WAVE_HEIGHTS = [0.32, 0.68, 0.44, 0.92, 0.56, 0.78, 0.36, 0.62, 0.48, 0.86, 0.4, 0.72, 0.3, 0.58];
// Static snapshot of the word being read, so the demo reads as a live page.
const NOW_WORD = 11;

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

  const paragraphs = useMemo(() => {
    let i = 0;
    return PASSAGE_PARAGRAPHS.map((p) => p.split(/\s+/).map((w) => ({ w, i: i++ })));
  }, []);

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
        <section className="c2-hero" aria-labelledby="c2-hero-title">
          <div className="c2-hero-wall" aria-hidden="true">
            <div className="c2-hero-wall-inner">
              {[0, 1, 2].map((r) =>
                PASSAGE_PARAGRAPHS.map((p, k) => <p key={`${r}-${k}`}>{p}</p>)
              )}
            </div>
          </div>
          <div className="c2-hero-flame" aria-hidden="true" />
          <div className="c2-hero-content">
            <p className="c2-eyebrow">
              <span>illume</span> <em>/ɪˈluːm/</em> — to light up
            </p>
            <h1 id="c2-hero-title" className="c2-hero-title">
              Light up <span>every page.</span>
            </h1>
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
          <button type="button" className="c2-scroll-cue" onClick={scrollToStory} aria-label="Scroll to the demo">
            <span>Watch it light up</span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
        </section>

        <section className="c2-story" ref={storyRef} aria-label="How Illume transforms a page">
          <div className="c2-stage">
            <div className="c2-stage-glow" aria-hidden="true" />
            <div className="c2-stage-grid">
              <div className="c2-demo-heading">
                <h2>A page, brought to life.</h2>
              </div>

              <div className="c2-visual">
                <div className="c2-device">
                  <div className="c2-device-shell" aria-hidden="true" />
                  <div className="c2-topbar" aria-hidden="true">
                    <img src={PASSAGE_BOOK.cover} alt="" />
                    <div>
                      <strong>{PASSAGE_BOOK.title}</strong>
                      <span>{PASSAGE_BOOK.author} · Chapter 9</span>
                    </div>
                  </div>
                  <div className="c2-device-body">
                    <article className="c2-page" aria-label={`Excerpt from ${PASSAGE_BOOK.title}`}>
                      <p className="c2-page-chapter">Chapter IX</p>
                      <div className="c2-page-view">
                        <div className="c2-text">
                          {paragraphs.map((para, pk) => (
                            <p key={pk}>
                              {para.map(({ w, i }) => (
                                <Fragment key={i}>
                                  <span
                                    className={`c2-w${i < NOW_WORD ? " c2-w--read" : i === NOW_WORD ? " c2-w--now" : ""}`}
                                  >
                                    {w}
                                  </span>{" "}
                                </Fragment>
                              ))}
                            </p>
                          ))}
                        </div>
                      </div>
                      <div className="c2-player">
                        <span className="c2-player-btn" aria-hidden="true">
                          <Pause size={15} />
                        </span>
                        <span className="c2-wave" aria-hidden="true">
                          {Array.from({ length: BARS }, (_, k) => (
                            <i
                              key={k}
                              style={{ transform: `scaleY(${WAVE_HEIGHTS[k % WAVE_HEIGHTS.length]})` }}
                            />
                          ))}
                        </span>
                      </div>
                    </article>
                    <figure className="c2-art">
                      <div className="c2-art-bloom" aria-hidden="true" />
                      <div className="c2-art-frame">
                        <img src="/landing/reader-cartoon-1.webp"
                          alt="Cartoon illustration of characters from Pride and Prejudice" />
                      </div>
                    </figure>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="c2-recap" aria-labelledby="c2-recap-title">
          <h2 id="c2-recap-title" className="c2-section-title">
            Everything lit. <span>Nothing lost.</span>
          </h2>
          <ul className="c2-recap-list">
            <li>
              <AudioLines aria-hidden="true" />
              <h3>Natural narration</h3>
              <p>Geffen reads any chapter aloud with real warmth and rhythm.</p>
            </li>
            <li>
              <Highlighter aria-hidden="true" />
              <h3>Live word tracking</h3>
              <p>Each word glows as it&apos;s spoken, so your place is never lost.</p>
            </li>
            <li>
              <ImageIcon aria-hidden="true" />
              <h3>Image Mode</h3>
              <p>An illustration for every section keeps the story in sight.</p>
            </li>
            <li>
              <BookOpen aria-hidden="true" />
              <h3>Your whole library</h3>
              <p>EPUB and PDF, picked up exactly where you left off.</p>
            </li>
          </ul>
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
