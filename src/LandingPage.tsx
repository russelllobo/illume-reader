import {
  ArrowRight,
  BookOpenText,

  Loader2,
  Mail,
  Pause,
  Play,
  Sparkles,
  Volume2,
  X
} from "lucide-react";
import { FormEvent, useEffect, useLayoutEffect, useState } from "react";

const CLASSIC_COVERS = [
  "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/cover-thumbnail.jpg",
  "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall/downloads/cover-thumbnail.jpg"
];

function ClassicsWall() {
  return (
    <div className="classics-wall" aria-hidden="true">
      <div className="classics-wall-grid">
        {CLASSIC_COVERS.map((url, i) => (
          <img key={i} src={url} alt="" />
        ))}
      </div>
    </div>
  );
}

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
}

const readerParagraphs = [
  "Begin each day by telling yourself: today I shall meet interference, ingratitude, insolence, disloyalty, ill-will, and selfishness. All of them come from ignorance of what is good and evil.",
  "But I have seen the beauty of good, and the ugliness of evil, and know that the wrongdoer has a nature related to my own. Not of the same blood or birth, but the same mind.",
  "None of them can hurt me. No one can implicate me in ugliness. We were born to work together, like hands, feet, and eyes, so return to the page and stay with it."
];

const readerWords = readerParagraphs.flatMap((paragraph) => paragraph.split(/\s+/));

function IllumeReaderText({ currentWordIndex }: { currentWordIndex: number }) {
  let wordOffset = 0;

  return (
    <>
      {readerParagraphs.map((paragraph) => {
        const words = paragraph.split(/\s+/);
        const paragraphStart = wordOffset;
        wordOffset += words.length;

        return (
          <p key={paragraphStart}>
            {words.map((word, idx) => {
              const absoluteIdx = paragraphStart + idx;

              return (
                <span key={`${paragraphStart}-${word}-${idx}`}>
                  <span className={absoluteIdx === currentWordIndex ? "illume-word active" : "illume-word"}>
                    {word}
                  </span>{" "}
                </span>
              );
            })}
          </p>
        );
      })}
    </>
  );
}

