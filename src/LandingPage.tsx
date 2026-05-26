import {
  ArrowRight,
  BookOpenText,
  Loader2,
  Mail,
  Star,
  X
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, FormEvent } from "react";

type ClassicBook = {
  title: string;
  author: string;
  cover: string;
};

const TOP_SHELF_BOOKS: ClassicBook[] = [
  {
    title: "Pride and Prejudice",
    author: "Jane Austen",
    cover: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Frankenstein",
    author: "Mary Shelley",
    cover: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Dracula",
    author: "Bram Stoker",
    cover: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/cover-thumbnail.jpg"
  },
  {
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    cover: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Moby-Dick",
    author: "Herman Melville",
    cover: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Dorian Gray",
    author: "Oscar Wilde",
    cover: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/cover-thumbnail.jpg"
  },
  {
    title: "The Odyssey",
    author: "Homer",
    cover: "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Crime and Punishment",
    author: "Fyodor Dostoevsky",
    cover: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Monte Cristo",
    author: "Alexandre Dumas",
    cover: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Jane Eyre",
    author: "Charlotte Bronte",
    cover: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/cover-thumbnail.jpg"
  }
];

const LOWER_SHELF_BOOKS: ClassicBook[] = [
  {
    title: "Wuthering Heights",
    author: "Emily Bronte",
    cover: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/cover-thumbnail.jpg"
  },
  {
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    cover: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Little Women",
    author: "Louisa May Alcott",
    cover: "https://standardebooks.org/ebooks/louisa-may-alcott/little-women/downloads/cover-thumbnail.jpg"
  },
  {
    title: "The Scarlet Letter",
    author: "Nathaniel Hawthorne",
    cover: "https://standardebooks.org/ebooks/nathaniel-hawthorne/the-scarlet-letter/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Two Cities",
    author: "Charles Dickens",
    cover: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    cover: "https://standardebooks.org/ebooks/robert-louis-stevenson/treasure-island/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Anne of Green Gables",
    author: "L. M. Montgomery",
    cover: "https://standardebooks.org/ebooks/l-m-montgomery/anne-of-green-gables/downloads/cover-thumbnail.jpg"
  },
  {
    title: "The Time Machine",
    author: "H. G. Wells",
    cover: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/cover-thumbnail.jpg"
  },
  {
    title: "War of the Worlds",
    author: "H. G. Wells",
    cover: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/cover-thumbnail.jpg"
  },
  {
    title: "Wizard of Oz",
    author: "L. Frank Baum",
    cover: "https://standardebooks.org/ebooks/l-frank-baum/the-wonderful-wizard-of-oz/downloads/cover-thumbnail.jpg"
  }
];

function ClassicsWall() {
  const topShelfBooks = [...TOP_SHELF_BOOKS, ...TOP_SHELF_BOOKS];
  const lowerShelfBooks = [...LOWER_SHELF_BOOKS, ...LOWER_SHELF_BOOKS];
  const renderBook = (book: ClassicBook, i: number, row: string) => (
    <figure className="classic-book" key={`${row}-${book.title}-${i}`}>
      <img src={book.cover} alt="" />
      <figcaption>
        <strong>{book.title}</strong>
        <span>{book.author}</span>
      </figcaption>
    </figure>
  );

  return (
    <div className="classics-wall" aria-hidden="true">
      <div className="classics-wall-row">
        <div className="classics-wall-track">
          {topShelfBooks.map((book, i) => renderBook(book, i, "top"))}
        </div>
      </div>
      <div className="classics-wall-row alternate">
        <div className="classics-wall-track">
          {lowerShelfBooks.map((book, i) => renderBook(book, i, "lower"))}
        </div>
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

const LANDING_READER_IMAGES = [
  "/landing/reader-1.webp",
  "/landing/reader-2.webp",
  "/landing/reader-3.webp",
  "/landing/reader-4.webp"
];

const LANDING_HERO_IMAGE_TIMEOUT_MS = 520;
const prideAndPrejudiceCover =
  "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg";

const preloadImage = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if ("decode" in image) {
        image.decode().then(() => resolve()).catch(() => resolve());
        return;
      }

      resolve();
    };
    image.onerror = () => resolve();
    image.src = src;
  });

