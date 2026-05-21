import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Brain,
  Loader2,
  Play,
  Pause,
  Sparkles,
  X,
  Target
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";

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

const passageWords = [
  "Begin", "each", "day", "by", "telling", "yourself:", "today", "I",
  "shall", "meet", "interference,", "ingratitude,", "insolence,", "disloyalty,",
  "ill-will,", "and", "selfishness.", "All", "of", "them", "come", "from",
  "ignorance", "of", "what", "is", "good", "and", "evil.", "But", "I",
  "have", "seen", "the", "beauty", "of", "good,", "and", "the", "ugliness",
  "of", "evil,", "and", "know", "that", "the", "wrongdoer", "has", "a",
  "nature", "related", "to", "my", "own."
];

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

  // Interval timer for simulated word tracking
  useEffect(() => {
    if (!isPlaying) return;

    const intervalMs = Math.round(60000 / wpm);

    const timer = setInterval(() => {
      setCurrentWordIndex((prev) => {
        if (prev >= passageWords.length - 1) {
          return 0; // loop back to start
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, wpm]);

  const handleWpmDecrease = () => {
    setWpm((prev) => Math.max(150, prev - 25));
  };

  const handleWpmIncrease = () => {
    setWpm((prev) => Math.min(600, prev + 25));
  };

  const toggleDemo = () => {
    if (!isPlaying && currentWordIndex === -1) {
      setCurrentWordIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleOpenAuth = (mode: "sign-in" | "sign-up") => {
    setAuthMode(mode);
    setIsAuthOpen(true);
  };

  const handleCloseAuth = () => {
    setIsAuthOpen(false);
  };

  const currentPercent = currentWordIndex >= 0 
    ? Math.round(((currentWordIndex + 1) / passageWords.length) * 100) 
    : 0;
  const activeVisualIndex = currentWordIndex < 34 ? 0 : 1;

  return (
    <div className="landing-theme">
      <div className="landing-wrapper">
        {/* Navigation Header */}
        <header className="landing-header">
          <a href="#" className="landing-logo">
            <BookOpen className="landing-logo-icon" size={24} />
            <span>reader</span>
          </a>
          <nav className="landing-nav">
            <div className="landing-nav-links" style={{ display: "flex", gap: "24px" }}>
              <a href="#features" className="landing-nav-link">Features</a>
              <a href="#comparison" className="landing-nav-link">How It Works</a>
              <a href="#testimonials" className="landing-nav-link">Pricing</a>
            </div>
            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <button 
                onClick={() => handleOpenAuth("sign-in")} 
                className="btn-secondary" 
                style={{ height: "38px", padding: "0 16px", fontSize: "0.85rem" }}
              >
                Sign In
              </button>
              <button 
                onClick={() => handleOpenAuth("sign-up")} 
                className="btn-primary" 
                style={{ height: "38px", padding: "0 16px", fontSize: "0.85rem", boxShadow: "none" }}
              >
                Get Started Free
              </button>
            </div>
          </nav>
        </header>

        {/* Hero Section */}
        <main className="landing-hero">
          <div className="hero-content">
            <div className="hero-badge">
              <span>★ Built for curious, lifelong learners</span>
            </div>
            <h1 className="hero-title">
              The Smarter Way<br />
              to <span>Read More Books</span>
            </h1>
            <p className="hero-desc">
              A reading app that narrates your books, tracks the words as you listen, and pairs the text with immersive visuals so every chapter feels easier to enter.
            </p>
            <div className="hero-actions">
              <button onClick={() => handleOpenAuth("sign-up")} className="btn-primary">
                <span>Get Started Free</span>
                <ArrowRight size={16} />
              </button>
              <button onClick={toggleDemo} className="btn-secondary">
                <span>See How It Works</span>
                <Play size={14} />
              </button>
            </div>
            <div className="hero-ratings-row">
              <div className="rating-avatars">
                <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&h=100&q=80" alt="User avatar" className="rating-avatar" />
                <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=100&h=100&q=80" alt="User avatar" className="rating-avatar" />
                <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=100&h=100&q=80" alt="User avatar" className="rating-avatar" />
                <img src="https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=100&h=100&q=80" alt="User avatar" className="rating-avatar" />
              </div>
              <div className="rating-text">
                <span className="rating-stars">★★★★★ </span>
                <span>Join 1,000+ readers building a more immersive reading habit</span>
              </div>
            </div>
          </div>

          <div className="mock-browser-container">
            <div className="mock-browser">
              <div className="mock-chrome">
                <div className="chrome-dots">
                  <div className="chrome-dot red" />
                  <div className="chrome-dot yellow" />
                  <div className="chrome-dot green" />
                </div>
                <div className="chrome-address-bar">reader.app</div>
                <div className="chrome-actions">
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", cursor: "pointer" }}>Aa</span>
                </div>
              </div>
              <div className="mock-browser-screen">
                <aside className="mock-sidebar">
                  <div className="mock-sidebar-brand">
                    <BookOpen size={12} className="landing-logo-icon" />
                    <span>reader</span>
                  </div>
                  <div className="mock-sidebar-list">
                    <div className="mock-sidebar-item"><BookOpen size={10} /> <span>Contents</span></div>
                    <div className="mock-sidebar-item active"><BookOpen size={10} /> <span>Book I</span></div>
                    <div className="mock-sidebar-item"><BookOpen size={10} /> <span>Book II</span></div>
                    <div className="mock-sidebar-item"><BookOpen size={10} /> <span>Book III</span></div>
                    <div className="mock-sidebar-item"><BookOpen size={10} /> <span>Notes</span></div>
                  </div>
                </aside>
                
                <div className="mock-content-panel">
                  <div className="mock-book-header">
                    <span>Meditations — Marcus Aurelius</span>
                    <span>Book II (18%)</span>
                  </div>
                  <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", fontWeight: 700, margin: "14px 0 6px", color: "var(--text-primary)" }}>
                    Morning Reflection
                  </h3>
                  <div className="mock-book-paragraph">
                    {passageWords.slice(0, 31).map((word, idx) => {
                      const absoluteIdx = idx;
                      return (
                        <span
                          key={absoluteIdx}
                          className={`mock-word ${absoluteIdx === currentWordIndex ? "highlighted" : ""}`}
                        >
                          {word}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mock-book-paragraph" style={{ marginTop: "12px" }}>
                    {passageWords.slice(31, 46).map((word, idx) => {
                      const absoluteIdx = 31 + idx;
                      return (
                        <span
                          key={absoluteIdx}
                          className={`mock-word ${absoluteIdx === currentWordIndex ? "highlighted" : ""}`}
                        >
                          {word}
                        </span>
                      );
                    })}
                  </div>
                  <div className="mock-book-paragraph" style={{ marginTop: "12px" }}>
                    {passageWords.slice(46, 60).map((word, idx) => {
                      const absoluteIdx = 46 + idx;
                      return (
                        <span
                          key={absoluteIdx}
                          className={`mock-word ${absoluteIdx === currentWordIndex ? "highlighted" : ""}`}
                        >
                          {word}
                        </span>
                      );
                    })}
                  </div>

                </div>

                <div className="mock-right-panel">
                  <div className="visual-stage">
                    <img
                      src="/landing/marcus-meet-the-day.webp"
                      alt="AI-generated cartoon visual of Marcus Aurelius preparing to meet the day"
                      className={`visual-panel-image ${activeVisualIndex === 0 ? "active" : ""}`}
                    />
                    <img
                      src="/landing/marcus-shared-nature.webp"
                      alt="AI-generated cartoon visual of Marcus Aurelius recognizing shared humanity"
                      className={`visual-panel-image ${activeVisualIndex === 1 ? "active" : ""}`}
                    />
                    <div className="visual-magic">
                      <Sparkles size={12} />
                    </div>
                  </div>
                </div>
              </div>

              <div className="mock-rail">
                <div className="mock-progress-container">
                  <button onClick={toggleDemo} className="mock-btn-play" title={isPlaying ? "Pause" : "Play"} type="button">
                    {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
                  </button>
                  <div className={`soundwave-container ${isPlaying ? "playing" : ""}`} title="Active Audio Sync">
                    <div className="soundwave-bar" />
                    <div className="soundwave-bar" />
                    <div className="soundwave-bar" />
                    <div className="soundwave-bar" />
                    <div className="soundwave-bar" />
                  </div>
                  <div className="mock-progress-bar">
                    <div 
                      className="mock-progress-fill" 
                      style={{ width: `${currentPercent}%` }} 
                    />
                  </div>
                  <span className="mock-progress-time">{currentPercent}%</span>
                </div>
                <div className="mock-controls">
                  <div className="wpm-stepper">
                    <button 
                      onClick={handleWpmDecrease} 
                      className="wpm-btn" 
                      disabled={wpm <= 150} 
                      title="Decrease Speed"
                      type="button"
                    >
                      −
                    </button>
                    <span className="wpm-value">{wpm} WPM</span>
                    <button 
                      onClick={handleWpmIncrease} 
                      className="wpm-btn" 
                      disabled={wpm >= 600} 
                      title="Increase Speed"
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Features Grid Section */}
        <section id="features" className="science-section">
          <div className="science-header">
            <div className="section-badge">Why readers love reader</div>
            <h2 className="section-title">Everything you need to stay inside the book</h2>
          </div>
          <div className="science-grid">
            <div className="science-card">
              <div className="card-icon-box blue">
                <BookOpen size={22} />
              </div>
              <h3 className="card-title">Active Reading</h3>
              <p className="card-desc">
                Follow along as narration highlights the exact words being read, so your eyes and ears stay in sync.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box purple">
                <Brain size={22} />
              </div>
              <h3 className="card-title">Immersive Visuals</h3>
              <p className="card-desc">
                Pair chapters with atmospheric images that make setting, tone, and ideas easier to feel.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box green">
                <Target size={22} />
              </div>
              <h3 className="card-title">Reading Progress</h3>
              <p className="card-desc">
                Keep your library, current position, and pace synced so it is simple to return to any book.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box orange">
                <Bookmark size={22} />
              </div>
              <h3 className="card-title">Private EPUB Library</h3>
              <p className="card-desc">
                Upload your own EPUBs and read them in a focused, narration-first space.
              </p>
            </div>
          </div>
        </section>

        {/* Comparison Bento Section */}
        <section id="comparison" className="comparison-section">
          <div className="science-header">
            <h2 className="section-title">Passive Reading vs. Immersive Reading</h2>
          </div>
          <div className="comparison-bento">
            <div className="comp-card">
              <div className="comp-card-header">
                <h3>Passive Reading</h3>
                <p>Easy to start. Easy to forget.</p>
              </div>
              <div className="comp-visual">
                {/* SVG outline illustration of passive reading */}
                <svg width="180" height="90" viewBox="0 0 180 90" fill="none" style={{ opacity: 0.6 }}>
                  <path d="M40 70C55 70 70 65 70 50C70 35 55 30 40 30" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" />
                  <circle cx="40" cy="20" r="8" stroke="var(--text-muted)" strokeWidth="2" />
                  <path d="M120 60C110 50 115 40 125 45" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 3" />
                  <circle cx="135" cy="40" r="10" stroke="var(--text-muted)" strokeWidth="1.5" strokeDasharray="3 3" />
                </svg>
              </div>
              <div className="comp-bullet-list">
                <div className="comp-bullet">
                  <div className="bullet-icon cross">✕</div>
                  <div className="bullet-text">Skim without focus</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon cross">✕</div>
                  <div className="bullet-text">Forget most within days</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon cross">✕</div>
                  <div className="bullet-text">No connection to your life</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon cross">✕</div>
                  <div className="bullet-text">Hard to build a habit</div>
                </div>
              </div>
            </div>

            <div className="bento-vs">VS</div>

            <div className="comp-card active-reading">
              <div className="comp-card-header">
                <h3 style={{ color: "var(--accent-cobalt)" }}>Immersive Reading</h3>
                <p>Narrated, visual, and easy to keep following.</p>
              </div>
              <div className="comp-visual">
                {/* SVG outline illustration of active reading */}
                <div className="sparkle-illustration">
                  <div className="sparkle-box">
                    <Sparkles size={16} style={{ color: "var(--accent-cobalt)" }} />
                  </div>
                  <svg width="120" height="90" viewBox="0 0 120 90" fill="none">
                    <circle cx="60" cy="35" r="12" stroke="var(--accent-cobalt)" strokeWidth="2" />
                    <path d="M30 65C45 65 60 60 60 45" stroke="var(--accent-cobalt)" strokeWidth="2" />
                    <path d="M60 45C75 45 90 60 90 65" stroke="var(--accent-cobalt)" strokeWidth="2" />
                    <line x1="60" y1="12" x2="60" y2="20" stroke="var(--accent-amber)" strokeWidth="2" strokeLinecap="round" />
                    <line x1="42" y1="20" x2="48" y2="25" stroke="var(--accent-amber)" strokeWidth="2" strokeLinecap="round" />
                    <line x1="78" y1="20" x2="72" y2="25" stroke="var(--accent-amber)" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                </div>
              </div>
              <div className="comp-bullet-list">
                <div className="comp-bullet">
                  <div className="bullet-icon check">✓</div>
                  <div className="bullet-text">Stay engaged and focused</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon check">✓</div>
                  <div className="bullet-text">Hear natural narration</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon check">✓</div>
                  <div className="bullet-text">See visuals that match the text</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon check">✓</div>
                  <div className="bullet-text">Pick up where you left off</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Testimonials & Social Proof Section */}
        <section id="testimonials" className="benefits-section">
          <div className="science-header">
            <div className="section-badge">Loved by readers everywhere</div>
            <h2 className="section-title">Real results from real readers</h2>
          </div>
          
          <div className="testimonials-grid">
            <div className="testimonial-card">
              <p className="testimonial-quote">
                The narration keeps me moving through dense chapters, and the word tracking stops me drifting off.
              </p>
              <div className="testimonial-user">
                <img src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=80&h=80&q=80" alt="Sarah K." className="rating-avatar" style={{ marginLeft: 0 }} />
                <div className="testimonial-user-info">
                  <h4>Sarah K.</h4>
                  <p>Product Manager</p>
                </div>
              </div>
            </div>

            <div className="testimonial-card">
              <p className="testimonial-quote">
                reader makes my EPUB library feel alive. The visuals give each book a sense of place without getting in the way.
              </p>
              <div className="testimonial-user">
                <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&h=80&q=80" alt="Michael T." className="rating-avatar" style={{ marginLeft: 0 }} />
                <div className="testimonial-user-info">
                  <h4>Michael T.</h4>
                  <p>Entrepreneur</p>
                </div>
              </div>
            </div>

            <div className="testimonial-card">
              <p className="testimonial-quote">
                I can listen, read, and follow the same passage at once. It is especially good for classics I used to bounce off.
              </p>
              <div className="testimonial-user">
                <img src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&h=80&q=80" alt="Priya S." className="rating-avatar" style={{ marginLeft: 0 }} />
                <div className="testimonial-user-info">
                  <h4>Priya S.</h4>
                  <p>Student</p>
                </div>
              </div>
            </div>
          </div>

          <div className="trusted-brand-strip">
            <div className="trusted-brand-title">Trusted by readers from</div>
            <div className="trusted-brand-logos">
              <div className="brand-logo-item">Google</div>
              <div className="brand-logo-item">Notion</div>
              <div className="brand-logo-item">Microsoft</div>
              <div className="brand-logo-item">Coursera</div>
              <div className="brand-logo-item">Amazon</div>
              <div className="brand-logo-item">Spotify</div>
            </div>
          </div>
        </section>

        {/* CTA Banner Section */}
        <section className="cta-banner">
          <div className="cta-content">
            <h2 className="cta-title">Ready to make reading<br />feel more immersive?</h2>
            <p className="cta-desc">
              Join 1,000+ readers using narration, visual context, and synced progress to spend more time with their books.
            </p>
          </div>
          <div className="cta-actions">
            <button onClick={() => handleOpenAuth("sign-up")} className="btn-cta-white" type="button">
              <span>Get Started Free</span>
              <ArrowRight size={16} />
            </button>
            <a href="#features" className="btn-cta-link">
              <span>See all features</span>
              <ArrowRight size={14} />
            </a>
          </div>
        </section>

        {/* Footer Section */}
        <footer id="footer" className="landing-footer">
          <div className="footer-container">
            <div className="footer-brand">
              <div className="footer-brand-logo">
                <BookOpen size={20} className="landing-logo-icon" />
                <span>reader</span>
              </div>
              <p className="footer-brand-desc">
                A narrated, visual reading app for your personal EPUB library.
              </p>
            </div>

            <div className="footer-col">
              <span className="footer-col-title">Product</span>
              <div className="footer-col-links">
                <a href="#" className="footer-col-link">Features</a>
                <a href="#" className="footer-col-link">How It Works</a>
                <a href="#" className="footer-col-link">Pricing</a>
              </div>
            </div>

          </div>
        </footer>

        {/* Elegant Blur Auth Modal */}
        {isAuthOpen && (
          <div className="auth-modal-overlay" onClick={handleCloseAuth}>
            <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
              <button className="auth-modal-close" onClick={handleCloseAuth} title="Close" type="button">
                <X size={16} />
              </button>
              
              <div className="auth-modal-header">
                <div className="card-icon-box blue" style={{ marginBottom: "12px", width: "42px", height: "42px" }}>
                  <Bookmark size={20} />
                </div>
                <h2>{authMode === "sign-in" ? "Welcome Back" : "Create Your Library"}</h2>
                <p>
                  {authMode === "sign-in" 
                    ? "Log in to access your personal digital shelf" 
                    : "Create an account to upload, read, and track EPUBs"}
                </p>
              </div>

              <form className="auth-modal-form" onSubmit={(e) => {
                void handleAuth(e);
              }}>
                <div className="auth-input-group">
                  <label htmlFor="auth-email">Email Address</label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    placeholder="name@domain.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
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
                    placeholder="••••••••"
                    autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="auth-input-field"
                  />
                </div>

                <button 
                  type="submit" 
                  disabled={busy} 
                  className="auth-submit-btn"
                >
                  {busy ? (
                    <>
                      <Loader2 className="spin" size={16} />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <span>{authMode === "sign-in" ? "Sign In" : "Create Account"}</span>
                  )}
                </button>

                <div className="auth-divider">or</div>

                <button 
                  type="button" 
                  disabled={busy} 
                  onClick={signInWithGoogle} 
                  className="auth-oauth-btn"
                >
                  <GoogleIcon />
                  <span>Continue with Google</span>
                </button>
              </form>

              <div className="auth-switch-mode">
                <button
                  type="button"
                  className="auth-switch-btn"
                  onClick={() => setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in")}
                >
                  {authMode === "sign-in" 
                    ? "Don't have an account? Sign up" 
                    : "Already have an account? Sign in"}
                </button>
              </div>

              {/* Dynamic feedback notice styled as a floating toast inside card */}
              {notice && (
                <div className="auth-notice-toast">
                  {notice}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
