import type { Session, User } from "@supabase/supabase-js";
import {
  BookOpen,
  ChevronLeft,
  Chrome,
  CreditCard,
  Crown,
  Loader2,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Trash2,
  Upload
} from "lucide-react";
import { ChangeEvent, FormEvent, KeyboardEvent, PointerEvent, useEffect, useRef, useState } from "react";
import { parseEpub, ReaderBook, ReaderParagraph } from "./epub";
import { supabase } from "./supabase";

type PlaybackState = "idle" | "playing" | "paused";
type SpeechHighlight = {
  end: number;
  paragraphId: string;
  start: number;
};
type WordRange = {
  end: number;
  start: number;
};
type BookRow = {
  author: string;
  chapter_count: number;
  created_at: string;
  current_index: number;
  file_name: string;
  file_size: number;
  id: string;
  last_opened_at: string | null;
  mime_type: string;
  paragraph_count: number;
  storage_path: string;
  title: string;
  updated_at: string;
  user_id: string;
};
type BillingProfile = {
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  plan: "free" | "pro";
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  user_id: string;
};

const EPUB_BUCKET = "epubs";
const USER_STORAGE_QUOTA_BYTES = Number(
  import.meta.env.VITE_USER_STORAGE_QUOTA_BYTES ?? 104_857_600
);

const wordRangeFromBoundary = (text: string, charIndex: number, charLength = 0) => {
  if (!Number.isFinite(charIndex) || charIndex < 0 || charIndex >= text.length) return null;

  let start = charIndex;
  while (start < text.length && /\s/.test(text[start])) start += 1;
  while (start > 0 && /\S/.test(text[start - 1])) start -= 1;

  let end = charLength > 0 ? start + charLength : start;
  while (end < text.length && /\S/.test(text[end])) end += 1;

  if (end <= start) return null;
  return { start, end: Math.min(end, text.length) };
};

const wordRangesFromText = (text: string): WordRange[] =>
  Array.from(text.matchAll(/\S+/g)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
};

const safeFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "book.epub";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [catalogBooks, setCatalogBooks] = useState<BookRow[]>([]);
  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
  const [activeBookId, setActiveBookId] = useState("");
  const [view, setView] = useState<"catalog" | "reader">("catalog");
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [speechHighlight, setSpeechHighlight] = useState<SpeechHighlight | null>(null);
  const parsedBooks = useRef(new Map<string, ReaderBook>());
  const readingSurfaceRef = useRef<HTMLElement | null>(null);
  const paragraphRefs = useRef(new Map<string, HTMLElement>());
  const chapterRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingScrollIndex = useRef<number | null>(null);
  const speechFallbackRef = useRef<number | null>(null);
  const lastSpeechBoundaryAt = useRef(0);
  const progressSaveTimer = useRef<number | null>(null);

  const user = session?.user ?? null;
  const current = book?.paragraphs[currentIndex];
  const progress = book ? ((currentIndex + 1) / book.paragraphs.length) * 100 : 0;
  const storageUsed = catalogBooks.reduce((total, item) => total + item.file_size, 0);
  const isPro = billingProfile?.plan === "pro";

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setCatalogBooks([]);
      setBillingProfile(null);
      setBook(null);
      setView("catalog");
      setActiveBookId("");
      return;
    }

    void loadLibrary(user);
    void loadBillingProfile(user);
  }, [user?.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success") {
      setNotice("Thanks. Your Pro subscription is being confirmed.");
      window.history.replaceState({}, "", window.location.pathname);
    }

    if (checkout === "canceled") {
      setNotice("Checkout was canceled.");
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => stopAudio, []);

  useEffect(() => {
    if (playback !== "playing" || !current) return;

    stopAudio();
    speakBrowser(current);
  }, [currentIndex]);

  useEffect(() => {
    const chapterButton = chapterRefs.current.get(current?.chapterIndex ?? -1);
    chapterButton?.scrollIntoView({ block: "nearest" });
  }, [current?.chapterIndex]);

  useEffect(() => {
    const targetIndex = pendingScrollIndex.current;
    if (targetIndex === null || !book) return;

    pendingScrollIndex.current = null;
    const target = book.paragraphs[targetIndex];
    const node = target ? paragraphRefs.current.get(target.id) : null;
    node?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [book?.paragraphs, currentIndex]);

  useEffect(() => {
    if (!activeBookId || !book || view !== "reader") return;
    if (progressSaveTimer.current !== null) window.clearTimeout(progressSaveTimer.current);

    progressSaveTimer.current = window.setTimeout(() => {
      void supabase
        .from("books")
        .update({ current_index: currentIndex, last_opened_at: new Date().toISOString() })
        .eq("id", activeBookId);
    }, 600);

    return () => {
      if (progressSaveTimer.current !== null) window.clearTimeout(progressSaveTimer.current);
    };
  }, [activeBookId, book, currentIndex, view]);

  const loadLibrary = async (_user: User) => {
    setBusy(true);
    setNotice("");

    const { data, error } = await supabase
      .from("books")
      .select("*")
      .order("last_opened_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) {
      setNotice(error.message);
    } else {
      setCatalogBooks((data ?? []) as BookRow[]);
    }

    setBusy(false);
  };

  const loadBillingProfile = async (_user: User) => {
    const { data, error } = await supabase
      .from("billing_profiles")
      .select("*")
      .maybeSingle();

    if (!error) setBillingProfile(data as BillingProfile | null);
  };

  const clearSpeechFallback = () => {
    if (speechFallbackRef.current !== null) {
      window.clearInterval(speechFallbackRef.current);
      speechFallbackRef.current = null;
    }
  };

  const stopAudio = () => {
    window.speechSynthesis.cancel();
    clearSpeechFallback();
    setSpeechHighlight(null);
  };

  const advance = () => {
    if (!book) return;
    const target = Math.min(currentIndex + 1, book.paragraphs.length - 1);
    pendingScrollIndex.current = target;
    setCurrentIndex(target);
  };

  const speakBrowser = (paragraph: ReaderParagraph) => {
    window.speechSynthesis.cancel();
    clearSpeechFallback();
    lastSpeechBoundaryAt.current = 0;
    const wordRanges = wordRangesFromText(paragraph.text);
    let fallbackIndex = 0;

    if (wordRanges[0]) {
      setSpeechHighlight({ paragraphId: paragraph.id, ...wordRanges[0] });
    } else {
      setSpeechHighlight({ paragraphId: paragraph.id, start: 0, end: 0 });
    }

    const utterance = new SpeechSynthesisUtterance(paragraph.text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.onboundary = (event) => {
      const boundary = event as SpeechSynthesisEvent & { charLength?: number };
      const range = wordRangeFromBoundary(
        paragraph.text,
        boundary.charIndex,
        typeof boundary.charLength === "number" ? boundary.charLength : 0
      );

      if (range) {
        lastSpeechBoundaryAt.current = Date.now();
        const matchingIndex = wordRanges.findIndex((word) => word.end > range.start);
        if (matchingIndex >= 0) fallbackIndex = matchingIndex + 1;
        setSpeechHighlight({ paragraphId: paragraph.id, ...range });
      }
    };
    speechFallbackRef.current = window.setInterval(() => {
      if (window.speechSynthesis.paused) return;
      if (Date.now() - lastSpeechBoundaryAt.current < 450) return;

      const range = wordRanges[fallbackIndex];
      if (!range) {
        clearSpeechFallback();
        return;
      }

      setSpeechHighlight({ paragraphId: paragraph.id, ...range });
      fallbackIndex += 1;
    }, 290);
    utterance.onend = () => {
      clearSpeechFallback();
      setSpeechHighlight(null);
      if (book && currentIndex < book.paragraphs.length - 1) {
        advance();
      } else {
        setPlayback("idle");
      }
    };
    utterance.onerror = () => {
      clearSpeechFallback();
      setSpeechHighlight(null);
      setNotice("Browser speech could not play this paragraph.");
      setPlayback("idle");
    };
    window.speechSynthesis.speak(utterance);
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");

    const credentials = { email, password };
    const { error } =
      authMode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp(credentials);

    if (error) {
      setNotice(error.message);
    } else if (authMode === "sign-up") {
      setNotice("Account created. Check your email if confirmation is enabled.");
    }

    setBusy(false);
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setNotice("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin
      }
    });

    if (error) {
      setNotice(error.message);
      setBusy(false);
    }
  };

  const signOut = async () => {
    stopAudio();
    await supabase.auth.signOut();
  };

  const startCheckout = async () => {
    setBusy(true);
    setNotice("");

    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      method: "POST"
    });

    if (error) {
      setNotice(error.message);
      setBusy(false);
      return;
    }

    if (!data?.url) {
      setNotice("Checkout did not return a Stripe URL.");
      setBusy(false);
      return;
    }

    window.location.assign(data.url);
  };

  const openBillingPortal = async () => {
    setBusy(true);
    setNotice("");

    const { data, error } = await supabase.functions.invoke("create-billing-portal", {
      method: "POST"
    });

    if (error) {
      setNotice(error.message);
      setBusy(false);
      return;
    }

    if (!data?.url) {
      setNotice("Billing portal did not return a Stripe URL.");
      setBusy(false);
      return;
    }

    window.location.assign(data.url);
  };

  const handleCatalogUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    stopAudio();
    setPlayback("idle");
    setNotice("");
    setBusy(true);

    try {
      if (!file.name.toLowerCase().endsWith(".epub")) {
        throw new Error("Please upload an EPUB file.");
      }

      if (storageUsed + file.size > USER_STORAGE_QUOTA_BYTES) {
        throw new Error(`This upload would exceed your ${formatBytes(USER_STORAGE_QUOTA_BYTES)} library limit.`);
      }

      const parsed = await parseEpub(file);
      const id = crypto.randomUUID();
      const storagePath = `${user.id}/${id}/${safeFileName(file.name)}`;

      const upload = await supabase.storage.from(EPUB_BUCKET).upload(storagePath, file, {
        contentType: file.type || "application/epub+zip",
        upsert: false
      });

      if (upload.error) throw upload.error;

      const newBook = {
        id,
        user_id: user.id,
        title: parsed.title,
        author: parsed.author,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || "application/epub+zip",
        paragraph_count: parsed.paragraphs.length,
        chapter_count: parsed.chapters.length,
        current_index: 0,
        last_opened_at: new Date().toISOString()
      };
      const { data, error } = await supabase.from("books").insert(newBook).select("*").single();

      if (error) {
        await supabase.storage.from(EPUB_BUCKET).remove([storagePath]);
        throw error;
      }

      const row = data as BookRow;
      parsedBooks.current.set(row.id, parsed);
      setCatalogBooks((items) => [row, ...items]);
      openParsedBook(row, parsed, 0);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not upload this EPUB.");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const openParsedBook = (row: BookRow, parsed: ReaderBook, targetIndex = row.current_index) => {
    stopAudio();
    setPlayback("idle");
    setNotice("");
    setActiveBookId(row.id);
    setBook(parsed);
    const safeIndex = Math.max(0, Math.min(targetIndex, parsed.paragraphs.length - 1));
    setCurrentIndex(safeIndex);
    pendingScrollIndex.current = safeIndex;
    setView("reader");
  };

  const openBook = async (row: BookRow) => {
    const cached = parsedBooks.current.get(row.id);
    if (cached) {
      openParsedBook(row, cached);
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      const { data, error } = await supabase.storage.from(EPUB_BUCKET).download(row.storage_path);
      if (error) throw error;
      const file = new File([data], row.file_name, { type: row.mime_type || "application/epub+zip" });
      const parsed = await parseEpub(file);
      parsedBooks.current.set(row.id, parsed);
      openParsedBook(row, parsed);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open this book.");
    } finally {
      setBusy(false);
    }
  };

  const deleteBook = async (row: BookRow) => {
    stopAudio();
    setBusy(true);
    setNotice("");

    const { error } = await supabase.from("books").delete().eq("id", row.id);
    if (error) {
      setNotice(error.message);
      setBusy(false);
      return;
    }

    await supabase.storage.from(EPUB_BUCKET).remove([row.storage_path]);
    parsedBooks.current.delete(row.id);
    setCatalogBooks((items) => items.filter((item) => item.id !== row.id));

    if (activeBookId === row.id) {
      setBook(null);
      setActiveBookId("");
      setView("catalog");
    }

    setBusy(false);
  };

  const togglePlayback = () => {
    setNotice("");

    if (playback === "playing") {
      window.speechSynthesis.pause();
      setPlayback("paused");
      return;
    }

    if (playback === "paused") {
      window.speechSynthesis.resume();
      setPlayback("playing");
      return;
    }

    if (!current) return;
    stopAudio();
    setPlayback("playing");
    speakBrowser(current);
  };

  const moveTo = (index: number, options: { scroll?: boolean; stop?: boolean } = {}) => {
    if (!book) return;
    const { scroll = true, stop = true } = options;
    const target = Math.max(0, Math.min(index, book.paragraphs.length - 1));

    if (stop) {
      stopAudio();
      setPlayback("idle");
    }

    if (scroll) pendingScrollIndex.current = target;
    setCurrentIndex(target);
  };

  const moveToChapter = (chapterIndex: number) => {
    if (!book) return;
    const firstParagraph = book.paragraphs.findIndex(
      (paragraph) => paragraph.chapterIndex === chapterIndex
    );
    if (firstParagraph >= 0) moveTo(firstParagraph);
  };

  const openCatalog = () => {
    stopAudio();
    setPlayback("idle");
    setView("catalog");
  };

  const handleReadingScroll = () => {
    if (!book) return;
    const surface = readingSurfaceRef.current;
    if (playback === "playing" || playback === "paused") return;
    if (!surface) return;

    const viewportTop = surface.getBoundingClientRect().top + 72;
    let closestIndex = currentIndex;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const [index, paragraph] of book.paragraphs.entries()) {
      const node = paragraphRefs.current.get(paragraph.id);
      if (!node) continue;

      const distance = Math.abs(node.getBoundingClientRect().top - viewportTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    if (closestIndex !== currentIndex) setCurrentIndex(closestIndex);
  };

  const setParagraphRef = (id: string) => (node: HTMLElement | null) => {
    if (node) {
      paragraphRefs.current.set(id, node);
    } else {
      paragraphRefs.current.delete(id);
    }
  };

  const renderReaderText = (paragraph: ReaderParagraph) => {
    if (speechHighlight?.paragraphId !== paragraph.id || speechHighlight.end <= speechHighlight.start) {
      return paragraph.text;
    }

    return (
      <>
        {paragraph.text.slice(0, speechHighlight.start)}
        <span className="spoken-word">
          {paragraph.text.slice(speechHighlight.start, speechHighlight.end)}
        </span>
        {paragraph.text.slice(speechHighlight.end)}
      </>
    );
  };

  const scrubToPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!book) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    moveTo(Math.round(ratio * (book.paragraphs.length - 1)));
  };

  const handleProgressKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!book) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      moveTo(currentIndex - 1);
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      moveTo(currentIndex + 1);
    }

    if (event.key === "Home") {
      event.preventDefault();
      moveTo(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      moveTo(book.paragraphs.length - 1);
    }
  };

  if (authLoading) {
    return (
      <main className="auth-shell">
        <Loader2 className="spin" size={28} aria-hidden="true" />
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-shell">
        <form className="auth-panel" onSubmit={handleAuth}>
          <BookOpen size={26} aria-hidden="true" />
          <h1>Reader Library</h1>
          <input
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            type="email"
            value={email}
          />
          <input
            autoComplete={authMode === "sign-in" ? "current-password" : "new-password"}
            minLength={6}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            required
            type="password"
            value={password}
          />
          <button className="primary-button" disabled={busy} type="submit">
            {busy ? "Working" : authMode === "sign-in" ? "Sign in" : "Create account"}
          </button>
          <button className="oauth-button" disabled={busy} onClick={() => void signInWithGoogle()} type="button">
            <Chrome size={17} aria-hidden="true" />
            <span>Continue with Google</span>
          </button>
          <button
            className="text-button"
            onClick={() => setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in")}
            type="button"
          >
            {authMode === "sign-in" ? "Create an account" : "Use an existing account"}
          </button>
        </form>
        {notice && <div className="notice">{notice}</div>}
      </main>
    );
  }

  if (view === "catalog") {
    return (
      <main className="app-shell catalog-shell">
        <header className="topbar catalog-topbar">
          <div>
            <div className="top-title">Library</div>
            <div className="storage-meter">
              {formatBytes(storageUsed)} of {formatBytes(USER_STORAGE_QUOTA_BYTES)}
            </div>
          </div>
          <div className="top-actions">
            <label className="catalog-upload" title="Upload EPUB">
              {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              <span>Upload EPUB</span>
              <input disabled={busy} type="file" accept=".epub,application/epub+zip" onChange={handleCatalogUpload} />
            </label>
            <button className="top-icon" onClick={signOut} title="Sign out" type="button">
              <LogOut size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className="catalog-view" aria-label="Book library">
          <div className="catalog-header">
            <h1>Books</h1>
            <div className="billing-strip">
              <div className="billing-plan">
                {isPro ? <Crown size={17} aria-hidden="true" /> : <CreditCard size={17} aria-hidden="true" />}
                <span>{isPro ? "Pro plan" : "Free plan"}</span>
                {billingProfile?.status && <small>{billingProfile.status}</small>}
              </div>
              {billingProfile?.stripe_customer_id ? (
                <button className="secondary-button" disabled={busy} onClick={() => void openBillingPortal()} type="button">
                  Manage billing
                </button>
              ) : (
                <button className="primary-small-button" disabled={busy} onClick={() => void startCheckout()} type="button">
                  Upgrade to Pro
                </button>
              )}
            </div>
          </div>
          <div className="catalog-list">
            {catalogBooks.length ? (
              catalogBooks.map((catalogBook) => (
                <div
                  className={catalogBook.id === activeBookId ? "catalog-book active" : "catalog-book"}
                  key={catalogBook.id}
                >
                  <button
                    className="catalog-book-open"
                    disabled={busy}
                    onClick={() => void openBook(catalogBook)}
                    type="button"
                  >
                    <BookOpen size={18} aria-hidden="true" />
                    <span>
                      <strong>{catalogBook.title}</strong>
                      <small>
                        {catalogBook.author || catalogBook.file_name} · {formatBytes(catalogBook.file_size)}
                      </small>
                    </span>
                  </button>
                  <button
                    className="catalog-delete"
                    disabled={busy}
                    onClick={() => void deleteBook(catalogBook)}
                    title="Delete book"
                    type="button"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              ))
            ) : (
              <div className="empty-library">
                <BookOpen size={22} aria-hidden="true" />
                <span>Your library is empty.</span>
              </div>
            )}
          </div>
        </section>

        {notice && <div className="notice">{notice}</div>}
      </main>
    );
  }

  if (!book) return null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="top-icon" type="button" title="Back to library" onClick={openCatalog}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="top-title">{book.title}</div>
        <button className="top-icon" onClick={signOut} title="Sign out" type="button">
          <LogOut size={17} aria-hidden="true" />
        </button>
      </header>

      <section className="reader-frame">
        <aside className="chapter-sidebar">
          <div className="chapter-heading">Chapters</div>
          <nav className="chapter-list" aria-label="Chapters">
            {book.chapters.map((chapter, index) => (
              <button
                className={index === current?.chapterIndex ? "chapter-item active" : "chapter-item"}
                key={`${chapter}-${index}`}
                ref={(node) => {
                  if (node) {
                    chapterRefs.current.set(index, node);
                  } else {
                    chapterRefs.current.delete(index);
                  }
                }}
                type="button"
                onClick={() => moveToChapter(index)}
                title={chapter}
              >
                {chapter}
              </button>
            ))}
          </nav>
        </aside>

        <div className="main-spread reader-only">
          <section
            className="reading-surface"
            aria-live="polite"
            onScroll={handleReadingScroll}
            ref={readingSurfaceRef}
          >
            <article className="reader-copy">
              {book.paragraphs.map((paragraph, index) => {
                const showChapterHeading =
                  index === 0 ||
                  paragraph.chapterIndex !== book.paragraphs[index - 1]?.chapterIndex;
                const isChapterHeading =
                  showChapterHeading &&
                  paragraph.kind === "heading" &&
                  paragraph.text.trim().toLowerCase() === paragraph.chapterTitle.trim().toLowerCase();
                const isActive = index === currentIndex;
                const isSpeaking = speechHighlight?.paragraphId === paragraph.id;

                return (
                  <div className="reader-block" key={paragraph.id}>
                    {showChapterHeading && !isChapterHeading && (
                      <h2 className="reader-chapter-title">{paragraph.chapterTitle}</h2>
                    )}
                    {isChapterHeading ? (
                      <h2
                        className={[
                          "reader-chapter-title",
                          isActive ? "reader-current-heading" : "",
                          isSpeaking ? "speaking" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        {renderReaderText(paragraph)}
                      </h2>
                    ) : paragraph.kind === "heading" ? (
                      <h3
                        className={[
                          "reader-heading",
                          isActive ? "active" : "",
                          isSpeaking ? "speaking" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        {renderReaderText(paragraph)}
                      </h3>
                    ) : (
                      <p
                        className={[
                          "reader-paragraph",
                          paragraph.kind === "quote" ? "quote" : "",
                          paragraph.kind === "list" ? "list" : "",
                          isActive ? "active" : "",
                          isSpeaking ? "speaking" : ""
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={() => moveTo(index)}
                        ref={setParagraphRef(paragraph.id)}
                      >
                        {renderReaderText(paragraph)}
                      </p>
                    )}
                  </div>
                );
              })}
            </article>
          </section>
        </div>
      </section>

      <div
        className="progress-wrap"
        aria-label="Reading progress"
        aria-valuemax={book.paragraphs.length}
        aria-valuemin={1}
        aria-valuenow={currentIndex + 1}
        onKeyDown={handleProgressKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubToPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) scrubToPointer(event);
        }}
        role="slider"
        tabIndex={0}
        title="Click or drag to jump through the book"
      >
        <span style={{ width: `${progress}%` }} />
      </div>

      <footer className="control-rail">
        <div className="transport">
          <button
            className="rail-icon"
            type="button"
            onClick={() => moveTo(currentIndex - 1)}
            disabled={currentIndex <= 0}
            title="Previous paragraph"
          >
            <RotateCcw size={21} aria-hidden="true" />
          </button>
          <button className="play-button" type="button" onClick={togglePlayback} title="Play or pause">
            {playback === "playing" ? (
              <Pause size={28} aria-hidden="true" />
            ) : (
              <Play size={28} aria-hidden="true" />
            )}
          </button>
          <button
            className="rail-icon"
            type="button"
            onClick={() => moveTo(currentIndex + 1)}
            disabled={currentIndex >= book.paragraphs.length - 1}
            title="Next paragraph"
          >
            <RotateCw size={21} aria-hidden="true" />
          </button>
        </div>
      </footer>

      {notice && <div className="notice">{notice}</div>}
    </main>
  );
}

export default App;
