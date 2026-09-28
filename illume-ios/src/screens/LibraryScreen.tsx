import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, RefreshControl, Modal, Image } from 'react-native';
import { useStore } from '../store';
import { IllumeTheme, radius, spacing } from '../theme';
import type { BookRow } from '../types';
import { ProfileSheet } from './ProfileSheet';

function Cover({ book, size }: { book: BookRow; size: { width: number; height: number } }) {
  if (book.coverUrl) {
    return <Image source={{ uri: book.coverUrl }} style={[{ width: size.width, height: size.height, borderRadius: 14 }]} resizeMode="cover" />;
  }
  const palettes: [string, string][] = [
    [IllumeTheme.ink, IllumeTheme.accent],
    [IllumeTheme.plum, IllumeTheme.coral],
    ['#143B42', '#F7BD42'],
  ];
  const [a, b] = palettes[Math.abs(hash(book.title)) % palettes.length];
  return (
    <View style={[{ width: size.width, height: size.height, borderRadius: 14, backgroundColor: a, justifyContent: 'flex-end', overflow: 'hidden' }]}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: b, opacity: 0.35 }} />
      <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: size.width * 0.46, fontWeight: '900', padding: 10 }}>{book.title.slice(0, 1)}</Text>
    </View>
  );
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export function LibraryScreen() {
  const { books, openBook, importPickedDocument, reload, isLoading, imageUsageCount, imageLimit } = useStore();
  const [profileOpen, setProfileOpen] = useState(false);
  const first = books[0];

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={reload} />}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.appTitle}>Illume</Text>
            <Text style={styles.sub}>
              {books.length} books · {imageUsageCount}/{imageLimit} images
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable style={styles.iconBtn} onPress={() => setProfileOpen(true)}>
              <Text style={styles.iconTxt}>☺</Text>
            </Pressable>
            <Pressable style={styles.iconBtn} onPress={() => importPickedDocument()}>
              <Text style={styles.iconTxt}>＋</Text>
            </Pressable>
          </View>
        </View>

        {books.length === 0 ? (
          <View style={{ marginTop: 60 }}>
            <Text style={{ fontSize: 54 }}>📚</Text>
            <Text style={styles.emptyTitle}>Drop in your first book.</Text>
            <Text style={styles.sub}>EPUBs and PDFs sync through the same private backend as the web app.</Text>
            <Pressable style={[styles.pill, { backgroundColor: IllumeTheme.accent, marginTop: 16 }]} onPress={() => importPickedDocument()}>
              <Text style={styles.pillText}>Import EPUB or PDF</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {first && (
              <Pressable style={styles.continueCard} onPress={() => openBook(first)}>
                <Cover book={first} size={{ width: 86, height: 124 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: IllumeTheme.accent, fontWeight: '800' }}>Continue</Text>
                  <Text style={styles.bookTitle} numberOfLines={2}>
                    {first.title}
                  </Text>
                  <Text style={styles.sub}>{first.author || first.fileName}</Text>
                </View>
                <Text style={{ fontSize: 20 }}>↗</Text>
              </Pressable>
            )}

            <Text style={styles.section}>Recent</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20, paddingHorizontal: 20 }}>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                {books.slice(0, 8).map((b) => (
                  <Pressable key={b.id} onPress={() => openBook(b)} style={{ width: 118 }}>
                    <Cover book={b} size={{ width: 118, height: 170 }} />
                    <Text style={styles.bookTitle} numberOfLines={2}>
                      {b.title}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            <View style={{ marginTop: 18, gap: 12 }}>
              {books.map((b) => (
                <Pressable key={b.id} style={styles.row} onPress={() => openBook(b)}>
                  <Cover book={b} size={{ width: 58, height: 82 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bookTitle} numberOfLines={2}>
                      {b.title}
                    </Text>
                    <Text style={styles.badge}>{(b.documentType ?? 'epub').toUpperCase()}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <Modal visible={profileOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setProfileOpen(false)}>
        <ProfileSheet onClose={() => setProfileOpen(false)} />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IllumeTheme.paper },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  appTitle: { fontSize: 38, fontWeight: '900', color: IllumeTheme.ink },
  sub: { color: '#666', marginTop: 2 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.8)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  iconTxt: { fontSize: 18, fontWeight: '800' },
  continueCard: { flexDirection: 'row', gap: 16, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.6)', borderRadius: 26, padding: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.05)', marginBottom: 20 },
  bookTitle: { fontWeight: '800', color: IllumeTheme.ink, marginTop: 6 },
  section: { fontSize: 22, fontWeight: '900', marginBottom: 10 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: radius.md, padding: 10 },
  badge: { fontSize: 11, fontWeight: '900', color: '#666', marginTop: 4 },
  emptyTitle: { fontSize: 32, fontWeight: '900', marginTop: 12 },
  pill: { borderRadius: radius.pill, height: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
