import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Image, ActivityIndicator } from 'react-native';
import { useStore } from '../store';
import { CLASSICS } from '../classics';
import { IllumeTheme, radius } from '../theme';

export function ClassicsScreen() {
  const { books, openBook, importClassicBook, importingClassicId } = useStore();

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 32 }}>
        <Text style={styles.appTitle}>Classics</Text>
        <Text style={styles.sub}>Free public-domain editions from Standard Ebooks.</Text>
        <View style={{ marginTop: 16, gap: 12 }}>
          {CLASSICS.map((classic) => {
            const match = books.find((b) => b.title.toLowerCase().trim() === classic.title.toLowerCase().trim());
            const busy = importingClassicId === classic.id;
            return (
              <View key={classic.id} style={styles.row}>
                <Image source={{ uri: classic.coverUrl }} style={{ width: 58, height: 82, borderRadius: 10 }} resizeMode="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.bookTitle} numberOfLines={2}>
                    {classic.title}
                  </Text>
                  <Text style={styles.sub}>{classic.author}</Text>
                  <Text style={styles.summary} numberOfLines={2}>
                    {classic.summary}
                  </Text>
                </View>
                <Pressable
                  disabled={busy || importingClassicId !== null}
                  style={[styles.pill, (busy || importingClassicId !== null) && styles.pillDisabled]}
                  onPress={() => {
                    if (match) void openBook(match);
                    else void importClassicBook(classic);
                  }}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.pillText}>{match ? 'Open' : 'Add'}</Text>
                  )}
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IllumeTheme.paper },
  appTitle: { fontSize: 38, fontWeight: '900', color: IllumeTheme.ink },
  sub: { color: '#666', marginTop: 2 },
  summary: { color: '#888', fontSize: 12, marginTop: 4 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.5)', borderRadius: radius.md, padding: 10 },
  bookTitle: { fontWeight: '800', color: IllumeTheme.ink, marginTop: 2 },
  pill: { backgroundColor: IllumeTheme.ink, borderRadius: 999, minWidth: 72, height: 40, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  pillDisabled: { opacity: 0.45 },
  pillText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
