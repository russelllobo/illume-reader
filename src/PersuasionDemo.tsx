import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

// The demo opens on "Be it known then..." rather than the dry first sentence.
const startSentenceIndex = Math.max(
  0,
  sentences.findIndex((sentence) => {
    const base = paragraphOffsets[sentence.paragraph];
    return (
      words[base + sentence.startWord]?.w === "Be" &&
      words[base + sentence.startWord + 1]?.w === "it" &&
      words[base + sentence.startWord + 2]?.w === "known"
    );
  })
);
const startWordIndex = sentences[startSentenceIndex]
  ? paragraphOffsets[sentences[startSentenceIndex].paragraph] + sentences[startSentenceIndex].startWord
  : 0;

type IntroPhase = "idle" | "flipping" | "reading";

export function PersuasionDemo() {
  const sectionRef = useRef<HTMLElement>(null);
  const artRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const loopEndRef = useRef(words.length);
  const introPlayedRef = useRef(false);
  const visibleRef = useRef(true);
  const [phase, setPhase] = useState<IntroPhase>(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "reading" : "idle"
  );
  const [introImage, setIntroImage] = useState(0);
  const progressRef = useRef(startWordIndex - 1);
  const [shownSentence, setShownSentence] = useState(startSentenceIndex);
  const activeSentence = phase === "flipping" ? introImage : shownSentence;

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

  // The art rests at its spot in the layout but starts centred over the page.
  // Measure the offset before paint and keep it in step with the layout, so
  // the only movement is a slide to the side when the text comes in.
  useLayoutEffect(() => {
    const section = sectionRef.current;
    const art = artRef.current;
    if (!section || !art) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const measure = () => {
      if (!section.clientWidth || !art.offsetWidth) return;
      const x = section.clientWidth / 2 - (art.offsetLeft + art.offsetWidth / 2);
      // Only lift the art on the side-by-side layout. On stacked layouts it
      // stays in its row so it never crosses the text.
      const y =
        art.offsetLeft > section.clientWidth / 2
          ? section.clientHeight / 2 - (art.offsetTop + art.offsetHeight / 2)
          : 0;
      section.style.setProperty("--c2-intro-x", `${x}px`);
      section.style.setProperty("--c2-intro-y", `${y}px`);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(section);
    observer.observe(art);

    if (reduced) {
      return () => observer.disconnect();
    }

    // Start the moment the demo fills the screen. No settle timer and no
    // separate "armed" beat: the first flip frame lands as the reader arrives.
    const maybeStart = () => {
      if (introPlayedRef.current) return;
      const rect = section.getBoundingClientRect();
      const viewport = window.innerHeight;
      if (rect.top > 1 || rect.bottom < viewport * 0.5) return;
      introPlayedRef.current = true;
      setPhase("flipping");
    };

    window.addEventListener("scroll", maybeStart, { passive: true });
    window.addEventListener("resize", maybeStart);
    maybeStart();

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", maybeStart);
      window.removeEventListener("resize", maybeStart);
    };
  }, []);

  useEffect(() => {
    if (phase !== "flipping") return;
    // Flip through the art, landing on the sentence the demo starts from.
    const sequence = Array.from(
      { length: sentences.length },
      (_, index) => (startSentenceIndex + 1 + index) % sentences.length
    );
    const delays = [0, 90, 100, 115, 135, 160, 195, 240, 300, 380, 470];
    const timers: number[] = [];
    let elapsed = 0;
    sequence.forEach((image, index) => {
      elapsed += delays[index] ?? 200;
      timers.push(window.setTimeout(() => setIntroImage(image), elapsed));
    });
    timers.push(window.setTimeout(() => setPhase("reading"), elapsed + 520));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  useEffect(() => {
    if (phase !== "reading") return;
    progressRef.current = startWordIndex - 1;
    wordRefs.current.forEach((word) => word?.classList.remove("is-read"));
    setShownSentence(startSentenceIndex);
  }, [phase]);

  // Only the words that fit the copy column take part in the demo. The column
  // is the same height as the picture, so the loop runs to the last fully
  // visible word and never needs to scroll.
  useLayoutEffect(() => {
    const copy = copyRef.current;
    if (!copy) return;
    let cancelled = false;

    const measure = () => {
      if (cancelled) return;
      // Keep clear of the bottom fade so the last word stays readable.
      const limit = copy.clientHeight - 64;
      let end = startWordIndex;
      for (let index = startWordIndex; index < wordRefs.current.length; index++) {
        const word = wordRefs.current[index];
        if (!word) continue;
        if (word.offsetTop + word.offsetHeight <= limit) end = index + 1;
        else break;
      }
      loopEndRef.current = end > startWordIndex ? end : startWordIndex + 1;
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(copy);
    void document.fonts.ready.then(measure);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

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
  // Classes are toggled straight on the word spans: at this pace, re-rendering
  // the whole passage on every step would melt the frame rate.
  useEffect(() => {
    if (phase !== "reading") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (document.hidden || !visibleRef.current) return;
      const current = progressRef.current;
      const total = loopEndRef.current || words.length;
      if (current + 1 >= total) {
        progressRef.current = startWordIndex - 1;
        wordRefs.current.forEach((word) => word?.classList.remove("is-read"));
        setShownSentence(startSentenceIndex);
        return;
      }

      const next = current + 1;
      const word = wordRefs.current[next];
      word?.classList.add("is-read");
      progressRef.current = next;

      const sentence = sentenceForWord[next] ?? 0;
      setShownSentence((shown) => (shown === sentence ? shown : sentence));
    }, 50);
    return () => window.clearInterval(id);
  }, [phase]);

  return (
    <section
      className={`c2-persuasion${
        phase === "flipping" ? " is-intro" : phase === "reading" ? " is-reading" : ""
      }`}
      ref={sectionRef}
      aria-label="Persuasion reading demo"
    >
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
              if (index < startWordIndex) return null;
              return (
                <span key={wordIndex}>
                  <span
                    className="c2-persuasion-word"
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
            className={index === activeSentence ? "is-active" : ""}
            loading="eager"
          />
        ))}
      </figure>
    </section>
  );
}