const readerParagraphs = `
Had she found Jane in any apparent danger, Mrs. Bennet would have been very miserable; but being satisfied on seeing her that her illness was not alarming, she had no wish of her recovering immediately, as her restoration to health would probably remove her from Netherfield. She would not listen therefore to her daughter's proposal of being carried home; neither did the apothecary, who arrived about the same time, think it at all advisable. After sitting a little while with Jane, on Miss Bingley's appearance and invitation, the mother and three daughters all attended her into the breakfast parlour. Bingley met them with hopes that Mrs. Bennet had not found Miss Bennet worse than she expected.

"Indeed I have, Sir," was her answer. "She is a great deal too ill to be moved. Mr. Jones says we must not think of moving her. We must trespass a little longer on your kindness."

"Removed!" cried Bingley. "It must not be thought of. My sister, I am sure, will not hear of her removal."

"You may depend upon it, Madam," said Miss Bingley, with cold civility, "that Miss Bennet shall receive every possible attention while she remains with us."

Mrs. Bennet was profuse in her acknowledgments.

"I am sure," she added, "if it was not for such good friends I do not know what would become of her, for she is very ill indeed, and suffers a vast deal, though with the greatest patience in the world, which is always the way with her, for she has, without exception, the sweetest temper I ever met with. I often tell my other girls they are nothing to her. You have a sweet room here, Mr. Bingley, and a charming prospect over that gravel walk. I do not know a place in the country that is equal to Netherfield. You will not think of quitting it in a hurry I hope, though you have but a short lease."

"Whatever I do is done in a hurry," replied he; "and therefore if I should resolve to quit Netherfield, I should probably be off in five minutes. At present, however, I consider myself as quite fixed here."

"That is exactly what I should have supposed of you," said Elizabeth.

"You begin to comprehend me, do you?" cried he, turning towards her.

"Oh! yes - I understand you perfectly."

"I wish I might take this for a compliment; but to be so easily seen through I am afraid is pitiful."

"That is as it happens. It does not necessarily follow that a deep, intricate character is more or less estimable than such a one as yours."

"Lizzy," cried her mother, "remember where you are, and do not run on in the wild manner that you are suffered to do at home."

"I did not know before," continued Bingley immediately, "that you were a studier of character. It must be an amusing study."

"Yes; but intricate characters are the most amusing. They have at least that advantage."

"The country," said Darcy, "can in general supply but few subjects for such a study. In a country neighbourhood you move in a very confined and unvarying society."

"But people themselves alter so much, that there is something new to be observed in them forever."

"Yes, indeed," cried Mrs. Bennet, offended by his manner of mentioning a country neighbourhood. "I assure you there is quite as much of that going on in the country as in town."

Everybody was surprised; and Darcy, after looking at her for a moment, turned silently away.

X

The day passed much as the day before had done. Mrs. Hurst and Miss Bingley had spent some hours of the morning with the invalid, who continued, though slowly, to mend; and in the evening Elizabeth joined their party in the drawing-room. The loo table, however, did not appear. Mr. Darcy was writing, and Miss Bingley, seated near him, was watching the progress of his letter, and repeatedly calling off his attention by messages to his sister. Mr. Hurst and Mr. Bingley were at piquet, and Mrs. Hurst was observing their game.

Elizabeth took up some needlework, and was sufficiently amused in attending to what passed between Darcy and his companion. The perpetual commendations of the lady either on his handwriting, or on the evenness of his lines, or on the length of his letter, with the perfect unconcern with which her praises were received, formed a curious dialogue, and was exactly in unison with her opinion of each.

"How delighted Miss Darcy will be to receive such a letter!"

"You are mistaken. I write rather slowly."

"How many letters you must have occasion to write in the course of the year! Letters of business too! How odious I should think them!"

"It is fortunate, then, that they fall to my lot instead of to yours."

"Pray tell your sister that I long to see her."

"I have already told her so once, by your desire."

"I am afraid you do not like your pen. Let me mend it for you. I mend pens remarkably well."

"Thank you - but I always mend my own."
`.trim().split(/\n\s*\n/);

