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
  "When", "you", "start", "a", "new", "habit,", "it", "should",
  "take", "less", "than", "two", "minutes", "to", "do.", "This",
  "allows", "you", "to", "start", "the", "habit", "even", "on",
  "days", "when", "you", "don't", "feel", "like", "it.", "You",
  "can", "often", "maintain", "a", "habit", "by", "scaling", "it",
  "down", "rather", "than", "giving", "it", "up.", "The", "key",
  "is", "to", "make", "it", "easy", "to", "start,", "and", "easy",
  "to", "keep", "going."
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
        {/* Navigation Header */}
        <header className="landing-header">
          <a href="#" className="landing-logo">
            <BookOpen className="landing-logo-icon" size={24} />
            <span>Readwise Flow</span>
          </a>
          <nav className="landing-nav">
            <div className="landing-nav-links" style={{ display: "flex", gap: "24px" }}>
              <a href="#features" className="landing-nav-link">Features</a>
              <a href="#comparison" className="landing-nav-link">How It Works</a>
              <a href="#testimonials" className="landing-nav-link">Pricing</a>
              <a href="#footer" className="landing-nav-link">Resources</a>
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
              Stay engaged with immersive reading tools, intelligent prompts, and active recall features that help you absorb more from every book.
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
                <span>Join 50,000+ readers leveling up their minds</span>
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
                <div className="chrome-address-bar">readwise.io/flow</div>
                <div className="chrome-actions">
                  <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-muted)", cursor: "pointer" }}>Aa</span>
                </div>
              </div>
              <div className="mock-browser-screen">
                <aside className="mock-sidebar">
                  <div className="mock-sidebar-brand">
                    <BookOpen size={12} className="landing-logo-icon" />
                    <span>Flow</span>
                  </div>
                  <div className="mock-sidebar-list">
                    <div className="mock-sidebar-item"><BookOpen size={10} /> <span>Library</span></div>
                    <div className="mock-sidebar-item active"><BookOpen size={10} /> <span>Now Reading</span></div>
                    <div className="mock-sidebar-item"><Brain size={10} /> <span>Insights</span></div>
                    <div className="mock-sidebar-item"><Check size={10} /> <span>Review</span></div>
                    <div className="mock-sidebar-item"><Target size={10} /> <span>Goals</span></div>
                  </div>
                </aside>
                
                <div className="mock-content-panel">
                  <div className="mock-book-header">
                    <span>Atomic Habits — James Clear</span>
                    <span>Chapter 3 of 20 (32%)</span>
                  </div>
                  <h3 style={{ fontFamily: "var(--font-serif)", fontSize: "1.1rem", fontWeight: 700, margin: "14px 0 6px", color: "var(--text-primary)" }}>
                    The Two-Minute Rule
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

                  {/* Annotated stuck note matching mockup */}
                  <div style={{
                    border: "1px solid var(--border-color)",
                    borderRadius: "8px",
                    padding: "10px 12px",
                    background: "#ffffff",
                    marginTop: "16px",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.02)"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                      <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--text-secondary)" }}>This stuck with me</span>
                      <span style={{ fontSize: "0.6rem", color: "var(--text-muted)", cursor: "pointer" }}>•••</span>
                    </div>
                    <p style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: "0.75rem",
                      fontStyle: "italic",
                      color: "var(--text-primary)",
                      margin: "0 0 6px 0",
                      lineHeight: "1.4"
                    }}>
                      Small habits → big identity change. Make it easy, then build momentum.
                    </p>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: "0.6rem", background: "var(--bg-neutral)", padding: "2px 6px", borderRadius: "4px", color: "var(--text-muted)", fontWeight: 600 }}>#habits</span>
                      <span style={{ fontSize: "0.6rem", color: "var(--text-muted)" }}>Today, 10:34 AM</span>
                    </div>
                  </div>
                </div>

                <div className="mock-right-panel">
                  <div className="panel-title">Reflections</div>
                  <div className="reflections-box">
                    <div className="reflections-q">What's one small action you can take based on this?</div>
                    <textarea 
                      className="reflections-a"
                      rows={3}
                      value="I will prepare my workout clothes the night before."
                      readOnly
                    />
                    <button className="reflections-save" type="button">Save</button>
                  </div>

                  <div className="panel-title" style={{ marginTop: "12px" }}>Key Takeaways</div>
                  <div className="takeaway-box">
                    <div className="takeaway-item">
                      <Target size={12} className="takeaway-icon" />
                      <div>
                        <strong>Start tiny:</strong> Make habits so small they're impossible to fail.
                      </div>
                    </div>
                    <div className="takeaway-item">
                      <Brain size={12} className="takeaway-icon" />
                      <div>
                        <strong>Consistency &gt; intensity:</strong> Show up, even if it's for 2 minutes.
                      </div>
                    </div>
                    <div className="takeaway-item">
                      <Sparkles size={12} className="takeaway-icon" />
                      <div>
                        <strong>Your identity drives your habits:</strong> Focus on becoming a reader.
                      </div>
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
            <div className="section-badge">Why Readers Love Readwise Flow</div>
            <h2 className="section-title">Everything you need to read better</h2>
          </div>
          <div className="science-grid">
            <div className="science-card">
              <div className="card-icon-box blue">
                <BookOpen size={22} />
              </div>
              <h3 className="card-title">Active Reading</h3>
              <p className="card-desc">
                Highlight, annotate, and interact with the text to stay focused and engaged from start to finish.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box purple">
                <Brain size={22} />
              </div>
              <h3 className="card-title">Deeper Comprehension</h3>
              <p className="card-desc">
                Intelligent prompts and reflections help you connect ideas and understand more deeply.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box green">
                <Target size={22} />
              </div>
              <h3 className="card-title">Habit-Building</h3>
              <p className="card-desc">
                Track your progress, set goals, and build a reading habit that lasts—one day at a time.
              </p>
            </div>
            <div className="science-card">
              <div className="card-icon-box orange">
                <Bookmark size={22} />
              </div>
              <h3 className="card-title">Insight Capture</h3>
              <p className="card-desc">
                Save key takeaways, flashcards, and quotes so your best ideas stay with you.
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
                <p>Engaging, effective, and transformative.</p>
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
                  <div className="bullet-text">Remember what truly matters</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon check">✓</div>
                  <div className="bullet-text">Apply ideas to your life</div>
                </div>
                <div className="comp-bullet">
                  <div className="bullet-icon check">✓</div>
                  <div className="bullet-text">Build a habit that compounds</div>
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
                I used to forget 90% of what I read. Now I retain more, think deeper, and actually apply what I learn.
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
                Readwise Flow turned reading into an active, daily habit. I'm reading more books than ever—and loving it.
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
                The reflections and key takeaways help me learn faster and share ideas with confidence.
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
            <h2 className="cta-title">Ready to read smarter<br />and become your best self?</h2>
            <p className="cta-desc">
              Join thousands of readers who are learning more, remembering more, and living better.
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
                <span>Readwise Flow</span>
              </div>
              <p className="footer-brand-desc">
                The smarter way to read, learn, and grow every day.
              </p>
              <div className="footer-social-row">
                <a href="#" className="footer-social-icon">Twitter</a>
                <a href="#" className="footer-social-icon">Instagram</a>
                <a href="#" className="footer-social-icon">YouTube</a>
                <a href="#" className="footer-social-icon">LinkedIn</a>
              </div>
            </div>

            <div className="footer-col">
              <span className="footer-col-title">Product</span>
              <div className="footer-col-links">
                <a href="#" className="footer-col-link">Features</a>
                <a href="#" className="footer-col-link">How It Works</a>
                <a href="#" className="footer-col-link">Pricing</a>
                <a href="#" className="footer-col-link">Roadmap</a>
              </div>
            </div>

            <div className="footer-col">
              <span className="footer-col-title">Resources</span>
              <div className="footer-col-links">
                <a href="#" className="footer-col-link">Blog</a>
                <a href="#" className="footer-col-link">Reading Guides</a>
                <a href="#" className="footer-col-link">Help Center</a>
                <a href="#" className="footer-col-link">Templates</a>
              </div>
            </div>

            <div className="footer-col">
              <span className="footer-col-title">Company</span>
              <div className="footer-col-links">
                <a href="#" className="footer-col-link">About Us</a>
                <a href="#" className="footer-col-link">Careers</a>
                <a href="#" className="footer-col-link">Privacy</a>
                <a href="#" className="footer-col-link">Terms</a>
              </div>
            </div>

            <div className="footer-newsletter">
              <span className="footer-col-title">Stay in the loop</span>
              <p>Get reading tips, product updates, and more.</p>
              <form className="newsletter-form" onSubmit={(e) => e.preventDefault()}>
                <input 
                  type="email" 
                  placeholder="Enter your email" 
                  className="newsletter-input" 
                  required
                />
                <button type="submit" className="newsletter-btn" aria-label="Subscribe">
                  <ArrowRight size={14} />
                </button>
              </form>
            </div>
          </div>

          <div className="footer-bottom">
            <div>© {new Date().getFullYear()} Readwise Flow. All rights reserved.</div>
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
