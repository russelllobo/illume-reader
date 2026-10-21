import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, Image, ActivityIndicator, Animated, PanResponder } from 'react-native';
import Slider from '@react-native-community/slider';
import { useStore } from '../store';
import * as Backend from '../supabase';
import { IllumeTheme } from '../theme';
import type { ReaderParagraph } from '../types';

// Single paragraph at a time, set directly on a bottom fade that darkens
// the picture behind the text — no card.
const CARD_INK = '#F5F2E9';

// Alpha ramp for the banded fade (transparent top → near-opaque bottom).
const FADE_BANDS = Array.from({ length: 12 }, (_, i) => {
  const t = i / 11;
  return Math.round(0.8 * t * t * 100) / 100;
});

// Same chunking as the web app: ~200 words per generated image so mobile
// requests hit the same server-side cache (user/book/style/start-end).
const IMAGE_CHUNK_WORDS = 200;

function wordsOf(text: string | null | undefined): string[] {
  if (!text) return [];
  return text.split(/\s+/).filter(Boolean);
}

interface ImageChunk {
  index: number;
  startWord: number;
  endWord: number;
  text: string;
  startParaIndex: number;
  endParaIndex: number;
}

function buildImageChunks(paragraphs: ReaderParagraph[]): ImageChunk[] {
  const chunks: ImageChunk[] = [];
  let wordOffset = 0;
  let chunkWords: string[] = [];
  let chunkStartWord = 1;
  let chunkStartPara = 0;

  const push = (endParaIndex: number) => {
    if (!chunkWords.length) return;
    chunks.push({
      index: chunks.length,
      startWord: chunkStartWord,
      endWord: wordOffset,
      text: chunkWords.join(' '),
      startParaIndex: chunkStartPara,
      endParaIndex,
    });
    chunkWords = [];
    chunkStartWord = wordOffset + 1;
  };

  paragraphs.forEach((p, paraIndex) => {
    const words = wordsOf(p.text);
    if (!words.length) return;
    if (!chunkWords.length) chunkStartPara = paraIndex;
    for (const w of words) {
      chunkWords.push(w);
      wordOffset += 1;
      if (chunkWords.length >= IMAGE_CHUNK_WORDS) {
        push(paraIndex);
        chunkStartPara = paraIndex;
      }
    }
    if (!chunkWords.length) chunkStartPara = paraIndex + 1;
  });
  push(paragraphs.length - 1);
  return chunks;
}

type ChunkEntry = { status: 'loading' | 'ready' | 'error'; url?: string; message?: string };

