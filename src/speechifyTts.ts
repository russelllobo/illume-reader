import { supabase } from "./supabase";

type WordRange = {
  end: number;
  start: number;
};

type SpeechifyPlayerOptions = {
  onBoundary: (range: WordRange) => void;
  onEnded: () => void;
  onError: (error: Error) => void;
  rate?: number;
  text: string;
  voice?: string;
  wordRanges: WordRange[];
};

export type SpeechifyPlayer = {
  pause: () => void;
  resume: () => void;
  setRate: (rate: number) => void;
  stop: () => void;
};

export const SPEECHIFY_DEFAULT_VOICE_ID = "speechify-geffen";
export const SPEECHIFY_SERVER_VOICE_ID = "geffen_32";

export const isSpeechifyVoiceId = (voiceId: string | undefined) =>
  voiceId === SPEECHIFY_DEFAULT_VOICE_ID;

type SpokenWord = { text: string; start: number; end: number };

type FetchedSpeech = {
  audioBase64: string;
  words: SpokenWord[];
};

// Shared in-memory cache so pressing play (or advancing to the next
// paragraph) usually hits an already-in-flight or completed request instead
// of starting a new round-trip. Audio is synthesized at 1x server-side and
// speed is applied via playbackRate, so entries are keyed by text + voice
// only and stay valid across rate changes.
const speechCache = new Map<string, Promise<FetchedSpeech>>();
const MAX_CACHED_PARAGRAPHS = 12;

const speechCacheKey = (text: string, voice: string) =>
  `${voice}::${text.trim().slice(0, 2000)}`;

const rememberSpeech = (key: string, request: Promise<FetchedSpeech>) => {
  speechCache.set(key, request);
  // LRU-ish bound: drop the oldest entry when over capacity. Audio blobs
  // are a few hundred KB each, so this caps memory at a few MB.
  if (speechCache.size > MAX_CACHED_PARAGRAPHS) {
    const oldest = speechCache.keys().next();
    if (!oldest.done) speechCache.delete(oldest.value);
  }
  // Don't poison the cache: a failed request should be retried next time.
  request.catch(() => {
    if (speechCache.get(key) === request) speechCache.delete(key);
  });
  return request;
};

type TimedWord = WordRange & {
  startsAt: number;
};

const clampSpeechRate = (rate: number | undefined) =>
  Math.min(2, Math.max(0.7, Number.isFinite(rate) ? rate ?? 1 : 1));

