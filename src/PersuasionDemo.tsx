import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { Volume2, VolumeX } from "lucide-react";
import narrationData from "./concepts/persuasion-narration.json";
import sentenceData from "./concepts/persuasion-sentences.json";

type NarrationWord = { w: string; start: number; end: number };
type NarrationParagraph = { text: string; audioStartMs: number; words: NarrationWord[] };
type DemoParagraph = { text: string; paragraph: number; startWord: number; endWord: number };

const narration = narrationData as { durationMs: number; paragraphs: NarrationParagraph[] };
const paragraphs = narration.paragraphs;
const sentences = (sentenceData as { sentences: DemoParagraph[] }).sentences;

// Flatten the words once so playback can binary-search the active one.
const words = paragraphs.flatMap((paragraph, paragraphIndex) =>
  paragraph.words.map((word, wordIndex) => ({ ...word, paragraphIndex, wordIndex }))
);
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

const activeWordAt = (timeMs: number) => {
  let lo = 0;
  let hi = words.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= timeMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
};

type IntroPhase = "idle" | "armed" | "flipping" | "revealing" | "done";

export function PersuasionDemo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const artRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const introArmedRef = useRef(false);
  const introPlayedRef = useRef(false);
  const [muted, setMuted] = useState(true);
  const [active, setActive] = useState(0);
  const [phase, setPhase] = useState<IntroPhase>("idle");
  const [introImage, setIntroImage] = useState(0);
  const activeSentence = sentenceForWord[active] ?? 0;
  const introing = phase === "flipping" || phase === "revealing";
  const shownSentence = introing ? introImage : activeSentence;

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
    timers.push(window.setTimeout(() => setPhase("revealing"), elapsed + 520));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase]);

  useEffect(() => {
    if (phase !== "revealing") return;
    const timer = window.setTimeout(() => setPhase("done"), 3900);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let raf = 0;
    let previous = -1;

    const tick = () => {
      const index = activeWordAt(audio.currentTime * 1000);
      if (index !== previous) {
        previous = index;
        setActive(index);
        const word = wordRefs.current[index];
        const box = copyRef.current;
        if (word && box) {
          const top = word.offsetTop;
          const bottom = top + word.offsetHeight;
          if (top < box.scrollTop + 32 || bottom > box.scrollTop + box.clientHeight - 96) {
            box.scrollTo({ top: Math.max(0, top - box.clientHeight / 2), behavior: "smooth" });
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (raf) return;
      previous = -1;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    audio.addEventListener("play", start);
    audio.addEventListener("pause", stop);
    audio.addEventListener("ended", stop);
    if (!audio.paused) start();
    return () => {
      stop();
      audio.removeEventListener("play", start);
      audio.removeEventListener("pause", stop);
      audio.removeEventListener("ended", stop);
    };
  }, []);

  const toggleSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (audio.ended || audio.currentTime * 1000 >= narration.durationMs - 100) {
        audio.currentTime = 0;
        setActive(0);
      }
      setMuted(false);
      void audio.play().catch(() => setMuted(true));
    } else {
      audio.pause();
      setMuted(true);
    }
  };

  const playFrom = (index: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = words[index].start / 1000 + 0.02;
    setActive(index);
    setMuted(false);
    void audio.play().catch(() => setMuted(true));
  };

  const handleEnded = () => {
    if (audioRef.current) audioRef.current.currentTime = 0;
    setActive(0);
    setMuted(true);
  };

  return (
    <section
      className={`c2-persuasion${
        phase === "armed" ? " is-armed" : phase === "flipping" ? " is-intro" : phase === "revealing" ? " is-revealing" : ""
      }`}
      ref={sectionRef}
      aria-label="Persuasion reading demo"
    >
      <audio
        ref={audioRef}
        src="/landing/persuasion/combined.mp3?v=2"
        preload="auto"
        onEnded={handleEnded}
      />

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
                    className={`c2-persuasion-word${index === active ? " is-spoken" : ""}`}
                    style={{ "--c2-word-index": index } as CSSProperties}
                    ref={(element) => {
                      wordRefs.current[index] = element;
                    }}
                    onClick={() => playFrom(index)}
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

      <button
        type="button"
        className={`c2-persuasion-mute${muted ? "" : " is-playing"}`}
        onClick={toggleSound}
        aria-pressed={!muted}
        aria-label={muted ? "Listen to this page" : "Mute narration"}
      >
        {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
        <span>{muted ? "Listen" : "Mute"}</span>
      </button>
    </section>
  );
}