export function ReaderScreen() {
  const { activeBook, activeBookRow, closeReader, saveProgress, speak, readerSettings, setReaderSettings, session } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const bookId = activeBookRow?.id ?? null;
  const paragraphs = activeBook?.paragraphs ?? [];
  const initialPara = Math.min(Math.max(activeBookRow?.currentIndex ?? 0, 0), Math.max(paragraphs.length - 1, 0));
  const [activeParaIndex, setActiveParaIndex] = useState(initialPara);
  const [chunkCache, setChunkCache] = useState<Record<string, ChunkEntry>>({});
  const [retryNonce, setRetryNonce] = useState(0);
  const requestRef = useRef(0);

  // Crossfade layers for the picture when the section image changes.
  const [shownImageUrl, setShownImageUrl] = useState<string | null>(null);
  const [fadingImageUrl, setFadingImageUrl] = useState<string | null>(null);
  const imageFade = useRef(new Animated.Value(0)).current;

  // Reset per-book state when opening a different book.
  useEffect(() => {
    requestRef.current += 1;
    setShownImageUrl(null);
    setFadingImageUrl(null);
    setChunkCache({});
    setActiveParaIndex(Math.min(Math.max(activeBookRow?.currentIndex ?? 0, 0), Math.max((activeBook?.paragraphs.length ?? 1) - 1, 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const paraOffsets = useMemo(() => {
    const offsets: number[] = [];
    let total = 0;
    for (const p of paragraphs) {
      offsets.push(total);
      total += wordsOf(p.text).length;
    }
    return offsets;
  }, [paragraphs]);

  const chunks = useMemo(() => buildImageChunks(paragraphs), [paragraphs]);

  const activeChunkIndex = useMemo(() => {
    if (!chunks.length) return -1;
    const offset = paraOffsets[activeParaIndex] ?? 0;
    const hit = chunks.find((c) => c.startWord - 1 <= offset && c.endWord > offset);
    return hit ? hit.index : chunks[chunks.length - 1].index;
  }, [chunks, paraOffsets, activeParaIndex]);

  const activeChunk = activeChunkIndex >= 0 ? chunks[activeChunkIndex] : null;
  const cacheKey = activeChunk ? `${activeChunk.index}:${readerSettings.imageStyle}` : null;
  const current = cacheKey ? chunkCache[cacheKey] : undefined;

  // Crossfade the picture when the section image changes; the previous
  // image stays mounted on top while it fades out.
  const readyUrl = current?.status === 'ready' && current.url ? (current.url as string) : null;
  useEffect(() => {
    if (!readyUrl || readyUrl === shownImageUrl) return;
    setFadingImageUrl(shownImageUrl);
    setShownImageUrl(readyUrl);
    imageFade.setValue(1);
    const fade = Animated.timing(imageFade, { toValue: 0, duration: 450, useNativeDriver: true });
    fade.start(({ finished }) => {
      if (finished) setFadingImageUrl(null);
    });
    return () => {
      fade.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyUrl]);

  // Fetch (and cache) the image for the visible chunk, like the web stage does.
  useEffect(() => {
    if (!activeChunk || !cacheKey || !bookId) return;
    if (chunkCache[cacheKey]) return;
    const token = session?.accessToken;
    if (!token) {
      setChunkCache((prev) => ({ ...prev, [cacheKey]: { status: 'error', message: 'Please sign in again to generate images.' } }));
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setChunkCache((prev) => ({ ...prev, [cacheKey]: { status: 'loading' } }));
    let cancelled = false;
    Backend.invokeReaderImage(
      {
        author: activeBook?.author,
        bookId,
        bookTitle: activeBook?.title,
        startWord: activeChunk.startWord,
        endWord: activeChunk.endWord,
        text: activeChunk.text,
        style: readerSettings.imageStyle,
      },
      token
    ).then(
      (res) => {
        if (cancelled || requestRef.current !== requestId) return;
        if (res?.imageUrl) {
          setChunkCache((prev) => ({ ...prev, [cacheKey]: { status: 'ready', url: res.imageUrl as string } }));
        } else if (res?.limitReached) {
          setChunkCache((prev) => ({ ...prev, [cacheKey]: { status: 'error', message: 'Monthly image allowance reached.' } }));
        } else {
          setChunkCache((prev) => ({ ...prev, [cacheKey]: { status: 'error', message: 'Could not generate this image.' } }));
        }
      },
      (e: unknown) => {
        if (cancelled || requestRef.current !== requestId) return;
        setChunkCache((prev) => ({ ...prev, [cacheKey]: { status: 'error', message: e instanceof Error ? e.message : 'Could not generate this image.' } }));
      }
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, bookId, readerSettings.imageStyle, retryNonce]);

  if (!activeBook) return null;

  // One paragraph at a time: the card follows the finger, then settles
  // with a directional slide-and-fade. Progress persists and the picture
  // follows via the chunk derived from activeParaIndex.
  const slideAnim = useRef(new Animated.Value(0)).current;
  const animatingRef = useRef(false);
  const indexRef = useRef(activeParaIndex);
  indexRef.current = activeParaIndex;

  const cardTranslateY = slideAnim.interpolate({ inputRange: [-1, 1], outputRange: [-64, 64] });
  const cardOpacity = slideAnim.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.35, 1, 0.35] });

  const settleBack = () => {
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }).start();
  };

  const stepRef = useRef((delta: number) => {});
  const step = (delta: number) => {
    if (!paragraphs.length || animatingRef.current) return;
    const from = indexRef.current;
    const next = Math.min(Math.max(from + delta, 0), paragraphs.length - 1);
    if (next === from) {
      // Gentle bounce at the first/last section.
      Animated.sequence([
        Animated.timing(slideAnim, { toValue: -Math.sign(delta) * 0.25, duration: 90, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true }),
      ]).start();
      return;
    }
    animatingRef.current = true;
    Animated.timing(slideAnim, { toValue: -Math.sign(delta), duration: 150, useNativeDriver: true }).start(() => {
      setActiveParaIndex(next);
      const p = paragraphs[next];
      if (p) saveProgress(next, p.pageNumber ?? 1);
      slideAnim.setValue(Math.sign(delta));
      Animated.timing(slideAnim, { toValue: 0, duration: 240, useNativeDriver: true }).start(() => {
        animatingRef.current = false;
      });
    });
  };
  stepRef.current = step;

  // Vertical swipe anywhere on the card turns the section. The responder
  // only claims the touch once it moves vertically, so taps and long-press
  // (speak) on the text keep working.
  const cardResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (animatingRef.current) return;
        slideAnim.setValue(Math.max(-1, Math.min(1, g.dy / 140)));
      },
      onPanResponderRelease: (_, g) => {
        if (animatingRef.current) {
          settleBack();
          return;
        }
        if (g.dy < -24) stepRef.current(1);
        else if (g.dy > 24) stepRef.current(-1);
        else settleBack();
      },
      onPanResponderTerminate: () => {
        settleBack();
      },
    })
  ).current;

  const retryChunk = () => {
    if (!cacheKey) return;
    setChunkCache((prev) => {
      const next = { ...prev };
      delete next[cacheKey];
      return next;
    });
    setRetryNonce((n) => n + 1);
  };

  const visiblePara: ReaderParagraph | null = paragraphs.length
    ? paragraphs[Math.min(activeParaIndex, paragraphs.length - 1)]
    : null;

  const renderParagraphText = (p: ReaderParagraph) => (
    <Text
      onLongPress={() => speak(p.text)}
      style={[
        p.kind === 'heading' ? styles.heading : p.kind === 'quote' ? styles.quote : styles.body,
        {
          color: CARD_INK,
          fontSize: (p.kind === 'heading' ? 30 : 20) * readerSettings.textScale,
          lineHeight: (p.kind === 'heading' ? 34 : 28) * readerSettings.lineHeight * 0.7,
        },
      ]}
    >
      {p.text}
    </Text>
  );

  return (
    <View style={[styles.root, { backgroundColor: '#000' }]}>
      {/* Full-screen picture; the text floats over it in a translucent card */}
      <View style={StyleSheet.absoluteFill}>
        {shownImageUrl ? (
          <>
            <Image source={{ uri: shownImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            {fadingImageUrl && (
              <Animated.Image
                source={{ uri: fadingImageUrl }}
                style={[StyleSheet.absoluteFill, { opacity: imageFade }]}
                resizeMode="cover"
              />
            )}
          </>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.imageFallback]}>
            {current?.status === 'loading' || !current ? (
              <>
                <ActivityIndicator size="large" color="#fff" />
                <Text style={styles.imageFallbackTxt}>Painting this passage…</Text>
              </>
            ) : (
              <>
                <Text style={styles.imageFallbackTxt}>{current.message ?? 'No image for this passage yet.'}</Text>
                <Pressable style={styles.retryBtn} onPress={retryChunk}>
                  <Text style={styles.retryTxt}>Retry</Text>
                </Pressable>
              </>
            )}
          </View>
        )}
      </View>

      <View style={styles.imageToolbar}>
        <Pressable style={styles.darkBtn} onPress={closeReader}>
          <Text style={styles.darkBtnTxt}>↓</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.darkBtn} onPress={() => setSettingsOpen(true)}>
          <Text style={styles.darkBtnTxt}>A⁺</Text>
        </Pressable>
      </View>

      {/* One paragraph on a bottom fade that darkens the picture; swipe up/down to move.
          Pure-RN banded fade (no native dependency) so this ships as an OTA update. */}
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.fade} {...cardResponder.panHandlers}>
          {FADE_BANDS.map((alpha, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={[styles.fadeBand, { top: `${(i * 100) / FADE_BANDS.length}%`, backgroundColor: `rgba(0,0,0,${alpha})` }]}
            />
          ))}
          <View style={styles.fadeText}>
            {visiblePara ? (
              <Animated.View
                key={visiblePara.id}
                style={{ transform: [{ translateY: cardTranslateY }], opacity: cardOpacity }}
              >
                {renderParagraphText(visiblePara)}
              </Animated.View>
            ) : (
              <Text style={styles.emptyTxt}>No text in this book yet.</Text>
            )}
          </View>
        </View>
      </View>

      <Modal visible={settingsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSettingsOpen(false)}>
        <View style={{ flex: 1, backgroundColor: IllumeTheme.paper, padding: 24 }}>
          <Text style={{ fontSize: 32, fontWeight: '900' }}>Reading</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginVertical: 16 }}>
            {(['Paper', 'Night', 'Mint'] as const).map((t) => (
              <Pressable key={t} onPress={() => setReaderSettings({ ...readerSettings, theme: t })} style={[styles.seg, readerSettings.theme === t && styles.segActive]}>
                <Text style={{ fontWeight: '700' }}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.label}>Text size {readerSettings.textScale.toFixed(2)}</Text>
          <Slider value={readerSettings.textScale} minimumValue={0.82} maximumValue={1.42} onValueChange={(v) => setReaderSettings({ ...readerSettings, textScale: v })} />
          <Text style={styles.label}>Line height {readerSettings.lineHeight.toFixed(2)}</Text>
          <Slider value={readerSettings.lineHeight} minimumValue={1.0} maximumValue={2.0} onValueChange={(v) => setReaderSettings({ ...readerSettings, lineHeight: v })} />
          <Text style={styles.label}>Voice rate {readerSettings.narrationRate.toFixed(2)}</Text>
          <Slider value={readerSettings.narrationRate} minimumValue={0.35} maximumValue={0.62} onValueChange={(v) => setReaderSettings({ ...readerSettings, narrationRate: v })} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
            {(['cartoon', 'cute'] as const).map((s) => (
              <Pressable key={s} onPress={() => setReaderSettings({ ...readerSettings, imageStyle: s })} style={[styles.seg, readerSettings.imageStyle === s && styles.segActive]}>
                <Text style={{ fontWeight: '700', textTransform: 'capitalize' }}>{s}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={[styles.pill, { backgroundColor: IllumeTheme.ink, marginTop: 24 }]} onPress={() => setSettingsOpen(false)}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  heading: { fontWeight: '900' },
  quote: { fontStyle: 'italic', fontWeight: '500' },
  body: { fontWeight: '400' },
  emptyTxt: { fontSize: 14, fontWeight: '700', color: CARD_INK, opacity: 0.6 },
  label: { fontWeight: '700', marginTop: 12 },
  seg: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  segActive: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  pill: { borderRadius: 999, height: 52, alignItems: 'center', justifyContent: 'center' },
  imageFallback: { backgroundColor: '#101214', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  imageFallbackTxt: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  retryBtn: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  retryTxt: { color: '#fff', fontWeight: '800' },
  imageToolbar: { flexDirection: 'row', paddingHorizontal: 18, paddingTop: 60, paddingBottom: 8, gap: 10, zIndex: 10 },
  darkBtn: { minWidth: 44, height: 44, paddingHorizontal: 12, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  darkBtnTxt: { fontSize: 15, fontWeight: '800', color: '#fff' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  fade: { width: '100%', paddingTop: 110, paddingBottom: 44 },
  fadeBand: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '8.5%' },
  fadeText: { paddingHorizontal: 24 },
});
