import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Modal, Image, Switch } from 'react-native';
import Slider from '@react-native-community/slider';
import { useStore } from '../store';
import { IllumeTheme, radius } from '../theme';

function themeColors(theme: string) {
  if (theme === 'Night') return { bg: IllumeTheme.night, fg: IllumeTheme.nightInk };
  if (theme === 'Mint') return { bg: IllumeTheme.mint, fg: IllumeTheme.ink };
  return { bg: IllumeTheme.paper, fg: IllumeTheme.ink };
}

export function ReaderScreen() {
  const { activeBook, activeBookRow, closeReader, saveProgress, speak, generateImage, readerSettings, setReaderSettings, readerImageResponse, clearReaderImage } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { bg, fg } = themeColors(readerSettings.theme);
  if (!activeBook) return null;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <View style={styles.toolbar}>
        <Pressable style={styles.iconBtn} onPress={closeReader}>
          <Text style={styles.iconTxt}>↓</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.iconBtn} onPress={() => setSettingsOpen(true)}>
          <Text style={styles.iconTxt}>A⁺</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120, maxWidth: readerSettings.lineWidth * 12, alignSelf: 'center', width: '100%' }}>
        {activeBook.paragraphs.map((p, index) => (
          <View key={p.id} style={{ marginVertical: p.kind === 'heading' ? 22 : 4 }}>
            <Text
              selectable
              onLongPress={() => speak(p.text)}
              style={[
                p.kind === 'heading' ? styles.heading : p.kind === 'quote' ? styles.quote : styles.body,
                {
                  color: fg,
                  fontSize: (p.kind === 'heading' ? 30 : 20) * readerSettings.textScale,
                  lineHeight: (p.kind === 'heading' ? 34 : 28) * readerSettings.lineHeight * 0.85,
                },
              ]}
            >
              {p.text}
            </Text>
            {p.kind !== 'heading' && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, opacity: 0.8 }}>
                <Pressable style={styles.mini} onPress={() => { saveProgress(index, p.pageNumber ?? 1); speak(p.text); }}>
                  <Text style={styles.miniTxt}>▶ Speak</Text>
                </Pressable>
                <Pressable style={styles.mini} onPress={() => generateImage(p)}>
                  <Text style={styles.miniTxt}>✦ Image</Text>
                </Pressable>
              </View>
            )}
            <View onLayout={() => {}} />
          </View>
        ))}
      </ScrollView>

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

      <Modal visible={!!readerImageResponse?.imageUrl} transparent animationType="slide" onRequestClose={clearReaderImage}>
        <Pressable style={styles.overlay} onPress={clearReaderImage}>
          <View style={styles.card}>
            {readerImageResponse?.imageUrl && <Image source={{ uri: readerImageResponse.imageUrl }} style={{ width: '100%', height: 320, borderRadius: 16 }} resizeMode="contain" />}
            <Pressable style={[styles.iconBtn, { position: 'absolute', top: 24, right: 24 }]} onPress={clearReaderImage}>
              <Text style={styles.iconTxt}>✕</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  toolbar: { flexDirection: 'row', paddingHorizontal: 18, paddingTop: 60, paddingBottom: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center' },
  iconTxt: { fontSize: 16, fontWeight: '800' },
  heading: { fontWeight: '900' },
  quote: { fontStyle: 'italic', fontWeight: '500' },
  body: { fontWeight: '400' },
  mini: { backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  miniTxt: { fontSize: 12, fontWeight: '800' },
  label: { fontWeight: '700', marginTop: 12 },
  seg: { flex: 1, borderRadius: 12, padding: 12, alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  segActive: { backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.1)' },
  pill: { borderRadius: 999, height: 52, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'flex-end', padding: 18 },
  card: { backgroundColor: '#fff', borderRadius: 28, padding: 12 },
});