const demoReaderParagraphs = readerParagraphs.slice(1, 7);
const readerWords = demoReaderParagraphs.flatMap((paragraph) => paragraph.split(/\s+/));

function IllumeReaderText({ currentWordIndex }: { currentWordIndex: number }) {
  let wordOffset = 0;

  return (
    <>
      {demoReaderParagraphs.map((paragraph) => {
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
  currentWordIndex,
  currentImageIndex
}: {
  currentWordIndex: number;
  currentImageIndex: number;
}) {
  return (
    <div className="landing-reader-demo" aria-label="illume image mode product screenshot">
      <div className="landing-reader-page">
        <div className="landing-reader-copy-scroll">
          <div className="landing-book-identity">
            <img src={prideAndPrejudiceCover} alt="Pride and Prejudice Standard Ebooks cover" />
            <div>
              <div className="landing-screen-meta">Jane Austen</div>
              <h3>Pride and Prejudice</h3>
            </div>
          </div>
          <IllumeReaderText currentWordIndex={currentWordIndex} />
        </div>
      </div>

      <div className="landing-reader-art">
        <div className="landing-reader-art-frame">
          {LANDING_READER_IMAGES.map((src, index) => (
            <img
              className={index === currentImageIndex ? "active" : ""}
              key={src}
              src={src}
              alt={index === currentImageIndex ? "Generated visual for a Pride and Prejudice passage" : ""}
              aria-hidden={index === currentImageIndex ? undefined : true}
              decoding="async"
              loading="eager"
              width={1024}
              height={1536}
            />
          ))}
        </div>
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
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isHeroReady, setIsHeroReady] = useState(false);
  const [authPane, setAuthPane] = useState<"choice" | "email">("choice");
  const [isHeaderCondensed, setIsHeaderCondensed] = useState(false);
  const [detailHeadingProgress, setDetailHeadingProgress] = useState(0);
  const detailSectionRef = useRef<HTMLElement | null>(null);
  const detailHeading = "For readers with wandering minds.";

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
    let frame = 0;

    const updateHeadingProgress = () => {
      frame = 0;
      const section = detailSectionRef.current;
      if (!section) return;

      const rect = section.getBoundingClientRect();
      const start = window.innerHeight * 0.82;
      const distance = window.innerHeight * 0.48;
      const nextProgress = Math.max(0, Math.min(1, (start - rect.top) / distance));

      setDetailHeadingProgress((current) =>
        Math.abs(current - nextProgress) > 0.006 ? nextProgress : current
      );
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateHeadingProgress);
    };

    updateHeadingProgress();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    };
  }, []);

  useEffect(() => {
    const focusItems = Array.from(document.querySelectorAll<HTMLElement>(".illume-focus-feature"));

    if (!focusItems.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.32 }
    );

    focusItems.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let isMounted = true;
    const readyTimer = window.setTimeout(() => {
      if (isMounted) setIsHeroReady(true);
    }, LANDING_HERO_IMAGE_TIMEOUT_MS);

    Promise.all([preloadImage(prideAndPrejudiceCover), ...LANDING_READER_IMAGES.map(preloadImage)])
      .then(() => {
        if (!isMounted) return;
        window.clearTimeout(readyTimer);
        setIsHeroReady(true);
      });

    return () => {
      isMounted = false;
      window.clearTimeout(readyTimer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentWordIndex((prev) => (prev >= readerWords.length - 1 ? 0 : prev + 1));
    }, 360);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentImageIndex((prev) => (prev + 1) % LANDING_READER_IMAGES.length);
    }, 1800);

    return () => window.clearInterval(timer);
  }, []);

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
    <div className="illume-theme">
      <header className={`illume-header${isHeaderCondensed ? " is-condensed" : ""}`}>
        <a href="#" className="illume-brand" aria-label="illume home">
          <img src="/landing/logo.webp" alt="" className="illume-brand-mark" />
          <span>illume</span>
        </a>
        <button onClick={() => handleOpenAuth("sign-in")} className="illume-sign-in-button" type="button">
          <BookOpenText size={15} />
          <span>Read now</span>
        </button>
      </header>

      <main>
        <section id="product" className={isHeroReady ? "illume-hero is-ready" : "illume-hero"}>
          <div className="illume-hero-copy">
            <div className="illume-hero-proof">
              <div className="proof-avatars" aria-hidden="true">
                <span className="proof-dot proof-dot--a">J</span>
                <span className="proof-dot proof-dot--b">A</span>
                <span className="proof-dot proof-dot--c">M</span>
                <span className="proof-dot proof-dot--d">
                  <Star size={9} fill="currentColor" />
                </span>
              </div>
              <div className="proof-text">
                <span className="proof-stat">12,000+ readers</span>
                <span className="proof-divider-dot" aria-hidden="true" />
                <span className="proof-rating">4.9 average</span>
              </div>
            </div>
            <h1>Reading, but easier</h1>
            <p className="illume-hero-line">
              Illume turns books into a more immersive reading experience, with natural narration, live word tracking, and AI-generated visuals that help you keep focus chapter after chapter.
            </p>
            <div className="illume-actions">
              <button onClick={() => handleOpenAuth("sign-up")} className="illume-primary-button" type="button">
                <span>Start reading free.</span>
                <ArrowRight size={16} />
              </button>
            </div>
          </div>

          <div className="illume-hero-product">
            <IllumeProductScreenshot
              currentWordIndex={currentWordIndex}
              currentImageIndex={currentImageIndex}
            />
          </div>
        </section>

        <section id="library" className="illume-detail-section" ref={detailSectionRef}>
          <div className="illume-detail-copy">
            <h2 className="illume-scroll-heading" aria-label={detailHeading}>
              {detailHeading.split("").map((char, index) => {
                const charProgress = Math.max(0, Math.min(1, (detailHeadingProgress - index * 0.024) * 4.8));
                return (
                  <span
                    aria-hidden="true"
                    className="illume-scroll-char"
                    key={`${char}-${index}`}
                    style={{
                      "--char-light": charProgress
                    } as CSSProperties}
                  >
                    {char}
                  </span>
                );
              })}
            </h2>
            <p className="illume-detail-lede">
              Some books are brilliant. Some are very good at making you check your phone.
            </p>
            <p>
              Illume helps you stay with the page by combining reading, listening, and visuals in one calm, focused space.
            </p>
          </div>

          <div className="illume-library-showcase">
            <ClassicsWall />
          </div>
        </section>

        <section className="illume-focus-block" aria-label="Reading support features">
          <div className="illume-feature-lines">
            <article className="illume-focus-feature">
              <div>
                <h3>Listen while you read</h3>
                <p>Natural narration keeps the story moving when your attention starts to drift.</p>
              </div>
            </article>
            <article className="illume-focus-feature">
              <div>
                <h3>Follow every word</h3>
                <p>Live word tracking helps you stay locked onto the page.</p>
              </div>
            </article>
            <article className="illume-focus-feature">
              <div>
                <h3>See the scene</h3>
                <p>Image Mode makes dense or abstract passages feel easier to understand.</p>
              </div>
            </article>
          </div>
        </section>

        <section id="pricing" className="illume-final-cta">
          <img src="/landing/logo.webp" alt="" aria-hidden="true" />
          <div>
            <h2>Stop restarting the same chapter.</h2>
          </div>
          <button onClick={() => handleOpenAuth("sign-up")} className="illume-primary-button" type="button">
            <span>Get started free</span>
            <ArrowRight size={16} />
          </button>
        </section>
      </main>

      <footer className="illume-footer">
        <div className="illume-footer-brand">
          <img src="/landing/logo.webp" alt="" aria-hidden="true" />
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
