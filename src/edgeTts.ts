import { Communicate } from "edge-tts-universal/browser";

type WordRange = {
  end: number;
  start: number;
};

type EdgeTtsPlayerOptions = {
  onBoundary: (range: WordRange) => void;
  onEnded: () => void;
  onError: (error: Error) => void;
  rate?: number;
  text: string;
  voice?: string;
  wordRanges: WordRange[];
};

export type EdgeTtsPlayer = {
  pause: () => void;
  resume: () => void;
  setRate: (rate: number) => void;
  stop: () => void;
};

type TimedWordRange = WordRange & {
  startsAt: number;
};

export const DEFAULT_EDGE_TTS_VOICE = "en-US-AvaMultilingualNeural";
const STREAMING_MIME = "audio/mpeg";

const clampSpeechRate = (rate: number | undefined) =>
  Math.min(2, Math.max(0.7, Number.isFinite(rate) ? rate ?? 1 : 1));

const edgeRateFromMultiplier = (rate: number | undefined) => {
  const percent = Math.round((clampSpeechRate(rate) - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
};

const normalizeWord = (value: string) =>
  value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

const findBoundaryRange = (
  text: string,
  ranges: WordRange[],
  boundaryText: string,
  fromIndex: number
) => {
  const normalizedBoundary = normalizeWord(boundaryText);

  for (let index = fromIndex; index < Math.min(ranges.length, fromIndex + 8); index += 1) {
    const range = ranges[index];
    if (normalizeWord(text.slice(range.start, range.end)) === normalizedBoundary) {
      return { index, range };
    }
  }

  const fallback = ranges[fromIndex];
  return fallback ? { index: fromIndex, range: fallback } : null;
};

const canStreamMp3 = () =>
  "MediaSource" in window &&
  typeof MediaSource.isTypeSupported === "function" &&
  MediaSource.isTypeSupported(STREAMING_MIME);

const audioChunkToArrayBuffer = (chunk: Uint8Array): ArrayBuffer =>
  chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer;

const shouldUseLocalProxy = () =>
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

const configuredEdgeTtsEndpoint = import.meta.env.VITE_EDGE_TTS_URL as string | undefined;

const edgeTtsEndpoint = () => {
  if (shouldUseLocalProxy()) return "/api/edge-tts";
  if (configuredEdgeTtsEndpoint) return configuredEdgeTtsEndpoint;
  return "/api/edge-tts";
};

const responseErrorMessage = async (response: Response, endpoint: string) => {
  const contentType = response.headers.get("Content-Type") ?? "";
  const details = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");
  const message =
    typeof details?.error === "string"
      ? details.error
      : typeof details === "string" && details.trim()
        ? details.trim().slice(0, 140)
        : response.statusText || "request failed";

  return `Edge TTS proxy ${response.status} at ${endpoint}: ${message}`;
};

export const createEdgeTtsPlayer = ({
  onBoundary,
  onEnded,
  onError,
  rate,
  text,
  voice = DEFAULT_EDGE_TTS_VOICE,
  wordRanges
}: EdgeTtsPlayerOptions): EdgeTtsPlayer => {
  const audio = new Audio();
  const bufferedChunks: Uint8Array[] = [];
  const queuedChunks: Uint8Array[] = [];
  const timedRanges: TimedWordRange[] = [];
  let cancelled = false;
  let ended = false;
  let mediaSource: MediaSource | null = null;
  let objectUrl = "";
  let rangeSearchIndex = 0;
  let sourceBuffer: SourceBuffer | null = null;
  let streamEnded = false;
  let monitorTimer: number | null = null;
  let nextTimedRangeIndex = 0;
  let startupTimer: number | null = null;
  const speechRate = clampSpeechRate(rate);
  const edgeRate = edgeRateFromMultiplier(speechRate);

  const cleanup = () => {
    if (monitorTimer !== null) {
      window.clearInterval(monitorTimer);
      monitorTimer = null;
    }
    if (startupTimer !== null) {
      window.clearTimeout(startupTimer);
      startupTimer = null;
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
    onError(error instanceof Error ? error : new Error("Edge TTS playback failed."));
  };

  const resetAudioPipeline = () => {
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
    queuedChunks.length = 0;
    bufferedChunks.length = 0;
    mediaSource = null;
    sourceBuffer = null;
    streamEnded = false;
    nextTimedRangeIndex = 0;
  };

  const startBoundaryMonitor = () => {
    if (monitorTimer !== null) return;

    monitorTimer = window.setInterval(() => {
      if (cancelled || audio.paused) return;
      const currentTime = audio.currentTime + 0.03;

      while (
        nextTimedRangeIndex < timedRanges.length &&
        timedRanges[nextTimedRangeIndex].startsAt <= currentTime
      ) {
        const { start, end } = timedRanges[nextTimedRangeIndex];
        onBoundary({ start, end });
        nextTimedRangeIndex += 1;
      }
    }, 50);
  };

  const queueBoundary = (boundaryText: string, offset: number) => {
    const matched = findBoundaryRange(text, wordRanges, boundaryText, rangeSearchIndex);
    if (!matched) return;

    rangeSearchIndex = matched.index + 1;
    timedRanges.push({
      ...matched.range,
      startsAt: offset / 10_000_000
    });
  };

  const queueEstimatedBoundaries = () => {
    if (timedRanges.length || !wordRanges.length) return;

    wordRanges.forEach((range, index) => {
      timedRanges.push({
        ...range,
        startsAt: (index * 0.31) / speechRate
      });
    });
  };

  const pumpSourceBuffer = () => {
    if (!sourceBuffer || sourceBuffer.updating) return;

    const next = queuedChunks.shift();
    if (next) {
      sourceBuffer.appendBuffer(audioChunkToArrayBuffer(next));
      return;
    }

    if (streamEnded && mediaSource?.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch (error) {
        fail(error);
      }
    }
  };

  const appendStreamingChunk = (chunk: Uint8Array) => {
    queuedChunks.push(chunk);
    pumpSourceBuffer();
  };

  const playBufferedAudio = async () => {
    if (cancelled) return;
    const blob = new Blob(bufferedChunks.map(audioChunkToArrayBuffer), { type: STREAMING_MIME });
    objectUrl = URL.createObjectURL(blob);
    audio.src = objectUrl;
    audio.onended = finish;
    startBoundaryMonitor();
    await audio.play();
  };

  const startStreamingAudio = async () => {
    mediaSource = new MediaSource();
    objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;
    audio.onended = finish;
    void audio.play().catch(() => {
      // Some browsers reject until bytes arrive; playback is retried on the first audio chunk.
    });

    await new Promise<void>((resolve, reject) => {
      if (!mediaSource) {
        reject(new Error("MediaSource is not available."));
        return;
      }

      mediaSource.addEventListener(
        "sourceopen",
        () => {
          if (!mediaSource) return;
          try {
            sourceBuffer = mediaSource.addSourceBuffer(STREAMING_MIME);
            sourceBuffer.addEventListener("updateend", pumpSourceBuffer);
            resolve();
          } catch (error) {
            reject(error);
          }
        },
        { once: true }
      );
    });

    startBoundaryMonitor();
  };

  const runProxy = async () => {
    await startStreamingAudio();
    queueEstimatedBoundaries();
    const endpoint = edgeTtsEndpoint();

    const response = await fetch(endpoint, {
      body: JSON.stringify({ rate: speechRate, text, voice }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, endpoint));
    }
    if (!response.body) throw new Error(`Edge TTS proxy returned no audio stream at ${endpoint}.`);

    const reader = response.body.getReader();
    while (!cancelled) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      if (startupTimer !== null) {
        window.clearTimeout(startupTimer);
        startupTimer = null;
      }

      appendStreamingChunk(value);
    }

    streamEnded = true;
    pumpSourceBuffer();
  };

  const runBrowserEdge = async () => {
    const useStreaming = canStreamMp3();
    if (useStreaming) await startStreamingAudio();

    const communicate = new Communicate(text, {
      connectionTimeout: 8_000,
      pitch: "+0Hz",
      rate: edgeRate,
      voice,
      volume: "+0%"
    });

    let startedPlayback = false;

    for await (const chunk of communicate.stream()) {
      if (cancelled) return;

      if (chunk.type === "audio" && chunk.data) {
        if (startupTimer !== null) {
          window.clearTimeout(startupTimer);
          startupTimer = null;
        }

        if (useStreaming) {
          appendStreamingChunk(chunk.data);
          if (!startedPlayback) {
            startedPlayback = true;
            if (audio.paused) await audio.play();
          }
        } else {
          bufferedChunks.push(chunk.data);
        }
      }

      if (chunk.type === "WordBoundary" && typeof chunk.text === "string" && typeof chunk.offset === "number") {
        queueBoundary(chunk.text, chunk.offset);
      }
    }

    if (useStreaming) {
      streamEnded = true;
      pumpSourceBuffer();
    } else {
      await playBufferedAudio();
    }
  };

  const run = async () => {
    startupTimer = window.setTimeout(() => {
      fail(new Error("Edge TTS did not start quickly enough."));
    }, 10_000);

    if (canStreamMp3()) {
      try {
        await runProxy();
        return;
      } catch (error) {
        if (cancelled) return;
        console.warn("Edge TTS proxy failed; falling back to direct Edge WebSocket.", error);
        resetAudioPipeline();
      }
    }

    await runBrowserEdge();
  };

  void run().catch(fail);

  return {
    pause: () => audio.pause(),
    resume: () => {
      void audio.play().catch(fail);
    },
    setRate: (nextRate: number) => {
      audio.playbackRate = clampSpeechRate(nextRate) / speechRate;
    },
    stop: () => {
      cancelled = true;
      cleanup();
    }
  };
};
