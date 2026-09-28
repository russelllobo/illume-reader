import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useStore } from '../store';
import { IllumeTheme, radius, spacing } from '../theme';

export function AuthScreen() {
  const { authenticate, signInWithApple, signInWithGoogle, authMode, setAuthMode, notice, isLoading } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const valid = email.length > 0 && password.length >= 6;

  return (
    <View style={styles.root}>
      <View style={styles.hero}>
        <Text style={styles.title}>Illume</Text>
        <Text style={styles.subtitle}>Your books, synced and quietly alive.</Text>
      </View>

      <View style={styles.fields}>
        <TextInput
          style={styles.field}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput style={styles.field} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      </View>

      <View style={styles.actions}>
        <Pressable
          style={[styles.pill, { backgroundColor: IllumeTheme.ink, opacity: valid ? 1 : 0.5 }]}
          disabled={!valid || isLoading}
          onPress={() => authenticate(email.trim(), password)}
        >
          <Text style={styles.pillText}>{authMode === 'signIn' ? 'Sign in' : 'Create account'}</Text>
        </Pressable>

        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={999}
          style={{ width: '100%', height: 52 }}
          onPress={() => signInWithApple()}
        />

        <Pressable style={[styles.pill, { backgroundColor: IllumeTheme.coral }]} onPress={() => signInWithGoogle()}>
          <Text style={styles.pillText}>Continue with Google</Text>
        </Pressable>

        <Pressable onPress={() => setAuthMode(authMode === 'signIn' ? 'signUp' : 'signIn')}>
          <Text style={styles.switcher}>{authMode === 'signIn' ? 'New here? Create an account' : 'Already have an account? Sign in'}</Text>
        </Pressable>
      </View>

      {!!notice && <Text style={styles.notice}>{notice}</Text>}
      {isLoading && <ActivityIndicator style={{ marginTop: 12 }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: spacing.lg, paddingTop: 64, backgroundColor: IllumeTheme.paper },
  hero: { marginBottom: 28 },
  title: { fontSize: 56, fontWeight: '900', color: IllumeTheme.ink },
  subtitle: { fontSize: 18, color: '#666', marginTop: 8 },
  fields: { gap: 14, marginBottom: 12 },
  field: { backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: radius.md, paddingHorizontal: 16, height: 54, fontSize: 16, borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)' },
  actions: { gap: 12, marginTop: 12 },
  pill: { borderRadius: radius.pill, height: 52, alignItems: 'center', justifyContent: 'center' },
  pillText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  switcher: { textAlign: 'center', fontWeight: '700', color: IllumeTheme.ink, marginTop: 4 },
  notice: { color: IllumeTheme.coral, marginTop: 12 },
});
