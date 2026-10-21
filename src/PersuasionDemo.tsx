import { useEffect, useRef, useState } from "react";
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

export function PersuasionDemo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [muted, setMuted] = useState(true);
  const [active, setActive] = useState(0);
  const activeSentence = sentenceForWord[active] ?? 0;

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
    <section className="c2-persuasion" aria-label="Persuasion reading demo">
      <audio
        ref={audioRef}
        src="/landing/persuasion/combined.mp3?v=2"
        preload="auto"
        onEnded={handleEnded}
      />

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

      <figure className="c2-persuasion-art" aria-hidden="true">
        {sentences.map((sentence, index) => (
          <img
            key={index}
            src={`/landing/persuasion/sentences/${String(index + 1).padStart(2, "0")}.webp?v=2`}
            alt=""
            className={index === activeSentence ? "is-active" : ""}
            loading={index < 2 ? "eager" : "lazy"}
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