const normalizeWord = (value: string) =>
  value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const base64ToBytes = (base64: string) => {
  const cleaned = base64.replace(/\s+/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const functionErrorMessage = (error: unknown) => {
  if (error && typeof error === "object") {
    const value = error as {
      context?: unknown;
      message?: unknown;
    };
    // supabase-js FunctionsHttpError carries the server JSON in context.
    // Surface the server's { error } message when present.
    const context = value.context;
    if (context && typeof context === "object") {
      const nested = context as { error?: unknown };
      if (typeof nested.error === "string" && nested.error.trim()) {
        return nested.error;
      }
    }
    if (typeof value.message === "string" && value.message.trim()) {
      // FunctionsHttpError messages look like "Edge Function returned a
      // non-2xx status code" — keep them only if no server message exists.
      if (!value.message.includes("non-2xx")) return value.message;
    }
  }
  return "Speechify narration failed.";
};

/**
 * Speechify narration player (simba-3.2 / geffen_32).
 * Audio is synthesized server-side via the `edge-tts` Supabase Edge Function
 * so the Speechify API key never reaches the browser. Word timings come from
 * Speechify speech_marks and are mapped onto the reader's word ranges for
 * live highlighting.
 *
 * Server-side synthesis runs at 1x; the requested rate is applied locally
 * via playbackRate so rate changes (and cache hits) never need a refetch.
 */
export const fetchSpeechifyAudio = (
  text: string,
  voice: string = SPEECHIFY_SERVER_VOICE_ID
): Promise<FetchedSpeech> => {
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return Promise.reject(new Error("No text was provided for speech."));
  const key = speechCacheKey(trimmed, voice);
  const cached = speechCache.get(key);
  if (cached) return cached;

  const request = (async (): Promise<FetchedSpeech> => {
    const { data, error } = await supabase.functions.invoke("edge-tts", {
      body: { rate: 1, text: trimmed, voice }
    });

    if (error) throw new Error(functionErrorMessage(error));
    const serverError =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? ((data as { error: string }).error as string)
        : "";
    if (serverError) throw new Error(serverError);

    const audioBase64 =
      data && typeof data === "object" && typeof (data as { audio?: unknown }).audio === "string"
        ? ((data as { audio: string }).audio as string)
        : "";
    if (!audioBase64) throw new Error("Speechify returned no audio.");

    const words = (
      data && typeof data === "object" && Array.isArray((data as { words?: unknown }).words)
        ? ((data as { words: SpokenWord[] }).words)
        : []
    ).filter(
      (word) =>
        word &&
        typeof word.text === "string" &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end)
    );

    return { audioBase64, words };
  })();

  return rememberSpeech(key, request);
};

/**
 * Warm the cache for a paragraph without playing it. Fire-and-forget: errors
 * are swallowed so prefetching never surfaces a notice; the real play will
 * retry and report failures then. Safe to call often — in-flight and cached
 * requests are deduped.
 */
export const prefetchSpeechifyAudio = (
  text: string,
  voice: string = SPEECHIFY_SERVER_VOICE_ID
): void => {
  if (!text.trim()) return;
  try {
    const pending = fetchSpeechifyAudio(text, voice);
    // Attach a no-op catch now so background rejections never trigger
    // unhandledrejection warnings; the shared promise stays rejected so a
    // later play still retries via cache eviction.
    pending.catch(() => undefined);
  } catch {
    // Synchronous validation failures (empty text) are not worth reporting.
  }
};
export const createSpeechifyPlayer = ({
  onBoundary,
  onEnded,
  onError,
  rate,
  text,
  voice = SPEECHIFY_SERVER_VOICE_ID,
  wordRanges
}: SpeechifyPlayerOptions): SpeechifyPlayer => {
  const audio = new Audio();
  let cancelled = false;
  let ended = false;
  let objectUrl = "";
  let monitorTimer: number | null = null;
  let nextWordIndex = 0;
  const timedWords: TimedWord[] = [];
  const speechRate = clampSpeechRate(rate);

  const cleanup = () => {
    if (monitorTimer !== null) {
      window.clearInterval(monitorTimer);
      monitorTimer = null;
    }
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
  };

  const finish = () => {
    if (cancelled || ended) return;
    ended = true;
    cleanup();
    onEnded();
  };

  const fail = (error: unknown) => {
    if (cancelled || ended) return;
    ended = true;
    cleanup();
    onError(error instanceof Error ? error : new Error("Speechify narration failed."));
  };

  const startMonitor = () => {
    if (monitorTimer !== null) return;
    monitorTimer = window.setInterval(() => {
      if (cancelled || audio.paused) return;
      const currentTime = audio.currentTime + 0.03;
      while (nextWordIndex < timedWords.length && timedWords[nextWordIndex].startsAt <= currentTime) {
        const { start, end } = timedWords[nextWordIndex];
        onBoundary({ start, end });
        nextWordIndex += 1;
      }
    }, 50);
  };

  const alignTimings = (
    spoken: Array<{ text: string; start: number; end: number }>
  ) => {
    let searchIndex = 0;
    spoken.forEach((word, spokenIndex) => {
      const normalized = normalizeWord(word.text);
      let matchedIndex = -1;
      for (
        let index = searchIndex;
        index < Math.min(wordRanges.length, searchIndex + 8);
        index += 1
      ) {
        const range = wordRanges[index];
        if (normalizeWord(text.slice(range.start, range.end)) === normalized) {
          matchedIndex = index;
          break;
        }
      }
      if (matchedIndex < 0) {
        const fallbackIndex = Math.min(searchIndex, wordRanges.length - 1);
        if (fallbackIndex >= 0 && wordRanges[fallbackIndex] && !normalized) return;
        if (fallbackIndex >= 0 && wordRanges[fallbackIndex]) matchedIndex = fallbackIndex;
        else if (spokenIndex < wordRanges.length && wordRanges[spokenIndex]) {
          matchedIndex = spokenIndex;
        } else return;
      }
      const range = wordRanges[matchedIndex];
      if (!range) return;
      searchIndex = matchedIndex + 1;
      timedWords.push({ ...range, startsAt: word.start });
    });
    timedWords.sort((a, b) => a.startsAt - b.startsAt);
  };

  const run = async () => {
    const trimmed = text.trim();
    if (!trimmed) throw new Error("No text was provided for speech.");

    const { audioBase64, words } = await fetchSpeechifyAudio(trimmed, voice);

    if (cancelled) return;

    alignTimings(words);
    if (!timedWords.length && wordRanges.length) {
      // Track is synthesized at 1x; currentTime is a track position, so
      // estimated marks stay in 1x track time regardless of playbackRate.
      wordRanges.forEach((range, index) => {
        timedWords.push({ ...range, startsAt: index * 0.31 });
      });
    }

    const bytes = base64ToBytes(audioBase64);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" });
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    audio.preload = "auto";
    audio.playbackRate = speechRate;
    audio.onended = finish;
    audio.onerror = () => fail(new Error("Speechify audio could not play."));
    startMonitor();
    await audio.play();
  };

  void run().catch(fail);

  return {
    pause: () => audio.pause(),
    resume: () => {
      void audio.play().catch(fail);
    },
    setRate: (nextRate: number) => {
      audio.playbackRate = clampSpeechRate(nextRate);
    },
    stop: () => {
      cancelled = true;
      cleanup();
    }
  };
};
