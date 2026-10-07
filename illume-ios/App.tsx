import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Modal, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StoreProvider, useStore } from './src/store';
import { AuthScreen } from './src/screens/AuthScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { ClassicsScreen } from './src/screens/ClassicsScreen';
import { ReaderScreen } from './src/screens/ReaderScreen';
import { IllumeTheme } from './src/theme';

function Root() {
  const { session, bootstrap, isLoading, isImporting, activeBook, notice } = useStore();
  const [tab, setTab] = useState<'library' | 'classics'>('library');

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      {session ? (
        <>
          <View style={{ flex: 1 }}>
            {tab === 'library' ? <LibraryScreen /> : <ClassicsScreen />}
          </View>
          <View style={styles.tabBar}>
            <Pressable style={[styles.tab, tab === 'library' && styles.tabActive]} onPress={() => setTab('library')}>
              <Text style={[styles.tabText, tab === 'library' && styles.tabTextActive]}>📚 Library</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'classics' && styles.tabActive]} onPress={() => setTab('classics')}>
              <Text style={[styles.tabText, tab === 'classics' && styles.tabTextActive]}>🏛️ Classics</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <AuthScreen />
      )}
      <Modal visible={!!activeBook} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
        <ReaderScreen />
      </Modal>
      {(isLoading || isImporting) && (
        <View style={styles.veilWrap}>
          <View style={styles.veil}>
            <ActivityIndicator size="large" />
            <Text style={styles.veilText}>{isImporting ? 'Importing' : 'Syncing'}</Text>
          </View>
        </View>
      )}
      {!!notice && !isLoading && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <Root />
      </StoreProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IllumeTheme.paper },
  veilWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  veil: { padding: 22, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', gap: 12 },
  veilText: { fontWeight: '800' },
  notice: { position: 'absolute', left: 16, right: 16, bottom: 100, backgroundColor: '#1c1c1e', borderRadius: 14, padding: 12 },
  noticeText: { color: '#fff' },
  tabBar: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 6 },
  tab: { flex: 1, borderRadius: 999, height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.06)' },
  tabActive: { backgroundColor: IllumeTheme.ink },
  tabText: { fontWeight: '800', fontSize: 15, color: '#555' },
  tabTextActive: { color: '#fff' },
});