function IllumeProductScreenshot({
  activeVisualIndex,
  currentPercent,
  currentWordIndex,
  isPlaying,
  setIsPlaying,
  setWpm,
  wpm
}: {
  activeVisualIndex: number;
  currentPercent: number;
  currentWordIndex: number;
  isPlaying: boolean;
  setIsPlaying: (updater: (value: boolean) => boolean) => void;
  setWpm: (updater: (value: number) => number) => void;
  wpm: number;
}) {
  return (
    <div className="illume-screenshot-shell" aria-label="illume image mode product screenshot">
      <div className="illume-screenshot-topbar">
        <div className="illume-window-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span>Meditations / Book II</span>
      </div>

      <div className="illume-reader-screenshot">
        <aside className="illume-screen-sidebar">
          <div className="illume-screen-logo">
            <img src="/landing/logo.jpeg" alt="" />
            <span>illume</span>
          </div>
          <span className="illume-sidebar-active">Book II</span>
          <span>Notes</span>
          <span>Images</span>
        </aside>

        <div className="illume-screen-page">
          <div className="illume-screen-meta">Marcus Aurelius / 18%</div>
          <h3>Morning Reflection</h3>
          <IllumeReaderText currentWordIndex={currentWordIndex} />
        </div>

        <div className="illume-screen-image">
          <img
            src="/landing/marcus-meet-the-day.webp"
            alt="Generated visual for a passage about meeting the day"
            className={activeVisualIndex === 0 ? "active" : ""}
          />
          <img
            src="/landing/marcus-shared-nature.webp"
            alt="Generated visual for a passage about shared humanity"
            className={activeVisualIndex === 1 ? "active" : ""}
          />
        </div>
      </div>

      <div className="illume-player">
        <button
          onClick={() => setIsPlaying((value) => !value)}
          className="illume-play-button"
          title={isPlaying ? "Pause" : "Play"}
          type="button"
        >
          {isPlaying ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
        <Volume2 size={16} />
        <div className="illume-progress">
          <span style={{ width: `${currentPercent}%` }} />
        </div>
        <button
          onClick={() => setWpm((value) => Math.max(150, value - 25))}
          className="illume-speed-button"
          disabled={wpm <= 150}
          type="button"
          title="Decrease speed"
        >
          -
        </button>
        <span className="illume-speed">{wpm} WPM</span>
        <button
          onClick={() => setWpm((value) => Math.min(600, value + 25))}
          className="illume-speed-button"
          disabled={wpm >= 600}
          type="button"
          title="Increase speed"
        >
          +
        </button>
      </div>
    </div>
  );
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
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [wpm, setWpm] = useState(275);
  const [authPane, setAuthPane] = useState<"choice" | "email">("choice");
  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);

  useLayoutEffect(() => {
    document.documentElement.classList.add("landing-scroll");
    document.body.classList.add("landing-scroll");

    return () => {
      document.documentElement.classList.remove("landing-scroll");
      document.body.classList.remove("landing-scroll");
    };
  }, []);

  useEffect(() => {
    const updateHeader = () => setIsHeaderCondensed(window.scrollY > 24);

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    return () => window.removeEventListener("scroll", updateHeader);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = window.setInterval(() => {
      setCurrentWordIndex((prev) => (prev >= readerWords.length - 1 ? 0 : prev + 1));
    }, Math.max(360, Math.round(60000 / wpm)));

    return () => window.clearInterval(timer);
  }, [isPlaying, wpm]);

  const handleOpenAuth = (mode: "sign-in" | "sign-up") => {
    setAuthMode(mode);
    setAuthPane("choice");
    setIsAuthOpen(true);
  };

  const handleCloseAuth = () => {
    setAuthPane("choice");
    setIsAuthOpen(false);
  };

  const currentPercent = Math.round(((currentWordIndex + 1) / readerWords.length) * 100);
  const activeVisualIndex = currentWordIndex < Math.floor(readerWords.length * 0.55) ? 0 : 1;

  return (
    <div className="illume-theme">
      <header className={`illume-header${isHeaderCondensed ? " is-condensed" : ""}`}>
        <a href="#" className="illume-brand" aria-label="illume home">
          <img src="/landing/logo.jpeg" alt="" className="illume-brand-mark" />
          <span>illume</span>
        </a>
        <button onClick={() => handleOpenAuth("sign-in")} className="illume-sign-in-button" type="button">
          <BookOpenText size={15} />
          <span>Read now</span>
        </button>
      </header>

      <main>
        <section id="product" className="illume-hero">
          <div className="illume-hero-copy">
            <h1>Make reading immersive</h1>
            <p className="illume-hero-line">
              Get more immersed in every chapter with narration, word tracking, and visuals that help you stay with the book longer.
            </p>
            <div className="illume-actions">
              <button onClick={() => handleOpenAuth("sign-up")} className="illume-primary-button" type="button">
                <span>Read more books</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <div className="illume-hero-product">
            <IllumeProductScreenshot
              activeVisualIndex={activeVisualIndex}
              currentPercent={currentPercent}
              currentWordIndex={currentWordIndex}
              isPlaying={isPlaying}
              setIsPlaying={setIsPlaying}
              setWpm={setWpm}
              wpm={wpm}
            />
          </div>
        </section>

        <section id="library" className="illume-detail-section">
          <div className="illume-detail-left">
            <div className="illume-detail-header">
              <span className="illume-section-label">Private library</span>
              <h2>More focus. More chapters. More finished books.</h2>
            </div>
            <div className="illume-feature-lines">
              <p><BookOpenText size={18} /> Upload your EPUBs and pick up exactly where immersion broke last time.</p>
              <p><Volume2 size={18} /> Hear natural narration while the current words stay lit on the page.</p>
              <p><Sparkles size={18} /> Use image mode to make dense chapters feel easier to stay inside.</p>
            </div>
          </div>
          <div className="illume-detail-right">
            <ClassicsWall />
          </div>
        </section>

        <section id="pricing" className="illume-final-cta">
          <img src="/landing/logo.jpeg" alt="" aria-hidden="true" />
          <div>
            <span className="illume-section-label">Start reading</span>
            <h2>Read deeper. Finish more.</h2>
          </div>
          <button onClick={() => handleOpenAuth("sign-up")} className="illume-primary-button" type="button">
            <span>Get started free</span>
            <ArrowRight size={16} />
          </button>
        </section>
      </main>

      <footer className="illume-footer">
        <div className="illume-footer-brand">
          <img src="/landing/logo.jpeg" alt="" aria-hidden="true" />
          <span className="illume-footer-copy">
            <span className="illume-footer-name">illume</span>
            <span className="illume-footer-origin">Made in London</span>
          </span>
        </div>
      </footer>

      {isAuthOpen && (
        <div className="auth-modal-overlay" onClick={handleCloseAuth}>
          <div className="auth-modal-card illume-auth-card" onClick={(e) => e.stopPropagation()}>
            <button className="auth-modal-close" onClick={handleCloseAuth} title="Close" type="button">
              <X size={16} />
            </button>

            <div className="auth-modal-header">
              <img src="/landing/logo.jpeg" alt="" className="illume-auth-logo" />
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
