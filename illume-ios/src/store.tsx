// Port of AppModel.swift (IllumeAppModel) to a React context.
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Speech from 'expo-speech';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { AUTH_CALLBACK, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config';
import * as Backend from './supabase';
import { buildGoogleAuthorizeUrl, parseOAuthCallbackParams } from './oauth';
import { loadSession, saveSession, deleteSession } from './session';
import { parseEpub, parseFileNameType, pdfBookFromPages } from './documents';
import { documentPath, hasProAccess, imageLimit, imageUsageCount, libraryByRecentActivity } from './lib';
import { loadProducts, purchasePro as iapPurchase, restorePro as iapRestore } from './billing';
import type {
  AuthSession,
  BillingProfile,
  BookRow,
  ReaderBook,
  ReaderImageFunctionResponse,
  ReaderParagraph,
  ReaderSettings,
  ReaderImageUsage,
  AuthUser,
} from './types';
import { defaultReaderSettings } from './types';

interface Store {
  session: AuthSession | null;
  books: BookRow[];
  activeBookRow: BookRow | null;
  activeBook: ReaderBook | null;
  billingProfile: BillingProfile | null;
  readerImageUsage: ReaderImageUsage | null;
  isLoading: boolean;
  isImporting: boolean;
  authMode: 'signIn' | 'signUp';
  notice: string;
  readerSettings: ReaderSettings;
  readerImageResponse: ReaderImageFunctionResponse | null;
  products: { id: string; title: string }[];
  isPro: boolean;
  storageUsed: number;
  imageUsageCount: number;
  imageLimit: number;
  setAuthMode: (m: 'signIn' | 'signUp') => void;
  setReaderSettings: (s: ReaderSettings) => void;
  clearReaderImage: () => void;
  bootstrap: () => Promise<void>;
  authenticate: (email: string, password: string) => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
  importPickedDocument: () => Promise<void>;
  openBook: (row: BookRow) => Promise<void>;
  closeReader: () => void;
  saveProgress: (index: number, page: number) => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
  generateImage: (p: ReaderParagraph) => Promise<void>;
  purchasePro: () => Promise<void>;
  restorePro: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

function randomNonce(length = 32): string {
  const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._';
  let out = '';
  while (out.length < length) {
    const i = Math.floor(Math.random() * charset.length);
    out += charset[i];
  }
  return out;
}

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [books, setBooks] = useState<BookRow[]>([]);
  const [activeBookRow, setActiveBookRow] = useState<BookRow | null>(null);
  const [activeBook, setActiveBook] = useState<ReaderBook | null>(null);
  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
  const [readerImageUsage, setReaderImageUsage] = useState<ReaderImageUsage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [authMode, setAuthMode] = useState<'signIn' | 'signUp'>('signIn');
  const [notice, setNotice] = useState('');
  const [readerSettings, setReaderSettings] = useState<ReaderSettings>(defaultReaderSettings);
  const [readerImageResponse, setReaderImageResponse] = useState<ReaderImageFunctionResponse | null>(null);
  const [products, setProducts] = useState<{ id: string; title: string }[]>([]);
  const progressTimer = useRef<any>(null);
  const speakingRef = useRef(false);

  const isPro = hasProAccess(billingProfile);
  const storageUsed = books.reduce((n, b) => n + b.fileSize, 0);
  const usageCount = imageUsageCount(readerImageUsage, 0, isPro);
  const limit = imageLimit(isPro);

  const applySession = useCallback(async (next: AuthSession) => {
    setSession(next);
    await saveSession(next);
  }, []);

  const runBusy = useCallback(async (fn: () => Promise<void>) => {
    setIsLoading(true);
    setNotice('');
    try {
      await fn();
    } catch (e: any) {
      setNotice(e?.message ?? String(e));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const reload = useCallback(async () => {
    const s = await loadSession();
    const token = s?.accessToken;
    if (!token) return;
    setSession(s);
    await runBusy(async () => {
      const [library, profile, usage] = await Promise.all([
        Backend.loadLibrary(token),
        Backend.loadBillingProfile(token),
        Backend.loadReaderImageUsage(token),
      ]);
      setBooks(library);
      setBillingProfile(profile);
      setReaderImageUsage(usage);
    });
  }, [runBusy]);

  const bootstrap = useCallback(async () => {
    const s = await loadSession();
    if (s?.refreshToken) {
      try {
        const refreshed = await Backend.refreshSession(s.refreshToken);
        await applySession(refreshed);
      } catch {
        await deleteSession();
        setSession(null);
      }
    } else if (s) {
      setSession(s);
    }
    await reload();
    try {
      setProducts(await loadProducts());
    } catch {}
  }, [applySession, reload]);

  const authenticate = useCallback(
    async (email: string, password: string) => {
      await runBusy(async () => {
        const next = authMode === 'signIn' ? await Backend.signIn(email, password) : await Backend.signUp(email, password);
        await applySession(next);
        const [library, profile, usage] = await Promise.all([
          Backend.loadLibrary(next.accessToken),
          Backend.loadBillingProfile(next.accessToken),
          Backend.loadReaderImageUsage(next.accessToken),
        ]);
        setBooks(library);
        setBillingProfile(profile);
        setReaderImageUsage(usage);
      });
    },
    [authMode, applySession, runBusy]
  );

  const signInWithApple = useCallback(async () => {
    await runBusy(async () => {
      const nonce = randomNonce();
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!cred.identityToken) throw new Error('Apple sign in was cancelled.');
      const next = await Backend.exchangeIdToken('apple', cred.identityToken, nonce);
      await applySession(next);
      await reload();
    });
  }, [applySession, reload, runBusy]);

  const signInWithGoogle = useCallback(async () => {
    await runBusy(async () => {
      const authorizeUrl = buildGoogleAuthorizeUrl();
      const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, AUTH_CALLBACK);
      if (result.type !== 'success' || !result.url) throw new Error('Google sign in was cancelled.');
      const url = result.url;
      const params = parseOAuthCallbackParams(url);
      if (params.error_description || params.error) throw new Error(params.error_description ?? params.error);
      const accessToken = params.access_token;
      if (!accessToken) throw new Error('Google sign in did not return an access token.');
      const user: AuthUser = await Backend.loadUser(accessToken);
      const next: AuthSession = {
        accessToken,
        refreshToken: params.refresh_token ?? null,
        expiresIn: params.expires_in ? Number(params.expires_in) : null,
        tokenType: params.token_type ?? null,
        user,
      };
      await applySession(next);
      await reload();
    });
  }, [applySession, reload, runBusy]);

  const signOut = useCallback(async () => {
    try {
      Speech.stop();
    } catch {}
    speakingRef.current = false;
    await deleteSession();
    setSession(null);
    setBooks([]);
    setActiveBook(null);
    setActiveBookRow(null);
    setBillingProfile(null);
    setReaderImageUsage(null);
  }, []);

  const importPickedDocument = useCallback(async () => {
    const s = session;
    if (!s) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: ['application/epub+zip', 'application/pdf'], copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    const fileName = asset.name ?? 'book.epub';
    const type = parseFileNameType(fileName);
    setIsImporting(true);
    setNotice('');
    try {
      const file = new File(asset.uri);
      const bytes = await file.bytes();
      const data = new Uint8Array(bytes.buffer as ArrayBuffer);
      if (storageUsed + data.length > Backend.STORAGE_QUOTA_BYTES) {
        throw new Error('This upload would exceed your library storage limit.');
      }
      const { randomUUID } = await import('expo-crypto');
      const bookId = randomUUID();
      // Local parse for EPUB now; PDFs are processed server-side (queuePdfProcessing).
      let title = fileName;
      let author = '';
      let coverUrl: string | null = null;
      let paragraphCount = 0;
      let chapterCount = 1;
      let pageCount: number | null = null;
      let localBook: ReaderBook | null = null;
      if (type === 'epub') {
        const { parseEpub } = await import('./documents');
        const parsed = await parseEpub(data, fileName);
        localBook = parsed.book;
        title = parsed.book.title;
        author = parsed.book.author;
        coverUrl = parsed.coverDataUrl ?? null;
        paragraphCount = parsed.book.paragraphs.length;
        chapterCount = parsed.book.chapters.length;
      }
      const storagePath = documentPath(s.user.id, bookId, fileName, type);
      const mimeType = type === 'pdf' ? 'application/pdf' : 'application/epub+zip';
      await Backend.uploadDocument(data, storagePath, mimeType, s.accessToken);
      try {
        const inserted = await Backend.insertBook(
          {
            id: bookId,
            userId: s.user.id,
            title,
            author,
            coverUrl,
            documentType: type,
            storagePath,
            fileName,
            fileSize: data.length,
            mimeType,
            pageCount,
            paragraphCount,
            chapterCount,
            pdfPageMetrics: [],
            pdfToc: [],
            processingStatus: type === 'pdf' ? 'queued' : 'ready',
            processingError: null,
            currentIndex: 0,
            currentPage: 1,
            lastOpenedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          s.accessToken
        );
        setBooks((prev) => libraryByRecentActivity([inserted, ...prev]));
        setActiveBookRow(inserted);
        if (localBook) setActiveBook(localBook);
        if (type === 'pdf') {
          await Backend.queuePdfProcessing(inserted.id, s.accessToken).catch(() => {});
        }
      } catch (e) {
        await Backend.deleteBook(bookId, s.accessToken).catch(() => {});
        throw e;
      }
    } catch (e: any) {
      setNotice(e?.message ?? String(e));
    } finally {
      setIsImporting(false);
    }
  }, [session, storageUsed]);

  const openBook = useCallback(
    async (row: BookRow) => {
      const s = session;
      if (!s) return;
      await runBusy(async () => {
        const data = await Backend.downloadDocument(row.storagePath, s.accessToken);
        let book: ReaderBook;
        if (row.documentType === 'pdf') {
          const pages = await Backend.loadBookPages(row.id, s.accessToken).catch(() => []);
          if (pages.length > 0) {
            book = pdfBookFromPages({
              title: row.title,
              author: row.author,
              fileName: row.fileName,
              pageCount: row.pageCount ?? pages.length,
              toc: row.pdfToc,
              pages,
            });
          } else {
            const { parseEpub } = await import('./documents');
            // PDFs without server pages fall back to empty reader shell.
            book = { title: row.title, author: row.author, fileName: row.fileName, format: 'pdf', pageCount: row.pageCount ?? null, chapterPageNumbers: [], chapterPageOffsets: [], paragraphs: [], chapters: [row.title] };
            void parseEpub;
            void data;
          }
        } else {
          const { parseEpub } = await import('./documents');
          book = (await parseEpub(data, row.fileName)).book;
        }
        setActiveBookRow(row);
        setActiveBook(book);
        await Backend.saveProgress(row.id, row.currentIndex, row.currentPage ?? 1, s.accessToken).catch(() => {});
      });
    },
    [session, runBusy]
  );

  const closeReader = useCallback(() => {
    try {
      Speech.stop();
    } catch {}
    speakingRef.current = false;
    setActiveBook(null);
    setActiveBookRow(null);
    setReaderImageResponse(null);
  }, []);

  const saveProgress = useCallback(
    (index: number, page: number) => {
      const row = activeBookRow;
      const token = session?.accessToken;
      if (!row || !token) return;
      if (progressTimer.current) clearTimeout(progressTimer.current);
      progressTimer.current = setTimeout(() => {
        Backend.saveProgress(row.id, index, page, token).catch(() => {});
      }, 450);
    },
    [activeBookRow, session]
  );

  const speak = useCallback(
    (text: string) => {
      if (speakingRef.current) {
        try {
          Speech.stop();
        } catch {}
        speakingRef.current = false;
        return;
      }
      speakingRef.current = true;
      Speech.speak(text, { language: 'en-GB', rate: readerSettings.narrationRate, onDone: () => { speakingRef.current = false; }, onStopped: () => { speakingRef.current = false; } });
    },
    [readerSettings.narrationRate]
  );

  const stopSpeaking = useCallback(() => {
    try {
      Speech.stop();
    } catch {}
    speakingRef.current = false;
  }, []);

  const generateImage = useCallback(
    async (p: ReaderParagraph) => {
      const row = activeBookRow;
      const token = session?.accessToken;
      if (!row || !token) return;
      const words = p.text.split(' ');
      const endWord = Math.max(1, Math.min(words.length, 130));
      await runBusy(async () => {
        const res = await Backend.invokeReaderImage(
          { bookId: row.id, startWord: 1, endWord, text: words.slice(0, endWord).join(' '), style: readerSettings.imageStyle },
          token
        );
        setReaderImageResponse(res);
        await reload();
      });
    },
    [activeBookRow, session, readerSettings.imageStyle, reload, runBusy]
  );

  const purchasePro = useCallback(async () => {
    const token = session?.accessToken;
    if (!token) return;
    await runBusy(async () => {
      await iapPurchase(token);
      await reload();
    });
  }, [session, reload, runBusy]);

  const restorePro = useCallback(async () => {
    const token = session?.accessToken;
    if (!token) return;
    await runBusy(async () => {
      await iapRestore(token);
      await reload();
    });
  }, [session, reload, runBusy]);

  const value = useMemo<Store>(
    () => ({
      session,
      books,
      activeBookRow,
      activeBook,
      billingProfile,
      readerImageUsage,
      isLoading,
      isImporting,
      authMode,
      notice,
      readerSettings,
      readerImageResponse,
      products,
      isPro,
      storageUsed,
      imageUsageCount: usageCount,
      imageLimit: limit,
      setAuthMode,
      setReaderSettings,
      clearReaderImage: () => setReaderImageResponse(null),
      bootstrap,
      authenticate,
      signInWithApple,
      signInWithGoogle,
      signOut,
      reload,
      importPickedDocument,
      openBook,
      closeReader,
      saveProgress,
      speak,
      stopSpeaking,
      generateImage,
      purchasePro,
      restorePro,
    }),
    [
      session,
      books,
      activeBookRow,
      activeBook,
      billingProfile,
      readerImageUsage,
      isLoading,
      isImporting,
      authMode,
      notice,
      readerSettings,
      readerImageResponse,
      products,
      isPro,
      storageUsed,
      usageCount,
      limit,
      bootstrap,
      authenticate,
      signInWithApple,
      signInWithGoogle,
      signOut,
      reload,
      importPickedDocument,
      openBook,
      closeReader,
      saveProgress,
      speak,
      stopSpeaking,
      generateImage,
      purchasePro,
      restorePro,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}
