import {
  ArrowRight,
  BookOpen,
  Bookmark,
  Brain,
  Check,
  Chrome,
  Loader2,
  Play,
  Pause,
  Sparkles,
  TrendingUp,
  X,
  Zap
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
  "Every", "hour", "focus", "your", "mind", "attentively,",
  "like", "a", "Roman", "and", "a", "man,", "with", "perfect",
  "and", "simple", "dignity,", "and", "feeling", "of", "affection,",
  "and", "freedom,", "and", "justice,", "and", "to", "give",
  "yourself", "relief", "from", "all", "other", "thoughts.",
  "And", "you", "will", "give", "yourself", "relief,", "if",
  "you", "do", "every", "act", "of", "your", "life", "as",
  "if", "it", "were", "the", "last,", "laying", "aside", "all",
  "carelessness", "and", "passionate", "aversion", "from", "the",
  "commands", "of", "reason,", "and", "all", "hypocrisy,", "and",
  "self-love,", "and", "discontent", "with", "the", "portion",
  "which", "has", "been", "given", "to", "you.", "You", "see",
  "how", "few", "the", "things", "are,", "which", "if", "a",
  "man", "lays", "hold", "of,", "he", "is", "able", "to",
  "live", "a", "life", "which", "flows", "in", "quiet,", "and",
  "is", "like", "the", "existence", "of", "a", "god."
];

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
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

  return (
    <div className="landing-theme">
      <div className="landing-wrapper">
        {/* Transparent Header */}
        <header className="landing-header">
          <a href="#" className="landing-logo">
            <BookOpen className="landing-logo-icon" size={24} />
            <span>Reader</span>
          </a>
          <nav className="landing-nav">
            <div className="landing-nav-links" style={{ display: "flex", gap: "24px" }}>
              <a href="#science" className="landing-nav-link">The Science</a>
              <a href="#benefits" className="landing-nav-link">Competitiveness</a>
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
                Get Started
              </button>
            </div>
          </nav>
        </header>

        {/* Hero Section */}
        <main className="landing-hero">
          <div className="hero-content">
            <div className="hero-badge">
              <Sparkles size={13} />
              <span>Sensory-Bound Cognitive Engine</span>
            </div>
            <h1 className="hero-title">
              Read 3x Faster.<br />
              Eliminate Waning Focus.<br />
              <span>Master Cognitive Leverage.</span>
            </h1>
            <p className="hero-desc">
              Welcome to your intellectual sanctuary. By bridging visual word tracking with synchronized vocal pacing, Reader binds your full attention, completely dissolving external distractions and eyes trailing off. Read more, retain deep context, and compound your knowledge.
            </p>
            <div className="hero-actions">
              <button onClick={() => handleOpenAuth("sign-up")} className="btn-primary">
                <span>Start Reading Now</span>
                <ArrowRight size={16} />
              </button>
              <a href="#science" className="btn-secondary">
                <span>Learn The Science</span>
              </a>
            </div>
          </div>

          {/* Interactive Simulated Reader */}
          <div className="mock-reader-container">
            <div className="mock-reader">
              <div className="mock-chrome">
                <div className="chrome-dots">
                  <div className="chrome-dot" />
                  <div className="chrome-dot" />
                  <div className="chrome-dot" />
                </div>
                <div className="chrome-title">Reader App Simulator — Meditations.epub</div>
              </div>
              <div className="mock-reader-screen">
                <aside className="mock-sidebar">
                  <div className="mock-sidebar-title">Chapters</div>
                  <div className="mock-chapter-list">
                    <div className="mock-chapter-item">I. Book One</div>
                    <div className="mock-chapter-item active">II. Focus & Dignity</div>
                    <div className="mock-chapter-item">III. Quietude</div>
                    <div className="mock-chapter-item">IV. The Logos</div>
                  </div>
                </aside>
                <div className="mock-content-panel">
                  <div className="mock-book-header">Marcus Aurelius — Meditations</div>
                  <div className="mock-book-paragraph">
                    {passageWords.map((word, idx) => (
                      <span
                        key={idx}
                        className={`mock-word ${idx === currentWordIndex ? "highlighted" : ""}`}
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mock-rail">
                <div className="mock-progress-container">
                  <button onClick={toggleDemo} className="mock-btn-play" title={isPlaying ? "Pause" : "Play"}>
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

        {/* Science Section */}
        <section id="science" className="science-section">
          <div className="science-header">
            <div className="section-badge">How It Works</div>
            <h2 className="section-title">The Science of Multimodal Learning</h2>
            <p className="section-desc">
              Why do visual-auditory environments make you read faster and understand better? It binds your sensory bandwidth to fully absorb the material.
            </p>
          </div>
          <div className="science-grid">
            <div className="science-card">
              <div className="card-icon-box">
                <Brain size={22} />
              </div>
              <h3 className="card-title">Dual-Coding Attention</h3>
              <p className="card-desc">
                By presenting identical visual text and natural voice pathways simultaneously, your brain recruits twice the visual and auditory processing power. This blocks peripheral audio distractions and silences mind-wandering instantly.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box">
                <Zap size={22} />
              </div>
              <h3 className="card-title">Bypassing Sub-Vocalization</h3>
              <p className="card-desc">
                Average readers pronounce words in their minds, capping speed at speaking rate (~150-200 WPM). Reader's pacing trains your brain to recognize words instantly by sight, effortlessly elevating speeds past 400 WPM.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box">
                <TrendingUp size={22} />
              </div>
              <h3 className="card-title">Active Synaptic Engagement</h3>
              <p className="card-desc">
                Dynamic highlighting works like a visual guide rail. Instead of scanning lines passively or losing your place, your eyes lock onto a moving focus laser, increasing reading comprehension, information retrieval, and neural connections.
              </p>
            </div>
          </div>
        </section>

        {/* Competitiveness and Smart Comparison Section */}
        <section id="benefits" className="benefits-section">
          <div className="benefits-content">
            <div className="section-badge">Cognitive Leverage</div>
            <h2 className="section-title">Compounding Knowledge: An Unfair Advantage</h2>
            <p className="section-desc" style={{ color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 16px" }}>
              In the information age, reading speed combined with comprehension is the ultimate competitive advantage. Increasing your reading rate compounding your learning creates an astronomical intellectual edge.
            </p>
            <div className="benefit-list">
              <div className="benefit-item">
                <div className="benefit-check">
                  <Check size={14} strokeWidth={3} />
                </div>
                <div className="benefit-item-text">
                  <h4>Read 1 Book per Week with Ease</h4>
                  <p>Spend just 25 minutes a day at an accelerated pacing rate to comfortably finish over 50 books a year.</p>
                </div>
              </div>
              <div className="benefit-item">
                <div className="benefit-check">
                  <Check size={14} strokeWidth={3} />
                </div>
                <div className="benefit-item-text">
                  <h4>Eliminate Cognitive Fatigue</h4>
                  <p>Multimodal reading drastically lowers cognitive load, preventing the eye-strain and brain fog typical of dense material.</p>
                </div>
              </div>
              <div className="benefit-item">
                <div className="benefit-check">
                  <Check size={14} strokeWidth={3} />
                </div>
                <div className="benefit-item-text">
                  <h4>Retain Knowledge Permanently</h4>
                  <p>Binding visual, auditory, and context clues constructs stronger mental schemas, driving content into long-term memory.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="benefits-visual">
            <h3 style={{ fontSize: "1.2rem", fontWeight: 800, margin: "0 0 10px", textAlign: "center" }}>Comparing Reader to Traditional Reading</h3>
            
            <div className="visual-bar-group">
              <div className="visual-bar-label">
                <span className="label-name">Traditional Focus Stamina (Mind wanders easily)</span>
                <span className="label-val red">25%</span>
              </div>
              <div className="visual-bar-track">
                <div className="visual-bar-fill red" />
              </div>
            </div>

            <div className="visual-bar-group">
              <div className="visual-bar-label">
                <span className="label-name">Reader Sensory Focus (Eyes + Ears locked in)</span>
                <span className="label-val">95%</span>
              </div>
              <div className="visual-bar-track">
                <div className="visual-bar-fill emerald" />
              </div>
            </div>

            <div className="visual-bar-group" style={{ marginTop: '10px' }}>
              <div className="visual-bar-label">
                <span className="label-name">Average Yearly Books Completed</span>
                <span className="label-val red">1.2 Books</span>
              </div>
              <div className="visual-bar-track">
                <div className="visual-bar-fill red" style={{ width: '8%' }} />
              </div>
            </div>

            <div className="visual-bar-group">
              <div className="visual-bar-label">
                <span className="label-name">Reader App Yearly Books Completed</span>
                <span className="label-val">36+ Books</span>
              </div>
              <div className="visual-bar-track">
                <div className="visual-bar-fill emerald" style={{ width: '75%' }} />
              </div>
            </div>

            <p className="visual-desc">
              *Compounded over 5 years, a Reader user learns from 180 books, while traditional readers complete 6. Think of the intellectual division this builds.
            </p>
          </div>
        </section>

        {/* CTA Banner Footer */}
        <section className="cta-banner">
          <h2 className="cta-title">Build Your Intellectual Sanctuary</h2>
          <p className="cta-desc">
            Upload your own collection of EPUB books. Train your mind, finish books twice as fast, and become the smartest version of yourself.
          </p>
          <button onClick={() => handleOpenAuth("sign-up")} className="btn-primary" style={{ padding: "0 36px", height: "52px", fontSize: "1.05rem" }}>
            <span>Get Started Free</span>
            <ArrowRight size={18} />
          </button>
        </section>

        {/* Sleek Footer */}
        <footer className="landing-footer">
          <div className="landing-footer-brand">
            <BookOpen size={18} className="landing-logo-icon" />
            <span>Reader Library</span>
          </div>
          <div>© {new Date().getFullYear()} Reader. Elevate your cognitive stamina.</div>
        </footer>

        {/* Elegant Blur Auth Modal */}
        {isAuthOpen && (
          <div className="auth-modal-overlay" onClick={handleCloseAuth}>
            <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
              <button className="auth-modal-close" onClick={handleCloseAuth} title="Close">
                <X size={16} />
              </button>
              
              <div className="auth-modal-header">
                <div className="card-icon-box" style={{ marginBottom: "12px", width: "42px", height: "42px" }}>
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
                  <Chrome size={18} />
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
