import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { useStore } from '../store';
import { IllumeTheme } from '../theme';
import { STORAGE_QUOTA_BYTES } from '../supabase';

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: '#666' }}>
          {Math.round(value)} / {Math.round(max)}
        </Text>
      </View>
      <View style={{ height: 10, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.08)' }}>
        <View style={{ height: 10, borderRadius: 6, backgroundColor: IllumeTheme.accent, width: `${ratio * 100}%` }} />
      </View>
    </View>
  );
}

export function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { isPro, session, storageUsed, imageUsageCount, imageLimit, purchasePro, restorePro, signOut } = useStore();
  const [updateMsg, setUpdateMsg] = useState('');

  async function checkForUpdates() {
    setUpdateMsg('Checking…');
    try {
      if (__DEV__) {
        setUpdateMsg('Updates are checked in release builds, not dev.');
        return;
      }
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setUpdateMsg('Up to date.');
        return;
      }
      setUpdateMsg('Downloading…');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e: any) {
      setUpdateMsg(e?.message ?? 'Update check failed.');
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{isPro ? 'Illume Pro' : 'Free plan'}</Text>
      <Text style={{ color: '#666' }}>{session?.user.email ?? 'Signed in'}</Text>
      <View style={{ gap: 16, marginVertical: 24 }}>
        <Meter label="Storage" value={storageUsed} max={STORAGE_QUOTA_BYTES} />
        <Meter label="Reader images" value={imageUsageCount} max={imageLimit} />
      </View>
      {isPro ? (
        <Pressable style={[styles.pill, { backgroundColor: IllumeTheme.accent }]} onPress={() => restorePro()}>
          <Text style={styles.pillText}>Restore purchases</Text>
        </Pressable>
      ) : (
        <Pressable style={[styles.pill, { backgroundColor: IllumeTheme.ink }]} onPress={() => purchasePro()}>
          <Text style={styles.pillText}>Go Pro</Text>
        </Pressable>
      )}
      <Pressable style={[styles.pill, { backgroundColor: IllumeTheme.coral, marginTop: 12 }]} onPress={() => { signOut(); onClose(); }}>
        <Text style={styles.pillText}>Sign out</Text>
      </Pressable>
      <Pressable style={{ marginTop: 16 }} onPress={checkForUpdates}>
        <Text style={{ textAlign: 'center', fontWeight: '700' }}>Check for updates</Text>
      </Pressable>
      {!!updateMsg && <Text style={{ textAlign: 'center', color: '#666', marginTop: 8 }}>{updateMsg}</Text>}
      <Pressable style={{ marginTop: 16 }} onPress={onClose}>
        <Text style={{ textAlign: 'center', fontWeight: '700' }}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: IllumeTheme.paper, padding: 24, paddingTop: 32 },
  title: { fontSize: 32, fontWeight: '900' },
  pill: { borderRadius: 999, height: 52, alignItems: 'center', justifyContent: 'center' },
  pillText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
