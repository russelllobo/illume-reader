import { Communicate } from "edge-tts-universal/browser";

type WordRange = {
  end: number;
  start: number;
};

type EdgeTtsPlayerOptions = {
  onBoundary: (range: WordRange) => void;
  onEnded: () => void;
  onError: (error: Error) => void;
  text: string;
  voice?: string;
  wordRanges: WordRange[];
};

export type EdgeTtsPlayer = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
};

type TimedWordRange = WordRange & {
  startsAt: number;
};

const EDGE_TTS_VOICE = "en-GB-SoniaNeural";
const STREAMING_MIME = "audio/mpeg";

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

export const createEdgeTtsPlayer = ({
  onBoundary,
  onEnded,
  onError,
  text,
  voice = EDGE_TTS_VOICE,
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
        startsAt: index * 0.31
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
    void audio.play().catch(fail);

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

    const response = await fetch(edgeTtsEndpoint(), {
      body: JSON.stringify({ text, voice }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(details?.error ?? "Edge TTS proxy failed.");
    }
    if (!response.body) throw new Error("Local Edge TTS proxy returned no audio stream.");

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
      rate: "-5%",
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
      await runProxy();
      return;
    }

    await runBrowserEdge();
  };

  void run().catch(fail);

  return {
    pause: () => audio.pause(),
    resume: () => {
      void audio.play().catch(fail);
    },
    stop: () => {
      cancelled = true;
      cleanup();
    }
  };
};
