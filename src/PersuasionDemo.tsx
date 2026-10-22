import { useEffect, useRef, useState } from "react";
import narrationData from "./concepts/persuasion-narration.json";
import sentenceData from "./concepts/persuasion-sentences.json";

type DemoWord = { w: string };
type DemoParagraph = { words: DemoWord[] };
type DemoSentence = { paragraph: number; startWord: number; endWord: number };

const narration = narrationData as { paragraphs: DemoParagraph[] };
const paragraphs = narration.paragraphs;
const sentences = (sentenceData as { sentences: DemoSentence[] }).sentences;

// Flatten the words once so the reading progress can walk them in order.
const words = paragraphs.flatMap((paragraph) => paragraph.words.map((word) => ({ ...word })));
const paragraphOffsets: number[] = [];
{
  let offset = 0;
  for (const paragraph of paragraphs) {
    paragraphOffsets.push(offset);
    offset += paragraph.words.length;
  }
}

const sentenceForWord = new Array(words.length).fill(0);
sentences.forEach((sentence, sentenceIndex) => {
  const base = paragraphOffsets[sentence.paragraph];
  for (let index = sentence.startWord; index <= sentence.endWord; index++) {
    sentenceForWord[base + index] = sentenceIndex;
  }
});

type IntroPhase = "idle" | "armed" | "flipping" | "reading";

export function PersuasionDemo() {
  const sectionRef = useRef<HTMLElement>(null);
  const artRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const introArmedRef = useRef(false);
  const introPlayedRef = useRef(false);
  const visibleRef = useRef(true);
  const [phase, setPhase] = useState<IntroPhase>("idle");
  const [introImage, setIntroImage] = useState(0);
  // -1 means nothing read yet; every word at or before this index is lit.
  const [progress, setProgress] = useState(-1);
  const shownSentence =
    phase === "flipping" ? introImage : (sentenceForWord[Math.max(0, progress)] ?? 0);

  // Warm the sentence art up while the reader is still on the hero, so the
  // opening flip never lands on an empty frame.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      sentences.forEach((_, index) => {
        const image = new Image();
        image.src = `/landing/persuasion/sentences/${String(index + 1).padStart(2, "0")}.webp?v=2`;
      });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const section = sectionRef.current;
    const art = artRef.current;
    if (!section || !art) return;

    let timer = 0;

    const isVisible = (threshold: number) => {
      const rect = section.getBoundingClientRect();
      const viewport = window.innerHeight;
      const visibleHeight = Math.max(0, Math.min(rect.bottom, viewport) - Math.max(rect.top, 0));
      return visibleHeight / Math.min(rect.height, viewport) >= threshold;
    };

    const measure = () => {
      const sectionRect = section.getBoundingClientRect();
      const artRect = art.getBoundingClientRect();
      if (!sectionRect.width || !sectionRect.height || !artRect.width || !artRect.height) return false;
      section.style.setProperty(
        "--c2-intro-x",
        `${sectionRect.left + sectionRect.width / 2 - (artRect.left + artRect.width / 2)}px`
      );
      section.style.setProperty(
        "--c2-intro-y",
        `${sectionRect.top + sectionRect.height / 2 - (artRect.top + artRect.height / 2)}px`
      );
      return true;
    };

    // Clear the stage the moment the demo starts peeking into view, so the
    // reader never sees the text layout flash before the pictures take over.
    const arm = () => {
      if (introArmedRef.current || introPlayedRef.current || !isVisible(0.03)) return;
      if (!measure()) return;
      introArmedRef.current = true;
      setPhase("armed");
    };

    // Once the reader has settled on the demo, run the picture flip.
    const begin = () => {
      if (introPlayedRef.current || !isVisible(0.6)) return;
      // Offsets are measured against the unshifted layout, so only measure
      // here when arm hasn't run yet. Re-measuring after the art has moved
      // would read the shifted position and snap the picture back.
      if (!introArmedRef.current) {
        arm();
        if (!introArmedRef.current) return;
      }
      introPlayedRef.current = true;
      setPhase("flipping");
    };

    const onScroll = () => {
      arm();
      window.clearTimeout(timer);
      timer = window.setTimeout(begin, 320);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    // In case the page loads already scrolled to the demo, clear the stage
    // on the next frame instead of waiting out the timer.
    const early = window.requestAnimationFrame(() => arm());
    timer = window.setTimeout(() => {
      arm();
      begin();
    }, 800);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(early);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (phase !== "flipping") return;
    const sequence = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0];
    const delays = [260, 90, 100, 115, 135, 160, 195, 240, 300, 380, 470];
    const timers: number[] = [];
    let elapsed = 0;
    sequence.forEach((image, index) => {
      elapsed += delays[index];
      timers.push(window.setTimeout(() => setIntroImage(image), elapsed));
    });
    timers.push(window.setTimeout(() => setPhase("reading"), elapsed + 520));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  useEffect(() => {
    if (phase !== "reading") return;
    copyRef.current?.scrollTo({ top: 0 });
  }, [phase]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const io = new IntersectionObserver(([entry]) => {
      visibleRef.current = entry.isIntersecting;
    }, { threshold: 0.15 });
    io.observe(section);
    return () => io.disconnect();
  }, []);

  // The reading progress: words light up one by one, looping forever. The
  // lit word also drives which picture is shown, so the art follows along.
  useEffect(() => {
    if (phase !== "reading") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (document.hidden || !visibleRef.current) return;
      setProgress((current) => {
        const next = current + 1 >= words.length ? -1 : current + 1;
        const box = copyRef.current;
        if (box) {
          if (next === -1) {
            box.scrollTo({ top: 0 });
          } else {
            const word = wordRefs.current[next];
            if (word) {
              const top = word.offsetTop;
              const bottom = top + word.offsetHeight;
              if (top < box.scrollTop + 32 || bottom > box.scrollTop + box.clientHeight - 96) {
                box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2) });
              }
            }
          }
        }
        return next;
      });
    }, 130);
    return () => window.clearInterval(id);
  }, [phase]);

  return (
    <section
      className={`c2-persuasion${
        phase === "armed" ? " is-armed" : phase === "flipping" ? " is-intro" : phase === "reading" ? " is-reading" : ""
      }`}
      ref={sectionRef}
      aria-label="Persuasion reading demo"
    >
      <div className="c2-persuasion-intro" aria-hidden="true" />
      <div className="c2-persuasion-intro-glow" aria-hidden="true" />

      <header className="c2-persuasion-book">
        <img src="/landing/persuasion/cover.jpg" alt="" />
        <div>
          <strong>Persuasion</strong>
          <span>Jane Austen</span>
        </div>
      </header>

      <div
        className="c2-persuasion-copy"
        ref={copyRef}
        aria-label="Sample passage from Persuasion by Jane Austen"
      >
        {paragraphs.map((paragraph, paragraphIndex) => (
          <p key={paragraphIndex}>
            {paragraph.words.map((word, wordIndex) => {
              const index = paragraphOffsets[paragraphIndex] + wordIndex;
              return (
                <span key={wordIndex}>
                  <span
                    className={`c2-persuasion-word${
                      phase === "reading" && index <= progress ? " is-read" : ""
                    }`}
                    ref={(element) => {
                      wordRefs.current[index] = element;
                    }}
                  >
                    {word.w}
                  </span>{" "}
                </span>
              );
            })}
          </p>
        ))}
      </div>

      <figure className="c2-persuasion-art" ref={artRef} aria-hidden="true">
        {sentences.map((sentence, index) => (
          <img
            key={index}
            src={`/landing/persuasion/sentences/${String(index + 1).padStart(2, "0")}.webp?v=2`}
            alt=""
            className={index === shownSentence ? "is-active" : ""}
            loading="eager"
          />
        ))}
      </figure>
    </section>
  );
}
