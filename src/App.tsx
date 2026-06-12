import type { Session, User } from "@supabase/supabase-js";
import {
  AlignJustify,
  BookOpen,
  CaseSensitive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Crown,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  LogOut,
  MessageCircle,
  Moon,
  MoreHorizontal,
  Palette,
  PanelLeft,
  Pencil,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Sun,
  Trash2,
  Upload,
  MoveHorizontal,
  Minus,
  Plus,
  Check,
  Users,
  X,
  Link2,
  ThumbsUp,
  TrendingUp
} from "lucide-react";
import { ChangeEvent, Component, CSSProperties, DragEvent, FormEvent, Fragment, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEpub, ReaderBook, ReaderParagraph } from "./epub";
import { parsePdf, pdfPreviewToBook, pdfjsLib, readPdfPreview, type PdfPreview, type StoredPdfPage } from "./pdf";
import { createEdgeTtsPlayer, DEFAULT_EDGE_TTS_VOICE, EdgeTtsPlayer } from "./edgeTts";
import { supabase } from "./supabase";
import { LandingPage } from "./LandingPage";



type PlaybackState = "idle" | "playing" | "paused";
type ReaderFontMode = "serif" | "sans";
type ReaderThemeMode = "light" | "dark";
type ReaderTheme =
  | "default"
  | "flexoki"
  | "ayu"
  | "catppuccin"
  | "everforest"
  | "gruvbox"
  | "nord"
  | "rose-pine"
  | "solarized";
type ReaderMenuId = "appearance" | "theme";
type ReaderImageStyle = "cartoon" | "cute";
type PdfReaderViewMode = "pdf" | "text" | "split";
type ReaderPreferences = {
  fontMode: ReaderFontMode;
  lineHeight: number;
  lineWidth: number;
  narrationRate: number;
  textScale: number;
  theme: ReaderTheme;
  themeMode: ReaderThemeMode;
};
type PendingDelete = {
  book: ReaderBook | null;
  deadline: number;
  file: File | null;
  index: number;
  row: BookRow;
  timer: number;
  wasActive: boolean;
};
type PendingBookImport = {
  author: string;
  coverUrl: string | null;
  fileName: string;
  id: string;
  progress: number;
  statusText?: string;
  title: string;
};
type PersistedPendingDelete = {
  deadline: number;
  index: number;
  row: BookRow;
};
type SpeechHighlight = {
  end: number;
  paragraphId: string;
  start: number;
};
type ReturnPoint = {
  index: number;
  offsetRatio: number;
  page: number;
};
type AppHistoryState = {
  bookId?: string;
  illumeView: "catalog" | "reader";
};
type WordRange = {
  end: number;
  start: number;
};
type PdfTextLayerWord = {
  charEnd: number;
  charStart: number;
  fontSize: number;
  height: number;
  left: number;
  pageWordIndex: number;
  text: string;
  top: number;
  width: number;
};
type PdfPageMetrics = {
  height: number;
  width: number;
};
type ReaderImageChunk = {
  endWord: number;
  index: number;
  pageNumber?: number;
  startWord: number;
  text: string;
};
type ReaderImageState = {
  error?: string;
  fallbackSrc?: string;
  imageCount?: number;
  imageLimit?: number;
  isFreshGeneration?: boolean;
  limitReached?: boolean;
  plan?: "free" | "pro";
  prompt?: string;
  src?: string;
  status: "checking" | "loading" | "ready" | "error";
  style?: ReaderImageStyle;
};
type ReaderImageGenerationResult = "ready" | "error" | "skipped";
type ReaderImageOpenContext = {
  chunks: ReaderImageChunk[];
  firstChunk: ReaderImageChunk | undefined;
  initialPage: number;
  safeIndex: number;
  start: MeaningfulStart;
  startOffset: number;
};
const readerImageFallbackSrcFromState = (
  images: Record<number, ReaderImageState>,
  chunkIndex: number,
  displayedChunkIndex: number | null
) => {
  if (displayedChunkIndex !== null && displayedChunkIndex !== chunkIndex) {
    const displayedImage = images[displayedChunkIndex];
    if (displayedImage?.status === "ready" && displayedImage.src) return displayedImage.src;
  }

  let nearestSrc = "";
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [imageChunkIndex, image] of Object.entries(images)) {
    const numericIndex = Number(imageChunkIndex);
    if (numericIndex === chunkIndex || image?.status !== "ready" || !image.src) continue;

    const distance = Math.abs(numericIndex - chunkIndex);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestSrc = image.src;
    }
  }

  return nearestSrc;
};
type CachedReaderImage = {
  bookId: string;
  createdAt: string;
  endWord: number;
  key: string;
  prompt?: string;
  src: string;
  startWord: number;
  style: ReaderImageStyle;
};

const NARRATION_RATE_MIN = 0.7;
const NARRATION_RATE_MAX = 2;
const NARRATION_RATE_PRESETS = [1, 1.25, 1.5, 2];

const VOICE_OPTIONS = [
  { id: "en-US-AndrewMultilingualNeural", label: "American Man", flag: "🇺🇸" },
  { id: "en-US-AvaMultilingualNeural", label: "American Woman", flag: "🇺🇸" },
  { id: "en-GB-RyanNeural", label: "British Man", flag: "🇬🇧" },
  { id: "en-GB-SoniaNeural", label: "British Woman", flag: "🇬🇧" }
] as const;
const READER_TEXT_SCALE_MIN = 9 / 16;
const READER_TEXT_SCALE_MAX = 1.5;
const READER_LINE_HEIGHT_MIN = 1.1;
const READER_LINE_HEIGHT_MAX = 2;
const READER_LINE_WIDTH_MIN = 30;
const READER_LINE_WIDTH_MAX = 60;
const CHAPTER_SIDEBAR_DESKTOP_QUERY = "(min-width: 981px)";
const PDF_PAGE_SCALE_MIN = 0.75;
const PDF_PAGE_SCALE_MAX = 1.5;
const READER_THEMES: Array<{ label: string; value: ReaderTheme }> = [
  { value: "default", label: "Default" },
  { value: "flexoki", label: "Flexoki" },
  { value: "ayu", label: "Ayu" },
  { value: "catppuccin", label: "Catppuccin" },
  { value: "everforest", label: "Everforest" },
  { value: "gruvbox", label: "Gruvbox" },
  { value: "nord", label: "Nord" },
  { value: "rose-pine", label: "Rose Pine" },
  { value: "solarized", label: "Solarized" }
];
const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  fontMode: "serif",
  lineHeight: 1.7,
  lineWidth: 42,
  narrationRate: 1,
  textScale: 1.125,
  theme: "default",
  themeMode: "light"
};
const BOOK_READER_PREFERENCES_KEY = "reader-book-preferences-v1";
const PENDING_BOOK_DELETE_KEY = "reader-pending-book-delete-v1";
const DELETE_UNDO_TIMEOUT_MS = 6000;
const TOAST_ANIMATION_MS = 180;
const TOAST_TITLE_WORD_LIMIT = 8;

const clampNarrationRate = (value: number) =>
  Math.min(NARRATION_RATE_MAX, Math.max(NARRATION_RATE_MIN, value));

const clampReaderTextScale = (value: number) =>
  Math.min(READER_TEXT_SCALE_MAX, Math.max(READER_TEXT_SCALE_MIN, value));

const clampReaderLineHeight = (value: number) =>
  Math.min(READER_LINE_HEIGHT_MAX, Math.max(READER_LINE_HEIGHT_MIN, value));

const clampReaderLineWidth = (value: number) =>
  Math.min(READER_LINE_WIDTH_MAX, Math.max(READER_LINE_WIDTH_MIN, value));

const clampPdfPageScale = (value: number) =>
  Math.min(PDF_PAGE_SCALE_MAX, Math.max(PDF_PAGE_SCALE_MIN, value));

const clampUnit = (value: number) =>
  Math.min(1, Math.max(0, value));

const formatNarrationRate = (value: number) =>
  Number.isInteger(value) ? `${value.toFixed(0)}x` : `${value.toFixed(2).replace(/0$/, "")}x`;

const waitForNextPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });

const isEditableKeyboardTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select"));
};

type BookRow = {
  author: string;
  chapter_count: number;
  cover_url: string | null;
  created_at: string;
  current_index: number;
  current_page?: number | null;
  document_type?: "epub" | "pdf";
  file_name: string;
  file_size: number;
  id: string;
  last_opened_at: string | null;
  mime_type: string;
  page_count?: number | null;
  paragraph_count: number;
  pdf_page_metrics?: PdfPreview["pageMetrics"] | null;
  pdf_toc?: Array<{ pageNumber?: number; pageOffsetRatio?: number; title?: string }> | null;
  processed_at?: string | null;
  processing_error?: string | null;
  processing_started_at?: string | null;
  processing_status?: "ready" | "queued" | "processing" | "processed" | "failed";
  storage_path: string;
  title: string;
  updated_at: string;
  user_id: string;
};

const bookActivityTime = (book: BookRow) => {
  const openedAt = book.last_opened_at ? Date.parse(book.last_opened_at) : 0;
  const createdAt = book.created_at ? Date.parse(book.created_at) : 0;
  return Math.max(openedAt, createdAt);
};

const sortBooksByRecentActivity = (books: BookRow[]) =>
  [...books].sort((a, b) => {
    const activityDifference = bookActivityTime(b) - bookActivityTime(a);
    if (activityDifference !== 0) return activityDifference;
    return a.title.localeCompare(b.title);
  });

type MeaningfulStart = {
  index: number;
  offsetRatio: number;
  page: number;
  usedSmartStart: boolean;
};

const START_TITLE_PATTERNS = [
  /\bintroduction\b/i,
  /\bpreface\b/i,
  /\bforeword\b/i,
  /\bprologue\b/i,
  /\bchapter\s*(?:1|one|i)\b/i,
  /^i$/i,
  /^(?:1|one|i)[\s.:;-]+/i
];

const FRONT_MATTER_TITLE_PATTERNS = [
  /\bcover\b/i,
  /\btitle\s+page\b/i,
  /\bcopyright\b/i,
  /\bcontents\b/i,
  /\btable\s+of\s+contents\b/i,
  /\bdedication\b/i,
  /\bepigraph\b/i,
  /\backnowledg/i,
  /\babout\s+the\s+(?:author|book)\b/i,
  /\balso\s+by\b/i
];

const normaliseStartTitle = (title: string) =>
  title.replace(/\s+/g, " ").trim();

const titleMatches = (title: string, patterns: RegExp[]) => {
  const normalised = normaliseStartTitle(title);
  return Boolean(normalised) && patterns.some((pattern) => pattern.test(normalised));
};

const isPreferredStartTitle = (title: string, bookTitle: string) => {
  const normalised = normaliseStartTitle(title);
  if (!normalised) return false;
  if (normaliseStartTitle(bookTitle).toLowerCase() === normalised.toLowerCase()) return false;
  return titleMatches(normalised, START_TITLE_PATTERNS);
};

const isFrontMatterTitle = (title: string, bookTitle: string) => {
  const normalised = normaliseStartTitle(title);
  if (!normalised) return true;
  if (normaliseStartTitle(bookTitle).toLowerCase() === normalised.toLowerCase()) return true;
  return titleMatches(normalised, FRONT_MATTER_TITLE_PATTERNS);
};

const firstParagraphForChapter = (book: ReaderBook, chapterIndex: number) =>
  book.paragraphs.findIndex((paragraph) => paragraph.chapterIndex === chapterIndex);

const resolveMeaningfulStart = (book: ReaderBook, row: BookRow, requestedIndex: number): MeaningfulStart => {
  const savedPage = Math.max(1, row.current_page ?? 1);
  const hasSavedProgress = (row.current_index ?? 0) > 0 || savedPage > 1 || requestedIndex > 0;
  const fallbackIndex = book.paragraphs.length ? Math.max(0, Math.min(requestedIndex, book.paragraphs.length - 1)) : 0;
  const fallbackPage = Math.max(1, Math.min(savedPage, book.pageCount ?? savedPage));

  if (hasSavedProgress) {
    return {
      index: fallbackIndex,
      offsetRatio: 0,
      page: fallbackPage,
      usedSmartStart: false
    };
  }

  const preferredChapterIndex = book.chapters.findIndex((chapter) =>
    isPreferredStartTitle(chapter, book.title)
  );

  if (preferredChapterIndex >= 0) {
    const page = book.chapterPageNumbers?.[preferredChapterIndex] ?? 1;
    const index = firstParagraphForChapter(book, preferredChapterIndex);
    return {
      index: index >= 0 ? index : fallbackIndex,
      offsetRatio: book.chapterPageOffsets?.[preferredChapterIndex] ?? 0,
      page: Math.max(1, Math.min(page, book.pageCount ?? page)),
      usedSmartStart: true
    };
  }

  const preferredHeadingIndex = book.paragraphs.findIndex((paragraph) =>
    paragraph.kind === "heading" && isPreferredStartTitle(paragraph.text, book.title)
  );

  if (preferredHeadingIndex >= 0) {
    const page = book.paragraphs[preferredHeadingIndex]?.pageNumber ?? 1;
    return {
      index: preferredHeadingIndex,
      offsetRatio: 0,
      page: Math.max(1, Math.min(page, book.pageCount ?? page)),
      usedSmartStart: true
    };
  }

  const firstContentChapterIndex = book.chapters.findIndex((chapter) =>
    !isFrontMatterTitle(chapter, book.title)
  );

  if (firstContentChapterIndex >= 0) {
    const page = book.chapterPageNumbers?.[firstContentChapterIndex] ?? 1;
    const index = firstParagraphForChapter(book, firstContentChapterIndex);
    return {
      index: index >= 0 ? index : fallbackIndex,
      offsetRatio: book.chapterPageOffsets?.[firstContentChapterIndex] ?? 0,
      page: Math.max(1, Math.min(page, book.pageCount ?? page)),
      usedSmartStart: true
    };
  }

  const firstContentParagraphIndex = book.paragraphs.findIndex((paragraph) =>
    !isFrontMatterTitle(paragraph.chapterTitle, book.title)
  );

  if (firstContentParagraphIndex >= 0) {
    const page = book.paragraphs[firstContentParagraphIndex]?.pageNumber ?? 1;
    return {
      index: firstContentParagraphIndex,
      offsetRatio: 0,
      page: Math.max(1, Math.min(page, book.pageCount ?? page)),
      usedSmartStart: true
    };
  }

  return {
    index: fallbackIndex,
    offsetRatio: 0,
    page: fallbackPage,
    usedSmartStart: false
  };
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
type ReaderDashboardBook = {
  createdAt: string;
  documentType: "epub" | "pdf" | string;
  fileName: string;
  fileSize: number;
  id: string;
  title: string;
};
type ReaderDashboardImage = {
  bookId: string;
  bookTitle: string;
  createdAt: string;
  endWord: number;
  id: string;
  prompt: string | null;
  signedUrl: string | null;
  startWord: number;
  style: string;
};
type ReaderDashboardJourneyEvent = {
  at: string;
  detail: string;
  label: string;
  type: "sign_up" | "sign_in" | "book_upload" | "image_generated" | string;
};
type ReaderDashboardUser = {
  bookStorageBytes: number;
  books: ReaderDashboardBook[];
  createdAt: string | null;
  email: string;
  id: string;
  imageStorageBytes: number;
  images: ReaderDashboardImage[];
  imagesGenerated: number;
  journey?: ReaderDashboardJourneyEvent[];
  lastSignInAt?: string | null;
  timeline?: ReaderDashboardTimelinePoint[];
};
type ReaderDashboardTimelinePoint = {
  booksBytes: number;
  booksCount: number;
  date: string;
  imagesBytes: number;
  imagesCount: number;
  storageBytes: number;
  usersCount: number;
};
type ReaderDashboardData = {
  generatedAt: string;
  storage: {
    booksBytes: number;
    imagesBytes: number;
    totalBytes: number;
  };
  totals: {
    books: number;
    imagesGenerated: number;
    users: number;
  };
  timeline?: ReaderDashboardTimelinePoint[];
  users: ReaderDashboardUser[];
};

const EPUB_BUCKET = "epubs";
const DOCUMENT_UPLOAD_ACCEPT = ".epub,application/epub+zip,.pdf,application/pdf";
const BOOK_CACHE_NAME = "epub-vision-reader-books-v1";
const READER_IMAGE_DB_NAME = "epub-vision-reader-images";
const READER_IMAGE_STORE_NAME = "images";
const READER_IMAGE_CHUNK_WORDS = 750;
const READER_IMAGE_CHECK_FEEDBACK_MS = 420;
const READER_IMAGE_GENERATION_FEEDBACK_MS = 760;
const READER_IMAGE_SETTLE_DELAY_MS = 900;
const LIBRARY_LOAD_TIMEOUT_MS = 12_000;
const FREE_READER_IMAGE_LIFETIME_LIMIT = 25;
const PRO_READER_IMAGE_MONTHLY_LIMIT = 1000;
const FREE_USER_STORAGE_QUOTA_BYTES = Number(
  import.meta.env.VITE_FREE_USER_STORAGE_QUOTA_BYTES ??
  import.meta.env.VITE_USER_STORAGE_QUOTA_BYTES ??
  104_857_600
);
const PRO_USER_STORAGE_QUOTA_BYTES = Number(
  import.meta.env.VITE_PRO_USER_STORAGE_QUOTA_BYTES ?? 5_368_709_120
);
const APP_TITLE = "Illume Reader | Make reading more immersive";
const READER_IMAGE_STYLES: Array<{ id: ReaderImageStyle; label: string; summary: string; previewAlt: string; previewSrc: string }> = [
  {
    id: "cartoon",
    label: "Cartoon",
    summary: "Bold Sunday funnies look with bright 1980s color.",
    previewAlt: "Cartoon image style example",
    previewSrc: "/cartoon.jpg"
  },
  {
    id: "cute",
    label: "Cute",
    summary: "Kawaii anime feel with pastel modern colors.",
    previewAlt: "Cute image style example",
    previewSrc: "/cute.jpg"
  }
];
type ClassicBook = {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  downloadUrl: string;
  summary: string;
};

const CURATED_CLASSICS: ClassicBook[] = [
  {
    id: "jane-austen-pride-and-prejudice",
    title: "Pride and Prejudice",
    author: "Jane Austen",
    coverUrl: "/classic-covers/jane-austen-pride-and-prejudice.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub",
    summary: "A classic romantic novel of manners following Elizabeth Bennet as she navigates issues of manners, upbringing, morality, education, and marriage in the British Regency gentry."
  },
  {
    id: "mary-shelley-frankenstein",
    title: "Frankenstein",
    author: "Mary Shelley",
    coverUrl: "/classic-covers/mary-shelley-frankenstein.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub",
    summary: "The iconic Gothic novel telling the story of Victor Frankenstein, a young scientist who creates a sapient creature in an unorthodox scientific experiment, and its tragic consequences."
  },
  {
    id: "bram-stoker-dracula",
    title: "Dracula",
    author: "Bram Stoker",
    coverUrl: "/classic-covers/bram-stoker-dracula.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.epub",
    summary: "The seminal vampire horror novel that introduced Count Dracula and established many conventions of subsequent vampire fantasy, structured as an epistolary sequence of diaries."
  },
  {
    id: "lewis-carroll-alices-adventures-in-wonderland",
    title: "Alice’s Adventures in Wonderland",
    author: "Lewis Carroll",
    coverUrl: "/classic-covers/lewis-carroll-alices-adventures-in-wonderland.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub",
    summary: "A fantastical tale of a young girl named Alice who falls through a rabbit hole into a subterranean fantasy world populated by peculiar, anthropomorphic creatures."
  },
  {
    id: "arthur-conan-doyle-the-adventures-of-sherlock-holmes",
    title: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    coverUrl: "/classic-covers/arthur-conan-doyle-the-adventures-of-sherlock-holmes.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-adventures-of-sherlock-holmes/downloads/arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub",
    summary: "A collection of twelve stories featuring the consulting detective Sherlock Holmes and his companion Dr. John H. Watson, showcasing Holmes' brilliant analytical deduction skills."
  },
  {
    id: "f-scott-fitzgerald-the-great-gatsby",
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    coverUrl: "/classic-covers/f-scott-fitzgerald-the-great-gatsby.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/f-scott-fitzgerald_the-great-gatsby.epub",
    summary: "Set in the Jazz Age on Long Island, the novel depicts narrator Nick Carraway's interactions with mysterious millionaire Jay Gatsby and Gatsby's obsession to reunite with Daisy Buchanan."
  },
  {
    id: "oscar-wilde-the-picture-of-dorian-gray",
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    coverUrl: "/classic-covers/oscar-wilde-the-picture-of-dorian-gray.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/oscar-wilde_the-picture-of-dorian-gray.epub",
    summary: "A philosophical novel about Dorian Gray, a handsome young man who sells his soul so that a painted portrait of him will age and record his decay, while he remains forever young."
  },
  {
    id: "herman-melville-moby-dick",
    title: "Moby-Dick",
    author: "Herman Melville",
    coverUrl: "/classic-covers/herman-melville-moby-dick.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/herman-melville_moby-dick.epub",
    summary: "The epic sailor Ishmael's narrative of the obsessive quest of Ahab, captain of the whaling ship Pequod, for revenge on Moby Dick, the giant white whale."
  },
  {
    id: "charles-dickens-a-tale-of-two-cities",
    title: "A Tale of Two Cities",
    author: "Charles Dickens",
    coverUrl: "/classic-covers/charles-dickens-a-tale-of-two-cities.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/charles-dickens_a-tale-of-two-cities.epub",
    summary: "Set in London and Paris before and during the French Revolution, the novel depicts the plight of the French peasantry and the demagogic excesses of the revolutionaries."
  },
  {
    id: "joseph-conrad-heart-of-darkness",
    title: "Heart of Darkness",
    author: "Joseph Conrad",
    coverUrl: "/classic-covers/joseph-conrad-heart-of-darkness.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/joseph-conrad/heart-of-darkness/downloads/joseph-conrad_heart-of-darkness.epub",
    summary: "A powerful novella following Charles Marlow's voyage up the Congo River in the Congo Free State, exploring the hypocrisy of European imperialism and the darkness of human nature."
  },
  {
    id: "h-g-wells-the-time-machine",
    title: "The Time Machine",
    author: "H. G. Wells",
    coverUrl: "/classic-covers/h-g-wells-the-time-machine.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/h-g-wells_the-time-machine.epub",
    summary: "The pioneering science fiction novella that popularized the concept of time travel using a vehicle, following a Victorian inventor's journey to the far future and the split of humanity."
  },
  {
    id: "h-g-wells-the-war-of-the-worlds",
    title: "The War of the Worlds",
    author: "H. G. Wells",
    coverUrl: "/classic-covers/h-g-wells-the-war-of-the-worlds.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/h-g-wells_the-war-of-the-worlds.epub",
    summary: "One of the earliest and most influential novels detailing an alien invasion, following a nameless narrator as Martians attack Victorian England with advanced technology."
  },
  {
    id: "robert-louis-stevenson-the-strange-case-of-dr-jekyll-and-mr-hyde",
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    author: "Robert Louis Stevenson",
    coverUrl: "/classic-covers/robert-louis-stevenson-the-strange-case-of-dr-jekyll-and-mr-hyde.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde/downloads/robert-louis-stevenson_the-strange-case-of-dr-jekyll-and-mr-hyde.epub",
    summary: "A gothic novella about a London legal practitioner named John Gabriel Utterson who investigates strange occurrences between his old friend, Dr. Henry Jekyll, and the evil Edward Hyde."
  },
  {
    id: "robert-louis-stevenson-treasure-island",
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    coverUrl: "/classic-covers/robert-louis-stevenson-treasure-island.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/treasure-island/downloads/robert-louis-stevenson_treasure-island.epub",
    summary: "The classic adventure novel telling the story of 'buccaneers and buried gold', following young Jim Hawkins as he boards the Hispaniola to locate Captain Flint's treasure."
  },
  {
    id: "charlotte-bronte-jane-eyre",
    title: "Jane Eyre",
    author: "Charlotte Brontë",
    coverUrl: "/classic-covers/charlotte-bronte-jane-eyre.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/charlotte-bronte_jane-eyre.epub",
    summary: "Following the emotions and experiences of its eponymous heroine, including her growth to adulthood and her love for Mr. Rochester, the master of Thornfield Hall."
  },
  {
    id: "emily-bronte-wuthering-heights",
    title: "Wuthering Heights",
    author: "Emily Brontë",
    coverUrl: "/classic-covers/emily-bronte-wuthering-heights.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/emily-bronte_wuthering-heights.epub",
    summary: "A passionate story of obsessive love and revenge on the Yorkshire moors, following the tumultuous relationship between Heathcliff and Catherine Earnshaw."
  },
  {
    id: "homer-the-odyssey",
    title: "The Odyssey",
    author: "Homer",
    coverUrl: "/classic-covers/homer-the-odyssey.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/homer_the-odyssey_william-cullen-bryant.epub",
    summary: "One of two major ancient Greek epic poems, following the Greek hero Odysseus, king of Ithaca, and his journey home after the fall of Troy, translated by William Cullen Bryant."
  },
  {
    id: "homer-the-iliad",
    title: "The Iliad",
    author: "Homer",
    coverUrl: "/classic-covers/homer-the-iliad.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/homer/the-iliad/william-cullen-bryant/downloads/homer_the-iliad_william-cullen-bryant.epub",
    summary: "Set during the ten-year siege of the city of Troy by a coalition of Greek states, detailing the battle between Achilles and King Agamemnon, translated by William Cullen Bryant."
  },
  {
    id: "fyodor-dostoevsky-crime-and-punishment",
    title: "Crime and Punishment",
    author: "Fyodor Dostoevsky",
    coverUrl: "/classic-covers/fyodor-dostoevsky-crime-and-punishment.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/fyodor-dostoevsky_crime-and-punishment_constance-garnett.epub",
    summary: "Following Rodion Raskolnikov, an impoverished ex-student in Saint Petersburg who formulates a plan to kill an unscrupulous pawnbroker for her money, translated by Constance Garnett."
  },
  {
    id: "fyodor-dostoevsky-the-brothers-karamazov",
    title: "The Brothers Karamazov",
    author: "Fyodor Dostoevsky",
    coverUrl: "/classic-covers/fyodor-dostoevsky-the-brothers-karamazov.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/the-brothers-karamazov/constance-garnett/downloads/fyodor-dostoevsky_the-brothers-karamazov_constance-garnett.epub",
    summary: "A passionate philosophical novel that enters deeply into the questions of God, free will, and morality, detailing the drama of the Karamazov family, translated by Constance Garnett."
  },
  {
    id: "henry-david-thoreau-walden",
    title: "Walden",
    author: "Henry David Thoreau",
    coverUrl: "/classic-covers/henry-david-thoreau-walden.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/henry-david-thoreau/walden/downloads/henry-david-thoreau_walden.epub",
    summary: "Thoreau's reflection upon simple living in natural surroundings, detailing his experiences over two years in a cabin he built near Walden Pond, Massachusetts."
  },
  {
    id: "walt-whitman-leaves-of-grass",
    title: "Leaves of Grass",
    author: "Walt Whitman",
    coverUrl: "/classic-covers/walt-whitman-leaves-of-grass.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/walt-whitman/leaves-of-grass/downloads/walt-whitman_leaves-of-grass.epub",
    summary: "A landmark poetry collection in American literature, celebrating nature, humanity, individualism, and the sensual experience of the human spirit."
  },
  {
    id: "alexandre-dumas-the-count-of-monte-cristo",
    title: "The Count of Monte Cristo",
    author: "Alexandre Dumas",
    coverUrl: "/classic-covers/alexandre-dumas-the-count-of-monte-cristo.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall/downloads/alexandre-dumas_the-count-of-monte-cristo_chapman-and-hall.epub",
    summary: "Following Edmond Dantès, a young French sailor who is falsely accused of treason, escapes from prison, and seeks retribution against his betrayers."
  },
  {
    id: "alexandre-dumas-the-three-musketeers",
    title: "The Three Musketeers",
    author: "Alexandre Dumas",
    coverUrl: "/classic-covers/alexandre-dumas-the-three-musketeers.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-three-musketeers/william-robson/downloads/alexandre-dumas_the-three-musketeers_william-robson.epub",
    summary: "The adventures of young d'Artagnan as he travels to Paris to join the Musketeers of the Guard, befriending Athos, Porthos, and Aramis, translated by William Robson."
  },
  {
    id: "charles-dickens-great-expectations",
    title: "Great Expectations",
    author: "Charles Dickens",
    coverUrl: "/classic-covers/charles-dickens-great-expectations.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/great-expectations/downloads/charles-dickens_great-expectations.epub",
    summary: "Pip, an orphan growing up in a humble blacksmith's household, is suddenly elevated to the rank of gentleman by an anonymous benefactor, navigating London high society."
  },
  {
    id: "charles-dickens-oliver-twist",
    title: "Oliver Twist",
    author: "Charles Dickens",
    coverUrl: "/classic-covers/charles-dickens-oliver-twist.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/oliver-twist/downloads/charles-dickens_oliver-twist.epub",
    summary: "The story of the orphan Oliver Twist, who starts his life in a workhouse and is then apprenticed with an undertaker, escaping to London and finding a gang of juvenile pickpockets."
  },
  {
    id: "charles-dickens-a-christmas-carol",
    title: "A Christmas Carol",
    author: "Charles Dickens",
    coverUrl: "/classic-covers/charles-dickens-a-christmas-carol.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/a-christmas-carol/downloads/charles-dickens_a-christmas-carol.epub",
    summary: "The transformation of Ebenezer Scrooge, a miserly old businessman, after he is visited by the ghosts of Christmas Past, Present, and Yet to Come."
  },
  {
    id: "james-joyce-dubliners",
    title: "Dubliners",
    author: "James Joyce",
    coverUrl: "/classic-covers/james-joyce-dubliners.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/dubliners/downloads/james-joyce_dubliners.epub",
    summary: "A collection of fifteen short stories depicting Irish middle-class life in and around Dublin in the early years of the 20th century, exploring moments of epiphany."
  },
  {
    id: "james-joyce-a-portrait-of-the-artist-as-a-young-man",
    title: "A Portrait of the Artist as a Young Man",
    author: "James Joyce",
    coverUrl: "/classic-covers/james-joyce-a-portrait-of-the-artist-as-a-young-man.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/a-portrait-of-the-artist-as-a-young-man/downloads/james-joyce_a-portrait-of-the-artist-as-a-young-man.epub",
    summary: "A semi-autobiographical novel tracing the intellectual, philosophical, and aesthetic awakening of Stephen Dedalus, a young man who rebels against his Catholic upbringing."
  },
  {
    id: "james-joyce-ulysses",
    title: "Ulysses",
    author: "James Joyce",
    coverUrl: "/classic-covers/james-joyce-ulysses.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/ulysses/downloads/james-joyce_ulysses.epub",
    summary: "A modern masterpiece chronicling the passage of Leopold Bloom through Dublin in the course of an ordinary day, establishing parallels to Homer's epic Odyssey."
  },
  {
    id: "jonathan-swift-gullivers-travels",
    title: "Gulliver’s Travels",
    author: "Jonathan Swift",
    coverUrl: "/classic-covers/jonathan-swift-gullivers-travels.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jonathan-swift/gullivers-travels/downloads/jonathan-swift_gullivers-travels.epub",
    summary: "A brilliant satire of human nature and traveler's tales, following Lemuel Gulliver's voyages to Lilliput, Brobdingnag, Laputa, and the land of the Houyhnhnms."
  },
  {
    id: "kenneth-grahame-the-wind-in-the-willows",
    title: "The Wind in the Willows",
    author: "Kenneth Grahame",
    coverUrl: "/classic-covers/kenneth-grahame-the-wind-in-the-willows.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/kenneth-grahame/the-wind-in-the-willows/downloads/kenneth-grahame_the-wind-in-the-willows.epub",
    summary: "The charming adventures of Mole, Water Rat, Badger, and the eccentric Mr. Toad of Toad Hall, exploring the Thames Valley wilderness and themes of friendship."
  },
  {
    id: "jack-london-the-call-of-the-wild",
    title: "The Call of the Wild",
    author: "Jack London",
    coverUrl: "/classic-covers/jack-london-the-call-of-the-wild.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild/downloads/jack-london_the-call-of-the-wild.epub",
    summary: "Set in the Yukon Territory during the Klondike Gold Rush, following Buck, a domesticated dog who is stolen, sold into service, and reverts to wild instincts."
  },
  {
    id: "jack-london-white-fang",
    title: "White Fang",
    author: "Jack London",
    coverUrl: "/classic-covers/jack-london-white-fang.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jack-london/white-fang/downloads/jack-london_white-fang.epub",
    summary: "A companion novel to Call of the Wild, focusing on a wild wolf-dog's journey to domestication in the Yukon Territory during the Gold Rush."
  },
  {
    id: "george-bernard-shaw-pygmalion",
    title: "Pygmalion",
    author: "George Bernard Shaw",
    coverUrl: "/classic-covers/george-bernard-shaw-pygmalion.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/george-bernard-shaw/pygmalion/downloads/george-bernard-shaw_pygmalion.epub",
    summary: "A brilliant play about Henry Higgins, a professor of phonetics, who makes a bet that he can train a bedraggled Cockney flower girl, Eliza Doolittle, to pass for a duchess."
  },
  {
    id: "leo-tolstoy-anna-karenina",
    title: "Anna Karenina",
    author: "Leo Tolstoy",
    coverUrl: "/classic-covers/leo-tolstoy-anna-karenina.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett/downloads/leo-tolstoy_anna-karenina_constance-garnett.epub",
    summary: "A complex novel in eight parts, tracing the tragic extramarital affair between the socialite Anna Karenina and the dashing cavalry officer Count Vronsky, translated by Constance Garnett."
  },
  {
    id: "leo-tolstoy-war-and-peace",
    title: "War and Peace",
    author: "Leo Tolstoy",
    coverUrl: "/classic-covers/leo-tolstoy-war-and-peace.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude/downloads/leo-tolstoy_war-and-peace_louise-maude_aylmer-maude.epub",
    summary: "An epic chronicle of the history of the French invasion of Russia and the impact of the Napoleonic era on Tsarist society through five Russian aristocratic families."
  },
  {
    id: "oscar-wilde-the-importance-of-being-earnest",
    title: "The Importance of Being Earnest",
    author: "Oscar Wilde",
    coverUrl: "/classic-covers/oscar-wilde-the-importance-of-being-earnest.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-importance-of-being-earnest/downloads/oscar-wilde_the-importance-of-being-earnest.epub",
    summary: "A farcical comedy in which the protagonists maintain fictitious personae in order to escape burdensome social obligations, showcasing Wilde's sharp wit."
  },
  {
    id: "jane-austen-sense-and-sensibility",
    title: "Sense and Sensibility",
    author: "Jane Austen",
    coverUrl: "/classic-covers/jane-austen-sense-and-sensibility.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/sense-and-sensibility/downloads/jane-austen_sense-and-sensibility.epub",
    summary: "Following the Dashwood sisters, Elinor (representing sense) and Marianne (representing sensibility), as they navigate romance, family, and financial hardship."
  },
  {
    id: "jane-austen-emma",
    title: "Emma",
    author: "Jane Austen",
    coverUrl: "/classic-covers/jane-austen-emma.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/jane-austen_emma.epub",
    summary: "Emma Woodhouse, beautiful, clever, and rich, has a very happy home and little to distress her. But she has an unfortunate habit of matchmaking in her small village."
  },
  {
    id: "jane-austen-persuasion",
    title: "Persuasion",
    author: "Jane Austen",
    coverUrl: "/classic-covers/jane-austen-persuasion.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/persuasion/downloads/jane-austen_persuasion.epub",
    summary: "The story of Anne Elliot, who, years after breaking her engagement to naval captain Frederick Wentworth, meets him again and must navigate unresolved feelings."
  },
  {
    id: "niccolo-machiavelli-the-prince",
    title: "The Prince",
    author: "Niccolò Machiavelli",
    coverUrl: "/classic-covers/niccolo-machiavelli-the-prince.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/niccolo-machiavelli/the-prince/w-k-marriott/downloads/niccolo-machiavelli_the-prince_w-k-marriott.epub",
    summary: "The classic political treatise on statecraft, describing how a ruler should acquire, maintain, and govern a principality, translated by W. K. Marriott."
  },
  {
    id: "friedrich-nietzsche-beyond-good-and-evil",
    title: "Beyond Good and Evil",
    author: "Friedrich Nietzsche",
    coverUrl: "/classic-covers/friedrich-nietzsche-beyond-good-and-evil.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern/downloads/friedrich-nietzsche_beyond-good-and-evil_helen-zimmern.epub",
    summary: "A fundamental critique of traditional morality and philosophy, introducing Nietzsche's concepts of the will to power and master-slave moralities."
  },
  {
    id: "friedrich-nietzsche-thus-spoke-zarathustra",
    title: "Thus Spoke Zarathustra",
    author: "Friedrich Nietzsche",
    coverUrl: "/classic-covers/friedrich-nietzsche-thus-spoke-zarathustra.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/thus-spake-zarathustra/thomas-common/downloads/friedrich-nietzsche_thus-spake-zarathustra_thomas-common.epub",
    summary: "A philosophical novel containing the fictional travels and speeches of Zarathustra, introducing the concepts of the Übermensch and eternal recurrence."
  },
  {
    id: "kahlil-gibran-the-prophet",
    title: "The Prophet",
    author: "Kahlil Gibran",
    coverUrl: "/classic-covers/kahlil-gibran-the-prophet.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/khalil-gibran/the-prophet/downloads/khalil-gibran_the-prophet.epub",
    summary: "A book of 26 poetic essays delivered by the prophet Almustafa, offering spiritual insights on love, marriage, children, work, joy, sorrow, and death."
  },
  {
    id: "frances-hodgson-burnett-the-secret-garden",
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    coverUrl: "/classic-covers/frances-hodgson-burnett-the-secret-garden.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden/downloads/frances-hodgson-burnett_the-secret-garden.epub",
    summary: "Following Mary Lennox, a spoiled and unloved orphan who is sent to Yorkshire to live with her uncle, discovering a locked and neglected secret garden."
  },
  {
    id: "j-m-barrie-peter-and-wendy",
    title: "Peter and Wendy",
    author: "J. M. Barrie",
    coverUrl: "/classic-covers/j-m-barrie-peter-and-wendy.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/j-m-barrie/peter-and-wendy/downloads/j-m-barrie_peter-and-wendy.epub",
    summary: "The classic fantasy story of Peter Pan, the boy who wouldn't grow up, as he takes Wendy Darling and her brothers to the magical island of Neverland."
  },
  {
    id: "brothers-grimm-fairy-tales",
    title: "Grimms’ Fairy Tales",
    author: "Brothers Grimm",
    coverUrl: "/classic-covers/brothers-grimm-fairy-tales.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jacob-grimm_wilhelm-grimm/household-tales/margaret-hunt/downloads/jacob-grimm_wilhelm-grimm_household-tales_margaret-hunt.epub",
    summary: "A renowned collection of German folklore and fairy tales, including Cinderella, Hansel and Gretel, Rapunzel, Rumpelstiltskin, and Sleeping Beauty."
  }
];


const wordRangesFromText = (text: string): WordRange[] =>
  Array.from(text.matchAll(/\S+/g)).map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length
  }));

const wordsFromText = (text: string) => Array.from(text.matchAll(/\S+/g)).map((match) => match[0]);

const pdfPageSpeechId = (pageNumber: number) => `pdf-page-${pageNumber}`;

const bookWords = (book: ReaderBook) =>
  book.paragraphs.flatMap((paragraph) => (paragraph.kind === "image" ? [] : wordsFromText(paragraph.text)));

const buildReaderImageChunks = (book: ReaderBook, startOffset = 0, chunkSize = READER_IMAGE_CHUNK_WORDS): ReaderImageChunk[] => {
  const allWords = bookWords(book);
  const safeStartOffset = Math.max(0, Math.min(startOffset, Math.max(0, allWords.length - 1)));
  const chunks: ReaderImageChunk[] = [];

  for (let offset = safeStartOffset; offset < allWords.length; offset += chunkSize) {
    const words = allWords.slice(offset, offset + chunkSize);
    if (!words.length) break;
    chunks.push({
      endWord: offset + words.length,
      index: chunks.length,
      startWord: offset + 1,
      text: words.join(" ")
    });
  }

  return chunks;
};

const buildPdfReaderImageChunks = (book: ReaderBook, chunkSize = READER_IMAGE_CHUNK_WORDS): ReaderImageChunk[] => {
  const chunks: ReaderImageChunk[] = [];
  let chunkStartPage = 1;
  let chunkStartWord = 1;
  let chunkWords: string[] = [];
  let wordOffset = 0;

  const pushChunk = () => {
    if (!chunkWords.length) return;
    chunks.push({
      endWord: wordOffset,
      index: chunks.length,
      pageNumber: chunkStartPage,
      startWord: chunkStartWord,
      text: chunkWords.join(" ")
    });
    chunkWords = [];
    chunkStartWord = wordOffset + 1;
  };

  for (let pageNumber = 1; pageNumber <= (book.pageCount ?? 0); pageNumber += 1) {
    const pageWords: string[] = [];

    for (let pIndex = 0; pIndex < book.paragraphs.length; pIndex++) {
      const paragraph = book.paragraphs[pIndex];
      if (paragraph.kind === "image" || paragraph.pageNumber !== pageNumber) continue;
      pageWords.push(...wordsFromText(paragraph.text));
    }

    for (const word of pageWords) {
      if (!chunkWords.length) {
        chunkStartPage = pageNumber;
        chunkStartWord = wordOffset + 1;
      }
      chunkWords.push(word);
      wordOffset += 1;
      if (chunkWords.length >= chunkSize) pushChunk();
    }
  }

  pushChunk();
  return chunks;
};

const pdfWordOffsetBeforePage = (book: ReaderBook, pageNumber: number) => {
  let wordOffset = 0;
  for (const paragraph of book.paragraphs) {
    if (paragraph.kind === "image") continue;
    const paragraphPage = paragraph.pageNumber ?? 1;
    if (paragraphPage >= pageNumber) continue;
    wordOffset += wordsFromText(paragraph.text).length;
  }
  return wordOffset;
};

const buildParagraphWordMetrics = (book: ReaderBook) => {
  const offsets: number[] = [];
  const counts: number[] = [];
  let total = 0;

  for (const paragraph of book.paragraphs) {
    offsets.push(total);
    const count = paragraph.kind === "image" ? 0 : wordsFromText(paragraph.text).length;
    counts.push(count);
    total += count;
  }

  return { counts, offsets, total };
};

const readerImageChunkIndexForWordOffset = (chunks: ReaderImageChunk[], wordOffset: number) => {
  if (!chunks.length) return -1;

  const safeOffset = Math.max(0, wordOffset);
  const chunk = chunks.find((item) => item.startWord - 1 <= safeOffset && item.endWord > safeOffset);
  return chunk?.index ?? chunks[chunks.length - 1].index;
};

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

const edgeFunctionErrorMessage = async (error: unknown) => {
  const fallback = error instanceof Error ? error.message : "Edge Function failed.";
  const response = error && typeof error === "object" && "context" in error ? (error.context as Response | undefined) : undefined;

  if (!response) return fallback;

  try {
    const body = await response.clone().json();
    const message = typeof body?.error === "string"
      ? body.error
      : typeof body?.message === "string"
        ? body.message
        : fallback;

    if (body?.code === "UNAUTHORIZED_INVALID_JWT_FORMAT") {
      return "Please sign in again before using this feature.";
    }

    return message;
  } catch {
    return fallback;
  }
};

const readerImageErrorMessage = (message: string) => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("rate limit reached") ||
    normalized.includes("rate_limit") ||
    normalized.includes("gpt-image") ||
    normalized.includes("platform.openai.com/account/rate-limits")
  ) {
    return "Image generation is busy. Please try again in a moment.";
  }

  return message;
};

const formatShortDate = (value: string | null) => {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
};

const formatShortDateTime = (value: string | null) => {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
};

const formatCompactDate = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short"
  }).format(new Date(value));

const buildSparklinePath = (values: number[], width = 180, height = 48, padding = 4) => {
  if (!values.length) return "";

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const drawableWidth = width - padding * 2;
  const drawableHeight = height - padding * 2;

  return values
    .map((value, index) => {
      const ratio = values.length === 1 ? 1 : index / (values.length - 1);
      const x = padding + ratio * drawableWidth;
      const y = padding + drawableHeight - ((value - min) / range) * drawableHeight;

      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

const buildSparklineAreaPath = (linePath: string, values: number[], width = 180, height = 48, padding = 4) => {
  if (!linePath || !values.length) return "";

  const baseline = height - padding;
  const startX = padding;
  const endX = values.length === 1 ? padding : width - padding;

  return `${linePath} L ${endX} ${baseline} L ${startX} ${baseline} Z`;
};

function DashboardSparkline({
  label,
  points,
  valueKey
}: {
  label: string;
  points: ReaderDashboardTimelinePoint[];
  valueKey: keyof Pick<ReaderDashboardTimelinePoint, "booksBytes" | "imagesBytes" | "imagesCount" | "storageBytes" | "usersCount">;
}) {
  const values = points.map((point) => Number(point[valueKey] ?? 0));
  const linePath = buildSparklinePath(values);
  const areaPath = buildSparklineAreaPath(linePath, values);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];

  return (
    <div className="dashboard-sparkline" aria-label={label}>
      {points.length ? (
        <>
          <svg viewBox="0 0 180 48" preserveAspectRatio="none" role="img" aria-label={label}>
            <path className="dashboard-sparkline-area" d={areaPath} />
            <path className="dashboard-sparkline-line" d={linePath} />
          </svg>
          <div className="dashboard-sparkline-dates" aria-hidden="true">
            <span>{firstPoint ? formatCompactDate(firstPoint.date) : ""}</span>
            <span>{lastPoint ? formatCompactDate(lastPoint.date) : ""}</span>
          </div>
        </>
      ) : (
        <div className="dashboard-sparkline-empty">No timeline yet</div>
      )}
    </div>
  );
}

const buildDashboardTimelineFromUsers = (data: ReaderDashboardData | null): ReaderDashboardTimelinePoint[] => {
  if (!data) return [];

  const events = new Map<string, Omit<ReaderDashboardTimelinePoint, "storageBytes">>();
  const ensureEvent = (date: string) => {
    const existing = events.get(date);
    if (existing) return existing;

    const event = { booksBytes: 0, booksCount: 0, date, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
    events.set(date, event);
    return event;
  };
  const imageCount = data.totals.imagesGenerated || data.users.reduce((total, user) => total + (user.images?.length ?? 0), 0);
  const imageAverageBytes = imageCount ? data.storage.imagesBytes / imageCount : 0;

  data.users.forEach((user) => {
    const joinedDate = user.createdAt ? new Date(user.createdAt) : null;
    if (joinedDate && !Number.isNaN(joinedDate.getTime())) {
      ensureEvent(joinedDate.toISOString().slice(0, 10)).usersCount += 1;
    }

    user.books?.forEach((book) => {
      const createdDate = new Date(book.createdAt);
      if (Number.isNaN(createdDate.getTime())) return;

      const event = ensureEvent(createdDate.toISOString().slice(0, 10));
      event.booksCount += 1;
      event.booksBytes += Number(book.fileSize ?? 0);
    });

    user.images?.forEach((image) => {
      const createdDate = new Date(image.createdAt);
      if (Number.isNaN(createdDate.getTime())) return;

      const event = ensureEvent(createdDate.toISOString().slice(0, 10));
      event.imagesCount += 1;
      event.imagesBytes += imageAverageBytes;
    });
  });

  const generatedDate = new Date(data.generatedAt);
  if (!Number.isNaN(generatedDate.getTime())) ensureEvent(generatedDate.toISOString().slice(0, 10));

  const totals = { booksBytes: 0, booksCount: 0, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
  const timeline = [...events.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((event) => {
      totals.booksBytes += event.booksBytes;
      totals.booksCount += event.booksCount;
      totals.imagesBytes += event.imagesBytes;
      totals.imagesCount += event.imagesCount;
      totals.usersCount += event.usersCount;

      return {
        booksBytes: totals.booksBytes,
        booksCount: totals.booksCount,
        date: event.date,
        imagesBytes: totals.imagesBytes,
        imagesCount: totals.imagesCount,
        storageBytes: totals.booksBytes + totals.imagesBytes,
        usersCount: totals.usersCount
      };
    });

  const lastPoint = timeline[timeline.length - 1];
  if (lastPoint) {
    lastPoint.booksBytes = data.storage.booksBytes;
    lastPoint.imagesBytes = data.storage.imagesBytes;
    lastPoint.storageBytes = data.storage.totalBytes;
    lastPoint.booksCount = data.totals.books;
    lastPoint.imagesCount = data.totals.imagesGenerated;
    lastPoint.usersCount = data.totals.users;
  }

  return timeline;
};

const buildUserTimelineFromData = (user: ReaderDashboardUser | null): ReaderDashboardTimelinePoint[] => {
  if (!user) return [];

  const events = new Map<string, Omit<ReaderDashboardTimelinePoint, "storageBytes">>();
  const ensureEvent = (date: string) => {
    const existing = events.get(date);
    if (existing) return existing;

    const event = { booksBytes: 0, booksCount: 0, date, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
    events.set(date, event);
    return event;
  };
  const imageCount = user.imagesGenerated || user.images?.length || 0;
  const imageAverageBytes = imageCount ? user.imageStorageBytes / imageCount : 0;

  const joinedDate = user.createdAt ? new Date(user.createdAt) : null;
  if (joinedDate && !Number.isNaN(joinedDate.getTime())) {
    ensureEvent(joinedDate.toISOString().slice(0, 10)).usersCount = 1;
  }

  user.books?.forEach((book) => {
    const createdDate = new Date(book.createdAt);
    if (Number.isNaN(createdDate.getTime())) return;

    const event = ensureEvent(createdDate.toISOString().slice(0, 10));
    event.booksCount += 1;
    event.booksBytes += Number(book.fileSize ?? 0);
  });

  user.images?.forEach((image) => {
    const createdDate = new Date(image.createdAt);
    if (Number.isNaN(createdDate.getTime())) return;

    const event = ensureEvent(createdDate.toISOString().slice(0, 10));
    event.imagesCount += 1;
    event.imagesBytes += imageAverageBytes;
  });

  const today = new Date();
  ensureEvent(today.toISOString().slice(0, 10));

  const totals = { booksBytes: 0, booksCount: 0, imagesBytes: 0, imagesCount: 0, usersCount: 0 };
  const timeline = [...events.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((event) => {
      totals.booksBytes += event.booksBytes;
      totals.booksCount += event.booksCount;
      totals.imagesBytes += event.imagesBytes;
      totals.imagesCount += event.imagesCount;
      totals.usersCount = Math.max(totals.usersCount, event.usersCount);

      return {
        booksBytes: totals.booksBytes,
        booksCount: totals.booksCount,
        date: event.date,
        imagesBytes: totals.imagesBytes,
        imagesCount: totals.imagesCount,
        storageBytes: totals.booksBytes + totals.imagesBytes,
        usersCount: totals.usersCount
      };
    });

  const lastPoint = timeline[timeline.length - 1];
  if (lastPoint) {
    lastPoint.booksBytes = user.bookStorageBytes;
    lastPoint.imagesBytes = user.imageStorageBytes;
    lastPoint.imagesCount = user.imagesGenerated ?? user.images.length;
    lastPoint.storageBytes = user.bookStorageBytes + user.imageStorageBytes;
  }

  return timeline;
};

const buildUserJourneyFromData = (user: ReaderDashboardUser | null): ReaderDashboardJourneyEvent[] => {
  if (!user) return [];
  if (user.journey?.length) return user.journey;

  return [
    user.createdAt
      ? {
          at: user.createdAt,
          detail: "Account created",
          label: "Signed up",
          type: "sign_up"
        }
      : null,
    user.lastSignInAt
      ? {
          at: user.lastSignInAt,
          detail: "Latest Supabase Auth sign-in",
          label: "Signed in",
          type: "sign_in"
        }
      : null,
    ...(user.books ?? []).map((book) => ({
      at: book.createdAt,
      detail: `${book.title || book.fileName} · ${(book.documentType || "book").toUpperCase()}`,
      label: "Uploaded book",
      type: "book_upload"
    })),
    ...(user.images ?? []).map((image) => ({
      at: image.createdAt,
      detail: `${image.style || "image"} image · words ${image.startWord ?? "?"}-${image.endWord ?? "?"}`,
      label: "Generated image",
      type: "image_generated"
    }))
  ]
    .filter((event): event is ReaderDashboardJourneyEvent => Boolean(event?.at))
    .sort((left, right) => right.at.localeCompare(left.at));
};

const toastTitle = (title: string) => {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length <= TOAST_TITLE_WORD_LIMIT) return title;
  return `${words.slice(0, TOAST_TITLE_WORD_LIMIT).join(" ")}...`;
};

const bookFormat = (row: Pick<BookRow, "document_type" | "file_name" | "mime_type">): "epub" | "pdf" => {
  if (row.document_type === "pdf" || row.mime_type === "application/pdf" || row.file_name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  return "epub";
};

const documentMimeType = (format: "epub" | "pdf") =>
  format === "pdf" ? "application/pdf" : "application/epub+zip";

const pdfPreviewFromRow = (row: BookRow): PdfPreview | null => {
  if (bookFormat(row) !== "pdf" || !row.page_count) return null;

  const toc = Array.isArray(row.pdf_toc) ? row.pdf_toc : [];
  return {
    author: row.author ?? "",
    chapterPageNumbers: toc.map((entry) => Number(entry.pageNumber ?? 1)).filter((page) => Number.isFinite(page) && page > 0),
    chapterPageOffsets: toc.map((entry) => Math.max(0, Math.min(1, Number(entry.pageOffsetRatio ?? 0) || 0))),
    chapters: toc.map((entry) => String(entry.title ?? "").trim()).filter(Boolean),
    pageCount: row.page_count,
    pageMetrics: Array.isArray(row.pdf_page_metrics) ? row.pdf_page_metrics : [],
    title: row.title
  };
};

const bookProcessingLabel = (book: BookRow) => {
  if (bookFormat(book) !== "pdf") return "";
  switch (book.processing_status) {
    case "queued":
      return " · text queued";
    case "processing":
      return " · processing text";
    case "failed":
      return " · text failed";
    default:
      return "";
  }
};

const isPdfFile = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const isEpubFile = (file: File) => file.type === "application/epub+zip" || file.name.toLowerCase().endsWith(".epub");

const safeFileName = (name: string) => {
  const safeName = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return safeName || "document";
};

const safeDocumentFileName = (name: string, format: "epub" | "pdf") => {
  const extension = `.${format}`;
  const safeName = safeFileName(name);
  const withoutExtension = safeName.toLowerCase().endsWith(extension)
    ? safeName.slice(0, -extension.length)
    : safeName.replace(/\.[^.]*$/, "");
  const safeBaseName = safeFileName(withoutExtension).slice(0, 120 - extension.length).replace(/[._-]+$/g, "");

  return `${safeBaseName || "document"}${extension}`;
};

const blobLooksLikeEpub = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
};

const classicDownloadUrl = (url: string) => {
  if (!url.startsWith("https://standardebooks.org/")) return url;

  const downloadUrl = new URL(url);
  downloadUrl.searchParams.set("source", "download");
  return downloadUrl.toString();
};

const coverPalettes = [
  "linear-gradient(145deg, #232323 0%, #5a4f3f 100%)",
  "linear-gradient(145deg, #18313f 0%, #d17a45 100%)",
  "linear-gradient(145deg, #2d2a32 0%, #7f8c6f 100%)",
  "linear-gradient(145deg, #143d3d 0%, #d6b35a 100%)",
  "linear-gradient(145deg, #3b2636 0%, #b9685b 100%)",
  "linear-gradient(145deg, #1f3048 0%, #b6a66a 100%)"
];

const getBookHue = (book: Pick<BookRow, "id" | "title">) => {
  const seed = `${book.id}-${book.title}`;
  const hash = Array.from(seed).reduce((value, char) => value + char.charCodeAt(0), 0);
  return coverPalettes[hash % coverPalettes.length];
};

const getCoverInitials = (title: string) =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("") || "EP";

function BookCover({ book }: { book: Pick<BookRow, "cover_url" | "document_type" | "file_name" | "id" | "mime_type" | "title"> }) {
  const [hasError, setHasError] = useState(false);
  const format = bookFormat(book);

  return (
    <span className="catalog-cover-art">
      {!book.cover_url || hasError ? (
        <span className="generated-cover" style={{ background: getBookHue(book) }}>
          {format === "pdf" ? <FileText size={28} aria-hidden="true" /> : null}
          <span className="fallback-title">{book.title}</span>
        </span>
      ) : (
        <img
          alt={book.title}
          decoding="sync"
          draggable={false}
          loading="eager"
          src={book.cover_url}
          onError={() => setHasError(true)}
        />
      )}
    </span>
  );
}

const PdfPageCanvas = memo(function PdfPageCanvas({
  active,
  metrics,
  pageNumber,
  pageScale,
  pdf,
  rootRef,
  sideImage,
  speechHighlight,
  paragraphs,
  viewportSize,
  onPageRendered,
  onWordClick
}: {
  active: boolean;
  metrics?: PdfPageMetrics;
  pageNumber: number;
  paragraphs: ReaderParagraph[];
  pageScale: number;
  pdf: pdfjsLib.PDFDocumentProxy;
  rootRef: RefObject<HTMLElement | null>;
  sideImage?: ReactNode;
  speechHighlight: SpeechHighlight | null;
  viewportSize: { height: number; width: number };
  onPageRendered?: (pageNumber: number) => void;
  onWordClick?: (pageNumber: number, pageWordIndex: number, word?: PdfTextLayerWord, pageText?: string) => void;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shouldRender, setShouldRender] = useState(active);
  const [pageSize, setPageSize] = useState({ height: 0, width: 0 });
  const [textLayerWords, setTextLayerWords] = useState<PdfTextLayerWord[]>([]);

  const activePageWordIndex = useMemo(() => {
    if (!speechHighlight || speechHighlight.end <= speechHighlight.start) return null;

    if (speechHighlight.paragraphId === pdfPageSpeechId(pageNumber)) {
      const activeWord = textLayerWords.find(
        (word) => word.charStart === speechHighlight.start && word.charEnd === speechHighlight.end
      );
      return activeWord?.pageWordIndex ?? null;
    }

    const activeParagraph = paragraphs.find((paragraph) => paragraph.id === speechHighlight.paragraphId);
    if (!activeParagraph || activeParagraph.pageNumber !== pageNumber) return null;

    const pageParagraphs = paragraphs.filter((paragraph) => paragraph.pageNumber === pageNumber);
    const activeParagraphIndex = pageParagraphs.findIndex((paragraph) => paragraph.id === activeParagraph.id);
    if (activeParagraphIndex < 0) return null;

    const wordsBeforeParagraph = pageParagraphs
      .slice(0, activeParagraphIndex)
      .reduce((total, paragraph) => total + wordsFromText(paragraph.text).length, 0);
    const wordIndexInParagraph = wordRangesFromText(activeParagraph.text).findIndex(
      (range) => range.start === speechHighlight.start && range.end === speechHighlight.end
    );

    return wordIndexInParagraph >= 0 ? wordsBeforeParagraph + wordIndexInParagraph : null;
  }, [pageNumber, paragraphs, speechHighlight, textLayerWords]);

  useEffect(() => {
    const node = pageRef.current;
    if (!node || !rootRef.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setShouldRender(true);
      },
      { root: rootRef.current, rootMargin: "900px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (active) setShouldRender(true);
  }, [active]);

  useEffect(() => {
    if (!shouldRender) return;

    let cancelled = false;
    let task: pdfjsLib.RenderTask | null = null;

    const render = async () => {
      const canvas = canvasRef.current;
      const holder = pageRef.current;
      if (!canvas || !holder) return;

      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;

      const unscaledViewport = page.getViewport({ scale: 1 });
      const surfaceWidth = viewportSize.width || rootRef.current?.clientWidth || holder.clientWidth;
      const inSpread = Boolean(holder.closest(".pdf-page-spread"));
      const pageGutter = surfaceWidth < 970 ? 24 : 88;
      const spreadGutter = surfaceWidth < 970 ? 44 : 110;
      const baseAvailableWidth = Math.max(260, inSpread ? (surfaceWidth - spreadGutter) / 2 : surfaceWidth - pageGutter);
      const scale = Math.min(3, (baseAvailableWidth * pageScale) / unscaledViewport.width);
      const viewport = page.getViewport({ scale });
      const deviceScale = window.devicePixelRatio || 1;
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = Math.floor(viewport.width * deviceScale);
      canvas.height = Math.floor(viewport.height * deviceScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      setPageSize({ height: Math.floor(viewport.height), width: Math.floor(viewport.width) });

      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      task = page.render({ canvas, canvasContext: context, viewport });
      await task.promise.catch(() => undefined);

      if (cancelled) return;
      const textContent = await page.getTextContent();
      if (cancelled) return;

      let pageWordIndex = 0;
      const words: PdfTextLayerWord[] = [];

      for (let itemIndex = 0; itemIndex < textContent.items.length; itemIndex++) {
        const item = textContent.items[itemIndex];
        if (!("str" in item) || !item.str.trim()) continue;

        const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
        const fontSize = Math.max(1, Math.hypot(transform[2], transform[3]) || item.height * scale);
        const itemWidth = Math.max(1, item.width * scale);
        const itemTextLength = Math.max(item.str.length, 1);

        const matches = Array.from(item.str.matchAll(/\S+/g));
        for (const match of matches) {
          const start = match.index ?? 0;
          const width = Math.max(2, itemWidth * (match[0].length / itemTextLength));
          words.push({
            charEnd: 0,
            charStart: 0,
            fontSize,
            height: fontSize * 1.18,
            left: transform[4] + itemWidth * (start / itemTextLength),
            pageWordIndex,
            text: match[0],
            top: transform[5] - fontSize,
            width
          });
          pageWordIndex += 1;
        }
      }

      let charOffset = 0;
      for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
        words[wordIndex].charStart = charOffset;
        words[wordIndex].charEnd = charOffset + words[wordIndex].text.length;
        charOffset = words[wordIndex].charEnd + 1;
      }

      setTextLayerWords(words);
      onPageRendered?.(pageNumber);
    };

    void render();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [onPageRendered, pageNumber, pageScale, pdf, rootRef, shouldRender, viewportSize.height, viewportSize.width]);

  const imageSlot = sideImage ? (
    <div className={`pdf-page-image-slot ${pageNumber % 2 === 1 ? "left" : "right"}`}>
      {sideImage}
    </div>
  ) : null;
  const pageStyle = {
    "--pdf-page-aspect-ratio": `${metrics?.width ?? (pageSize.width || 3)} / ${metrics?.height ?? (pageSize.height || 4)}`,
    ...(pageSize.width && pageSize.height ? {
    "--pdf-page-height": `${pageSize.height}px`,
    "--pdf-page-width": `${pageSize.width}px`
    } : {})
  } as CSSProperties;

  return (
    <div className="pdf-page-row" data-page-number={pageNumber} style={pageStyle}>
      <div
        className={active ? "pdf-page active" : "pdf-page"}
        ref={pageRef}
        style={pageStyle}
      >
        <canvas ref={canvasRef} aria-label={`PDF page ${pageNumber}`} />
        {textLayerWords.length ? (
          <div
            className="pdf-text-layer"
            aria-hidden="true"
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const wordIndexStr = target.getAttribute("data-page-word-index");
              if (wordIndexStr !== null && onWordClick) {
                const pageWordIndex = parseInt(wordIndexStr, 10);
                const pageText = textLayerWords.map((word) => word.text).join(" ");
                const word = textLayerWords.find((item) => item.pageWordIndex === pageWordIndex);
                onWordClick(pageNumber, pageWordIndex, word, pageText);
              }
            }}
          >
            {textLayerWords.map((word, index) => (
              <span
                className={word.pageWordIndex === activePageWordIndex ? "pdf-spoken-word" : "pdf-text-word"}
                key={`${word.pageWordIndex}-${index}`}
                data-page-word-index={word.pageWordIndex}
                style={{
                  fontSize: `${word.fontSize}px`,
                  height: `${word.height}px`,
                  left: `${word.left}px`,
                  top: `${word.top}px`,
                  width: `${word.width}px`
                }}
              >
                {word.text}
              </span>
            ))}
          </div>
        ) : null}
        {!shouldRender && <div className="pdf-page-placeholder">Page {pageNumber}</div>}
      </div>
      {imageSlot}
    </div>
  );
});

function PdfDocumentView({
  currentPage,
  file,
  onDocumentReady,
  onPageChange,
  pageCount,
  paragraphs,
  scrollOffsetRatio,
  scrollPage,
  scrollRequest,
  renderPageImage,
  speechHighlight,
  pdfPageLayout,
  pdfPageScale,
  onWordClick
}: {
  currentPage: number;
  file: File | null;
  onDocumentReady?: () => void;
  onPageChange: (page: number, options?: { offsetRatio?: number; scroll?: boolean }) => void;
  pageCount: number;
  paragraphs: ReaderParagraph[];
  scrollOffsetRatio: number;
  scrollPage: number;
  scrollRequest: number;
  renderPageImage?: (pageNumber: number) => ReactNode;
  speechHighlight: SpeechHighlight | null;
  pdfPageLayout: "single" | "double";
  pdfPageScale: number;
  onWordClick?: (pageNumber: number, pageWordIndex: number, word?: PdfTextLayerWord, pageText?: string) => void;
}) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [pageMetrics, setPageMetrics] = useState<PdfPageMetrics[]>([]);
  const [surfaceSize, setSurfaceSize] = useState({ height: 0, width: 0 });
  const [isInitialPdfVisible, setIsInitialPdfVisible] = useState(false);
  const [isPdfResizing, setIsPdfResizing] = useState(false);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const resizeDebounceRef = useRef<number | null>(null);
  const resizeFallbackRef = useRef<number | null>(null);
  const awaitingResizeRenderRef = useRef(false);
  const frozenScrollTopRef = useRef(0);
  const pendingSurfaceSizeRef = useRef({ height: 0, width: 0 });
  const scrollAnchorRef = useRef({ offsetRatio: 0, page: currentPage });
  const resizingRef = useRef(false);
  const suppressScrollRef = useRef(false);
  const userScrolledRef = useRef(false);
  const onDocumentReadyRef = useRef(onDocumentReady);
  const initialReadyFrameRef = useRef<number | null>(null);
  const initialReadyTimerRef = useRef<number | null>(null);
  const initialReadyReportedRef = useRef(false);

  useEffect(() => {
    onDocumentReadyRef.current = onDocumentReady;
  }, [onDocumentReady]);

  useEffect(() => {
    scrollAnchorRef.current = {
      offsetRatio: scrollAnchorRef.current.page === currentPage ? scrollAnchorRef.current.offsetRatio : 0,
      page: currentPage
    };
  }, [currentPage]);

  useEffect(() => {
    if (scrollRequest <= 0) return;
    scrollAnchorRef.current = {
      offsetRatio: Math.max(0, Math.min(1, scrollOffsetRatio)),
      page: scrollPage
    };
  }, [scrollOffsetRatio, scrollPage, scrollRequest]);

  useEffect(() => {
    if (!file) {
      setPdf(null);
      setPageMetrics([]);
      setIsInitialPdfVisible(false);
      initialReadyReportedRef.current = false;
      return;
    }

    let cancelled = false;
    let loadedPdf: pdfjsLib.PDFDocumentProxy | null = null;

    const load = async () => {
      setError("");
      setPdf(null);
      setPageMetrics([]);
      setIsInitialPdfVisible(false);
      initialReadyReportedRef.current = false;
      try {
        const bytes = await file.arrayBuffer();
        loadedPdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
        if (cancelled) return;

        const firstPage = await loadedPdf.getPage(1).catch(() => null);
        if (cancelled) return;
        if (firstPage) {
          const firstViewport = firstPage.getViewport({ scale: 1 });
          setPageMetrics(Array.from({ length: loadedPdf.numPages }, () => ({ height: firstViewport.height, width: firstViewport.width })));
        }
        setPdf(loadedPdf);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not render this PDF.");
          onDocumentReadyRef.current?.();
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      void loadedPdf?.destroy();
    };
  }, [file]);

  useEffect(() => {
    initialReadyReportedRef.current = false;
    setIsInitialPdfVisible(false);
    if (initialReadyFrameRef.current !== null) {
      window.cancelAnimationFrame(initialReadyFrameRef.current);
      initialReadyFrameRef.current = null;
    }
    if (initialReadyTimerRef.current !== null) {
      window.clearTimeout(initialReadyTimerRef.current);
      initialReadyTimerRef.current = null;
    }
  }, [file, pdfPageLayout, pdfPageScale]);

  const scrollToPageTarget = (page: number, offsetRatio = 0, behavior: ScrollBehavior = "auto") => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const target = surface.querySelector<HTMLElement>(`[data-page-number="${page}"]`);
    if (!target) return;

    const targetTop =
      target.getBoundingClientRect().top -
      surface.getBoundingClientRect().top +
      surface.scrollTop +
      target.clientHeight * Math.max(0, Math.min(1, offsetRatio));
    surface.scrollTo({ top: Math.max(0, targetTop - 18), behavior });
  };

  const restoreScrollAnchor = (settled = false) => {
    const anchor = scrollAnchorRef.current;
    suppressScrollRef.current = true;
    scrollToPageTarget(anchor.page, anchor.offsetRatio);
    window.requestAnimationFrame(() => {
      if (settled || !resizingRef.current) suppressScrollRef.current = false;
    });
  };

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    const measureSurface = () => ({ height: surface.clientHeight, width: surface.clientWidth });
    const applySurfaceSize = (next = measureSurface()) => {
      setSurfaceSize((previous) => (
        previous.height === next.height && previous.width === next.width ? previous : next
      ));
    };

    const finishResize = () => {
      awaitingResizeRenderRef.current = false;
      restoreScrollAnchor(true);
      window.requestAnimationFrame(() => {
        resizingRef.current = false;
        setIsPdfResizing(false);
      });
    };

    const scheduleAnchorRestore = () => {
      const wasResizing = resizingRef.current;
      if (!wasResizing) frozenScrollTopRef.current = surface.scrollTop;
      resizingRef.current = true;
      awaitingResizeRenderRef.current = false;
      suppressScrollRef.current = true;
      setIsPdfResizing(true);
      surface.scrollTop = frozenScrollTopRef.current;
      pendingSurfaceSizeRef.current = measureSurface();

      if (resizeDebounceRef.current !== null) window.clearTimeout(resizeDebounceRef.current);
      if (resizeFallbackRef.current !== null) window.clearTimeout(resizeFallbackRef.current);

      resizeDebounceRef.current = window.setTimeout(() => {
        resizeDebounceRef.current = null;
        awaitingResizeRenderRef.current = true;
        applySurfaceSize(pendingSurfaceSizeRef.current);
        resizeFallbackRef.current = window.setTimeout(() => {
          resizeFallbackRef.current = null;
          finishResize();
        }, 220);
      }, 160);
    };

    applySurfaceSize();
    const observer = new ResizeObserver(scheduleAnchorRestore);
    observer.observe(surface);
    window.addEventListener("resize", scheduleAnchorRestore);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleAnchorRestore);
      if (resizeDebounceRef.current !== null) window.clearTimeout(resizeDebounceRef.current);
      if (resizeFallbackRef.current !== null) window.clearTimeout(resizeFallbackRef.current);
    };
  }, [pdf]);

  const reportInitialReadyAfterSettledPaint = useCallback((pageNumber: number) => {
    if (initialReadyReportedRef.current || pageNumber !== scrollAnchorRef.current.page) return;

    if (initialReadyFrameRef.current !== null) window.cancelAnimationFrame(initialReadyFrameRef.current);
    if (initialReadyTimerRef.current !== null) window.clearTimeout(initialReadyTimerRef.current);

    initialReadyFrameRef.current = window.requestAnimationFrame(() => {
      initialReadyFrameRef.current = window.requestAnimationFrame(() => {
        initialReadyFrameRef.current = null;
        initialReadyTimerRef.current = window.setTimeout(() => {
          initialReadyTimerRef.current = null;

          if (resizingRef.current || awaitingResizeRenderRef.current) {
            reportInitialReadyAfterSettledPaint(pageNumber);
            return;
          }

          initialReadyReportedRef.current = true;
          setIsInitialPdfVisible(true);
          onDocumentReadyRef.current?.();
        }, 90);
      });
    });
  }, []);

  const handlePageRendered = useCallback((pageNumber: number) => {
    reportInitialReadyAfterSettledPaint(pageNumber);
    if (!resizingRef.current || !awaitingResizeRenderRef.current || pageNumber !== scrollAnchorRef.current.page) return;
    if (resizeFallbackRef.current !== null) window.clearTimeout(resizeFallbackRef.current);
    resizeFallbackRef.current = window.setTimeout(() => {
      resizeFallbackRef.current = null;
      awaitingResizeRenderRef.current = false;
      restoreScrollAnchor(true);
      window.requestAnimationFrame(() => {
        resizingRef.current = false;
        setIsPdfResizing(false);
      });
    }, 40);
  }, [reportInitialReadyAfterSettledPaint]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || userScrolledRef.current) return;

    scrollToPageTarget(currentPage, 0);
  }, [currentPage, pdf]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !pdf || scrollRequest <= 0) return;

    userScrolledRef.current = false;
    requestAnimationFrame(() => {
      scrollToPageTarget(scrollPage, scrollOffsetRatio);
    });
  }, [pdf, scrollOffsetRatio, scrollPage, scrollRequest]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (initialReadyFrameRef.current !== null) window.cancelAnimationFrame(initialReadyFrameRef.current);
    if (initialReadyTimerRef.current !== null) window.clearTimeout(initialReadyTimerRef.current);
  }, []);

  const handleScroll = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    if (suppressScrollRef.current || resizingRef.current) return;
    userScrolledRef.current = true;
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;

      const viewportTop = surface.getBoundingClientRect().top + 72;
      let closestPage = currentPage;
      let closestDistance = Number.POSITIVE_INFINITY;
      let closestOffsetRatio = 0;

      surface.querySelectorAll<HTMLElement>("[data-page-number]").forEach((node) => {
        const page = Number(node.dataset.pageNumber);
        const bounds = node.getBoundingClientRect();
        const distance = Math.abs(bounds.top - viewportTop);
        if (Number.isFinite(page) && distance < closestDistance) {
          closestDistance = distance;
          closestPage = page;
          closestOffsetRatio = Math.max(0, Math.min(1, (viewportTop - bounds.top) / Math.max(1, bounds.height)));
        }
      });

      scrollAnchorRef.current = { offsetRatio: closestOffsetRatio, page: closestPage };
      onPageChange(closestPage, { offsetRatio: closestOffsetRatio, scroll: false });
    });
  };

  if (error) {
    return (
      <section className="pdf-surface pdf-empty-state">
        <FileText size={28} aria-hidden="true" />
        <span>{error}</span>
      </section>
    );
  }

  if (!file || !pdf) {
    return (
      <section className="pdf-surface pdf-empty-state">
        <Loader2 className="spin" size={28} aria-hidden="true" />
      </section>
    );
  }

  const renderPages = () => {
    const totalPages = pageCount || pdf.numPages;
    if (pdfPageLayout === "double") {
      const rows: [number, number | null][] = [];
      for (let i = 0; i < totalPages; i += 2) {
        rows.push([i + 1, i + 2 <= totalPages ? i + 2 : null]);
      }
      return rows.map(([page1, page2], rowIndex) => (
        <div key={rowIndex} className="pdf-page-spread">
          <PdfPageCanvas
            active={currentPage === page1}
            metrics={pageMetrics[page1 - 1]}
            pageNumber={page1}
            paragraphs={paragraphs}
            pageScale={pdfPageScale}
            pdf={pdf}
            rootRef={surfaceRef}
            sideImage={renderPageImage?.(page1)}
            speechHighlight={speechHighlight}
            viewportSize={surfaceSize}
            onPageRendered={handlePageRendered}
            onWordClick={onWordClick}
          />
          {page2 && (
            <PdfPageCanvas
              active={currentPage === page2}
              metrics={pageMetrics[page2 - 1]}
              pageNumber={page2}
              paragraphs={paragraphs}
              pageScale={pdfPageScale}
              pdf={pdf}
              rootRef={surfaceRef}
              sideImage={renderPageImage?.(page2)}
              speechHighlight={speechHighlight}
              viewportSize={surfaceSize}
              onPageRendered={handlePageRendered}
              onWordClick={onWordClick}
            />
          )}
        </div>
      ));
    } else {
      return Array.from({ length: totalPages }, (_, index) => (
        <PdfPageCanvas
          active={currentPage === index + 1}
          key={index + 1}
          metrics={pageMetrics[index]}
          pageNumber={index + 1}
          paragraphs={paragraphs}
          pageScale={pdfPageScale}
          pdf={pdf}
          rootRef={surfaceRef}
          sideImage={renderPageImage?.(index + 1)}
          speechHighlight={speechHighlight}
          viewportSize={surfaceSize}
          onPageRendered={handlePageRendered}
          onWordClick={onWordClick}
        />
      ));
    }
  };

  return (
    <section
      className={[
        "pdf-surface",
        isPdfResizing ? "pdf-surface-resizing" : "",
        isInitialPdfVisible ? "pdf-surface-initial-ready" : "pdf-surface-initial-loading"
      ].filter(Boolean).join(" ")}
      onScroll={handleScroll}
      ref={surfaceRef}
      aria-busy={isPdfResizing}
      aria-label="PDF pages"
    >
      {renderPages()}
      {isPdfResizing && <div className="pdf-resize-veil" aria-hidden="true" />}
    </section>
  );
}

const renderReaderText = (
  paragraph: ReaderParagraph,
  shouldRenderWords: boolean,
  speechHighlight: SpeechHighlight | null
) => {
  if (paragraph.kind === "image") return null;
  if (!shouldRenderWords) return paragraph.text;

  const ranges = wordRangesFromText(paragraph.text);
  if (ranges.length === 0) {
    return paragraph.text;
  }
  const isSpoken = speechHighlight?.paragraphId === paragraph.id;
  const leading = paragraph.text.slice(0, ranges[0].start);

  const words = ranges.map((range, i) => {
    const word = paragraph.text.slice(range.start, range.end);
    const gap = paragraph.text.slice(range.end, ranges[i + 1]?.start);
    const active = isSpoken && speechHighlight && speechHighlight.start === range.start && speechHighlight.end === range.end;

    return (
      <Fragment key={range.start}>
        <span
          className={active ? "reader-word spoken-word" : "reader-word"}
          data-word-start={range.start}
          data-word-end={range.end}
        >
          {word}
        </span>
        {gap}
      </Fragment>
    );
  });

  return (
    <>
      {leading}
      {words}
    </>
  );
};

type TextReaderParagraphBlockProps = {
  currentIndex: number;
  index: number;
  insertionChunks?: ReaderImageChunk[];
  paragraph: ReaderParagraph;
  previousParagraph?: ReaderParagraph;
  readerActionsRef: RefObject<TextReaderActions>;
  readerImageMode: boolean;
  renderGeneratedReaderImage: (chunk: ReaderImageChunk) => ReactNode;
  setParagraphRef: (id: string) => (node: HTMLElement | null) => void;
  speechHighlight: SpeechHighlight | null;
};

const paragraphSpeechKey = (speechHighlight: SpeechHighlight | null, paragraphId: string) =>
  speechHighlight?.paragraphId === paragraphId ? `${speechHighlight.start}:${speechHighlight.end}` : "";

type TextReaderActions = {
  moveTo: (index: number) => void;
  paragraphClick: (event: MouseEvent<HTMLElement>, paragraph: ReaderParagraph, index: number) => void;
  scroll: () => void;
};

const TextReaderParagraphBlock = memo(function TextReaderParagraphBlock({
  currentIndex,
  index,
  insertionChunks,
  paragraph,
  previousParagraph,
  readerActionsRef,
  readerImageMode,
  renderGeneratedReaderImage,
  setParagraphRef,
  speechHighlight
}: TextReaderParagraphBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const showChapterHeading = index === 0 || paragraph.chapterIndex !== previousParagraph?.chapterIndex;
  const isChapterHeading =
    showChapterHeading &&
    paragraph.kind === "heading" &&
    paragraph.text.trim().toLowerCase() === paragraph.chapterTitle.trim().toLowerCase();
  const isActive = index === currentIndex;
  const isSpeaking = speechHighlight?.paragraphId === paragraph.id;
  const shouldRenderWords = isActive || isSpeaking || isHovered;
  const text = renderReaderText(paragraph, shouldRenderWords, speechHighlight);

  const handlePointerEnter = () => setIsHovered(true);
  const handlePointerLeave = () => setIsHovered(false);

  return (
    <div className="reader-block">
      {readerImageMode && insertionChunks?.map((chunk) => renderGeneratedReaderImage(chunk))}
      {showChapterHeading && !isChapterHeading && (
        <h2 className="reader-chapter-title">{paragraph.chapterTitle}</h2>
      )}
      {paragraph.kind === "image" && paragraph.image ? (
        <figure
          className={["reader-image", isActive ? "active" : ""].filter(Boolean).join(" ")}
          onClick={() => readerActionsRef.current.moveTo(index)}
          ref={setParagraphRef(paragraph.id)}
        >
          <img alt={paragraph.image.alt} src={paragraph.image.src} />
          {paragraph.image.alt && <figcaption>{paragraph.image.alt}</figcaption>}
        </figure>
      ) : isChapterHeading ? (
        <h2
          className={[
            "reader-chapter-title",
            isActive ? "reader-current-heading" : "",
            isSpeaking ? "speaking" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={(event) => readerActionsRef.current.paragraphClick(event, paragraph, index)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          ref={setParagraphRef(paragraph.id)}
        >
          {text}
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
          onClick={(event) => readerActionsRef.current.paragraphClick(event, paragraph, index)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          ref={setParagraphRef(paragraph.id)}
        >
          {text}
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
          onClick={(event) => readerActionsRef.current.paragraphClick(event, paragraph, index)}
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
          ref={setParagraphRef(paragraph.id)}
        >
          {text}
        </p>
      )}
    </div>
  );
}, (previous, next) => {
  const previousActive = previous.index === previous.currentIndex;
  const nextActive = next.index === next.currentIndex;

  return (
    previous.paragraph === next.paragraph &&
    previous.previousParagraph === next.previousParagraph &&
    previous.readerImageMode === next.readerImageMode &&
    previous.insertionChunks === next.insertionChunks &&
    previousActive === nextActive &&
    paragraphSpeechKey(previous.speechHighlight, previous.paragraph.id) ===
      paragraphSpeechKey(next.speechHighlight, next.paragraph.id)
  );
});

type TextReadingSurfaceProps = {
  book: ReaderBook;
  className?: string;
  currentIndex: number;
  readerActionsRef: RefObject<TextReaderActions>;
  readerFontMode: ReaderFontMode;
  readerImageInsertions: Map<number, ReaderImageChunk[]>;
  readerImageMode: boolean;
  readerLineHeight: number;
  readerLineWidth: number;
  readerTextScale: number;
  readingSurfaceRef: RefObject<HTMLElement | null>;
  renderGeneratedReaderImage: (chunk: ReaderImageChunk) => ReactNode;
  setParagraphRef: (id: string) => (node: HTMLElement | null) => void;
  speechHighlight: SpeechHighlight | null;
};

const TextReadingSurface = memo(function TextReadingSurface({
  book,
  className = "reading-surface",
  currentIndex,
  readerActionsRef,
  readerFontMode,
  readerImageInsertions,
  readerImageMode,
  readerLineHeight,
  readerLineWidth,
  readerTextScale,
  readingSurfaceRef,
  renderGeneratedReaderImage,
  setParagraphRef,
  speechHighlight
}: TextReadingSurfaceProps) {
  return (
    <section
      className={className}
      aria-live="polite"
      onScroll={() => readerActionsRef.current.scroll()}
      ref={readingSurfaceRef}
    >
      {book.paragraphs.length ? (
        <article
          className={`reader-copy reader-font-${readerFontMode}`}
          style={{
            "--reader-line-height": readerLineHeight,
            "--reader-line-width": `${readerLineWidth}em`,
            "--reader-text-scale": readerTextScale
          } as CSSProperties}
        >
          {book.paragraphs.map((paragraph, index) => (
            <TextReaderParagraphBlock
              currentIndex={currentIndex}
              index={index}
              insertionChunks={readerImageInsertions.get(index)}
              key={paragraph.id}
              paragraph={paragraph}
              previousParagraph={book.paragraphs[index - 1]}
              readerActionsRef={readerActionsRef}
              readerImageMode={readerImageMode}
              renderGeneratedReaderImage={renderGeneratedReaderImage}
              setParagraphRef={setParagraphRef}
              speechHighlight={speechHighlight}
            />
          ))}
        </article>
      ) : (
        <div className="pdf-text-empty">
          <FileText size={30} aria-hidden="true" />
          <span>No selectable text was found in this PDF.</span>
        </div>
      )}
    </section>
  );
}, (previous, next) => (
  previous.book === next.book &&
  previous.className === next.className &&
  previous.currentIndex === next.currentIndex &&
  previous.readerFontMode === next.readerFontMode &&
  previous.readerImageInsertions === next.readerImageInsertions &&
  previous.readerImageMode === next.readerImageMode &&
  previous.readerLineHeight === next.readerLineHeight &&
  previous.readerLineWidth === next.readerLineWidth &&
  previous.readerTextScale === next.readerTextScale &&
  previous.speechHighlight === next.speechHighlight
));

class DashboardErrorBoundary extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : "The dashboard could not be displayed." };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="dashboard-shell auth-dashboard-shell">
          <section className="dashboard-auth-panel">
            <div className="dashboard-mark blocked">
              <X size={24} aria-hidden="true" />
            </div>
            <h1>Dashboard error</h1>
            <p>{this.state.error}</p>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

// Helper components for inline SVGs:
const YouTubeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.508a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.508 9.388.508 9.388.508s7.517 0 9.388-.508a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);

const InstagramIcon = () => (
  <svg className="instagram-glyph" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
  </svg>
);

const TikTokIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M17.2 2c.32 2.55 1.76 4.08 4.28 4.24v3.1a7.17 7.17 0 0 1-4.18-1.28v6.1c0 5.1-5.54 7.35-9.48 4.45-4.12-3.03-2.54-9.66 2.64-10.3.74-.09 1.48-.04 2.2.14v3.24a3.6 3.6 0 0 0-2.04-.21 2.8 2.8 0 1 0 3.32 2.75V2h3.26Z" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 4 }}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#16a34a' }}>
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const KeyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: '#64748b' }}>
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15"></polyline>
  </svg>
);

const InfoIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="12" y1="16" x2="12" y2="12"></line>
    <line x1="12" y1="8" x2="12.01" y2="8"></line>
  </svg>
);

type ServiceConnectionStatus = "disconnected" | "connected" | "simulated";
type YouTubeVideoPreview = {
  comments?: number | string;
  duration: string;
  id: string;
  imageUrl: string;
  likes?: number | string;
  publishedAt?: string;
  published: string;
  title: string;
  views: string | number;
};
type YouTubeAnalyticsSummary = {
  averageViewDuration: number;
  averageViewPercentage: number;
  engagedViews?: number;
  estimatedMinutesWatched: number;
  subscribersGained: number;
  subscribersLost: number;
  views: number;
};
type YouTubeWeeklyViews = {
  endDate: string;
  startDate: string;
  views: number;
  engagedViews?: number;
};
type YouTubeAnalyticsRange = {
  availableEndDate?: string;
  endDate?: string;
  startDate?: string;
};
type YouTubeTopVideoAnalytics = {
  averageViewDuration: number;
  averageViewPercentage: number;
  engagedViews: number;
  estimatedMinutesWatched: number;
  impressions: number | null;
  impressionsClickThroughRate: number | null;
  subscribersGained: number;
  subscribersLost: number;
  video: string;
  views: number;
};
type InstagramPostPreview = {
  averageWatchTime?: number;
  caption: string;
  comments?: number;
  durationSeconds?: number;
  follows?: number;
  id: string;
  imageUrl: string;
  likes?: number;
  mediaUrl?: string;
  mediaProductType?: string;
  mediaType?: string;
  permalink?: string;
  profileActivity?: number;
  profileVisits?: number;
  views?: number;
  publishedAt?: string;
  reach?: number;
  saved?: number;
  shares?: number;
  skipRate?: number;
  totalInteractions?: number;
  totalViewTime?: number;
};
type TikTokVideoPreview = {
  comments?: number;
  duration: string;
  durationSeconds?: number;
  embedUrl?: string;
  id: string;
  imageUrl: string;
  likes?: number;
  published: string;
  publishedAt?: string;
  shares?: number;
  title: string;
  url?: string;
  views: number;
};
type DashboardVideoPlayer = {
  duration?: string;
  embedUrl?: string;
  imageUrl?: string;
  platform: "youtube" | "instagram" | "tiktok";
  title: string;
  url?: string;
};

const WEEKLY_DASHBOARD_START_DATE = "2026-05-18";
type DashboardTab = "users" | "weekly_views" | "content" | "instagram" | "tiktok";
type SortDirection = "asc" | "desc";

const parseViewCount = (views: string | number | null | undefined): number => {
  if (typeof views === "number") return Number.isFinite(views) ? views : 0;
  if (!views) return 0;

  const cleaned = views
    .toLowerCase()
    .replace(/\bviews?\b/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return 0;

  const multiplier = cleaned.endsWith("k")
    ? 1_000
    : cleaned.endsWith("m")
      ? 1_000_000
      : 1;
  const numericText = multiplier === 1 ? cleaned : cleaned.slice(0, -1);
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : 0;
};

function VideoPlayerModal({ player, onClose }: { player: DashboardVideoPlayer; onClose: () => void }) {
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const iframeTitle = `${player.title} video player`;
  const canEmbed = Boolean(player.embedUrl);
  const canPlayDirect = player.platform === "instagram" && Boolean(player.url);

  return (
    <div className="video-player-backdrop" onClick={onClose} role="presentation">
      <div className="video-player-dialog" aria-modal="true" role="dialog" aria-label={iframeTitle} onClick={(event) => event.stopPropagation()}>
        <div className="video-player-header">
          <div>
            <span className={`video-player-platform ${player.platform}`}>{player.platform}</span>
            <h3>{player.title}</h3>
          </div>
          <button className="video-player-close" onClick={onClose} type="button" aria-label="Close video player">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="video-player-frame">
          {canEmbed ? (
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              src={player.embedUrl}
              title={iframeTitle}
            />
          ) : canPlayDirect ? (
            <video controls autoPlay playsInline poster={player.imageUrl} src={player.url} />
          ) : (
            <div className="video-player-fallback">
              {player.imageUrl && <img src={player.imageUrl} alt="" />}
              <p>This platform did not provide an embeddable video URL.</p>
              {player.url && (
                <a href={player.url} target="_blank" rel="noreferrer">
                  Open video
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const parseAnalyticsCount = (value: string | number | null | undefined): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (!value) return 0;

  const cleaned = value
    .toLowerCase()
    .replace(/\b(?:likes?|views?)\b/g, "")
    .replace(/,/g, "")
    .trim();
  if (!cleaned) return 0;

  const multiplier = cleaned.endsWith("k")
    ? 1_000
    : cleaned.endsWith("m")
      ? 1_000_000
      : 1;
  const numericText = multiplier === 1 ? cleaned : cleaned.slice(0, -1);
  const parsed = Number(numericText);
  return Number.isFinite(parsed) ? Math.round(parsed * multiplier) : 0;
};

const formatExactViewCount = (views: string | number | null | undefined) => {
  const count = parseViewCount(views);
  if (count <= 0) return "No views";
  return `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(count)} views`;
};

const formatExactCount = (value: string | number | null | undefined) => {
  const count = typeof value === "number" ? value : parseAnalyticsCount(value);
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(Math.round(Number(count) || 0));
};

type YouTubePerformanceSortKey =
  | "duration"
  | "publishedAt"
  | "title"
  | "averageViewPercentage"
  | "stayedToWatch"
  | "views"
  | "watchHours"
  | "impressions"
  | "impressionsClickThroughRate";
type CombinedPerformanceSortKey =
  | "duration"
  | "publishedAt"
  | "title"
  | "performanceScore"
  | "totalViews"
  | "ytViews"
  | "igViews"
  | "ttViews"
  | "likedPercentage"
  | "ytLikes"
  | "igLikes"
  | "ttLikes"
  | "averageViewPercentage"
  | "ytAverageViewPercentage"
  | "igAverageViewPercentage"
  | "stayedToWatch"
  | "ytStayedToWatch"
  | "igStayedToWatch";

const clampScoreMetric = (value: number) => Math.max(0, Math.min(value, 100));

const percentileScore = (values: number[], value: number | null | undefined) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  if (sorted.length === 1) return 100;

  const below = sorted.filter((item) => item < value).length;
  const equal = sorted.filter((item) => item === value).length;
  return ((below + equal / 2) / sorted.length) * 100;
};

const calculateVideoPerformanceScore = (values: {
  averageViewPercentiles: number[];
  likedPercentiles: number[];
  likedPercentage: number | null;
  stayedPercentiles: number[];
  averageViewPercentage: number | null;
  stayedToWatch: number | null;
  totalViews: number;
  viewPercentiles: number[];
}) => {
  if (values.totalViews <= 0) return null;

  const metrics = [
    {
      score: percentileScore(values.viewPercentiles, Math.log1p(values.totalViews)),
      weight: 0.55
    },
    {
      score: percentileScore(values.likedPercentiles, values.likedPercentage),
      weight: 0.2
    },
    {
      score: percentileScore(values.averageViewPercentiles, values.averageViewPercentage),
      weight: 0.15
    },
    {
      score: percentileScore(values.stayedPercentiles, values.stayedToWatch),
      weight: 0.1
    }
  ].filter((metric): metric is { score: number; weight: number } => metric.score !== null);
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);

  return totalWeight > 0
    ? Math.round(clampScoreMetric(metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0) / totalWeight))
    : null;
};

const videoPerformanceLabel = (score: number | null, rank: number, total: number) => {
  if (score === null) return "Not enough data";
  const topQuartileCutoff = Math.max(1, Math.ceil(total * 0.25));
  if (rank === 1) return "Best performer";
  if (rank <= topQuartileCutoff || score >= 75) return "Doing well";
  if (score >= 50) return "Middle pack";
  return "Needs attention";
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });

const compareNullableNumber = (left: number | null | undefined, right: number | null | undefined) => {
  const leftMissing = left === null || left === undefined || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || Number.isNaN(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return left - right;
};

const compareNullableNumberForSort = (
  left: number | null | undefined,
  right: number | null | undefined,
  direction: SortDirection
) => {
  const leftMissing = left === null || left === undefined || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || Number.isNaN(right);
  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;
  return (left - right) * numericSortDirectionFor(direction);
};

const timestampFromDate = (value?: string) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

const durationToSeconds = (duration?: string) => {
  if (!duration) return null;
  const parts = duration.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
};

const chunks = <T,>(items: T[], size: number) => {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
};

const numericSortDirectionFor = (direction: SortDirection) => (direction === "asc" ? 1 : -1);

const YOUTUBE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly"
];
const YOUTUBE_OAUTH_SCOPE = YOUTUBE_OAUTH_SCOPES.join(" ");
const LEGACY_YOUTUBE_CLIENT_ID = "1013878176385-hhhdtg9kim3g6gencok1ka058osc25q1.apps.googleusercontent.com";
const YOUTUBE_DEFAULT_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ??
  "1013878176385-hhhdtg9kim3g6gencok1ka058osc25q1.apps.googleusercontent.com";
const TIKTOK_OAUTH_SCOPE = "user.info.basic,video.list";
const TIKTOK_DEFAULT_CLIENT_KEY =
  (import.meta.env.VITE_TIKTOK_CLIENT_KEY as string | undefined) ??
  "sbawrw36ejuxde41rf";
const INSTAGRAM_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement"
];
const INSTAGRAM_OAUTH_SCOPE = INSTAGRAM_OAUTH_SCOPES.join(",");
const INSTAGRAM_DEFAULT_APP_ID = (import.meta.env.VITE_INSTAGRAM_APP_ID as string | undefined) ?? "";
const INSTAGRAM_LOGIN_CONFIGURATION_ID = "1662166615913905";
const validMetaAppId = (value: string | null | undefined) => Boolean(value && /^\d{5,}$/.test(value.trim()));
const storedInstagramAppId = () => {
  const stored = localStorage.getItem("reader-ig-app-id");
  return validMetaAppId(stored) ? stored!.trim() : INSTAGRAM_DEFAULT_APP_ID;
};

const storedYouTubeAccessToken = () =>
  localStorage.getItem("reader-yt-access-token") ??
  (localStorage.getItem("reader-yt-api-key")?.startsWith("AIzaSy") ? null : localStorage.getItem("reader-yt-api-key")) ??
  "";

const initialYouTubeStatus = (): ServiceConnectionStatus => {
  const savedStatus = localStorage.getItem("reader-yt-status") as ServiceConnectionStatus | null;
  if (savedStatus === "simulated") return "simulated";
  if (storedYouTubeAccessToken()) return "connected";
  return "connected";
};

function ContentIntegrationsSection({ refreshSignal }: { refreshSignal: number }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [youtubeGuideOpen, setYoutubeGuideOpen] = useState(false);
  const [instagramGuideOpen, setInstagramGuideOpen] = useState(false);
  const [youtubeAnalytics, setYoutubeAnalytics] = useState<YouTubeAnalyticsSummary | null>(null);
  const [youtubeAnalyticsRange, setYoutubeAnalyticsRange] = useState<YouTubeAnalyticsRange | null>(null);
  const [youtubeWeeklyViews, setYoutubeWeeklyViews] = useState<YouTubeWeeklyViews[]>([]);
  const [youtubeTopVideos, setYoutubeTopVideos] = useState<YouTubeTopVideoAnalytics[]>([]);
  const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideoPreview[]>([]);
  const [fetchError, setFetchError] = useState("");
  const [hoveredWeekIndex, setHoveredWeekIndex] = useState<number | null>(null);
  const [youtubePerformanceSort, setYoutubePerformanceSort] = useState<{
    direction: SortDirection;
    key: YouTubePerformanceSortKey;
  }>({ direction: "desc", key: "publishedAt" });

  // YouTube Credentials States
  const [ytAccessToken, setYtAccessToken] = useState(storedYouTubeAccessToken);
  const [ytChannel, setYtChannel] = useState(() => localStorage.getItem("reader-yt-channel") ?? "@ilumereader");
  const [ytClientId, setYtClientId] = useState(() => {
    const savedClientId = localStorage.getItem("reader-yt-client-id") ?? "";
    if (savedClientId && savedClientId !== LEGACY_YOUTUBE_CLIENT_ID) return savedClientId;
    return YOUTUBE_DEFAULT_CLIENT_ID;
  });
  const [ytRedirectUri, setYtRedirectUri] = useState(() => localStorage.getItem("reader-yt-redirect-uri") ?? window.location.origin + "/auth/youtube/callback");
  const [ytStatus, setYtStatus] = useState<ServiceConnectionStatus>(initialYouTubeStatus);

  // Instagram Credentials States
  const [igAppId, setIgAppId] = useState("");
  const [igAppSecret, setIgAppSecret] = useState("");
  const [igAccessToken, setIgAccessToken] = useState("");
  const [igRedirectUri, setIgRedirectUri] = useState(() => localStorage.getItem("reader-ig-redirect-uri") ?? window.location.origin + "/auth/instagram/callback");
  const [igStatus, setIgStatus] = useState<ServiceConnectionStatus>(() => {
    const stored = localStorage.getItem("reader-ig-status") as ServiceConnectionStatus;
    if (stored && stored !== "simulated") return stored;
    if (import.meta.env.VITE_INSTAGRAM_ACCESS_TOKEN) return "connected";
    return "disconnected";
  });

  // Simulated OAuth Modal States
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalType, setAuthModalType] = useState<"youtube" | "instagram">("youtube");
  const [authModalStep, setAuthModalStep] = useState(0);

  // Simulated Content Feed States
  const [activeFeedTab, setActiveFeedTab] = useState<"youtube" | "weekly" | "instagram">("youtube");
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedFetched, setFeedFetched] = useState(false);
  const [videoPlayer, setVideoPlayer] = useState<DashboardVideoPlayer | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatAnalyticsNumber = (value: number) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value || 0);

  const formatDurationSeconds = (value: number) => {
    const seconds = Math.round(value || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  const formatPublishDate = (value?: string) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  };

  function formatShortDate(value: string) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  }

  const formatAnalyticsPercent = (value: number) =>
    `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value || 0)}%`;

  const formatOptionalAnalyticsNumber = (value: number | null) =>
    value === null ? "-" : formatAnalyticsNumber(value);

  const formatOptionalAnalyticsPercent = (value: number | null) =>
    value === null ? "-" : formatAnalyticsPercent(value);

  const formatViews = useCallback(formatExactViewCount, []);

  const videoDetailsById = useMemo(
    () => new Map(youtubeVideos.map((video) => [video.id, video])),
    [youtubeVideos]
  );

  const youtubeAnalyticsRows = useMemo(() => {
    const totalViews = youtubeAnalytics?.views ?? 0;
    const totalWatchMinutes = youtubeAnalytics?.estimatedMinutesWatched ?? 0;
    const totalSubscribers = youtubeAnalytics
      ? youtubeAnalytics.subscribersGained - youtubeAnalytics.subscribersLost
      : 0;

    const analyticsByVideoId = new Map(youtubeTopVideos.map((row) => [row.video, row]));
    const rows = youtubeVideos.length
      ? youtubeVideos.map((video) => analyticsByVideoId.get(video.id) ?? {
        averageViewDuration: 0,
        averageViewPercentage: 0,
        engagedViews: 0,
        estimatedMinutesWatched: 0,
        impressions: null,
        impressionsClickThroughRate: null,
        subscribersGained: 0,
        subscribersLost: 0,
        video: video.id,
        views: parseViewCount(video.views)
      })
      : youtubeTopVideos;

    return rows.map((row, index) => {
      const details = videoDetailsById.get(row.video);
      const netSubscribers = Number(row.subscribersGained ?? 0) - Number(row.subscribersLost ?? 0);

      return {
        averageViewPercentage: Number(row.averageViewPercentage ?? 0),
        color: ["#3b82f6", "#84cc16", "#eab308", "#a855f7", "#f43f5e"][index % 5],
        duration: details?.duration ?? formatDurationSeconds(Number(row.averageViewDuration ?? 0)),
        id: row.video,
        imageUrl: details?.imageUrl ?? "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=600",
        impressions: row.impressions === null ? null : Number(row.impressions ?? 0),
        impressionsClickThroughRate: row.impressionsClickThroughRate === null ? null : Number(row.impressionsClickThroughRate ?? 0),
        publishedAt: details?.publishedAt,
        stayedToWatch: Number(row.views ?? 0) ? (Number(row.engagedViews ?? 0) / Number(row.views ?? 0)) * 100 : 0,
        subscribers: netSubscribers,
        subscriberShare: totalSubscribers ? (netSubscribers / totalSubscribers) * 100 : 0,
        title: details?.title ?? row.video,
        views: Number(row.views ?? 0),
        viewsShare: totalViews ? (Number(row.views ?? 0) / totalViews) * 100 : 0,
        watchHours: Number(row.estimatedMinutesWatched ?? 0) / 60,
        watchTimeShare: totalWatchMinutes ? (Number(row.estimatedMinutesWatched ?? 0) / totalWatchMinutes) * 100 : 0
      };
    });
  }, [formatDurationSeconds, videoDetailsById, youtubeAnalytics, youtubeTopVideos, youtubeVideos]);

  const sortedYoutubeAnalyticsRows = useMemo(() => {
    if (!youtubePerformanceSort) return youtubeAnalyticsRows;

    const { direction, key } = youtubePerformanceSort;
    const multiplier = numericSortDirectionFor(direction);

    return [...youtubeAnalyticsRows].sort((left, right) => {
      let result = 0;

      if (key === "title") {
        result = compareText(left.title, right.title);
      } else if (key === "duration") {
        result = compareNullableNumber(durationToSeconds(left.duration), durationToSeconds(right.duration));
      } else if (key === "publishedAt") {
        result = compareNullableNumber(timestampFromDate(left.publishedAt), timestampFromDate(right.publishedAt));
      } else {
        result = compareNullableNumber(left[key], right[key]);
      }

      return result === 0 ? compareText(left.title, right.title) : result * multiplier;
    });
  }, [youtubeAnalyticsRows, youtubePerformanceSort]);

  const toggleYoutubePerformanceSort = (key: YouTubePerformanceSortKey) => {
    setYoutubePerformanceSort((current) => {
      const defaultDirection: SortDirection = key === "title" || key === "duration" || key === "publishedAt" ? "asc" : "desc";
      if (!current || current.key !== key) return { key, direction: defaultDirection };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  };

  const youtubeSortButton = (key: YouTubePerformanceSortKey, label: string) => {
    const active = youtubePerformanceSort?.key === key;
    const direction = active ? youtubePerformanceSort.direction : undefined;

    return (
      <button
        aria-label={`Sort by ${label}${active ? ` ${direction === "asc" ? "descending" : "ascending"}` : ""}`}
        aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
        className={`table-sort-button ${active ? "active" : ""}`}
        onClick={() => toggleYoutubePerformanceSort(key)}
        type="button"
      >
        <span>{label}</span>
        <span className="table-sort-indicator" aria-hidden="true">
          {active ? (direction === "asc" ? <ChevronUpIcon /> : <ChevronDownIcon />) : <span className="table-sort-placeholder" />}
        </span>
      </button>
    );
  };

  const youtubeAnalyticsTotals = useMemo(() => {
    const rows = youtubeAnalyticsRows;
    const impressionRows = rows.filter((row) => row.impressions !== null && row.impressionsClickThroughRate !== null);
    const impressions = impressionRows.reduce((total, row) => total + (row.impressions ?? 0), 0);
    const weightedCtr = impressions
      ? impressionRows.reduce((total, row) => total + (row.impressionsClickThroughRate ?? 0) * (row.impressions ?? 0), 0) / impressions
      : null;

    return {
      averageViewPercentage: youtubeAnalytics?.averageViewPercentage ?? 0,
      impressions: impressionRows.length ? impressions : null,
      impressionsClickThroughRate: weightedCtr,
      stayedToWatch: youtubeAnalytics?.views ? (Number(youtubeAnalytics.engagedViews ?? 0) / youtubeAnalytics.views) * 100 : 0,
      subscribers: youtubeAnalytics ? youtubeAnalytics.subscribersGained - youtubeAnalytics.subscribersLost : 0,
      views: youtubeAnalytics?.views ?? 0,
      watchHours: (youtubeAnalytics?.estimatedMinutesWatched ?? 0) / 60
    };
  }, [youtubeAnalytics, youtubeAnalyticsRows]);

  const weeklyViewsTotal = useMemo(
    () => youtubeWeeklyViews.reduce((total, week) => total + Number(week.views ?? 0), 0),
    [youtubeWeeklyViews]
  );

  const getLinkedIgViewsForWeek = useCallback((startDateStr: string, endDateStr: string): number => {
    try {
      const cachedIgPostsRaw = localStorage.getItem("reader-ig-posts-cache");
      const igPosts: InstagramPostPreview[] = cachedIgPostsRaw ? JSON.parse(cachedIgPostsRaw) : [];
      const links: Record<string, string> = JSON.parse(localStorage.getItem("reader-ig-yt-links") || "{}");

      if (!igPosts.length) return 0;

      const start = new Date(startDateStr);
      const end = new Date(endDateStr);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);

      return igPosts
        .filter((post) => {
          if (!post.publishedAt || !links[post.id]) return false;
          const pubDate = new Date(post.publishedAt);
          pubDate.setHours(0, 0, 0, 0);
          return pubDate >= start && pubDate <= end;
        })
        .reduce((sum, post) => sum + (post.views ?? 0), 0);
    } catch (e) {
      console.error("Error aggregating Instagram views:", e);
      return 0;
    }
  }, []);

  const weeklyIgViewsTotal = useMemo(() => {
    return youtubeWeeklyViews.reduce((total, week) => total + getLinkedIgViewsForWeek(week.startDate, week.endDate), 0);
  }, [youtubeWeeklyViews, getLinkedIgViewsForWeek]);

  const weeklyViewsMax = useMemo(
    () => Math.max(...youtubeWeeklyViews.map((week) => Number(week.views ?? 0)), 0),
    [youtubeWeeklyViews]
  );

  const handleYtOAuth = () => {
    const clientId = ytClientId.trim();
    const redirectUri = ytRedirectUri.trim();

    if (!clientId) {
      alert("Please configure a Client ID first!");
      return;
    }

    localStorage.setItem("reader-yt-channel", ytChannel.trim() || "@ilumereader");
    localStorage.setItem("reader-yt-client-id", clientId);
    localStorage.setItem("reader-yt-redirect-uri", redirectUri);
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(YOUTUBE_OAUTH_SCOPE)}&access_type=offline&prompt=consent`;
    window.location.href = authUrl;
  };

  const handleSaveYtCreds = () => {
    localStorage.setItem("reader-yt-channel", ytChannel.trim());
    localStorage.setItem("reader-yt-client-id", ytClientId.trim());
    localStorage.setItem("reader-yt-redirect-uri", ytRedirectUri.trim());
    localStorage.removeItem("reader-yt-api-key");
    if (ytChannel.trim() || ytAccessToken) {
      setYtStatus("connected");
      localStorage.setItem("reader-yt-status", "connected");
    } else {
      setYtStatus("disconnected");
      localStorage.setItem("reader-yt-status", "disconnected");
    }
  };

  const handleSaveIgCreds = () => {
    localStorage.setItem("reader-ig-app-id", igAppId);
    localStorage.setItem("reader-ig-app-secret", igAppSecret);
    localStorage.setItem("reader-ig-access-token", igAccessToken);
    localStorage.setItem("reader-ig-redirect-uri", igRedirectUri);
    if (igAccessToken || (igAppId && igAppSecret)) {
      setIgStatus("connected");
      localStorage.setItem("reader-ig-status", "connected");
    } else {
      setIgStatus("disconnected");
      localStorage.setItem("reader-ig-status", "disconnected");
    }
  };

  const handleSimulateConnection = (type: "youtube") => {
    setAuthModalType(type);
    setAuthModalStep(0);
    setAuthModalOpen(true);

    const stepIntervals = [1200, 2400, 3600, 4800];
    stepIntervals.forEach((time, index) => {
      setTimeout(() => {
        setAuthModalStep(index + 1);
        if (index === 3) {
          setYtStatus("simulated");
          localStorage.setItem("reader-yt-status", "simulated");
          setYtChannel("@youtube");
          setYtAccessToken("");
          setYtClientId(YOUTUBE_DEFAULT_CLIENT_ID || LEGACY_YOUTUBE_CLIENT_ID);
          localStorage.setItem("reader-yt-channel", "@youtube");
          localStorage.setItem("reader-yt-client-id", YOUTUBE_DEFAULT_CLIENT_ID || LEGACY_YOUTUBE_CLIENT_ID);
          localStorage.removeItem("reader-yt-api-key");
          localStorage.removeItem("reader-yt-access-token");
        }
      }, time);
    });
  };

  const handleDisconnect = (type: "youtube" | "instagram") => {
    if (type === "youtube") {
      setYtStatus("disconnected");
      localStorage.setItem("reader-yt-status", "disconnected");
      setYtChannel("");
      setYtAccessToken("");
      localStorage.removeItem("reader-yt-api-key");
      localStorage.removeItem("reader-yt-channel");
      localStorage.removeItem("reader-yt-access-token");
      localStorage.removeItem("reader-yt-refresh-token");
    } else {
      setIgStatus("disconnected");
      localStorage.setItem("reader-ig-status", "disconnected");
      setIgAppId("");
      setIgAppSecret("");
      setIgAccessToken("");
      localStorage.removeItem("reader-ig-app-id");
      localStorage.removeItem("reader-ig-app-secret");
      localStorage.removeItem("reader-ig-access-token");
    }
    setFeedFetched(false);
  };

  const handleFetchFeed = async () => {
    setFeedLoading(true);
    setFetchError("");

    const parseISO8601Duration = (duration: string) => {
      if (!duration) return "10:00";
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!match) return "10:00";
      const hours = parseInt(match[1] ?? "0", 10);
      const minutes = parseInt(match[2] ?? "0", 10);
      const seconds = parseInt(match[3] ?? "0", 10);

      if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      }
      return `${minutes}:${String(seconds).padStart(2, "0")}`;
    };



    const formatTimeAgo = (dateStr: string) => {
      if (!dateStr) return "";
      const date = new Date(dateStr);
      const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

      let interval = Math.floor(seconds / 31536000);
      if (interval >= 1) return `${interval} year${interval > 1 ? "s" : ""} ago`;

      interval = Math.floor(seconds / 2592000);
      if (interval >= 1) return `${interval} month${interval > 1 ? "s" : ""} ago`;

      interval = Math.floor(seconds / 604800);
      if (interval >= 1) return `${interval} week${interval > 1 ? "s" : ""} ago`;

      interval = Math.floor(seconds / 86400);
      if (interval >= 1) return `${interval} day${interval > 1 ? "s" : ""} ago`;

      interval = Math.floor(seconds / 3600);
      if (interval >= 1) return `${interval} hour${interval > 1 ? "s" : ""} ago`;

      interval = Math.floor(seconds / 60);
      if (interval >= 1) return `${interval} minute${interval > 1 ? "s" : ""} ago`;

      return "just now";
    };

    if (activeFeedTab === "youtube" || activeFeedTab === "weekly") {
      if (ytStatus === "simulated") {
        setTimeout(() => {
          setYoutubeVideos(youtubeMockVideos);
          setYoutubeAnalytics({
            views: 124500,
            estimatedMinutesWatched: 864500,
            averageViewDuration: 418,
            averageViewPercentage: 54.5,
            engagedViews: 82000,
            subscribersGained: 1420,
            subscribersLost: 85,
          });
          setYoutubeWeeklyViews([
            { startDate: "2026-04-20", endDate: "2026-04-26", views: 24500 },
            { startDate: "2026-04-27", endDate: "2026-05-03", views: 28900 },
            { startDate: "2026-05-04", endDate: "2026-05-10", views: 18400 },
            { startDate: "2026-05-11", endDate: "2026-05-17", views: 32400 },
            { startDate: "2026-05-18", endDate: "2026-05-24", views: 38200 },
            { startDate: "2026-05-25", endDate: "2026-05-31", views: 42100 },
          ]);
          setYoutubeTopVideos([
            {
              video: "yt-4",
              views: 42100,
              estimatedMinutesWatched: 210000,
              averageViewDuration: 300,
              averageViewPercentage: 52,
              subscribersGained: 280,
              subscribersLost: 15,
              engagedViews: 22000,
              impressions: 480000,
              impressionsClickThroughRate: 5.8
            },
            {
              video: "yt-3",
              views: 38200,
              estimatedMinutesWatched: 174000,
              averageViewDuration: 270,
              averageViewPercentage: 58,
              subscribersGained: 210,
              subscribersLost: 10,
              engagedViews: 19000,
              impressions: 390000,
              impressionsClickThroughRate: 6.2
            },
            {
              video: "yt-1",
              views: 32400,
              estimatedMinutesWatched: 144000,
              averageViewDuration: 266,
              averageViewPercentage: 48,
              subscribersGained: 180,
              subscribersLost: 8,
              engagedViews: 15000,
              impressions: 310000,
              impressionsClickThroughRate: 4.9
            }
          ]);
          setFeedLoading(false);
          setFeedFetched(true);
        }, 1500);
        return;
      }

      let token = ytAccessToken || storedYouTubeAccessToken();
      const isOAuth = Boolean(token);

      try {
        const loadYouTubeAnalytics = async (videosForAnalytics: YouTubeVideoPreview[] = youtubeVideos) => {
          try {
            const { data, error } = await supabase.functions.invoke("youtube-analytics", {
              body: {
                channel: ytChannel.trim() || "@ilumereader",
                videoIds: videosForAnalytics.map((video) => video.id).filter(Boolean)
              }
            });

            if (error) throw new Error(await edgeFunctionErrorMessage(error));
            setYoutubeAnalytics(data?.summary ?? null);
            setYoutubeAnalyticsRange(data?.range ?? null);
            setYoutubeWeeklyViews(data?.weeklyViews ?? []);
            setYoutubeTopVideos(data?.topVideos ?? []);
          } catch (error) {
            console.info("YouTube Analytics unavailable:", error);
            setYoutubeAnalytics(null);
            setYoutubeAnalyticsRange(null);
            setYoutubeWeeklyViews([]);
            setYoutubeTopVideos([]);
          }
        };

        if (!token) {
          const { data, error } = await supabase.functions.invoke("youtube-feed", {
            body: { channel: ytChannel.trim() || "@ilumereader" }
          });

          if (error) throw new Error(await edgeFunctionErrorMessage(error));

          setYoutubeVideos(data?.videos ?? []);
          setYtStatus("connected");
          localStorage.setItem("reader-yt-status", "connected");
          setFeedFetched(true);
          await loadYouTubeAnalytics(data?.videos ?? []);
          return;
        }

        const refreshYouTubeAccessToken = async () => {
          const refreshToken = localStorage.getItem("reader-yt-refresh-token");
          if (!refreshToken) return "";

          const { data, error } = await supabase.functions.invoke("youtube-token-exchange", {
            body: { clientId: ytClientId.trim() || YOUTUBE_DEFAULT_CLIENT_ID, refreshToken }
          });

          if (error) throw new Error(await edgeFunctionErrorMessage(error));
          if (!data?.access_token) throw new Error("Google did not return a refreshed YouTube access token.");

          localStorage.setItem("reader-yt-access-token", data.access_token);
          setYtAccessToken(data.access_token);
          return data.access_token as string;
        };

        // 1. Fetch channel's content uploads playlist ID
        // If OAuth, get the authenticated user's channel.
        // If simple key, fall back to search or list channel by a default/preset ID.
        const channelUrl = isOAuth
          ? "https://youtube.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true"
          : "";

        let channelRes = await fetch(channelUrl, {
          headers: isOAuth ? { Authorization: `Bearer ${token}` } : {}
        });

        if (isOAuth && channelRes.status === 401) {
          token = await refreshYouTubeAccessToken();
          channelRes = await fetch(channelUrl, {
            headers: { Authorization: `Bearer ${token}` }
          });
        }

        if (!channelRes.ok) {
          const errData = await channelRes.json().catch(() => ({}));
          throw new Error(errData.error?.message || "Failed to retrieve channel uploads profile. Check your API credentials.");
        }

        const channelData = await channelRes.json();
        const uploadsPlaylist = channelData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (!uploadsPlaylist) {
          throw new Error("No uploads playlist associated with this YouTube channel.");
        }

        // 2. Fetch every page in the channel uploads playlist
        const items: any[] = [];
        let pageToken = "";

        do {
          const playlistParams = new URLSearchParams({
            part: "snippet,contentDetails",
            playlistId: uploadsPlaylist,
            maxResults: "50"
          });
          if (pageToken) playlistParams.set("pageToken", pageToken);

          const playlistRes = await fetch(`https://youtube.googleapis.com/youtube/v3/playlistItems?${playlistParams.toString()}`, {
            headers: isOAuth ? { Authorization: `Bearer ${token}` } : {}
          });

          if (!playlistRes.ok) {
            throw new Error("Failed to fetch upload playlist items.");
          }

          const playlistData = await playlistRes.json();
          items.push(...(playlistData.items ?? []));
          pageToken = playlistData.nextPageToken ?? "";
        } while (pageToken);

        if (items.length === 0) {
          setYoutubeVideos([]);
          setFeedFetched(true);
          return;
        }

        // 3. Query video durations & view statistics
        const videoIds = items.map((item: any) => item.contentDetails?.videoId).filter(Boolean);
        const statsMap = new Map();

        for (const videoIdChunk of chunks(videoIds, 50)) {
          const videosUrl = `https://youtube.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIdChunk.join(",")}`;
          const videosRes = await fetch(videosUrl, {
            headers: isOAuth ? { Authorization: `Bearer ${token}` } : {}
          });

          if (videosRes.ok) {
            const videosData = await videosRes.json();
            (videosData.items ?? []).forEach((v: any) => {
              statsMap.set(v.id, {
                comments: v.statistics?.commentCount || "0",
                likes: v.statistics?.likeCount || "0",
                views: v.statistics?.viewCount || "0",
                duration: parseISO8601Duration(v.contentDetails?.duration)
              });
            });
          }
        }

        const parsedVideos = items.map((item: any) => {
          const vId = item.contentDetails?.videoId;
          const stats = statsMap.get(vId) ?? { comments: "0", likes: "0", views: "0", duration: "10:00" };
          return {
            comments: stats.comments,
            id: vId || item.id,
            title: item.snippet?.title ?? "Untitled Video",
            duration: stats.duration,
            likes: stats.likes,
            views: stats.views,
            publishedAt: item.snippet?.publishedAt ?? "",
            published: formatTimeAgo(item.snippet?.publishedAt),
            imageUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=600"
          };
        });

        setYoutubeVideos(parsedVideos);
        setFeedFetched(true);
        await loadYouTubeAnalytics(parsedVideos);
      } catch (err) {
        console.error("YouTube API retrieval failed:", err);
        setFetchError(err instanceof Error ? err.message : "Failed to load real YouTube uploads.");
      } finally {
        setFeedLoading(false);
      }
    } else {
      setFeedLoading(false);
      setFeedFetched(true);
    }
  };

  useEffect(() => {
    void handleFetchFeed();
  }, [refreshSignal]);

  useEffect(() => {
    if (youtubeVideos.length) {
      localStorage.setItem("reader-yt-videos-cache", JSON.stringify(youtubeVideos));
    } else if (ytStatus === "simulated") {
      localStorage.setItem("reader-yt-videos-cache", JSON.stringify(youtubeMockVideos));
    }
  }, [youtubeVideos, ytStatus]);

  useEffect(() => {
    const listToCache = youtubeWeeklyViews.length ? youtubeWeeklyViews : [
      { startDate: "2026-04-20", endDate: "2026-04-26", views: 24500 },
      { startDate: "2026-04-27", endDate: "2026-05-03", views: 28900 },
      { startDate: "2026-05-04", endDate: "2026-05-10", views: 18400 },
      { startDate: "2026-05-11", endDate: "2026-05-17", views: 32400 },
      { startDate: "2026-05-18", endDate: "2026-05-24", views: 38200 },
      { startDate: "2026-05-25", endDate: "2026-05-31", views: 42100 },
    ];
    localStorage.setItem("reader-yt-weekly-views-cache", JSON.stringify(listToCache));
  }, [youtubeWeeklyViews]);

  useEffect(() => {
    localStorage.setItem("reader-yt-analytics-range-cache", JSON.stringify(youtubeAnalyticsRange));
  }, [youtubeAnalyticsRange]);

  useEffect(() => {
    localStorage.setItem("reader-yt-analytics-cache", JSON.stringify(youtubeTopVideos));
  }, [youtubeTopVideos]);

  // Mock Data
  const youtubeMockVideos = [
    {
      id: "yt-1",
      title: "Building a modern PDF & ePub Reader with Supabase",
      duration: "14:22",
      likes: 820,
      comments: 64,
      views: 12400,
      publishedAt: "2026-05-25T10:00:00Z",
      published: "3 days ago",
      imageUrl: "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=600&auto=format&fit=crop&q=60"
    },
    {
      id: "yt-2",
      title: "How to deploy Supabase Edge Functions in 5 minutes",
      duration: "8:05",
      likes: 510,
      comments: 38,
      views: 8200,
      publishedAt: "2026-05-21T10:00:00Z",
      published: "1 week ago",
      imageUrl: "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=600&auto=format&fit=crop&q=60"
    },
    {
      id: "yt-3",
      title: "Aesthetic Web Design: HSL gradients & glassmorphism",
      duration: "22:40",
      likes: 1300,
      comments: 112,
      views: 24500,
      publishedAt: "2026-05-14T10:00:00Z",
      published: "2 weeks ago",
      imageUrl: "https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=600&auto=format&fit=crop&q=60"
    },
    {
      id: "yt-4",
      title: "Next.js 15 vs. Vanilla React: The complete performance audit",
      duration: "18:15",
      likes: 940,
      comments: 76,
      views: 15900,
      publishedAt: "2026-04-28T10:00:00Z",
      published: "1 month ago",
      imageUrl: "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=600&auto=format&fit=crop&q=60"
    }
  ];

  const displayedYouTubeVideos = youtubeVideos.length || ytStatus !== "simulated" ? youtubeVideos : youtubeMockVideos;

  return (
    <div className="content-integrations-section">


      {/* FEED TESTING / PREVIEW SECTION */}
      <div className="preview-feed-section">
        <div className="preview-feed-header">
          <div>
            <h2>Interactive Media Feed</h2>
            <p>Latest content is fetched automatically when this tab opens.</p>
          </div>
          {feedLoading && (
            <span className="feed-refresh-status">
              <Loader2 className="spin" size={16} aria-hidden="true" />
              Pulling API content...
            </span>
          )}
          {!youtubeAnalytics && ytStatus !== "disconnected" && (
            <button className="dashboard-secondary-button" onClick={handleYtOAuth} type="button" style={{ width: 'auto', margin: 0, padding: '0 16px' }}>
              Link Google
            </button>
          )}
        </div>

        {fetchError && (
          <div className="dashboard-error" style={{ margin: '0 0 18px 0' }}>
            <span>{fetchError}</span>
            {fetchError.toLowerCase().includes("link google") && (
              <button className="dashboard-secondary-button" onClick={handleYtOAuth} type="button" style={{ width: 'auto', marginLeft: 12, padding: '8px 12px' }}>
                Link Google
              </button>
            )}
          </div>
        )}

        {ytStatus === "disconnected" && igStatus === "disconnected" ? (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700 }}>No content source is connected.</span>
            <small style={{ color: '#64748b', marginTop: 4 }}>Connect an API credential server-side, then reopen this tab to pull the latest items.</small>
          </div>
        ) : !feedFetched ? (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700, color: '#1e293b' }}>Credentials Configured!</span>
            <small style={{ color: '#64748b', marginTop: 4 }}>Fetching starts automatically when the content tab opens.</small>
          </div>
        ) : (
          <>
            {/* 1. YouTube Uploads Grid */}
            {ytStatus !== "disconnected" && (
              <div className="uploads-grid-container" style={{ marginBottom: 28 }}>
                <div className="preview-feed-header" style={{ border: 'none', padding: 0, marginBottom: 16 }}>
                  <h3>YouTube Uploads ({displayedYouTubeVideos.length})</h3>
                </div>
                <div className="media-feed-grid">
                  {displayedYouTubeVideos.map((video) => (
                    <article className="youtube-video-card" key={video.id}>
                      <div className="video-thumbnail-container">
                        <button
                          className="video-thumbnail-button"
                          onClick={() => setVideoPlayer({
                            duration: video.duration,
                            embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(video.id)}?autoplay=1&rel=0`,
                            imageUrl: video.imageUrl,
                            platform: "youtube",
                            title: video.title,
                            url: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`
                          })}
                          type="button"
                          aria-label={`Play ${video.title}`}
                        >
                          <img src={video.imageUrl} alt="" />
                          <span className="video-thumbnail-play" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
                        </button>
                        <span className="video-duration">{video.duration}</span>
                      </div>
                      <div className="video-details">
                        <h4>{video.title}</h4>
                        <div className="video-stats">
                          <span>{formatViews(video.views)}</span>
                          <span>{video.published}</span>
                        </div>
                        <div className="video-engagement-stats">
                          <span>
                            <ThumbsUp size={13} aria-hidden="true" />
                            {formatExactCount(video.likes)}
                          </span>
                          <span>
                            <MessageCircle size={13} aria-hidden="true" />
                            {formatExactCount(video.comments)}
                          </span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}

            {/* 2. YouTube Analytics Performance */}
            {youtubeAnalytics && youtubeAnalyticsRows.length > 0 && (
              <div className="youtube-analytics-block" style={{ marginTop: 28 }}>
                <div className="preview-feed-header" style={{ border: 'none', padding: 0, marginBottom: 16 }}>
                  <h3>YouTube Analytics Performance</h3>
                </div>
                <div className="youtube-analytics-grid" style={{ marginBottom: 20 }}>
                  <article className="youtube-analytics-card">
                    <span>Views</span>
                    <strong>{formatAnalyticsNumber(youtubeAnalytics.views)}</strong>
                  </article>
                  <article className="youtube-analytics-card">
                    <span>Watch time</span>
                    <strong>{formatAnalyticsNumber(youtubeAnalytics.estimatedMinutesWatched)} min</strong>
                  </article>
                  <article className="youtube-analytics-card">
                    <span>Avg view duration</span>
                    <strong>{formatDurationSeconds(youtubeAnalytics.averageViewDuration)}</strong>
                  </article>
                  <article className="youtube-analytics-card">
                    <span>Avg viewed</span>
                    <strong>{formatAnalyticsNumber(youtubeAnalytics.averageViewPercentage)}%</strong>
                  </article>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* SIMULATED OAUTH MODAL BACKDROP */}
      {authModalOpen && (
        <div className="auth-modal-backdrop" onClick={() => setAuthModalOpen(false)}>
          <div className="auth-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>
              {authModalType === "youtube" ? "Connect Google & YouTube API" : "Connect Meta & Instagram API"}
            </h3>

            <div className="auth-modal-body">
              <p>Simulating standard OAuth 2.0 Web Authorization callback flow redirecting to secure Consent server...</p>

              <div className="oauth-simulation-steps">
                <div className={`simulation-step ${authModalStep >= 1 ? "completed" : "active"}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 1 ? <CheckIcon /> : <Loader2 className="spin" size={14} />}
                  </div>
                  <span>Contacting authorization authorization callback handlers...</span>
                </div>

                <div className={`simulation-step ${authModalStep >= 2 ? "completed" : authModalStep === 1 ? "active" : ""}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 2 ? <CheckIcon /> : authModalStep === 1 ? <Loader2 className="spin" size={14} /> : <KeyIcon />}
                  </div>
                  <span>
                    {authModalType === "youtube"
                      ? "Requesting scope: youtube.readonly..."
                      : "Requesting permissions: instagram_basic, instagram_manage_insights..."}
                  </span>
                </div>

                <div className={`simulation-step ${authModalStep >= 3 ? "completed" : authModalStep === 2 ? "active" : ""}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 3 ? <CheckIcon /> : authModalStep === 2 ? <Loader2 className="spin" size={14} /> : <KeyIcon />}
                  </div>
                  <span>Exchanging authorization code for long-lived OAuth token...</span>
                </div>

                <div className={`simulation-step ${authModalStep >= 4 ? "completed" : authModalStep === 3 ? "active" : ""}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 4 ? <CheckIcon /> : authModalStep === 3 ? <Loader2 className="spin" size={14} /> : <KeyIcon />}
                  </div>
                  <span>Validating connection credentials & loading sandbox data...</span>
                </div>
              </div>

              {authModalStep >= 4 && (
                <div style={{ color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 6px 0' }}>
                  <CheckIcon />
                  <span>Link Established successfully! Credentials saved.</span>
                </div>
              )}
            </div>

          </div>
        </div>
      )}
    </div>
  );
}

function InstagramIntegrationSection({ refreshSignal, onLinksChanged }: { refreshSignal: number; onLinksChanged?: () => void }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [instagramGuideOpen, setInstagramGuideOpen] = useState(false);
  const [instagramPosts, setInstagramPosts] = useState<InstagramPostPreview[]>([]);
  const [fetchError, setFetchError] = useState("");

  // Instagram Credentials States
  const [igAppId, setIgAppId] = useState(storedInstagramAppId);
  const [igAppSecret, setIgAppSecret] = useState("");
  const [igAccessToken, setIgAccessToken] = useState("");
  const [igRedirectUri, setIgRedirectUri] = useState(() => localStorage.getItem("reader-ig-redirect-uri") ?? window.location.origin + "/auth/instagram/callback");
  const [igStatus, setIgStatus] = useState<ServiceConnectionStatus>(() => {
    const stored = localStorage.getItem("reader-ig-status") as ServiceConnectionStatus;
    if (stored && stored !== "simulated") return stored;
    if (import.meta.env.VITE_INSTAGRAM_ACCESS_TOKEN) return "connected";
    return "connected";
  });

  // Simulated OAuth Modal States
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalStep, setAuthModalStep] = useState(0);

  // Simulated Content Feed States
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedFetched, setFeedFetched] = useState(false);
  const [videoPlayer, setVideoPlayer] = useState<DashboardVideoPlayer | null>(null);

  // Instagram-to-YouTube Video Linking States
  const [links, setLinks] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("reader-ig-yt-links") || "{}");
    } catch {
      return {};
    }
  });
  const [skipped, setSkipped] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("reader-ig-yt-skipped") || "[]");
    } catch {
      return [];
    }
  });
  const [manualLinkPost, setManualLinkPost] = useState<InstagramPostPreview | null>(null);
  const [promptLinkPost, setPromptLinkPost] = useState<InstagramPostPreview | null>(null);
  const [selectedYtVideoId, setSelectedYtVideoId] = useState("");

  const handleLink = (igId: string, ytId: string) => {
    const newLinks = { ...links, [igId]: ytId };
    setLinks(newLinks);
    localStorage.setItem("reader-ig-yt-links", JSON.stringify(newLinks));
    setManualLinkPost(null);
    setPromptLinkPost(null);
    setSelectedYtVideoId("");
    if (onLinksChanged) onLinksChanged();
  };

  const handleUnlink = (igId: string) => {
    const newLinks = { ...links };
    delete newLinks[igId];
    setLinks(newLinks);
    localStorage.setItem("reader-ig-yt-links", JSON.stringify(newLinks));
    if (onLinksChanged) onLinksChanged();
  };

  const handleSkip = (igId: string) => {
    const newSkipped = [...skipped, igId];
    setSkipped(newSkipped);
    localStorage.setItem("reader-ig-yt-skipped", JSON.stringify(newSkipped));
    setPromptLinkPost(null);
  };

  const cachedYtVideos: YouTubeVideoPreview[] = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("reader-yt-videos-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal, manualLinkPost]);

  const formatInstagramNumber = (value: number | string | undefined) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(Number(value ?? 0) || 0);

  const formatInstagramViews = (views: string | number | undefined) => {
    const count = Number(views ?? 0);
    if (Number.isNaN(count) || count <= 0) return "No views";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
    return `${count} views`;
  };

  const formatInstagramTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "";
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    const intervals = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "week", seconds: 604800 },
      { label: "day", seconds: 86400 },
      { label: "hour", seconds: 3600 },
      { label: "minute", seconds: 60 }
    ];
    const match = intervals.find((interval) => Math.floor(seconds / interval.seconds) >= 1);
    if (!match) return "just now";
    const value = Math.floor(seconds / match.seconds);
    return `${value} ${match.label}${value > 1 ? "s" : ""} ago`;
  };

  // Automatic Prompt for New Content
  useEffect(() => {
    if (!instagramPosts.length) return;

    const latestPost = instagramPosts[0];
    if (!links[latestPost.id] && !skipped.includes(latestPost.id)) {
      const timer = setTimeout(() => {
        setPromptLinkPost(latestPost);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [instagramPosts, links, skipped]);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatAnalyticsNumber = (value: number) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value || 0);

  const formatViews = (views: string | number) => {
    const count = Number(views);
    if (Number.isNaN(count) || count <= 0) return "No views";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
    return `${count} views`;
  };

  const formatTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
    const intervals = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "day", seconds: 86400 },
      { label: "hour", seconds: 3600 },
      { label: "minute", seconds: 60 }
    ];
    for (const interval of intervals) {
      const count = Math.floor(seconds / interval.seconds);
      if (count >= 1) return `${count} ${interval.label}${count > 1 ? "s" : ""} ago`;
    }
    return "just now";
  };

  const handleSaveIgCreds = () => {
    localStorage.setItem("reader-ig-app-id", igAppId);
    localStorage.setItem("reader-ig-app-secret", igAppSecret);
    localStorage.setItem("reader-ig-access-token", igAccessToken);
    localStorage.setItem("reader-ig-redirect-uri", igRedirectUri);
    if (igAccessToken || (igAppId && igAppSecret)) {
      setIgStatus("connected");
      localStorage.setItem("reader-ig-status", "connected");
    } else {
      setIgStatus("disconnected");
      localStorage.setItem("reader-ig-status", "disconnected");
    }
  };

  const handleInstagramOAuth = () => {
    const appId = validMetaAppId(INSTAGRAM_DEFAULT_APP_ID) ? INSTAGRAM_DEFAULT_APP_ID.trim() : igAppId.trim();
    const redirectUri = igRedirectUri.trim();
    if (!validMetaAppId(appId)) {
      localStorage.removeItem("reader-ig-app-id");
      setIgAppId(INSTAGRAM_DEFAULT_APP_ID);
      setFetchError("Your stored Meta app ID was invalid. I reset it to the .env app ID; click Link Instagram again.");
      return;
    }

    localStorage.setItem("reader-ig-app-id", appId);
    localStorage.setItem("reader-ig-redirect-uri", redirectUri);

    const url = new URL("https://www.facebook.com/v25.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("override_default_response_type", "true");
    url.searchParams.set("config_id", INSTAGRAM_LOGIN_CONFIGURATION_ID);
    url.searchParams.set("scope", INSTAGRAM_OAUTH_SCOPE);
    url.searchParams.set("state", crypto.randomUUID());
    console.log("Instagram OAuth URL:", url.toString());
    window.location.href = url.toString();
  };

  const handleDisconnect = () => {
    setIgStatus("disconnected");
    localStorage.setItem("reader-ig-status", "disconnected");
    setIgAppId("");
    setIgAppSecret("");
    setIgAccessToken("");
    localStorage.removeItem("reader-ig-app-id");
    localStorage.removeItem("reader-ig-app-secret");
    localStorage.removeItem("reader-ig-access-token");
    localStorage.removeItem("reader-ig-posts-cache");
    localStorage.removeItem("reader-ig-user-insights-cache");
    setInstagramPosts([]);
    setFeedFetched(false);
  };

  const handleFetchFeed = async () => {
    setFeedLoading(true);
    setFetchError("");
    localStorage.removeItem("reader-ig-user-insights-cache");

    try {
      const { data, error } = await supabase.functions.invoke("instagram-feed", {
        body: {}
      });

      if (error) throw new Error(await edgeFunctionErrorMessage(error));

      console.log("Instagram API response:", data);

      const posts = (data?.media ?? []).map((item: any) => {
        console.log(`Post ${item.id} (${item.media_type}):`, {
          insights: item.insights,
          like_count: item.like_count,
          comments_count: item.comments_count,
          error: item._error
        });
        const insightsViews = Math.max(
          0,
          Number(item.total_views_count ?? 0) || 0,
          Number(item.insights?.total_views ?? 0) || 0,
          Number(item.insights?.views ?? 0) || 0
        );
        return {
          averageWatchTime: Number(item.insights?.average_watch_time ?? 0),
          caption: item.caption ?? "Instagram post",
          comments: Number(item.insights?.comments ?? item.comments_count ?? 0),
          follows: Number(item.insights?.follows ?? 0),
          id: item.id,
          imageUrl: item.thumbnail_url ?? item.media_url ?? "",
          likes: Number(item.insights?.likes ?? item.like_count ?? 0),
          mediaUrl: item.media_url,
          mediaProductType: item.media_product_type,
          mediaType: item.media_type,
          permalink: item.permalink,
          profileActivity: Number(item.insights?.profile_activity ?? 0),
          profileVisits: Number(item.insights?.profile_visits ?? 0),
          publishedAt: item.timestamp ?? item.publishedAt ?? new Date().toISOString(),
          reach: Number(item.insights?.reach ?? 0),
          saved: Number(item.insights?.saved ?? 0),
          shares: Number(item.insights?.shares ?? 0),
          skipRate: Number(item.insights?.skip_rate ?? 0),
          totalInteractions: Number(item.insights?.total_interactions ?? 0),
          totalViewTime: Number(item.insights?.total_view_time ?? 0),
          views: Number(insightsViews)
        };
      });

      setInstagramPosts(posts);
      localStorage.setItem("reader-ig-posts-cache", JSON.stringify(posts));

      if (data?.userInsightsTimeline) {
        localStorage.setItem("reader-ig-user-insights-cache", JSON.stringify(data.userInsightsTimeline));
      } else {
        localStorage.removeItem("reader-ig-user-insights-cache");
      }

      setIgStatus("connected");
      localStorage.setItem("reader-ig-status", "connected");
      setFeedFetched(true);
      onLinksChanged?.();
    } catch (err) {
      console.error("Instagram API retrieval failed:", err);
      localStorage.removeItem("reader-ig-user-insights-cache");
      setFetchError(err instanceof Error ? err.message : "Failed to load Instagram feed.");
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    void handleFetchFeed();
  }, [refreshSignal]);

  useEffect(() => {
    localStorage.setItem("reader-ig-posts-cache", JSON.stringify(instagramPosts));
  }, [instagramPosts]);

  return (
    <div className="content-integrations-section">

      {/* FEED TESTING / PREVIEW SECTION */}
      <div className="preview-feed-section">
        <div className="preview-feed-header">
          <div>
            <h2>Instagram Media Feed</h2>
            <p>Latest posts fetched automatically using your connection credentials.</p>
          </div>
          {feedLoading ? (
            <span className="feed-refresh-status">
              <Loader2 className="spin" size={16} aria-hidden="true" />
              Pulling API content...
            </span>
          ) : (
            <button className="dashboard-secondary-button" onClick={handleInstagramOAuth} type="button" style={{ width: "auto", margin: 0, padding: "0 14px" }}>
              <InstagramIcon />
              <span>Link Instagram</span>
            </button>
          )}
        </div>

        {fetchError && (
          <div className="dashboard-error" style={{ margin: '0 0 18px 0' }}>
            {fetchError}
          </div>
        )}

        {igStatus === "disconnected" ? (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700 }}>No Instagram source is connected.</span>
            <small style={{ color: '#64748b', marginTop: 4 }}>Link the connected Facebook Page to pull Instagram Business Graph totals.</small>
            <button className="dashboard-secondary-button" onClick={handleInstagramOAuth} type="button" style={{ width: "auto", marginTop: 14, padding: "8px 14px" }}>
              <InstagramIcon />
              <span>Link Instagram</span>
            </button>
          </div>
        ) : !feedFetched ? (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700, color: '#1e293b' }}>Credentials Configured!</span>
            <small style={{ color: '#64748b', marginTop: 4 }}>Fetching starts automatically when the content tab opens.</small>
          </div>
        ) : (
          <div className="media-feed-grid">
            {instagramPosts.map((post) => {
              const linkedYtId = links[post.id];
              const linkedYtVideo = cachedYtVideos.find((v) => v.id === linkedYtId);

              return (
                <article className="youtube-video-card instagram-post-card" key={post.id}>
                  <div className="video-thumbnail-container instagram-image-container">
                    <button
                      className="video-thumbnail-button"
                      onClick={() => setVideoPlayer({
                        imageUrl: post.imageUrl,
                        platform: "instagram",
                        title: post.caption || "Instagram media",
                        url: post.mediaUrl || post.permalink
                      })}
                      type="button"
                      aria-label={`Play ${post.caption || "Instagram media"}`}
                    >
                      <img src={post.imageUrl} alt="" />
                      <span className="video-thumbnail-play" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
                    </button>
                    {linkedYtVideo && (
                      <span className="youtube-linked-badge-icon" title="Linked to YouTube video">
                        <YouTubeIcon />
                      </span>
                    )}
                  </div>
                  <div className="video-details instagram-post-details">
                    <h4 className="instagram-caption">{post.caption || "Instagram media"}</h4>
                    <div className="video-stats">
                      <span>{formatInstagramViews(post.views)}</span>
                      <span>{formatInstagramTimeAgo(post.publishedAt)}</span>
                    </div>
                    <div className="video-engagement-stats">
                      <span>
                        <ThumbsUp size={13} aria-hidden="true" />
                        {formatInstagramNumber(post.likes)}
                      </span>
                      <span>
                        <MessageCircle size={13} aria-hidden="true" />
                        {formatInstagramNumber(post.comments)}
                      </span>
                    </div>

                    <div className="ig-post-yt-link-section">
                      {linkedYtVideo ? (
                        <div className="ig-post-yt-badge linked">
                          <YouTubeIcon />
                          <span className="yt-title" title={linkedYtVideo.title}>
                            {linkedYtVideo.title}
                          </span>
                          <button
                            className="ig-post-yt-unlink-btn"
                            onClick={() => handleUnlink(post.id)}
                            title="Unlink YouTube video"
                            type="button"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="ig-post-yt-link-btn"
                          onClick={() => {
                            setManualLinkPost(post);
                            setSelectedYtVideoId("");
                          }}
                          type="button"
                        >
                          <Link2 size={13} />
                          <span>Link YouTube Video</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {videoPlayer && <VideoPlayerModal player={videoPlayer} onClose={() => setVideoPlayer(null)} />}

      {/* SIMULATED OAUTH MODAL BACKDROP */}
      {authModalOpen && (
        <div className="auth-modal-backdrop" onClick={() => setAuthModalOpen(false)}>
          <div className="auth-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Connect Meta & Instagram API</h3>

            <div className="auth-modal-body">
              <p>Simulating standard OAuth 2.0 Web Authorization callback flow redirecting to secure Consent server...</p>

              <div className="oauth-simulation-steps">
                <div className={`simulation-step ${authModalStep >= 1 ? "completed" : "active"}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 1 ? <CheckIcon /> : <Loader2 className="spin" size={14} />}
                  </div>
                  <span>Contacting authorization authorization callback handlers...</span>
                </div>

                <div className={`simulation-step ${authModalStep >= 2 ? "completed" : authModalStep === 1 ? "active" : ""}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 2 ? <CheckIcon /> : authModalStep === 1 ? <Loader2 className="spin" size={14} /> : <KeyIcon />}
                  </div>
                  <span>Requesting permissions: instagram_basic, instagram_manage_insights...</span>
                </div>

                <div className={`simulation-step ${authModalStep >= 3 ? "completed" : authModalStep === 2 ? "active" : ""}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 3 ? <CheckIcon /> : authModalStep === 2 ? <Loader2 className="spin" size={14} /> : <KeyIcon />}
                  </div>
                  <span>Exchanging authorization code for long-lived OAuth token...</span>
                </div>

                <div className={`simulation-step ${authModalStep >= 4 ? "completed" : authModalStep === 3 ? "active" : ""}`}>
                  <div className="simulation-indicator">
                    {authModalStep >= 4 ? <CheckIcon /> : authModalStep === 3 ? <Loader2 className="spin" size={14} /> : <KeyIcon />}
                  </div>
                  <span>Validating connection credentials & loading sandbox data...</span>
                </div>
              </div>

              {authModalStep >= 4 && (
                <div style={{ color: '#16a34a', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 6px 0' }}>
                  <CheckIcon />
                  <span>Link Established successfully! Credentials saved.</span>
                </div>
              )}
            </div>

            <div className="auth-modal-footer">
              <button
                className="dashboard-secondary-button"
                onClick={() => setAuthModalOpen(false)}
                type="button"
                disabled={authModalStep < 4}
              >
                Close Consent Panel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* INSTAGRAM-TO-YOUTUBE LINKING MODAL */}
      {(manualLinkPost || promptLinkPost) && (() => {
        const activePost = manualLinkPost || promptLinkPost!;
        const isAutoPrompt = Boolean(promptLinkPost);

        return (
          <div className="auth-modal-backdrop" onClick={() => {
            if (!isAutoPrompt) setManualLinkPost(null);
          }}>
            <div className="auth-modal-dialog ig-yt-link-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>
                {isAutoPrompt ? "⚡ Link New Instagram Reel" : "🔗 Link Instagram Reel to YouTube"}
              </h3>

              <div className="auth-modal-body ig-yt-link-modal-body">
                {isAutoPrompt && (
                  <div className="new-reel-alert-badge">
                    New content detected! Link it to YouTube to synchronize combined weekly analytics.
                  </div>
                )}

                <div className="link-modal-split-preview">
                  <div className="ig-preview-thumbnail-container">
                    <img src={activePost.imageUrl} alt="" />
                    <div className="ig-preview-overlay">
                      <span>❤️ {activePost.likes ?? 0}</span>
                      <span>💬 {activePost.comments ?? 0}</span>
                    </div>
                  </div>
                  <div className="ig-preview-copy">
                    <span className="ig-preview-label">Instagram Reel Caption</span>
                    <p className="ig-preview-caption-text">{activePost.caption}</p>
                    {activePost.publishedAt && (
                      <span className="ig-preview-date">
                        Published on {new Date(activePost.publishedAt).toLocaleDateString("en-GB", { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="link-dropdown-form-row">
                  <label htmlFor="yt-video-select">Select target YouTube Video:</label>
                  <select
                    id="yt-video-select"
                    value={selectedYtVideoId}
                    onChange={(e) => setSelectedYtVideoId(e.target.value)}
                    className="yt-select-dropdown"
                  >
                    <option value="">-- Choose YouTube Video --</option>
                    {cachedYtVideos.map((video) => (
                      <option key={video.id} value={video.id}>
                        {video.title} ({formatExactViewCount(video.views)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="auth-modal-footer">
                {isAutoPrompt ? (
                  <button
                    className="dashboard-secondary-button"
                    onClick={() => handleSkip(activePost.id)}
                    type="button"
                  >
                    Ignore Reel
                  </button>
                ) : (
                  <button
                    className="dashboard-secondary-button"
                    onClick={() => setManualLinkPost(null)}
                    type="button"
                  >
                    Cancel
                  </button>
                )}
                <button
                  className="dashboard-primary-button"
                  disabled={!selectedYtVideoId}
                  onClick={() => handleLink(activePost.id, selectedYtVideoId)}
                  type="button"
                  style={{ width: 'auto', margin: 0 }}
                >
                  Link & Sync Views
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function TikTokIntegrationSection({ refreshSignal, onLinksChanged }: { refreshSignal: number; onLinksChanged?: () => void }) {
  const [tiktokVideos, setTiktokVideos] = useState<TikTokVideoPreview[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("reader-tt-videos-cache") || "[]");
    } catch {
      return [];
    }
  });
  const [fetchError, setFetchError] = useState("");
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedFetched, setFeedFetched] = useState(false);
  const [ttStatus, setTtStatus] = useState<ServiceConnectionStatus>(() => {
    const stored = localStorage.getItem("reader-tt-status") as ServiceConnectionStatus;
    return stored && stored !== "simulated" ? stored : "disconnected";
  });
  const [ttClientKey, setTtClientKey] = useState(() => localStorage.getItem("reader-tt-client-key") ?? TIKTOK_DEFAULT_CLIENT_KEY);
  const [ttRedirectUri, setTtRedirectUri] = useState(() => localStorage.getItem("reader-tt-redirect-uri") ?? window.location.origin + "/auth/tiktok/callback");
  const [links, setLinks] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem("reader-tt-yt-links") || "{}");
    } catch {
      return {};
    }
  });
  const [manualLinkVideo, setManualLinkVideo] = useState<TikTokVideoPreview | null>(null);
  const [selectedYtVideoId, setSelectedYtVideoId] = useState("");
  const [videoPlayer, setVideoPlayer] = useState<DashboardVideoPlayer | null>(null);

  const cachedYtVideos: YouTubeVideoPreview[] = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("reader-yt-videos-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal, manualLinkVideo]);

  const formatTikTokNumber = (value: number | string | undefined) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(Number(value ?? 0) || 0);

  const formatTikTokViews = (views: string | number | undefined) => {
    const count = Number(views ?? 0);
    if (Number.isNaN(count) || count <= 0) return "No views";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
    return `${count} views`;
  };

  const formatTikTokTimeAgo = (dateStr?: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return "";
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    const intervals = [
      { label: "year", seconds: 31536000 },
      { label: "month", seconds: 2592000 },
      { label: "week", seconds: 604800 },
      { label: "day", seconds: 86400 },
      { label: "hour", seconds: 3600 },
      { label: "minute", seconds: 60 }
    ];
    const match = intervals.find((interval) => Math.floor(seconds / interval.seconds) >= 1);
    if (!match) return "just now";
    const value = Math.floor(seconds / match.seconds);
    return `${value} ${match.label}${value > 1 ? "s" : ""} ago`;
  };

  const formatTikTokDuration = (seconds: number) => {
    const rounded = Math.round(seconds || 0);
    const minutes = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };

  const handleTikTokOAuth = () => {
    const clientKey = ttClientKey.trim();
    const redirectUri = ttRedirectUri.trim();
    if (!clientKey) {
      setFetchError("Enter your TikTok client key before linking TikTok.");
      return;
    }
    localStorage.setItem("reader-tt-client-key", clientKey);
    localStorage.setItem("reader-tt-redirect-uri", redirectUri);
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", clientKey);
    url.searchParams.set("scope", TIKTOK_OAUTH_SCOPE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", crypto.randomUUID());
    window.location.href = url.toString();
  };

  const handleLink = (ttId: string, ytId: string) => {
    const newLinks = { ...links, [ttId]: ytId };
    setLinks(newLinks);
    localStorage.setItem("reader-tt-yt-links", JSON.stringify(newLinks));
    setManualLinkVideo(null);
    setSelectedYtVideoId("");
    if (onLinksChanged) onLinksChanged();
  };

  const handleUnlink = (ttId: string) => {
    const newLinks = { ...links };
    delete newLinks[ttId];
    setLinks(newLinks);
    localStorage.setItem("reader-tt-yt-links", JSON.stringify(newLinks));
    if (onLinksChanged) onLinksChanged();
  };

  const handleFetchFeed = async () => {
    setFeedLoading(true);
    setFetchError("");

    try {
      const { data, error } = await supabase.functions.invoke("tiktok-feed", { body: {} });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));

      const videos = (data?.videos ?? []).map((item: any): TikTokVideoPreview => {
        const durationSeconds = Number(item.duration ?? 0) || 0;
        const publishedAt = item.create_time
          ? new Date(Number(item.create_time) * 1000).toISOString()
          : undefined;
        return {
          comments: Number(item.comment_count ?? 0),
          duration: formatTikTokDuration(durationSeconds),
          durationSeconds,
          embedUrl: item.embed_link,
          id: String(item.id),
          imageUrl: item.cover_image_url ?? "",
          likes: Number(item.like_count ?? 0),
          published: formatTikTokTimeAgo(publishedAt),
          publishedAt,
          shares: Number(item.share_count ?? 0),
          title: item.title || item.video_description || "TikTok video",
          url: item.share_url ?? item.embed_link,
          views: Number(item.view_count ?? 0)
        };
      });

      setTiktokVideos(videos);
      localStorage.setItem("reader-tt-videos-cache", JSON.stringify(videos));
      setTtStatus("connected");
      localStorage.setItem("reader-tt-status", "connected");
      setFeedFetched(true);
    } catch (err) {
      console.error("TikTok API retrieval failed:", err);
      setFetchError(err instanceof Error ? err.message : "Failed to load TikTok feed.");
      if (err instanceof Error && err.message.toLowerCase().includes("link tiktok")) {
        setTtStatus("disconnected");
        localStorage.setItem("reader-tt-status", "disconnected");
      }
    } finally {
      setFeedLoading(false);
    }
  };

  useEffect(() => {
    void handleFetchFeed();
  }, [refreshSignal]);

  useEffect(() => {
    localStorage.setItem("reader-tt-videos-cache", JSON.stringify(tiktokVideos));
  }, [tiktokVideos]);

  return (
    <div className="content-integrations-section">
      <div className="preview-feed-section">
        <div className="preview-feed-header">
          <div>
            <h2>TikTok Videos</h2>
            <p>Latest public TikTok videos with current public counters.</p>
          </div>
          {feedLoading && (
            <span className="feed-refresh-status">
              <Loader2 className="spin" size={16} aria-hidden="true" />
              Pulling API content...
            </span>
          )}
          <button className="dashboard-secondary-button" onClick={handleTikTokOAuth} type="button" style={{ width: "auto", margin: 0, padding: "0 16px" }}>
            <TikTokIcon />
            <span>Link TikTok</span>
          </button>
        </div>

        <div className="credentials-form" style={{ marginBottom: 20 }}>
          <div className="form-group">
            <label htmlFor="tt-client-key">TikTok client key</label>
            <input id="tt-client-key" value={ttClientKey} onChange={(event) => setTtClientKey(event.target.value)} placeholder="TikTok app client key" />
          </div>
          <div className="form-group">
            <label htmlFor="tt-redirect-uri">Redirect URI</label>
            <input id="tt-redirect-uri" value={ttRedirectUri} onChange={(event) => setTtRedirectUri(event.target.value)} />
          </div>
        </div>

        {fetchError && (
          <div className="dashboard-error" style={{ margin: "0 0 18px 0" }}>
            <span>{fetchError}</span>
          </div>
        )}

        {ttStatus === "disconnected" && !feedFetched ? (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700 }}>No TikTok source is connected.</span>
            <small style={{ color: "#64748b", marginTop: 4 }}>Create a TikTok Developer app, add this redirect URI, then link TikTok.</small>
          </div>
        ) : !feedFetched ? (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700, color: "#1e293b" }}>Fetching starts automatically when the TikTok tab opens.</span>
          </div>
        ) : (
          <div className="media-feed-grid">
            {tiktokVideos.map((video) => {
              const linkedYtId = links[video.id];
              const linkedYtVideo = cachedYtVideos.find((item) => item.id === linkedYtId);

              return (
                <article className="youtube-video-card tiktok-video-card" key={video.id}>
                  <div className="video-thumbnail-container instagram-image-container">
                    <button
                      className="video-thumbnail-button"
                      onClick={() => setVideoPlayer({
                        duration: video.duration,
                        embedUrl: video.embedUrl,
                        imageUrl: video.imageUrl,
                        platform: "tiktok",
                        title: video.title || "TikTok video",
                        url: video.url
                      })}
                      type="button"
                      aria-label={`Play ${video.title || "TikTok video"}`}
                    >
                      {video.imageUrl ? <img src={video.imageUrl} alt="" /> : <div className="dashboard-image-missing"><TikTokIcon /></div>}
                      <span className="video-thumbnail-play" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
                    </button>
                    <span className="video-duration">{video.duration}</span>
                    {linkedYtVideo && (
                      <span className="youtube-linked-badge-icon" title="Linked to YouTube video">
                        <YouTubeIcon />
                      </span>
                    )}
                  </div>
                  <div className="video-details instagram-post-details">
                    <h4 className="instagram-caption">{video.title || "TikTok video"}</h4>
                    <div className="video-stats">
                      <span>{formatTikTokViews(video.views)}</span>
                      <span>{video.published}</span>
                    </div>
                    <div className="video-engagement-stats">
                      <span>
                        <ThumbsUp size={13} aria-hidden="true" />
                        {formatTikTokNumber(video.likes)}
                      </span>
                      <span>
                        <MessageCircle size={13} aria-hidden="true" />
                        {formatTikTokNumber(video.comments)}
                      </span>
                    </div>
                    <div className="ig-post-yt-link-section">
                      {linkedYtVideo ? (
                        <div className="ig-post-yt-badge linked">
                          <YouTubeIcon />
                          <span className="yt-title" title={linkedYtVideo.title}>
                            {linkedYtVideo.title}
                          </span>
                          <button className="ig-post-yt-unlink-btn" onClick={() => handleUnlink(video.id)} title="Unlink YouTube video" type="button">
                            <X size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="ig-post-yt-link-btn"
                          onClick={() => {
                            setManualLinkVideo(video);
                            setSelectedYtVideoId("");
                          }}
                          type="button"
                        >
                          <Link2 size={13} />
                          <span>Link YouTube Video</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {videoPlayer && <VideoPlayerModal player={videoPlayer} onClose={() => setVideoPlayer(null)} />}

      {manualLinkVideo && (
        <div className="auth-modal-backdrop" onClick={() => setManualLinkVideo(null)}>
          <div className="auth-modal-dialog ig-yt-link-dialog" onClick={(event) => event.stopPropagation()}>
            <h3>Link TikTok Video to YouTube</h3>
            <div className="auth-modal-body ig-yt-link-modal-body">
              <div className="link-modal-split-preview">
                <div className="ig-preview-thumbnail-container">
                  {manualLinkVideo.imageUrl ? <img src={manualLinkVideo.imageUrl} alt="" /> : <div className="dashboard-image-missing"><TikTokIcon /></div>}
                  <div className="ig-preview-overlay">
                    <span>{formatTikTokNumber(manualLinkVideo.views)} views</span>
                    <span>{formatTikTokNumber(manualLinkVideo.likes)} likes</span>
                  </div>
                </div>
                <div className="ig-preview-copy">
                  <span className="ig-preview-label">TikTok video</span>
                  <p className="ig-preview-caption-text">{manualLinkVideo.title}</p>
                  {manualLinkVideo.publishedAt && (
                    <span className="ig-preview-date">
                      Published on {new Date(manualLinkVideo.publishedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  )}
                </div>
              </div>
              <div className="link-dropdown-form-row">
                <label htmlFor="tt-yt-video-select">Select target YouTube Video:</label>
                <select
                  id="tt-yt-video-select"
                  value={selectedYtVideoId}
                  onChange={(event) => setSelectedYtVideoId(event.target.value)}
                  className="yt-select-dropdown"
                >
                  <option value="">-- Choose YouTube Video --</option>
                  {cachedYtVideos.map((video) => (
                    <option key={video.id} value={video.id}>
                      {video.title} ({formatExactViewCount(video.views)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="auth-modal-footer">
              <button className="dashboard-secondary-button" onClick={() => setManualLinkVideo(null)} type="button">
                Cancel
              </button>
              <button
                className="dashboard-primary-button"
                disabled={!selectedYtVideoId}
                onClick={() => handleLink(manualLinkVideo.id, selectedYtVideoId)}
                type="button"
                style={{ width: "auto", margin: 0 }}
              >
                Link & Sync Views
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WeeklyViewsSection({ refreshSignal, linksVersion }: { refreshSignal: number; linksVersion?: number }) {
  const [hoveredWeekIndex, setHoveredWeekIndex] = useState<number | null>(null);
  const [averageViewExpanded, setAverageViewExpanded] = useState(false);
  const [igVideoDurations, setIgVideoDurations] = useState<Record<string, number>>({});
  const [likedByPlatformExpanded, setLikedByPlatformExpanded] = useState(false);
  const [platformViewsExpanded, setPlatformViewsExpanded] = useState(false);
  const [stayedToWatchExpanded, setStayedToWatchExpanded] = useState(false);
  const [videoPlayer, setVideoPlayer] = useState<DashboardVideoPlayer | null>(null);
  const [combinedPerformanceSort, setCombinedPerformanceSort] = useState<{
    direction: SortDirection;
    key: CombinedPerformanceSortKey;
  }>({ direction: "desc", key: "publishedAt" });

  // 1. Read cached YouTube weekly views
  const weeklyViews = useMemo((): YouTubeWeeklyViews[] => {
    try {
      return JSON.parse(localStorage.getItem("reader-yt-weekly-views-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal]);

  const youtubeRange = useMemo((): YouTubeAnalyticsRange | null => {
    try {
      return JSON.parse(localStorage.getItem("reader-yt-analytics-range-cache") || "null");
    } catch {
      return null;
    }
  }, [refreshSignal]);

  // 2. Read cached YouTube videos
  const ytVideos = useMemo((): YouTubeVideoPreview[] => {
    try {
      return JSON.parse(localStorage.getItem("reader-yt-videos-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal]);

  const ytAnalytics = useMemo((): YouTubeTopVideoAnalytics[] => {
    try {
      return JSON.parse(localStorage.getItem("reader-yt-analytics-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal]);

  // 3. Read cached Instagram posts
  const igPosts = useMemo((): InstagramPostPreview[] => {
    try {
      return JSON.parse(localStorage.getItem("reader-ig-posts-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal]);

  const igDailyViews = useMemo((): Array<{ day: string; views: number }> => {
    try {
      const rows = JSON.parse(localStorage.getItem("reader-ig-user-insights-cache") || "[]");
      return Array.isArray(rows)
        ? rows
          .filter((row): row is { day: string; views: number } =>
            typeof row?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.day)
          )
          .map((row) => ({ day: row.day, views: Number(row.views ?? 0) || 0 }))
        : [];
    } catch {
      return [];
    }
  }, [refreshSignal]);

  const ttVideos = useMemo((): TikTokVideoPreview[] => {
    try {
      return JSON.parse(localStorage.getItem("reader-tt-videos-cache") || "[]");
    } catch {
      return [];
    }
  }, [refreshSignal]);

  // 4. Read links mapping
  const links = useMemo((): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem("reader-ig-yt-links") || "{}");
    } catch {
      return {};
    }
  }, [refreshSignal, linksVersion]);

  const ttLinks = useMemo((): Record<string, string> => {
    try {
      return JSON.parse(localStorage.getItem("reader-tt-yt-links") || "{}");
    } catch {
      return {};
    }
  }, [refreshSignal, linksVersion]);

  useEffect(() => {
    const videoPosts = igPosts.filter((post) =>
      post.mediaUrl &&
      !post.durationSeconds &&
      !igVideoDurations[post.id] &&
      (post.mediaType === "VIDEO" || post.mediaProductType === "REELS")
    );
    if (!videoPosts.length) return;

    const videos = videoPosts.map((post) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = post.mediaUrl || "";
      video.onloadedmetadata = () => {
        if (Number.isFinite(video.duration) && video.duration > 0) {
          setIgVideoDurations((durations) => ({ ...durations, [post.id]: video.duration }));
        }
      };
      return video;
    });

    return () => {
      videos.forEach((video) => {
        video.onloadedmetadata = null;
        video.removeAttribute("src");
        video.load();
      });
    };
  }, [igPosts, igVideoDurations]);

  // parseViews utility for robust string-to-number views conversion
  const parseViews = useCallback(parseViewCount, []);

  const parseDurationSeconds = useCallback((duration?: string): number => {
    if (!duration) return 0;
    const parts = duration.split(":").map((part) => Number(part));
    if (parts.some((part) => Number.isNaN(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }, []);

  const formatDurationSeconds = useCallback((value: number) => {
    const seconds = Math.round(value || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }, []);

  const formatPublishDate = useCallback((value?: string) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }, []);

  const dateFromIsoDate = useCallback((value: string) => {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }, []);

  const isoDateFromDate = useCallback((date: Date) => date.toISOString().slice(0, 10), []);

  const addUtcDays = useCallback((date: Date, days: number) => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
  }, []);

  const mondayOfWeek = useCallback((date: Date) => {
    const monday = new Date(date);
    const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
    return monday;
  }, []);

  const weekBucketsBetween = useCallback((startDate: string, endDate: string) => {
    const start = dateFromIsoDate(startDate);
    const end = dateFromIsoDate(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

    const buckets: YouTubeWeeklyViews[] = [];
    for (let cursor = mondayOfWeek(start); cursor <= end; cursor = addUtcDays(cursor, 7)) {
      const weekStart = new Date(cursor);
      const weekEnd = new Date(Math.min(addUtcDays(weekStart, 6).getTime(), end.getTime()));
      buckets.push({
        endDate: isoDateFromDate(weekEnd),
        startDate: isoDateFromDate(weekStart),
        views: 0
      });
    }

    return buckets;
  }, [addUtcDays, dateFromIsoDate, isoDateFromDate, mondayOfWeek]);

  const formatShortWeeklyDate = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  };

  const releasedVideoDates = useMemo(() => {
    const dates: string[] = [];
    const processedIgIds = new Set<string>();
    const processedTtIds = new Set<string>();

    ytVideos.forEach((ytVideo) => {
      const linkedIg = igPosts.find((post) => links[post.id] === ytVideo.id);
      const linkedTt = ttVideos.find((video) => ttLinks[video.id] === ytVideo.id);
      if (linkedIg) processedIgIds.add(linkedIg.id);
      if (linkedTt) processedTtIds.add(linkedTt.id);
      const publishedAt = ytVideo.publishedAt || linkedIg?.publishedAt || linkedTt?.publishedAt;
      if (publishedAt) dates.push(publishedAt);
    });

    igPosts.forEach((igPost) => {
      if (!processedIgIds.has(igPost.id) && igPost.publishedAt) {
        dates.push(igPost.publishedAt);
      }
    });

    ttVideos.forEach((ttVideo) => {
      if (!processedTtIds.has(ttVideo.id) && ttVideo.publishedAt) {
        dates.push(ttVideo.publishedAt);
      }
    });

    return dates;
  }, [igPosts, links, ttLinks, ttVideos, ytVideos]);

  const getReleasedVideoCountForWeek = useCallback((startDateStr: string, endDateStr: string) => {
    const startTime = dateFromIsoDate(startDateStr).getTime();
    const endTime = dateFromIsoDate(endDateStr).getTime() + 24 * 60 * 60 * 1000 - 1;

    return releasedVideoDates.filter((publishedAt) => {
      const publishedTime = new Date(publishedAt).getTime();
      return Number.isFinite(publishedTime) && publishedTime >= startTime && publishedTime <= endTime;
    }).length;
  }, [dateFromIsoDate, releasedVideoDates]);

  const getPublishedYtViewsForWeek = useCallback((startDateStr: string, endDateStr: string) => {
    const startTime = dateFromIsoDate(startDateStr).getTime();
    const endTime = dateFromIsoDate(endDateStr).getTime() + 24 * 60 * 60 * 1000 - 1;

    return ytVideos.reduce((total, video) => {
      if (!video.publishedAt) return total;
      const publishedTime = new Date(video.publishedAt).getTime();
      return Number.isFinite(publishedTime) && publishedTime >= startTime && publishedTime <= endTime
        ? total + parseViews(video.views)
        : total;
    }, 0);
  }, [dateFromIsoDate, parseViews, ytVideos]);

  const getPublishedIgViewsForWeek = useCallback((startDateStr: string, endDateStr: string) => {
    const startTime = dateFromIsoDate(startDateStr).getTime();
    const endTime = dateFromIsoDate(endDateStr).getTime() + 24 * 60 * 60 * 1000 - 1;

    return igPosts.reduce((total, post) => {
      if (!post.publishedAt) return total;
      const publishedTime = new Date(post.publishedAt).getTime();
      return Number.isFinite(publishedTime) && publishedTime >= startTime && publishedTime <= endTime
        ? total + parseViews(post.views ?? 0)
        : total;
    }, 0);
  }, [dateFromIsoDate, igPosts, parseViews]);

  const getPublishedTtViewsForWeek = useCallback((startDateStr: string, endDateStr: string) => {
    const startTime = dateFromIsoDate(startDateStr).getTime();
    const endTime = dateFromIsoDate(endDateStr).getTime() + 24 * 60 * 60 * 1000 - 1;

    return ttVideos.reduce((total, video) => {
      if (!video.publishedAt) return total;
      const publishedTime = new Date(video.publishedAt).getTime();
      return Number.isFinite(publishedTime) && publishedTime >= startTime && publishedTime <= endTime
        ? total + Number(video.views ?? 0)
        : total;
    }, 0);
  }, [dateFromIsoDate, ttVideos]);

  // 6. Compute weekly combined analytics
  const weeklyViewsData = useMemo(() => {
    const bucketsByStartDate = new Map<string, YouTubeWeeklyViews>();
    const addBucket = (week: YouTubeWeeklyViews) => {
      const existing = bucketsByStartDate.get(week.startDate);
      bucketsByStartDate.set(week.startDate, {
        endDate: existing?.endDate && existing.endDate > week.endDate ? existing.endDate : week.endDate,
        startDate: week.startDate,
        views: Number(existing?.views ?? 0) + Number(week.views ?? 0)
      });
    };

    weeklyViews.forEach(addBucket);

    const rangeEndDate = youtubeRange?.availableEndDate || youtubeRange?.endDate;
    if (youtubeRange?.startDate && rangeEndDate) {
      const startDate = youtubeRange.startDate < WEEKLY_DASHBOARD_START_DATE ? WEEKLY_DASHBOARD_START_DATE : youtubeRange.startDate;
      weekBucketsBetween(startDate, rangeEndDate).forEach(addBucket);
    }

    if (igDailyViews.length) {
      const sortedDays = [...igDailyViews].sort((left, right) => left.day.localeCompare(right.day));
      const startDate = sortedDays[0].day < WEEKLY_DASHBOARD_START_DATE ? WEEKLY_DASHBOARD_START_DATE : sortedDays[0].day;
      weekBucketsBetween(startDate, sortedDays[sortedDays.length - 1].day).forEach(addBucket);
    }

    if (releasedVideoDates.length) {
      const sortedReleaseDates = releasedVideoDates
        .map((publishedAt) => publishedAt.slice(0, 10))
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();
      if (sortedReleaseDates.length) {
        const startDate = sortedReleaseDates[0] < WEEKLY_DASHBOARD_START_DATE ? WEEKLY_DASHBOARD_START_DATE : sortedReleaseDates[0];
        weekBucketsBetween(startDate, sortedReleaseDates[sortedReleaseDates.length - 1]).forEach(addBucket);
      }
    }

    if (ttVideos.length) {
      const sortedTtDates = ttVideos
        .map((video) => video.publishedAt?.slice(0, 10) ?? "")
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
        .sort();
      if (sortedTtDates.length) {
        const startDate = sortedTtDates[0] < WEEKLY_DASHBOARD_START_DATE ? WEEKLY_DASHBOARD_START_DATE : sortedTtDates[0];
        weekBucketsBetween(startDate, sortedTtDates[sortedTtDates.length - 1]).forEach(addBucket);
      }
    }

    const sourceRows = [...bucketsByStartDate.values()]
      .filter((week) => week.startDate >= WEEKLY_DASHBOARD_START_DATE)
      .sort((left, right) => left.startDate.localeCompare(right.startDate));

    const rows = sourceRows.map((week) => {
      const youtubeWeek = weeklyViews.find((row) => row.startDate === week.startDate);
      const publishedYtViews = getPublishedYtViewsForWeek(week.startDate, week.endDate);
      const ytViews = publishedYtViews;
      const igViews = getPublishedIgViewsForWeek(week.startDate, week.endDate);
      const ttViews = getPublishedTtViewsForWeek(week.startDate, week.endDate);
      const totalViews = ytViews + igViews + ttViews;
      const releasedVideoCount = getReleasedVideoCountForWeek(week.startDate, week.endDate);
      return {
        ...week,
        views: Number(youtubeWeek?.views ?? week.views ?? 0) || publishedYtViews,
        ytViews,
        igViews,
        ttViews,
        totalViews,
        releasedVideoCount,
        averageViewsPerReleasedVideo: releasedVideoCount ? totalViews / releasedVideoCount : null
      };
    });

    const percentChange = (current: number | null, previous: number | null) => {
      if (previous === null || current === null) return null;
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return rows.map((week, index) => {
      const previousWeek = [...rows.slice(0, index)].reverse().find((row) => row.totalViews > 0) ?? null;

      return {
        ...week,
        averageViewsChangePercent: percentChange(week.averageViewsPerReleasedVideo, previousWeek?.averageViewsPerReleasedVideo ?? null),
        igViewsChangePercent: percentChange(week.igViews, previousWeek?.igViews ?? null),
        releasedVideoCountChangePercent: percentChange(week.releasedVideoCount, previousWeek?.releasedVideoCount ?? null),
        totalViewsChangePercent: percentChange(week.totalViews, previousWeek?.totalViews ?? null),
        ttViewsChangePercent: percentChange(week.ttViews, previousWeek?.ttViews ?? null),
        ytViewsChangePercent: percentChange(week.ytViews, previousWeek?.ytViews ?? null)
      };
    });
  }, [igDailyViews, releasedVideoDates, ttVideos, weeklyViews, youtubeRange, weekBucketsBetween, getPublishedIgViewsForWeek, getPublishedTtViewsForWeek, getPublishedYtViewsForWeek, getReleasedVideoCountForWeek]);

  const weeklyViewsDateRange = useMemo(() => {
    if (!weeklyViewsData.length) return "";
    const firstWeek = weeklyViewsData[0];
    const lastWeek = weeklyViewsData[weeklyViewsData.length - 1];
    const actualEndDate = youtubeRange?.availableEndDate || lastWeek.endDate;
    const requestedEndDate = youtubeRange?.endDate;
    const label = `${formatShortWeeklyDate(firstWeek.startDate)} - ${formatShortWeeklyDate(actualEndDate)}`;

    return requestedEndDate && actualEndDate < requestedEndDate
      ? `${label} (YouTube available through ${formatShortWeeklyDate(actualEndDate)})`
      : label;
  }, [weeklyViewsData, youtubeRange]);

  const weeklyViewsMax = useMemo(() => {
    return Math.max(...weeklyViewsData.map((week) => week.totalViews), 1);
  }, [weeklyViewsData]);

  const weeklyViewsTotals = useMemo(() => {
    const ytViews = weeklyViewsData.reduce((sum, week) => sum + week.ytViews, 0);
    const igViews = weeklyViewsData.reduce((sum, week) => sum + week.igViews, 0);
    const ttViews = weeklyViewsData.reduce((sum, week) => sum + week.ttViews, 0);
    const totalViews = weeklyViewsData.reduce((sum, week) => sum + week.totalViews, 0);
    const releasedVideoCount = weeklyViewsData.reduce((sum, week) => sum + week.releasedVideoCount, 0);

    return {
      averageViewsPerReleasedVideo: releasedVideoCount ? totalViews / releasedVideoCount : null,
      igViews,
      releasedVideoCount,
      ttViews,
      totalViews,
      ytViews
    };
  }, [weeklyViewsData]);

  // 7. Aggregate combined video entries (linked items merged into one entry)
  const combinedEntries = useMemo(() => {
    const entries: Array<{
		      averageViewPercentage: number | null;
		      color: string;
		      duration: string;
		      engagedViews: number | null;
		      id: string;
	      ytVideo: YouTubeVideoPreview | null;
	      igPost: InstagramPostPreview | null;
	      ttVideo: TikTokVideoPreview | null;
	      imageUrl: string;
	      performanceLabel: string;
	      performanceRank: number | null;
	      performanceReason: string;
	      performanceScore: number | null;
	      publishedAt?: string;
	      stayedToWatch: number | null;
	      ytStayedToWatch: number | null;
	      igStayedToWatch: number | null;
	      title: string;
		      igCaption: string | null;
		      igEngagedViews: number | null;
		      igAverageViewPercentage: number | null;
		      platform: "youtube" | "instagram" | "tiktok" | "both";
		      ytAverageViewPercentage: number | null;
		      ytEngagedViews: number | null;
	      ytViews: number;
      igViews: number;
      ttViews: number;
      ytLikes: number;
      igLikes: number;
      ttLikes: number;
      totalViews: number;
      totalLikes: number;
      likedPercentage: number | null;
      watchHours: number;
      watchTimeShare: number;
    }> = [];

    const processedIgIds = new Set<string>();
    const processedTtIds = new Set<string>();
    const analyticsByVideoId = new Map(ytAnalytics.map((row) => [row.video, row]));
    const totalWatchHours = ytAnalytics.reduce((total, row) => total + Number(row.estimatedMinutesWatched ?? 0) / 60, 0) +
      igPosts.reduce((total, post) => {
        const totalViewTime = Number(post.totalViewTime ?? 0);
        const inferredViewTime = (Number(post.averageWatchTime ?? 0) / 1000) * Number(post.views ?? 0);
        return total + (totalViewTime ? totalViewTime / 3600000 : inferredViewTime / 3600);
      }, 0);

    const rowFrom = (values: {
      index: number;
      ytVideo: YouTubeVideoPreview | null;
      igPost: InstagramPostPreview | null;
      ttVideo: TikTokVideoPreview | null;
      ytViews: number;
      igViews: number;
      ttViews: number;
      ytLikes: number;
      igLikes: number;
      ttLikes: number;
      platform: "youtube" | "instagram" | "tiktok" | "both";
    }) => {
      const ytRow = values.ytVideo ? analyticsByVideoId.get(values.ytVideo.id) : undefined;
	      const ytDurationSeconds = parseDurationSeconds(values.ytVideo?.duration);
	      const igAverageWatchSeconds = Number(values.igPost?.averageWatchTime ?? 0) / 1000;
	      const igDurationSeconds = Number(values.igPost?.durationSeconds ?? 0) || Number(values.igPost ? igVideoDurations[values.igPost.id] ?? 0 : 0) || ytDurationSeconds;
	      const igTotalViewTime = Number(values.igPost?.totalViewTime ?? 0);
      const igWatchHours = igTotalViewTime
        ? igTotalViewTime / 3600000
        : (igAverageWatchSeconds * values.igViews) / 3600;
      const ytWatchHours = Number(ytRow?.estimatedMinutesWatched ?? 0) / 60;
      const totalViews = values.ytViews + values.igViews + values.ttViews;
      const totalLikes = values.ytLikes + values.igLikes + values.ttLikes;
      const likedPercentage = totalViews ? (totalLikes / totalViews) * 100 : null;
      const watchMetricViews = values.ytViews + values.igViews;
	      const watchHours = ytWatchHours + igWatchHours;
	      const ytAverageViewPercentage = ytRow ? Number(ytRow.averageViewPercentage ?? 0) : null;
	      const igAverageViewPercentage = igDurationSeconds && igAverageWatchSeconds
	        ? Math.min((igAverageWatchSeconds / igDurationSeconds) * 100, 999)
	        : null;
      const averageViewPercentage = values.ytViews && ytAverageViewPercentage !== null && values.igViews && igAverageViewPercentage !== null
        ? ((ytAverageViewPercentage * values.ytViews) + (igAverageViewPercentage * values.igViews)) / watchMetricViews
        : ytAverageViewPercentage ?? igAverageViewPercentage;
	      const ytEngagedViews = ytRow ? Number(ytRow.engagedViews ?? 0) : null;
	      const ytStayed = ytRow && Number(ytRow.views ?? 0) ? (Number(ytRow.engagedViews ?? 0) / Number(ytRow.views ?? 0)) * 100 : null;
	      const igStayed = typeof values.igPost?.skipRate === "number" ? 100 - Number(values.igPost.skipRate) : null;
	      const igEngagedViews = igStayed !== null ? (values.igViews * igStayed) / 100 : null;
	      const engagedValues = [ytEngagedViews, igEngagedViews].filter((value): value is number => value !== null);
	      const engagedViews = engagedValues.length ? engagedValues.reduce((sum, value) => sum + value, 0) : null;
	      const stayedToWatch = values.ytViews && ytStayed !== null && values.igViews && igStayed !== null
	        ? ((ytStayed * values.ytViews) + (igStayed * values.igViews)) / watchMetricViews
	        : ytStayed ?? igStayed;

      return {
	        averageViewPercentage,
	        color: ["#3b82f6", "#84cc16", "#eab308", "#a855f7", "#f43f5e"][values.index % 5],
	        duration: values.ytVideo?.duration ?? values.ttVideo?.duration ?? (igAverageWatchSeconds ? formatDurationSeconds(igAverageWatchSeconds) : "-"),
	        engagedViews,
	        id: [values.ytVideo?.id, values.igPost?.id, values.ttVideo?.id].filter(Boolean).join("-") || String(values.index),
		        imageUrl: values.ytVideo?.imageUrl ?? values.igPost?.imageUrl ?? values.ttVideo?.imageUrl ?? "https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=600",
		        igCaption: values.igPost?.caption ?? null,
		        igAverageViewPercentage,
		        igEngagedViews,
		        igPost: values.igPost,
		        platform: values.platform,
		        performanceLabel: "Not scored",
		        performanceRank: null,
		        performanceReason: "",
		        performanceScore: null,
	        publishedAt: values.ytVideo?.publishedAt ?? values.igPost?.publishedAt ?? values.ttVideo?.publishedAt,
	        stayedToWatch,
	        ttVideo: values.ttVideo,
	        ytStayedToWatch: ytStayed,
	        igStayedToWatch: igStayed,
	        title: values.ytVideo?.title ?? values.igPost?.caption ?? values.ttVideo?.title ?? "Social video",
        totalViews,
        totalLikes,
        likedPercentage,
	        watchHours,
	        watchTimeShare: totalWatchHours ? (watchHours / totalWatchHours) * 100 : 0,
	        ytVideo: values.ytVideo,
	        ytAverageViewPercentage,
	        ytEngagedViews,
        ytViews: values.ytViews,
        igViews: values.igViews,
        ttViews: values.ttViews,
        ytLikes: values.ytLikes,
        igLikes: values.igLikes,
        ttLikes: values.ttLikes
      };
    };

    // 7.1 Map YouTube videos and see if they are linked
    ytVideos.forEach((ytVideo, index) => {
      const linkedIg = igPosts.find((post) => links[post.id] === ytVideo.id);
      const linkedTt = ttVideos.find((video) => ttLinks[video.id] === ytVideo.id);
      const ytViewsNum = parseViews(ytVideo.views);
      const ytLikesNum = parseAnalyticsCount(ytVideo.likes);

      if (linkedIg || linkedTt) {
        if (linkedTt) processedTtIds.add(linkedTt.id);
        if (linkedIg) processedIgIds.add(linkedIg.id);
        const ttViewsNum = linkedTt ? Number(linkedTt.views ?? 0) : 0;
        const igViewsNum = linkedIg ? parseViews(linkedIg.views ?? 0) : 0;
        const ttLikesNum = linkedTt ? Number(linkedTt.likes ?? 0) : 0;
        const igLikesNum = linkedIg ? Number(linkedIg.likes ?? 0) : 0;
        entries.push(rowFrom({
          index,
          ytVideo,
          igPost: linkedIg ?? null,
          ttVideo: linkedTt ?? null,
          platform: "both",
          ytViews: ytViewsNum,
          igViews: igViewsNum,
          ttViews: ttViewsNum,
          ytLikes: ytLikesNum,
          igLikes: igLikesNum,
          ttLikes: ttLikesNum
        }));
      } else {
        entries.push(rowFrom({
          index,
          ytVideo,
          igPost: null,
          ttVideo: null,
          platform: "youtube",
          ytViews: ytViewsNum,
          igViews: 0,
          ttViews: 0,
          ytLikes: ytLikesNum,
          igLikes: 0,
          ttLikes: 0
        }));
      }
    });

    // 7.2 Map remaining Instagram posts
    igPosts.forEach((igPost, index) => {
      if (!processedIgIds.has(igPost.id)) {
        const igViewsNum = parseViews(igPost.views ?? 0);
        entries.push(rowFrom({
          index: ytVideos.length + index,
          ytVideo: null,
          igPost,
          ttVideo: null,
          platform: "instagram",
          ytViews: 0,
          igViews: igViewsNum,
          ttViews: 0,
          ytLikes: 0,
          igLikes: Number(igPost.likes ?? 0),
          ttLikes: 0
        }));
      }
    });

    // 7.3 Map remaining TikTok videos
    ttVideos.forEach((ttVideo, index) => {
      if (!processedTtIds.has(ttVideo.id)) {
        entries.push(rowFrom({
          index: ytVideos.length + igPosts.length + index,
          ytVideo: null,
          igPost: null,
          ttVideo,
          platform: "tiktok",
          ytViews: 0,
          igViews: 0,
          ttViews: Number(ttVideo.views ?? 0),
          ytLikes: 0,
          igLikes: 0,
          ttLikes: Number(ttVideo.likes ?? 0)
        }));
      }
    });

    const viewPercentiles = entries.map((entry) => Math.log1p(entry.totalViews));
    const likedPercentiles = entries
      .map((entry) => entry.likedPercentage)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const averageViewPercentiles = entries
      .map((entry) => entry.averageViewPercentage)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const stayedPercentiles = entries
      .map((entry) => entry.stayedToWatch)
      .filter((value): value is number => value !== null && Number.isFinite(value));

    const scoredEntries = entries
      .map((entry) => ({
        ...entry,
        performanceScore: calculateVideoPerformanceScore({
          averageViewPercentiles,
          averageViewPercentage: entry.averageViewPercentage,
          likedPercentiles,
          likedPercentage: entry.likedPercentage,
          stayedPercentiles,
          stayedToWatch: entry.stayedToWatch,
          totalViews: entry.totalViews,
          viewPercentiles
        })
      }));

    const rankedEntries = [...scoredEntries].sort((left, right) =>
      compareNullableNumberForSort(left.performanceScore, right.performanceScore, "desc") ||
      right.totalViews - left.totalViews ||
      compareText(left.title, right.title)
    );

    const rankById = new Map(rankedEntries.map((entry, index) => [entry.id, index + 1]));
    const formatReasonNumber = (value: number) => formatExactCount(value);
    const formatReasonPercent = (value: number | null) =>
      value === null ? null : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value || 0)}%`;

    return scoredEntries
      .map((entry) => {
        const rank = rankById.get(entry.id) ?? null;
        const reasons = [
          `${formatReasonNumber(entry.totalViews)} views`,
          entry.likedPercentage !== null ? `${formatReasonPercent(entry.likedPercentage)} liked` : null,
          entry.averageViewPercentage !== null ? `${formatReasonPercent(entry.averageViewPercentage)} average watched` : null,
          entry.stayedToWatch !== null ? `${formatReasonPercent(entry.stayedToWatch)} stayed` : null
        ].filter(Boolean).join(" · ");

        return {
          ...entry,
          performanceLabel: videoPerformanceLabel(entry.performanceScore, rank ?? scoredEntries.length, scoredEntries.length),
          performanceRank: rank,
          performanceReason: reasons
        };
      })
      .sort((a, b) =>
        compareNullableNumberForSort(a.performanceScore, b.performanceScore, "desc") ||
        b.totalViews - a.totalViews ||
        compareText(a.title, b.title)
      );
	  }, [formatDurationSeconds, igPosts, igVideoDurations, links, parseDurationSeconds, parseViews, ttLinks, ttVideos, ytAnalytics, ytVideos]);

  const sortedCombinedEntries = useMemo(() => {
    if (!combinedPerformanceSort) return combinedEntries;

    const { direction, key } = combinedPerformanceSort;
    return [...combinedEntries].sort((left, right) => {
      let result = 0;

      if (key === "title") {
        result = compareText(left.title, right.title);
        result = direction === "asc" ? result : result * -1;
      } else if (key === "duration") {
        result = compareNullableNumberForSort(durationToSeconds(left.duration), durationToSeconds(right.duration), direction);
      } else if (key === "publishedAt") {
        result = compareNullableNumberForSort(timestampFromDate(left.publishedAt), timestampFromDate(right.publishedAt), direction);
      } else {
        result = compareNullableNumberForSort(left[key], right[key], direction);
      }

      return result === 0 ? compareText(left.title, right.title) : result;
    });
  }, [combinedEntries, combinedPerformanceSort]);

  const toggleCombinedPerformanceSort = (key: CombinedPerformanceSortKey) => {
    setCombinedPerformanceSort((current) => {
      const defaultDirection: SortDirection = key === "title" || key === "duration" ? "asc" : "desc";
      if (!current || current.key !== key) return { key, direction: defaultDirection };
      return { key, direction: current.direction === "asc" ? "desc" : "asc" };
    });
  };

  const combinedSortButton = (key: CombinedPerformanceSortKey, label: string) => {
    const active = combinedPerformanceSort?.key === key;
    const direction = active ? combinedPerformanceSort.direction : undefined;

    return (
      <button
        aria-label={`Sort by ${label}${active ? ` ${direction === "asc" ? "descending" : "ascending"}` : ""}`}
        aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
        className={`table-sort-button ${active ? "active" : ""}`}
        onClick={() => toggleCombinedPerformanceSort(key)}
        type="button"
      >
        <span>{label}</span>
        <span className="table-sort-indicator" aria-hidden="true">
          {active ? (direction === "asc" ? <ChevronUpIcon /> : <ChevronDownIcon />) : <span className="table-sort-placeholder" />}
        </span>
      </button>
    );
  };

  const combinedVideoSortControls = () => (
    <div className="video-header-sort-box">
      <span>Video</span>
      <div>
        {combinedSortButton("publishedAt", "Date")}
        {combinedSortButton("duration", "Duration")}
      </div>
    </div>
  );

  const formatAnalyticsNumber = (value: number) =>
    new Intl.NumberFormat("en-GB", { maximumFractionDigits: value >= 100 ? 0 : 1 }).format(value || 0);

  const formatMetricCount = (value: number) => formatExactCount(value);

  const formatAnalyticsPercent = (value: number | null) =>
    value === null ? "-" : `${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 }).format(value || 0)}%`;

  const formatWeeklyChange = (value: number | null) => {
    if (value === null) return "-";
    const formatted = new Intl.NumberFormat("en-GB", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 1
    }).format(Math.abs(value));
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}${formatted}%`;
  };

  const weeklyChangeTone = (value: number | null) => {
    if (value === null || value === 0) return "amber";
    return value > 0 ? "green" : "red";
  };

  const weeklyMetricCell = (value: ReactNode, changePercent: number | null, strong = false) => (
    <span className="weekly-metric-cell">
      <span className="weekly-metric-value">{strong ? <strong>{value}</strong> : value}</span>
      {changePercent !== null && (
        <span className={`weekly-metric-change ${weeklyChangeTone(changePercent)}`}>
          {formatWeeklyChange(changePercent)}
        </span>
      )}
    </span>
  );

  const performanceScoreTone = (score: number | null) => {
    if (score === null) return "muted";
    if (score >= 85) return "excellent";
    if (score >= 70) return "good";
    if (score >= 50) return "average";
    return "weak";
  };

	  const combinedPerformanceTotals = useMemo(() => {
	    const totalViews = combinedEntries.reduce((sum, entry) => sum + entry.totalViews, 0);
	    const totalLikes = combinedEntries.reduce((sum, entry) => sum + entry.totalLikes, 0);
	    const ytViews = combinedEntries.reduce((sum, entry) => sum + entry.ytViews, 0);
	    const igViews = combinedEntries.reduce((sum, entry) => sum + entry.igViews, 0);
	    const ttViews = combinedEntries.reduce((sum, entry) => sum + entry.ttViews, 0);
	    const ytLikes = combinedEntries.reduce((sum, entry) => sum + entry.ytLikes, 0);
	    const igLikes = combinedEntries.reduce((sum, entry) => sum + entry.igLikes, 0);
	    const ttLikes = combinedEntries.reduce((sum, entry) => sum + entry.ttLikes, 0);
	    const watchMetricViews = ytViews + igViews;
	    const watchHours = combinedEntries.reduce((sum, entry) => sum + entry.watchHours, 0);
	    const likedPercentage = totalViews ? (totalLikes / totalViews) * 100 : null;
		    const engagedViews = combinedEntries.reduce((sum, entry) => sum + Number(entry.engagedViews ?? 0), 0);
		    const ytEngagedViews = combinedEntries.reduce((sum, entry) => sum + Number(entry.ytEngagedViews ?? 0), 0);
		    const igEngagedViews = combinedEntries.reduce((sum, entry) => sum + Number(entry.igEngagedViews ?? 0), 0);
		    const averageViewRows = combinedEntries.filter((entry) => entry.averageViewPercentage !== null);
		    const ytAverageRows = combinedEntries.filter((entry) => entry.ytAverageViewPercentage !== null && entry.ytViews > 0);
		    const igAverageRows = combinedEntries.filter((entry) => entry.igAverageViewPercentage !== null && entry.igViews > 0);
		    const stayedRows = combinedEntries.filter((entry) => entry.stayedToWatch !== null);
		    const ytStayedRows = combinedEntries.filter((entry) => entry.ytStayedToWatch !== null && entry.ytViews > 0);
		    const igStayedRows = combinedEntries.filter((entry) => entry.igStayedToWatch !== null && entry.igViews > 0);
	    const averageViewPercentage = averageViewRows.length && watchMetricViews
	      ? averageViewRows.reduce((sum, entry) => sum + Number(entry.averageViewPercentage ?? 0) * (entry.ytViews + entry.igViews), 0) / watchMetricViews
	      : null;
	    const ytAverageViewPercentage = ytAverageRows.length && ytViews
	      ? ytAverageRows.reduce((sum, entry) => sum + Number(entry.ytAverageViewPercentage ?? 0) * entry.ytViews, 0) / ytViews
	      : null;
	    const igAverageViewPercentage = igAverageRows.length && igViews
	      ? igAverageRows.reduce((sum, entry) => sum + Number(entry.igAverageViewPercentage ?? 0) * entry.igViews, 0) / igViews
	      : null;
		    const stayedToWatch = stayedRows.length && watchMetricViews
		      ? stayedRows.reduce((sum, entry) => sum + Number(entry.stayedToWatch ?? 0) * (entry.ytViews + entry.igViews), 0) / watchMetricViews
		      : null;
		    const ytStayedToWatch = ytStayedRows.length && ytViews
		      ? ytStayedRows.reduce((sum, entry) => sum + Number(entry.ytStayedToWatch ?? 0) * entry.ytViews, 0) / ytViews
		      : null;
		    const igStayedToWatch = igStayedRows.length && igViews
		      ? igStayedRows.reduce((sum, entry) => sum + Number(entry.igStayedToWatch ?? 0) * entry.igViews, 0) / igViews
		      : null;

		    return { averageViewPercentage, engagedViews, igAverageViewPercentage, igEngagedViews, igLikes, igStayedToWatch, igViews, likedPercentage, stayedToWatch, totalLikes, totalViews, ttLikes, ttViews, watchHours, ytAverageViewPercentage, ytEngagedViews, ytLikes, ytStayedToWatch, ytViews };
		  }, [combinedEntries]);

  const expandedViewMetric = (views: number) => {
    if (views <= 0) return "-";

    return (
      <span className="expanded-view-metric">
        <span className="expanded-view-views">{formatMetricCount(views)}</span>
      </span>
    );
  };

  const likedMetric = (percentage: number | null, likes: number) => (
    <span className="liked-percentage-metric">
      <span className="liked-percentage-value">{formatAnalyticsPercent(percentage)}</span>
      <span className="liked-percentage-likes">{formatMetricCount(likes)} likes</span>
    </span>
  );

  const platformLikedMetric = (likes: number, views: number) => {
    if (likes <= 0 && views <= 0) return "-";
    return likedMetric(views ? (likes / views) * 100 : null, likes);
  };

  return (
    <div className="weekly-views-layout-container">
      {/* 1. WEEKLY VIEWS GRAPH & SUMMARY TABLE */}
      <div className="weekly-views-dashboard-block">
        <div className="weekly-views-block-header">
          <h2>Weekly Views Trend (Combined Platforms)</h2>
          <p>
            Displays current view totals grouped by the week each YouTube video, Instagram Reel, and TikTok video was released.
            {weeklyViewsDateRange ? ` Date range: ${weeklyViewsDateRange}.` : ""}
          </p>
        </div>

        {weeklyViewsData.length > 0 ? (
          <div className="weekly-views-layout">
            <section className="weekly-views-graph" aria-label="Weekly views graph">
              {(() => {
                const svgWidth = 650;
                const svgHeight = 250;
                const paddingLeft = 55;
                const paddingRight = 20;
                const paddingTop = 30;
                const paddingBottom = 40;

                const chartWidth = svgWidth - paddingLeft - paddingRight;
                const chartHeight = svgHeight - paddingTop - paddingBottom;

                const points = weeklyViewsData.map((week, index) => {
                  const ratio = weeklyViewsData.length > 1 ? index / (weeklyViewsData.length - 1) : 0.5;
                  const x = paddingLeft + ratio * chartWidth;
                  const baseline = paddingTop + chartHeight;
                  const yInstagram = baseline - (week.igViews / weeklyViewsMax) * chartHeight;
                  const yTikTok = baseline - ((week.igViews + week.ttViews) / weeklyViewsMax) * chartHeight;
                  const yTotal = baseline - (week.totalViews / weeklyViewsMax) * chartHeight;
                  return {
                    baseline,
                    index,
                    week,
                    x,
                    yInstagram,
                    yTikTok,
                    yTotal,
                  };
                });

                const steps = [0, 0.25, 0.5, 0.75, 1];
                const instagramLineD = points.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.yInstagram.toFixed(2)}`).join(" ");
                const tiktokLineD = points.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.yTikTok.toFixed(2)}`).join(" ");
                const totalLineD = points.map((p, index) => `${index === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.yTotal.toFixed(2)}`).join(" ");
                const instagramAreaD = points.length
                  ? `${instagramLineD} L ${points[points.length - 1].x.toFixed(2)} ${(paddingTop + chartHeight).toFixed(2)} L ${points[0].x.toFixed(2)} ${(paddingTop + chartHeight).toFixed(2)} Z`
                  : "";
                const tiktokAreaD = points.length
                  ? `${tiktokLineD} L ${[...points].reverse().map((p) => `${p.x.toFixed(2)} ${p.yInstagram.toFixed(2)}`).join(" L ")} Z`
                  : "";
                const youtubeAreaD = points.length
                  ? `${totalLineD} L ${[...points].reverse().map((p) => `${p.x.toFixed(2)} ${p.yTikTok.toFixed(2)}`).join(" L ")} Z`
                  : "";

                return (
                  <div style={{ position: "relative", width: "100%", height: "100%", minHeight: "260px" }}>
                    <div className="weekly-views-legend" aria-hidden="true">
                      <span><i className="youtube" />YouTube</span>
                      <span><i className="instagram" />Instagram</span>
                      <span><i className="tiktok" />TikTok</span>
                    </div>
                    <svg
                      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                      className="weekly-views-svg"
                      preserveAspectRatio="xMidYMid meet"
                      onMouseLeave={() => setHoveredWeekIndex(null)}
                    >
                      <defs>
                        <linearGradient id="weeklyViewsGradient" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="#818cf8" />
                          <stop offset="50%" stopColor="#ec4899" />
                          <stop offset="100%" stopColor="#f43f5e" />
                        </linearGradient>
                        <linearGradient id="weeklyViewsAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#818cf8" stopOpacity={0.24} />
                          <stop offset="100%" stopColor="#ec4899" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>

                      {steps.map((step) => {
                        const yGrid = paddingTop + step * chartHeight;
                        const labelVal = Math.round((1 - step) * weeklyViewsMax);

                        return (
                          <g key={step}>
                            <line
                              x1={paddingLeft}
                              y1={yGrid}
                              x2={svgWidth - paddingRight}
                              y2={yGrid}
                              className="weekly-views-gridline"
                            />
                            <text
                              x={paddingLeft - 10}
                              y={yGrid + 4}
                              textAnchor="end"
                              className="weekly-views-axis-label-y"
                            >
                              {formatAnalyticsNumber(labelVal)}
                            </text>
                          </g>
                        );
                      })}

                      {instagramAreaD && <path d={instagramAreaD} className="weekly-views-area-instagram" />}
                      {tiktokAreaD && <path d={tiktokAreaD} className="weekly-views-area-tiktok" />}
                      {youtubeAreaD && <path d={youtubeAreaD} className="weekly-views-area-youtube" />}
                      {instagramLineD && <path d={instagramLineD} className="weekly-views-line-instagram" />}
                      {tiktokLineD && <path d={tiktokLineD} className="weekly-views-line-tiktok" />}
                      {totalLineD && <path d={totalLineD} className="weekly-views-line-total" />}

                      {hoveredWeekIndex !== null && points[hoveredWeekIndex] && (
                        <line
                          x1={points[hoveredWeekIndex].x}
                          y1={paddingTop}
                          x2={points[hoveredWeekIndex].x}
                          y2={paddingTop + chartHeight}
                          className="weekly-views-guide-line"
                        />
                      )}

                      {points.map((p) => (
                        <text
                          key={p.week.startDate}
                          x={p.x}
                          y={paddingTop + chartHeight + 20}
                          textAnchor="middle"
                          className="weekly-views-axis-label-x"
                        >
                          {formatShortWeeklyDate(p.week.startDate)}
                        </text>
                      ))}

                      {points.map((p) => {
                        const colWidth = chartWidth / (weeklyViewsData.length || 1);
                        const rectX = p.x - colWidth / 2;

                        return (
                          <rect
                            key={p.week.startDate}
                            x={rectX}
                            y={paddingTop}
                            width={colWidth}
                            height={chartHeight}
                            fill="transparent"
                            style={{ cursor: "pointer" }}
                            onMouseEnter={() => setHoveredWeekIndex(p.index)}
                          />
                        );
                      })}
                    </svg>

                    {hoveredWeekIndex !== null && points[hoveredWeekIndex] && (() => {
                      const activeP = points[hoveredWeekIndex];
                      const leftPct = (activeP.x / svgWidth) * 100;
                      const topPct = (activeP.yTotal / svgHeight) * 100;

                      return (
                        <div
                          className="weekly-views-tooltip"
                          style={{
                            left: `${leftPct}%`,
                            top: `${topPct - 8}%`,
                          }}
                        >
                          <div className="tooltip-views">
                            <strong>{formatAnalyticsNumber(activeP.week.totalViews)}</strong>
                            <span>combined views</span>
                          </div>
                          <div className="tooltip-sub-details" style={{ fontSize: '0.7rem', color: '#cbd5e1', marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                            <span>YouTube: {formatAnalyticsNumber(activeP.week.ytViews)}</span>
                            <span>Instagram: {formatAnalyticsNumber(activeP.week.igViews)}</span>
                            <span>TikTok: {formatAnalyticsNumber(activeP.week.ttViews)}</span>
                          </div>
                          <div className="tooltip-dates" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 4, marginTop: 4 }}>
                            {formatShortWeeklyDate(activeP.week.startDate)} - {formatShortWeeklyDate(activeP.week.endDate)}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </section>

            <div className="weekly-views-table-wrap">
              <table className="weekly-views-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>YT Views</th>
                    <th>IG Views</th>
                    <th>TikTok Views</th>
                    <th>Views</th>
                    <th>Videos</th>
                    <th>Avg / Video</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyViewsData.map((week) => (
                    <tr key={week.startDate}>
                      <td>{formatShortWeeklyDate(week.startDate)}</td>
                      <td>{weeklyMetricCell(formatAnalyticsNumber(week.ytViews), week.ytViewsChangePercent)}</td>
                      <td>{weeklyMetricCell(formatAnalyticsNumber(week.igViews), week.igViewsChangePercent)}</td>
                      <td>{weeklyMetricCell(formatAnalyticsNumber(week.ttViews), week.ttViewsChangePercent)}</td>
                      <td>{weeklyMetricCell(formatAnalyticsNumber(week.totalViews), week.totalViewsChangePercent, true)}</td>
                      <td>{weeklyMetricCell(formatAnalyticsNumber(week.releasedVideoCount), week.releasedVideoCountChangePercent)}</td>
                      <td>{weeklyMetricCell(week.averageViewsPerReleasedVideo === null ? "-" : formatAnalyticsNumber(week.averageViewsPerReleasedVideo), week.averageViewsChangePercent)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th>{formatAnalyticsNumber(weeklyViewsTotals.ytViews)}</th>
                    <th>{formatAnalyticsNumber(weeklyViewsTotals.igViews)}</th>
                    <th>{formatAnalyticsNumber(weeklyViewsTotals.ttViews)}</th>
                    <th>{formatAnalyticsNumber(weeklyViewsTotals.totalViews)}</th>
                    <th>{formatAnalyticsNumber(weeklyViewsTotals.releasedVideoCount)}</th>
                    <th>{weeklyViewsTotals.averageViewsPerReleasedVideo === null ? "-" : formatAnalyticsNumber(weeklyViewsTotals.averageViewsPerReleasedVideo)}</th>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ) : (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700 }}>No weekly view data yet.</span>
            <small style={{ color: '#64748b', marginTop: 4 }}>Please connect a YouTube/Instagram account to populate analytics.</small>
          </div>
        )}
      </div>

      {/* 2. COMBINED CONTENT LIBRARY TABLE (DEDUPLICATED) */}
      <div className="weekly-views-dashboard-block" style={{ marginTop: 24 }}>
        <div className="weekly-views-block-header">
          <h2>All Videos & Reels Performance</h2>
          <p>
            Displays connected YouTube videos, Instagram Reels, and TikTok videos with linked items consolidated into one performance row.
          </p>
        </div>

        {combinedEntries.length > 0 ? (
          <div className="youtube-analytics-table-wrap combined-performance-table-wrap">
            <table className="youtube-analytics-table combined-performance-table">
              <thead>
                <tr>
                  <th className="content-column metric-help sortable-heading" data-definition="Content duration, publish date, platform, thumbnail, and title." tabIndex={0}>{combinedVideoSortControls()}</th>
                  <th className="metric-help sortable-heading" data-definition="Combined YouTube, Instagram, and TikTok views for this row. Linked items are merged." tabIndex={0}>
                    <span className="expandable-metric-heading">
                      {combinedSortButton("totalViews", "Views")}
                      <button
                        aria-label={platformViewsExpanded ? "Hide platform view split" : "Show platform view split"}
                        className="metric-expand-toggle"
                        onClick={() => setPlatformViewsExpanded((expanded) => !expanded)}
                        title={platformViewsExpanded ? "Hide YouTube, Instagram, and TikTok views" : "Show YouTube, Instagram, and TikTok views"}
                        type="button"
                      >
                        {platformViewsExpanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                      </button>
                    </span>
	                  </th>
	                  {platformViewsExpanded && (
	                    <>
	                      <th className="expanded-metric-column expanded-metric-column-start metric-help sortable-heading" data-definition="YouTube views for this row." tabIndex={0}>{combinedSortButton("ytViews", "YouTube views")}</th>
	                      <th className="expanded-metric-column metric-help sortable-heading" data-definition="Instagram views for this row." tabIndex={0}>{combinedSortButton("igViews", "Instagram views")}</th>
	                      <th className="expanded-metric-column metric-help sortable-heading" data-definition="TikTok views for this row. TikTok does not affect average duration watched or stayed-to-watch." tabIndex={0}>{combinedSortButton("ttViews", "TikTok views")}</th>
	                    </>
	                  )}
                  <th className="metric-help sortable-heading" data-definition="Total likes divided by total views for this row, shown as a percentage." tabIndex={0}>
                    <span className="expandable-metric-heading">
                      {combinedSortButton("likedPercentage", "Percentage liked")}
                      <button
                        aria-label={likedByPlatformExpanded ? "Hide platform like split" : "Show platform like split"}
                        className="metric-expand-toggle"
                        onClick={() => setLikedByPlatformExpanded((expanded) => !expanded)}
                        title={likedByPlatformExpanded ? "Hide YouTube, Instagram, and TikTok likes" : "Show YouTube, Instagram, and TikTok likes"}
                        type="button"
                      >
                        {likedByPlatformExpanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                      </button>
                    </span>
                  </th>
                  {likedByPlatformExpanded && (
                    <>
                      <th className="expanded-metric-column expanded-metric-column-start metric-help sortable-heading" data-definition="YouTube likes for this row, with likes divided by YouTube views when available." tabIndex={0}>{combinedSortButton("ytLikes", "YouTube likes")}</th>
                      <th className="expanded-metric-column metric-help sortable-heading" data-definition="Instagram likes for this row, with likes divided by Instagram views when available." tabIndex={0}>{combinedSortButton("igLikes", "Instagram likes")}</th>
                      <th className="expanded-metric-column metric-help sortable-heading" data-definition="TikTok likes for this row, with likes divided by TikTok views when available." tabIndex={0}>{combinedSortButton("ttLikes", "TikTok likes")}</th>
                    </>
                  )}
		                  <th className="metric-help sortable-heading" data-definition="Combined average percentage viewed. YouTube uses Analytics average percentage viewed; Instagram is estimated from average watch time divided by reel duration." tabIndex={0}>
	                    <span className="expandable-metric-heading">
	                      {combinedSortButton("averageViewPercentage", "Average duration watched")}
	                      <button
	                        aria-label={averageViewExpanded ? "Hide platform average viewed split" : "Show platform average viewed split"}
	                        className="metric-expand-toggle"
	                        onClick={() => setAverageViewExpanded((expanded) => !expanded)}
	                        title={averageViewExpanded ? "Hide YouTube and Instagram average viewed" : "Show YouTube and Instagram average viewed"}
	                        type="button"
	                      >
	                        {averageViewExpanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
	                      </button>
	                    </span>
	                  </th>
		                  {averageViewExpanded && (
		                    <>
		                      <th className="expanded-metric-column expanded-metric-column-start metric-help sortable-heading" data-definition="YouTube average percentage viewed from YouTube Analytics." tabIndex={0}>{combinedSortButton("ytAverageViewPercentage", "YouTube avg viewed")}</th>
		                      <th className="expanded-metric-column metric-help sortable-heading" data-definition="Instagram average watch time divided by reel duration. A dash means duration or watch time is unavailable." tabIndex={0}>{combinedSortButton("igAverageViewPercentage", "Instagram avg viewed")}</th>
		                    </>
		                  )}
	                  <th className="metric-help sortable-heading" data-definition="Combined stayed-to-watch rate. YouTube uses engaged views divided by views; Instagram uses 100 minus skip rate. Linked rows are weighted by platform views." tabIndex={0}>
	                    <span className="expandable-metric-heading">
	                      {combinedSortButton("stayedToWatch", "Stayed to watch")}
	                      <button
	                        aria-label={stayedToWatchExpanded ? "Hide platform stayed-to-watch split" : "Show platform stayed-to-watch split"}
	                        className="metric-expand-toggle"
	                        onClick={() => setStayedToWatchExpanded((expanded) => !expanded)}
	                        title={stayedToWatchExpanded ? "Hide YouTube and Instagram stayed-to-watch" : "Show YouTube and Instagram stayed-to-watch"}
	                        type="button"
	                      >
	                        {stayedToWatchExpanded ? <Minus size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
	                      </button>
	                    </span>
	                  </th>
		                  {stayedToWatchExpanded && (
		                    <>
		                      <th className="expanded-metric-column expanded-metric-column-start metric-help sortable-heading" data-definition="YouTube engaged views divided by YouTube views." tabIndex={0}>{combinedSortButton("ytStayedToWatch", "YouTube stayed")}</th>
		                      <th className="expanded-metric-column metric-help sortable-heading" data-definition="Instagram stayed-to-watch estimated as 100 minus skip rate." tabIndex={0}>{combinedSortButton("igStayedToWatch", "Instagram stayed")}</th>
		                    </>
		                  )}
                </tr>
              </thead>
              <tbody>
                {sortedCombinedEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="analytics-content-cell combined-performance-content-cell">
                      <span className="analytics-row-accent" style={{ background: entry.color }} />
                      <div className="combined-video-cell">
                        <button
                          className="combined-video-thumb-button"
                          onClick={() => {
                            const player = entry.ytVideo
                              ? {
                                duration: entry.ytVideo.duration,
                                embedUrl: `https://www.youtube.com/embed/${encodeURIComponent(entry.ytVideo.id)}?autoplay=1&rel=0`,
                                imageUrl: entry.ytVideo.imageUrl,
                                platform: "youtube" as const,
                                title: entry.ytVideo.title,
                                url: `https://www.youtube.com/watch?v=${encodeURIComponent(entry.ytVideo.id)}`
                              }
                              : entry.igPost
                                ? {
                                  imageUrl: entry.igPost.imageUrl,
                                  platform: "instagram" as const,
                                  title: entry.igPost.caption || "Instagram media",
                                  url: entry.igPost.mediaUrl || entry.igPost.permalink
                                }
                                : entry.ttVideo
                                  ? {
                                    duration: entry.ttVideo.duration,
                                    embedUrl: entry.ttVideo.embedUrl,
                                    imageUrl: entry.ttVideo.imageUrl,
                                    platform: "tiktok" as const,
                                    title: entry.ttVideo.title || "TikTok video",
                                    url: entry.ttVideo.url
                                  }
                                  : null;

                            if (player) setVideoPlayer(player);
                          }}
                          type="button"
                          aria-label={`Play ${entry.title}`}
                        >
                          <img src={entry.imageUrl} alt="" />
                          <span className="video-thumbnail-play" aria-hidden="true"><Play size={12} fill="currentColor" /></span>
                        </button>
                        <div className="combined-video-copy">
                          <span className="combined-video-title-row">
                            <span className="combined-video-title" title={entry.title}>{entry.title}</span>
                            <span
                              className={`video-performance-score-badge ${performanceScoreTone(entry.performanceScore)}`}
                              title={entry.performanceReason}
                            >
                              {entry.performanceScore === null ? "-" : entry.performanceScore}
                            </span>
                          </span>
                          <div className="combined-video-meta">
                            <span className="analytics-duration-pill">{entry.duration}</span>
                            <span>{formatPublishDate(entry.publishedAt)}</span>
                            {entry.platform === "both" && (
                              <span className="platform-badge both" aria-label="Linked social content">
                                <YouTubeIcon />
                                {entry.igPost && <InstagramIcon />}
                                {entry.ttVideo && <TikTokIcon />}
                              </span>
                            )}
                            {entry.platform === "youtube" && (
                              <span className="platform-badge youtube" aria-label="YouTube">
                                <YouTubeIcon />
                              </span>
                            )}
                            {entry.platform === "instagram" && (
                              <span className="platform-badge instagram" aria-label="Instagram">
                                <InstagramIcon />
                              </span>
                            )}
                            {entry.platform === "tiktok" && (
                              <span className="platform-badge tiktok" aria-label="TikTok">
                                <TikTokIcon />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
	                    <td>
	                      {expandedViewMetric(entry.totalViews)}
	                    </td>
	                    {platformViewsExpanded && (
	                      <>
	                        <td className="expanded-metric-column expanded-metric-column-start">{expandedViewMetric(entry.ytViews)}</td>
	                        <td className="expanded-metric-column">{expandedViewMetric(entry.igViews)}</td>
	                        <td className="expanded-metric-column">{expandedViewMetric(entry.ttViews)}</td>
	                      </>
		                    )}
		                    <td>{likedMetric(entry.likedPercentage, entry.totalLikes)}</td>
		                    {likedByPlatformExpanded && (
		                      <>
		                        <td className="expanded-metric-column expanded-metric-column-start">{platformLikedMetric(entry.ytLikes, entry.ytViews)}</td>
		                        <td className="expanded-metric-column">{platformLikedMetric(entry.igLikes, entry.igViews)}</td>
		                        <td className="expanded-metric-column">{platformLikedMetric(entry.ttLikes, entry.ttViews)}</td>
		                      </>
		                    )}
		                    <td>{formatAnalyticsPercent(entry.averageViewPercentage)}</td>
		                    {averageViewExpanded && (
		                      <>
		                        <td className="expanded-metric-column expanded-metric-column-start">{formatAnalyticsPercent(entry.ytAverageViewPercentage)}</td>
		                        <td className="expanded-metric-column">{formatAnalyticsPercent(entry.igAverageViewPercentage)}</td>
		                      </>
		                    )}
			                    <td>{formatAnalyticsPercent(entry.stayedToWatch)}</td>
			                    {stayedToWatchExpanded && (
			                      <>
			                        <td className="expanded-metric-column expanded-metric-column-start">{formatAnalyticsPercent(entry.ytStayedToWatch)}</td>
			                        <td className="expanded-metric-column">{formatAnalyticsPercent(entry.igStayedToWatch)}</td>
			                      </>
			                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
	                <tr>
	                  <th>Total / average</th>
	                  <th>{formatAnalyticsNumber(combinedPerformanceTotals.totalViews)}</th>
	                  {platformViewsExpanded && (
	                    <>
	                      <th className="expanded-metric-column expanded-metric-column-start">{expandedViewMetric(combinedPerformanceTotals.ytViews)}</th>
	                      <th className="expanded-metric-column">{expandedViewMetric(combinedPerformanceTotals.igViews)}</th>
	                      <th className="expanded-metric-column">{expandedViewMetric(combinedPerformanceTotals.ttViews)}</th>
	                    </>
		                  )}
		                  <th>{likedMetric(combinedPerformanceTotals.likedPercentage, combinedPerformanceTotals.totalLikes)}</th>
		                  {likedByPlatformExpanded && (
		                    <>
		                      <th className="expanded-metric-column expanded-metric-column-start">{platformLikedMetric(combinedPerformanceTotals.ytLikes, combinedPerformanceTotals.ytViews)}</th>
		                      <th className="expanded-metric-column">{platformLikedMetric(combinedPerformanceTotals.igLikes, combinedPerformanceTotals.igViews)}</th>
		                      <th className="expanded-metric-column">{platformLikedMetric(combinedPerformanceTotals.ttLikes, combinedPerformanceTotals.ttViews)}</th>
		                    </>
		                  )}
		                  <th>{formatAnalyticsPercent(combinedPerformanceTotals.averageViewPercentage)}</th>
		                  {averageViewExpanded && (
		                    <>
		                      <th className="expanded-metric-column expanded-metric-column-start">{formatAnalyticsPercent(combinedPerformanceTotals.ytAverageViewPercentage)}</th>
		                      <th className="expanded-metric-column">{formatAnalyticsPercent(combinedPerformanceTotals.igAverageViewPercentage)}</th>
		                    </>
		                  )}
			                  <th>{formatAnalyticsPercent(combinedPerformanceTotals.stayedToWatch)}</th>
			                  {stayedToWatchExpanded && (
			                    <>
			                      <th className="expanded-metric-column expanded-metric-column-start">{formatAnalyticsPercent(combinedPerformanceTotals.ytStayedToWatch)}</th>
			                      <th className="expanded-metric-column">{formatAnalyticsPercent(combinedPerformanceTotals.igStayedToWatch)}</th>
			                    </>
			                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="dashboard-sparkline-empty" style={{ minHeight: 140 }}>
            <InfoIcon />
            <span style={{ marginTop: 8, fontWeight: 700 }}>No video or reel content found.</span>
            <small style={{ color: '#64748b', marginTop: 4 }}>Connect YouTube Sync or Instagram Sync tabs to retrieve lists.</small>
          </div>
        )}
      </div>
      {videoPlayer && <VideoPlayerModal player={videoPlayer} onClose={() => setVideoPlayer(null)} />}
    </div>
  );
}

function ReaderDashboard({
  busy,
  data,
  error,
  onNavigate,

  onRefresh,
  onContentTabClick,
  onSignInWithGoogle,
  onSignOut,
  selectedUserId,
  session,
  activeTab,
  contentRefreshSignal,
  setActiveTab
}: {
  busy: boolean;
  data: ReaderDashboardData | null;
  error: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onContentTabClick: () => void;
  onSignInWithGoogle: () => void;
  onSignOut: () => void;
  selectedUserId: string | null;
  session: Session | null;
  activeTab: DashboardTab;
  contentRefreshSignal: number;
  setActiveTab: (tab: DashboardTab) => void;
}) {
  const email = session?.user.email ?? "";
  const isOwner = email.toLowerCase() === "r.lobo2003@gmail.com";
  const storageTotal = data?.storage.totalBytes ?? 0;
  const dashboardUsers = data?.users ?? [];
  const selectedUser = selectedUserId ? dashboardUsers.find((item) => item.id === selectedUserId) ?? null : null;
  const selectedBooks = selectedUser?.books ?? [];
  const selectedImages = selectedUser?.images ?? [];
  const selectedBookStorageBytes = selectedUser?.bookStorageBytes ?? 0;
  const selectedImageStorageBytes = selectedUser?.imageStorageBytes ?? 0;
  const selectedJourney = buildUserJourneyFromData(selectedUser);
  const selectedUserTimeline = selectedUser?.timeline?.length ? selectedUser.timeline : buildUserTimelineFromData(selectedUser);
  const timeline = data?.timeline?.length ? data.timeline : buildDashboardTimelineFromUsers(data);
  const [linksVersion, setLinksVersion] = useState(0);

  if (!session) {
    return (
      <main className="dashboard-shell auth-dashboard-shell">
        <section className="dashboard-auth-panel">
          <button className="dashboard-primary-button" disabled={busy} onClick={onSignInWithGoogle} type="button">
            {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Users size={18} aria-hidden="true" />}
            <span>Sign in with Google</span>
          </button>
        </section>
      </main>
    );
  }

  if (!isOwner) {
    return (
      <main className="dashboard-shell auth-dashboard-shell">
        <section className="dashboard-auth-panel">
          <p className="dashboard-access-message">You do not have access</p>
        </section>
      </main>
    );
  }

  if (selectedUserId) {
    return (
      <main className="dashboard-shell">
        <header className="dashboard-topbar">
          <div>
            <span className="dashboard-kicker">Reader project</span>
            <h1>User detail</h1>
          </div>
          <div className="dashboard-actions">
            <button className="dashboard-secondary-button" onClick={() => onNavigate("/dashboard")} type="button">
              <ChevronLeft size={17} aria-hidden="true" />
              <span>Users</span>
            </button>
            <button className="dashboard-secondary-button" disabled={busy} onClick={onRefresh} type="button">
              {busy ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
              <span>Refresh</span>
            </button>
            <button className="dashboard-secondary-button" onClick={onSignOut} type="button">
              <LogOut size={17} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </header>

        {error && <div className="dashboard-error">{error}</div>}

        {!data && !error && (
          <div className="dashboard-loading">
            <Loader2 className="spin" size={22} aria-hidden="true" />
            <span>Loading dashboard</span>
          </div>
        )}

        {data && !selectedUser && (
          <section className="dashboard-user-section">
            <div className="dashboard-section-heading">
              <div>
                <h2>User not found</h2>
                <p>This user is not included in the latest dashboard data.</p>
              </div>
            </div>
          </section>
        )}

        {selectedUser && (
          <>
            <section className="dashboard-user-profile">
              <div className="dashboard-user-main">
                <div className="dashboard-avatar">{selectedUser.email[0]?.toUpperCase() ?? "U"}</div>
                <div>
                  <h2>{selectedUser.email}</h2>
                  <p>Joined {formatShortDate(selectedUser.createdAt)}</p>
                </div>
              </div>
              <div className="dashboard-user-stats">
                <span>{selectedBooks.length} books</span>
                <span>{selectedUser.imagesGenerated ?? selectedImages.length} images</span>
                <span>{formatBytes(selectedBookStorageBytes + selectedImageStorageBytes)}</span>
                <span>Last sign in {formatShortDate(selectedUser.lastSignInAt ?? null)}</span>
              </div>
            </section>

            <section className="dashboard-user-metrics" aria-label={`${selectedUser.email} activity over time`}>
              <article className="dashboard-metric">
                <HardDrive size={20} aria-hidden="true" />
                <span>User storage</span>
                <strong>{formatBytes(selectedBookStorageBytes + selectedImageStorageBytes)}</strong>
                <small>{formatBytes(selectedBookStorageBytes)} books · {formatBytes(selectedImageStorageBytes)} images</small>
                <DashboardSparkline label="User storage over time" points={selectedUserTimeline} valueKey="storageBytes" />
              </article>
              <article className="dashboard-metric">
                <ImageIcon size={20} aria-hidden="true" />
                <span>User images</span>
                <strong>{selectedUser.imagesGenerated ?? selectedImages.length}</strong>
                <small>{formatBytes(selectedImageStorageBytes)} stored</small>
                <DashboardSparkline label="User images over time" points={selectedUserTimeline} valueKey="imagesCount" />
              </article>
            </section>

            <section className="dashboard-detail-grid">
              <div className="dashboard-user-section dashboard-journey-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h2>User journey</h2>
                    <p>Sign-ins, uploads, and generated images with time.</p>
                  </div>
                </div>
                {selectedJourney.length ? (
                  <ol className="dashboard-journey-list">
                    {selectedJourney.map((event, index) => (
                      <li className="dashboard-journey-item" key={`${event.type}-${event.at}-${index}`}>
                        <div className="dashboard-journey-dot" aria-hidden="true" />
                        <div>
                          <strong>{event.label}</strong>
                          <span>{event.detail}</span>
                        </div>
                        <time dateTime={event.at}>{formatShortDateTime(event.at)}</time>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="dashboard-empty-detail">No journey events yet.</p>
                )}
              </div>

              <div className="dashboard-user-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h2>Books</h2>
                    <p>{formatBytes(selectedBookStorageBytes)} stored</p>
                  </div>
                </div>
                {selectedBooks.length ? (
                  <div className="dashboard-book-list">
                    {selectedBooks.map((book) => (
                      <div className="dashboard-book-row" key={book.id}>
                        <FileText size={15} aria-hidden="true" />
                        <span>{book.title || book.fileName}</span>
                        <small>{(book.documentType || "book").toUpperCase()} · {formatBytes(book.fileSize ?? 0)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="dashboard-empty-detail">No uploaded books yet.</p>
                )}
              </div>

              <div className="dashboard-user-section">
                <div className="dashboard-section-heading">
                  <div>
                    <h2>Images</h2>
                    <p>{formatBytes(selectedImageStorageBytes)} stored</p>
                  </div>
                </div>
                {selectedImages.length ? (
                  <div className="dashboard-image-grid">
                    {selectedImages.map((image) => (
                      <article className="dashboard-image-card" key={image.id}>
                        {image.signedUrl ? (
                          <img alt={`Generated image for ${image.bookTitle}`} src={image.signedUrl} />
                        ) : (
                          <div className="dashboard-image-missing">
                            <ImageIcon size={22} aria-hidden="true" />
                          </div>
                        )}
                        <div>
                          <strong>{image.bookTitle}</strong>
                          <span>{image.style || "image"} · words {image.startWord ?? "?"}-{image.endWord ?? "?"}</span>
                          <small>{formatShortDate(image.createdAt)}</small>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="dashboard-empty-detail">No generated images yet.</p>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-topbar">
        <div>
          <span className="dashboard-kicker">Reader project</span>
          <h1>Dashboard</h1>
        </div>
        <div className="dashboard-actions">
          <button className="dashboard-secondary-button" disabled={busy} onClick={onRefresh} type="button">
            {busy ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <RefreshCw size={17} aria-hidden="true" />}
            <span>Refresh all</span>
          </button>
          <button className="dashboard-secondary-button" onClick={onSignOut} type="button">
            <LogOut size={17} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      {error && <div className="dashboard-error">{error}</div>}

      <div className="dashboard-tabs">
        <button
          className={`dashboard-tab-btn ${activeTab === "users" ? "active" : ""}`}
          onClick={() => setActiveTab("users")}
          type="button"
        >
          <Users size={16} aria-hidden="true" />
          <span>Users & Analytics</span>
        </button>
        <button
          className={`dashboard-tab-btn ${activeTab === "weekly_views" ? "active" : ""}`}
          onClick={() => setActiveTab("weekly_views")}
          type="button"
        >
          <TrendingUp size={16} aria-hidden="true" />
          <span>Weekly & Combined Views</span>
        </button>
        <button
          className={`dashboard-tab-btn ${activeTab === "content" ? "active" : ""}`}
          onClick={() => setActiveTab("content")}
          type="button"
        >
          <YouTubeIcon />
          <span>YouTube Sync</span>
        </button>
        <button
          className={`dashboard-tab-btn ${activeTab === "instagram" ? "active" : ""}`}
          onClick={() => setActiveTab("instagram")}
          type="button"
        >
          <InstagramIcon />
          <span>Instagram Sync</span>
        </button>
        <button
          className={`dashboard-tab-btn ${activeTab === "tiktok" ? "active" : ""}`}
          onClick={() => setActiveTab("tiktok")}
          type="button"
        >
          <TikTokIcon />
          <span>TikTok Sync</span>
        </button>
      </div>

      <div style={{ display: activeTab === "users" ? "block" : "none" }}>
        <section className="dashboard-metrics" aria-label="Reader project metrics">
          <article className="dashboard-metric">
            <HardDrive size={20} aria-hidden="true" />
            <span>Supabase storage</span>
            <strong>{formatBytes(storageTotal)}</strong>
            <DashboardSparkline label="Supabase storage over time" points={timeline} valueKey="storageBytes" />
          </article>
          <article className="dashboard-metric">
            <BookOpen size={20} aria-hidden="true" />
            <span>Books</span>
            <strong>{formatBytes(data?.storage.booksBytes ?? 0)}</strong>
            <small>{data?.totals.books ?? 0} uploaded</small>
            <DashboardSparkline label="Book storage over time" points={timeline} valueKey="booksBytes" />
          </article>
          <article className="dashboard-metric">
            <ImageIcon size={20} aria-hidden="true" />
            <span>Images</span>
            <strong>{formatBytes(data?.storage.imagesBytes ?? 0)}</strong>
            <small>{data?.totals.imagesGenerated ?? 0} generated</small>
            <DashboardSparkline label="Image storage over time" points={timeline} valueKey="imagesBytes" />
          </article>
          <article className="dashboard-metric">
            <Users size={20} aria-hidden="true" />
            <span>Users</span>
            <strong>{data?.totals.users ?? 0}</strong>
            <DashboardSparkline label="Users over time" points={timeline} valueKey="usersCount" />
          </article>
        </section>

        <section className="dashboard-user-section">
          <div className="dashboard-section-heading">
            <div>
              <h2>Users</h2>
              <p>{data ? `Updated ${formatShortDate(data.generatedAt)}` : "Loading project data"}</p>
            </div>
          </div>

          <div className="dashboard-user-list">
            {dashboardUsers.map((item) => (
              <button className="dashboard-user-row dashboard-user-button" key={item.id} onClick={() => onNavigate(`/dashboard/users/${item.id}`)} type="button">
                <div className="dashboard-user-main">
                  <div className="dashboard-avatar">{item.email[0]?.toUpperCase() ?? "U"}</div>
                  <div>
                    <h3>{item.email}</h3>
                    <p>Joined {formatShortDate(item.createdAt)}</p>
                  </div>
                </div>
                <div className="dashboard-user-stats">
                  <span>{(item.books ?? []).length} books</span>
                  <span>{item.imagesGenerated ?? (item.images ?? []).length} images</span>
                  <span>{formatBytes((item.bookStorageBytes ?? 0) + (item.imageStorageBytes ?? 0))}</span>
                </div>
                <ChevronRight className="dashboard-row-arrow" size={18} aria-hidden="true" />
              </button>
            ))}
            {!data && !error && (
              <div className="dashboard-loading">
                <Loader2 className="spin" size={22} aria-hidden="true" />
                <span>Loading dashboard</span>
              </div>
            )}
          </div>
        </section>
      </div>

      <div style={{ display: activeTab === "weekly_views" ? "block" : "none" }}>
        <WeeklyViewsSection refreshSignal={contentRefreshSignal} linksVersion={linksVersion} />
      </div>

      <div style={{ display: activeTab === "content" ? "block" : "none" }}>
        <ContentIntegrationsSection refreshSignal={contentRefreshSignal} />
      </div>

      <div style={{ display: activeTab === "instagram" ? "block" : "none" }}>
        <InstagramIntegrationSection refreshSignal={contentRefreshSignal} onLinksChanged={() => setLinksVersion((v) => v + 1)} />
      </div>

      <div style={{ display: activeTab === "tiktok" ? "block" : "none" }}>
        <TikTokIntegrationSection refreshSignal={contentRefreshSignal} onLinksChanged={() => setLinksVersion((v) => v + 1)} />
      </div>
    </main>
  );
}

const authRedirectUrl = () => {
  const url = new URL(window.location.href);
  if (url.pathname.startsWith("/dashboard")) {
    const redirectUrl = new URL(window.location.origin);
    redirectUrl.searchParams.set("redirect", url.pathname);
    return redirectUrl.toString();
  }

  url.search = "";
  url.hash = "";
  return url.toString();
};

const initialReaderFontMode = (): ReaderFontMode =>
  window.localStorage.getItem("reader-font-mode") === "sans" ? "sans" : DEFAULT_READER_PREFERENCES.fontMode;

const initialReaderThemeMode = (): ReaderThemeMode => {
  const savedThemeMode = window.localStorage.getItem("reader-theme-mode");
  if (savedThemeMode === "dark" || savedThemeMode === "light") return savedThemeMode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : DEFAULT_READER_PREFERENCES.themeMode;
};

const initialReaderTheme = (): ReaderTheme => {
  const value = window.localStorage.getItem("reader-theme");
  return READER_THEMES.some((theme) => theme.value === value) ? (value as ReaderTheme) : DEFAULT_READER_PREFERENCES.theme;
};

const initialReaderTextScale = () => {
  const fontSize = Number(window.localStorage.getItem("reader-font-size"));
  if (Number.isFinite(fontSize)) return fontSize <= 9 ? DEFAULT_READER_PREFERENCES.textScale : clampReaderTextScale(fontSize / 16);

  const value = Number(window.localStorage.getItem("reader-text-scale"));
  return Number.isFinite(value)
    ? value <= READER_TEXT_SCALE_MIN
      ? DEFAULT_READER_PREFERENCES.textScale
      : clampReaderTextScale(value)
    : DEFAULT_READER_PREFERENCES.textScale;
};

const initialReaderLineHeight = () => {
  const value = Number(window.localStorage.getItem("reader-line-height"));
  return Number.isFinite(value) ? clampReaderLineHeight(value) : DEFAULT_READER_PREFERENCES.lineHeight;
};

const initialReaderLineWidth = () => {
  const value = Number(window.localStorage.getItem("reader-line-width"));
  return Number.isFinite(value) ? clampReaderLineWidth(value) : DEFAULT_READER_PREFERENCES.lineWidth;
};

const initialNarrationRate = () => {
  const value = Number(window.localStorage.getItem("reader-narration-rate"));
  return Number.isFinite(value) ? clampNarrationRate(value) : DEFAULT_READER_PREFERENCES.narrationRate;
};

const VOICE_STORAGE_KEY = "reader-narration-voice";

const initialNarrationVoice = () => {
  const saved = window.localStorage.getItem(VOICE_STORAGE_KEY);
  if (saved && VOICE_OPTIONS.some((v) => v.id === saved)) return saved;
  return DEFAULT_EDGE_TTS_VOICE;
};

const readBookReaderPreferences = () => {
  const raw = window.localStorage.getItem(BOOK_READER_PREFERENCES_KEY);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, Partial<ReaderPreferences>> : {};
  } catch {
    return {};
  }
};

const normalizeReaderPreferences = (value: Partial<ReaderPreferences> | undefined, currentThemeMode?: ReaderThemeMode): ReaderPreferences => {
  const fontMode = value?.fontMode === "sans" ? "sans" : DEFAULT_READER_PREFERENCES.fontMode;
  const themeMode = currentThemeMode ?? DEFAULT_READER_PREFERENCES.themeMode;
  const rawTheme = value?.theme;
  const theme = READER_THEMES.some((item) => item.value === rawTheme) ? rawTheme as ReaderTheme : DEFAULT_READER_PREFERENCES.theme;
  const textScale = typeof value?.textScale === "number" && Number.isFinite(value.textScale)
    ? clampReaderTextScale(value.textScale)
    : DEFAULT_READER_PREFERENCES.textScale;
  const lineHeight = typeof value?.lineHeight === "number" && Number.isFinite(value.lineHeight)
    ? clampReaderLineHeight(value.lineHeight)
    : DEFAULT_READER_PREFERENCES.lineHeight;
  const lineWidth = typeof value?.lineWidth === "number" && Number.isFinite(value.lineWidth)
    ? clampReaderLineWidth(value.lineWidth)
    : DEFAULT_READER_PREFERENCES.lineWidth;
  const narrationRate = typeof value?.narrationRate === "number" && Number.isFinite(value.narrationRate)
    ? clampNarrationRate(value.narrationRate)
    : DEFAULT_READER_PREFERENCES.narrationRate;

  return {
    fontMode,
    lineHeight,
    lineWidth,
    narrationRate,
    textScale,
    theme,
    themeMode
  };
};

const readerPreferencesForBook = (bookId: string, currentThemeMode?: ReaderThemeMode) =>
  normalizeReaderPreferences(readBookReaderPreferences()[bookId], currentThemeMode);

const writeBookReaderPreferences = (bookId: string, preferences: ReaderPreferences) => {
  const items = readBookReaderPreferences();
  const { themeMode: _themeMode, ...bookPreferences } = normalizeReaderPreferences(preferences, preferences.themeMode);
  items[bookId] = bookPreferences;
  window.localStorage.setItem(BOOK_READER_PREFERENCES_KEY, JSON.stringify(items));
};

const readPendingBookDelete = (): PersistedPendingDelete | null => {
  const raw = window.localStorage.getItem(PENDING_BOOK_DELETE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PersistedPendingDelete>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.deadline !== "number" || !parsed.row?.id) return null;
    return {
      deadline: parsed.deadline,
      index: typeof parsed.index === "number" ? parsed.index : 0,
      row: parsed.row as BookRow
    };
  } catch {
    return null;
  }
};

const writePendingBookDelete = (pending: PersistedPendingDelete) => {
  window.localStorage.setItem(PENDING_BOOK_DELETE_KEY, JSON.stringify(pending));
};

const clearPendingBookDelete = (bookId?: string) => {
  const pending = readPendingBookDelete();
  if (bookId && pending?.row.id !== bookId) return;
  window.localStorage.removeItem(PENDING_BOOK_DELETE_KEY);
};

const getOpenLibraryCoverUrl = async (title: string, author: string) => {
  const params = new URLSearchParams({
    title,
    fields: "cover_i",
    limit: "1"
  });
  if (author) params.set("author", author);

  let response: Response;
  try {
    response = await fetch(`https://openlibrary.org/search.json?${params.toString()}`);
  } catch {
    return "";
  }

  if (!response.ok) return "";

  let result: { docs?: Array<{ cover_i?: number }> };
  try {
    result = (await response.json()) as { docs?: Array<{ cover_i?: number }> };
  } catch {
    return "";
  }
  const coverId = result.docs?.find((doc) => typeof doc.cover_i === "number")?.cover_i;
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : "";
};

const shrinkCoverDataUrl = async (coverUrl: string) => {
  if (!coverUrl.startsWith("data:image/") || coverUrl.startsWith("data:image/svg")) return coverUrl;

  const image = new Image();
  image.decoding = "async";
  image.src = coverUrl;

  try {
    await image.decode();
  } catch {
    return coverUrl;
  }

  // Always resize and compress to keep database payloads highly efficient (~8KB-15KB)
  const maxWidth = 240;
  const scale = Math.min(1, maxWidth / image.naturalWidth);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

  const context = canvas.getContext("2d");
  if (!context) return coverUrl;

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.75);
};

const bookCacheRequest = (bookId: string) =>
  new Request(`${window.location.origin}/__book-cache/${encodeURIComponent(bookId)}`);

const readerImageCacheKey = (
  bookId: string,
  chunk: Pick<ReaderImageChunk, "endWord" | "startWord">,
  style: ReaderImageStyle
) => `${bookId}:${style}:${chunk.startWord}:${chunk.endWord}`;

const openReaderImageDb = () =>
  new Promise<IDBDatabase | null>((resolve) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(READER_IMAGE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(READER_IMAGE_STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });

const getCachedReaderImage = async (bookId: string, chunk: ReaderImageChunk, style: ReaderImageStyle) => {
  const db = await openReaderImageDb();
  if (!db) return null;

  return new Promise<CachedReaderImage | null>((resolve) => {
    const transaction = db.transaction(READER_IMAGE_STORE_NAME, "readonly");
    const request = transaction.objectStore(READER_IMAGE_STORE_NAME).get(readerImageCacheKey(bookId, chunk, style));
    request.onsuccess = () => resolve((request.result as CachedReaderImage | undefined) ?? null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  });
};

const cacheReaderImage = async (image: CachedReaderImage) => {
  const db = await openReaderImageDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(READER_IMAGE_STORE_NAME, "readwrite");
    transaction.objectStore(READER_IMAGE_STORE_NAME).put(image);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
};

const deleteCachedReaderImagesForBook = async (bookId: string) => {
  const db = await openReaderImageDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(READER_IMAGE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(READER_IMAGE_STORE_NAME);
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;

      const image = cursor.value as CachedReaderImage | undefined;
      if (image?.bookId === bookId) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      resolve();
    };
  });
};

const getCachedBookFile = async (row: BookRow) => {
  if (!("caches" in window)) return null;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    const response = await cache.match(bookCacheRequest(row.id));
    if (!response) return null;

    const blob = await response.blob();
    if (row.file_size > 0 && blob.size !== row.file_size) {
      await cache.delete(bookCacheRequest(row.id));
      return null;
    }

    const format = bookFormat(row);
    return new File([blob], row.file_name, { type: documentMimeType(format) });
  } catch (error) {
    console.warn("Could not read document from browser cache.", error);
    return null;
  }
};

const cacheBookFile = async (row: BookRow, file: Blob) => {
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.put(
      bookCacheRequest(row.id),
      new Response(file, {
        headers: {
          "Content-Type": documentMimeType(bookFormat(row))
        }
      })
    );
  } catch (error) {
    console.warn("Could not store document in browser cache.", error);
  }
};

const deleteCachedBookFile = async (bookId: string) => {
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.delete(bookCacheRequest(bookId));
  } catch (error) {
    console.warn("Could not remove document from browser cache.", error);
  }
};

const waitForOpeningPaint = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });

const waitForReaderFonts = (timeoutMs = 700) => {
  const fonts = document.fonts;
  if (!fonts) return Promise.resolve();

  return Promise.race([
    fonts.ready.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
};

const preloadLibraryCover = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => {
      if ("decode" in image) {
        image.decode().then(() => resolve()).catch(() => resolve());
        return;
      }

      resolve();
    };
    image.onerror = () => resolve();
    image.src = src;
  });

const preloadReaderImage = (src: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if ("decode" in image) {
        image.decode().then(() => resolve()).catch(() => resolve());
        return;
      }

      resolve();
    };
    image.onerror = () => resolve();
    image.src = src;
  });

const waitForLibraryCovers = (rows: BookRow[], timeoutMs = 620) => {
  const coverUrls = [...new Set(rows.map((row) => row.cover_url).filter((src): src is string => Boolean(src)))];
  if (!coverUrls.length) return Promise.resolve();

  return Promise.race([
    Promise.all(coverUrls.map(preloadLibraryCover)).then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs))
  ]);
};

const libraryAbortSignal = () => {
  if ("timeout" in AbortSignal) return AbortSignal.timeout(LIBRARY_LOAD_TIMEOUT_MS);

  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), LIBRARY_LOAD_TIMEOUT_MS);
  return controller.signal;
};

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [catalogBooks, setCatalogBooks] = useState<BookRow[]>([]);
  const [catalogReady, setCatalogReady] = useState(false);
  const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
  const [activeBookId, setActiveBookId] = useState("");
  const [view, setView] = useState<"catalog" | "reader">("catalog");
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [openingBook, setOpeningBook] = useState<BookRow | null>(null);
  const [openingBookProgress, setOpeningBookProgress] = useState(0);
  const [openingPdfSettled, setOpeningPdfSettled] = useState(false);
  const [openingTextSettled, setOpeningTextSettled] = useState(false);
  const [openingPdfPreview, setOpeningPdfPreview] = useState<PdfPreview | null>(null);
  const [activeBookFile, setActiveBookFile] = useState<File | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfScrollOffsetRatio, setPdfScrollOffsetRatio] = useState(0);
  const [pdfScrollPage, setPdfScrollPage] = useState(1);
  const [pdfScrollRequest, setPdfScrollRequest] = useState(0);
  const [pdfVisibleOffsetRatio, setPdfVisibleOffsetRatio] = useState(0);
  const [pdfReaderViewMode, setPdfReaderViewMode] = useState<PdfReaderViewMode>("pdf");
  const [playback, setPlayback] = useState<PlaybackState>("idle");
  const [readerFontMode, setReaderFontMode] = useState<ReaderFontMode>(initialReaderFontMode);
  const [readerThemeMode, setReaderThemeMode] = useState<ReaderThemeMode>(initialReaderThemeMode);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(initialReaderTheme);
  const [readerTextScale, setReaderTextScale] = useState(initialReaderTextScale);
  const [readerLineHeight, setReaderLineHeight] = useState(initialReaderLineHeight);
  const [readerLineWidth, setReaderLineWidth] = useState(initialReaderLineWidth);
  const [narrationRate, setNarrationRate] = useState(initialNarrationRate);
  const [narrationVoice, setNarrationVoice] = useState(initialNarrationVoice);
  const [speedPreviewRate, setSpeedPreviewRate] = useState<number | null>(null);
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);
  const [voicePopoverOpen, setVoicePopoverOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [pendingDeleteExiting, setPendingDeleteExiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<"success" | "canceled" | "">("");
  const [speechHighlight, setSpeechHighlight] = useState<SpeechHighlight | null>(null);
  const [readerImageMode, setReaderImageMode] = useState(false);
  const [readerImageResizeMasked, setReaderImageResizeMasked] = useState(false);
  const [readerImages, setReaderImages] = useState<Record<number, ReaderImageState>>({});
  const [visibleReaderImageChunkIndex, setVisibleReaderImageChunkIndex] = useState<number | null>(null);
  const [displayedReaderImageChunkIndex, setDisplayedReaderImageChunkIndex] = useState<number | null>(null);
  const [generatingReaderImageChunkIndex, setGeneratingReaderImageChunkIndex] = useState<number | null>(null);
  const [readerImageCount, setReaderImageCount] = useState(0);
  const [readerImageStyle, setReaderImageStyle] = useState<ReaderImageStyle>("cartoon");
  const [readerImageStyleOpen, setReaderImageStyleOpen] = useState(false);
  const [readerImageUpgradeOpen, setReaderImageUpgradeOpen] = useState(false);
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(() => window.matchMedia(CHAPTER_SIDEBAR_DESKTOP_QUERY).matches);
  const parsedBooks = useRef(new Map<string, ReaderBook>());
  const parsedBookFiles = useRef(new Map<string, File>());
  const bookOpenRunRef = useRef(0);
  const readingSurfaceRef = useRef<HTMLElement | null>(null);
  const paragraphRefs = useRef(new Map<string, HTMLElement>());
  const chapterRefs = useRef(new Map<number, HTMLButtonElement>());
  const imageRequestsRef = useRef(new Set<number>());
  const displayedReaderImageChunkIndexRef = useRef<number | null>(null);
  const readerImageSettleTimerRef = useRef<number | null>(null);
  const readerImageModeRef = useRef(false);
  const readerImageRunRef = useRef(0);
  const pendingScrollIndex = useRef<number | null>(null);
  const edgeTtsPlayerRef = useRef<EdgeTtsPlayer | null>(null);
  const suppressNextPlaybackStartRef = useRef(false);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const voiceControlRef = useRef<HTMLDivElement | null>(null);
  const imageStyleMenuRef = useRef<HTMLDivElement | null>(null);
  const textReaderActionsRef = useRef<TextReaderActions>({
    moveTo: () => undefined,
    paragraphClick: () => undefined,
    scroll: () => undefined
  });
  const progressSaveTimer = useRef<number | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  const pendingDeleteExitTimer = useRef<number | null>(null);
  const uploadedBookNoticeTimer = useRef<number | null>(null);
  const uploadedBookNoticeExitTimer = useRef<number | null>(null);
  const libraryLoadRunRef = useRef(0);
  const catalogActionMenuRef = useRef<HTMLDivElement | null>(null);
  const catalogDropDepth = useRef(0);
  const readingScrollFrame = useRef<number | null>(null);
  const coverLookupRef = useRef(new Set<string>());
  const isInitialOpenRef = useRef(false);
  const isInstantScrollRef = useRef(false);
  const [progressNotice, setProgressNotice] = useState(false);
  const [progressNoticeToken, setProgressNoticeToken] = useState(0);
  const [returnPoint, setReturnPoint] = useState<ReturnPoint | null>(null);
  const [pdfPageLayout, setPdfPageLayout] = useState<"single" | "double">(() => {
    const saved = window.localStorage.getItem("pdf-page-layout");
    return saved === "double" ? "double" : "single";
  });
  const [pdfPageScale, setPdfPageScale] = useState(() => {
    const saved = Number(window.localStorage.getItem("pdf-page-scale"));
    return Number.isFinite(saved) ? clampPdfPageScale(saved) : 1;
  });

  useEffect(() => {
    window.localStorage.setItem("pdf-page-layout", pdfPageLayout);
  }, [pdfPageLayout]);

  useEffect(() => {
    window.localStorage.setItem("pdf-page-scale", pdfPageScale.toFixed(2));
  }, [pdfPageScale]);

  useEffect(() => {
    return () => {
      if (uploadedBookNoticeTimer.current) {
        window.clearTimeout(uploadedBookNoticeTimer.current);
      }
      if (uploadedBookNoticeExitTimer.current) {
        window.clearTimeout(uploadedBookNoticeExitTimer.current);
      }
      if (pendingDeleteExitTimer.current) {
        window.clearTimeout(pendingDeleteExitTimer.current);
      }
    };
  }, []);

  const [importingClassicId, setImportingClassicId] = useState<string | null>(null);
  const [pendingBookImports, setPendingBookImports] = useState<PendingBookImport[]>([]);
  const [uploadedBookNotice, setUploadedBookNotice] = useState("");
  const [uploadedBookNoticeExiting, setUploadedBookNoticeExiting] = useState(false);
  const [isCatalogDragActive, setIsCatalogDragActive] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerMenuOpen, setReaderMenuOpen] = useState<ReaderMenuId | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [catalogActionBookId, setCatalogActionBookId] = useState("");
  const [renameTarget, setRenameTarget] = useState<BookRow | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [isRenamingBook, setIsRenamingBook] = useState(false);
  const [readerRenameTarget, setReaderRenameTarget] = useState<BookRow | null>(null);
  const [readerRenameTitle, setReaderRenameTitle] = useState("");
  const [readerRenameError, setReaderRenameError] = useState("");
  const [isReaderRenamingBook, setIsReaderRenamingBook] = useState(false);
  const catalogRenameInputRef = useRef<HTMLTextAreaElement | null>(null);
  const readerRenameInputRef = useRef<HTMLInputElement | null>(null);
  const [dashboardData, setDashboardData] = useState<ReaderDashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardPath, setDashboardPath] = useState(() => window.location.pathname);
  const [dashboardTab, setDashboardTab] = useState<DashboardTab>(() => {
    const tab = new URL(window.location.href).searchParams.get("tab");
    if (tab === "content") return "content";
    if (tab === "instagram") return "instagram";
    if (tab === "tiktok") return "tiktok";
    if (tab === "weekly_views") return "weekly_views";
    return "users";
  });
  const [contentRefreshSignal, setContentRefreshSignal] = useState(0);


  const user = session?.user ?? null;
  const isReaderDashboard = window.location.pathname.startsWith("/dashboard");
  const dashboardUserMatch = dashboardPath.match(/^\/dashboard\/users\/([^/]+)\/?$/);
  const selectedDashboardUserId = isReaderDashboard ? decodeURIComponent(dashboardUserMatch?.[1] ?? "") || null : null;
  const current = book?.paragraphs[currentIndex];
  const activeReaderRow = activeBookId ? catalogBooks.find((item) => item.id === activeBookId) ?? null : null;
  const isPdfBook = book?.format === "pdf";
  const hasChapterSidebarEntries = Boolean(book?.chapters.length);
  const pdfPageCount = book?.pageCount ?? 0;
  const pdfHasText = Boolean(isPdfBook && book.paragraphs.length);
  const isPdfPageOnlyMode = isPdfBook && pdfReaderViewMode === "pdf";
  const progress = book
    ? isPdfPageOnlyMode && pdfPageCount
      ? (currentPage / pdfPageCount) * 100
      : book.paragraphs.length
        ? ((currentIndex + 1) / book.paragraphs.length) * 100
        : 0
    : 0;
  const activePdfChapterIndex = useMemo(() => {
    if (!isPdfBook || !book?.chapterPageNumbers?.length) return -1;

    let index = 0;
    for (let entryIndex = 0; entryIndex < book.chapterPageNumbers.length; entryIndex += 1) {
      const chapterPage = book.chapterPageNumbers[entryIndex];
      const chapterOffset = book.chapterPageOffsets?.[entryIndex] ?? 0;
      if (
        chapterPage < currentPage ||
        (chapterPage === currentPage && chapterOffset <= pdfVisibleOffsetRatio + 0.015)
      ) {
        index = entryIndex;
      } else {
        break;
      }
    }

    return index;
  }, [book?.chapterPageNumbers, book?.chapterPageOffsets, currentPage, isPdfBook, pdfVisibleOffsetRatio]);
  const storageUsed = catalogBooks.reduce((total, item) => total + item.file_size, 0);
  const isBookImporting = pendingBookImports.length > 0;
  const isPro = billingProfile?.plan === "pro" && ["active", "trialing"].includes(billingProfile.status);
  const storageQuotaBytes = isPro ? PRO_USER_STORAGE_QUOTA_BYTES : FREE_USER_STORAGE_QUOTA_BYTES;
  const readerImageLimit = isPro ? PRO_READER_IMAGE_MONTHLY_LIMIT : FREE_READER_IMAGE_LIFETIME_LIMIT;
  const readerImageUsageLabel = `${readerImageCount} / ${readerImageLimit}`;
  const paragraphWordMetrics = useMemo(
    () => (book ? buildParagraphWordMetrics(book) : { counts: [], offsets: [], total: 0 }),
    [book]
  );
  const currentReaderWordOffset = useMemo(
    () => paragraphWordMetrics.offsets[currentIndex] ?? 0,
    [currentIndex, paragraphWordMetrics]
  );
  const readerImageChunks = useMemo(
    () => (book ? (book.format === "pdf" ? buildPdfReaderImageChunks(book) : buildReaderImageChunks(book)) : []),
    [book]
  );
  const readerImageChunkByIndex = useMemo(
    () => new Map(readerImageChunks.map((chunk) => [chunk.index, chunk])),
    [readerImageChunks]
  );
  const readerImageChunkByPageNumber = useMemo(
    () => new Map(readerImageChunks.flatMap((chunk) => chunk.pageNumber ? [[chunk.pageNumber, chunk] as const] : [])),
    [readerImageChunks]
  );
  const activeReaderImageChunkIndex = useMemo(() => {
    if (!book || !readerImageChunks.length) return -1;
    if (book.format === "pdf") {
      return readerImageChunkIndexForWordOffset(readerImageChunks, pdfWordOffsetBeforePage(book, currentPage));
    }
    if (
      visibleReaderImageChunkIndex !== null &&
      visibleReaderImageChunkIndex >= 0 &&
      visibleReaderImageChunkIndex < readerImageChunks.length
    ) {
      return visibleReaderImageChunkIndex;
    }
    return readerImageChunkIndexForWordOffset(readerImageChunks, currentReaderWordOffset);
  }, [book, currentPage, currentReaderWordOffset, readerImageChunks, visibleReaderImageChunkIndex]);
  const activeReaderImageChunk =
    activeReaderImageChunkIndex >= 0 ? readerImageChunkByIndex.get(activeReaderImageChunkIndex) ?? null : null;
  const generatingReaderImageChunk =
    generatingReaderImageChunkIndex !== null ? readerImageChunkByIndex.get(generatingReaderImageChunkIndex) ?? null : null;
  const displayedReaderImageChunk =
    displayedReaderImageChunkIndex !== null ? readerImageChunkByIndex.get(displayedReaderImageChunkIndex) ?? null : null;
  const isReaderImageDisplayable = useCallback((chunkIndex: number) => {
    const image = readerImages[chunkIndex];
    return image?.status === "ready" || image?.status === "error";
  }, [readerImages]);
  const fallbackReaderImageSrc = useCallback((chunkIndex: number) => {
    return readerImageFallbackSrcFromState(readerImages, chunkIndex, displayedReaderImageChunkIndex);
  }, [displayedReaderImageChunkIndex, readerImages]);
  const isReaderImageLoading =
    readerImageMode &&
    activeReaderImageChunkIndex >= 0 &&
    readerImages[activeReaderImageChunkIndex]?.status === "loading";

  useEffect(() => {
    displayedReaderImageChunkIndexRef.current = displayedReaderImageChunkIndex;
  }, [displayedReaderImageChunkIndex]);

  const readerImageInsertions = useMemo(() => {
    const insertions = new Map<number, ReaderImageChunk[]>();
    if (!book || !readerImageMode || !readerImageChunks.length) return insertions;
    if (book.format === "pdf") return insertions;

    let chunkIndex = 0;

    book.paragraphs.forEach((paragraph, paragraphIndex) => {
      const wordOffset = paragraphWordMetrics.offsets[paragraphIndex] ?? 0;
      const wordCount = paragraphWordMetrics.counts[paragraphIndex] ?? 0;
      const paragraphStart = wordOffset;
      const paragraphEnd = wordOffset + wordCount;

      while (
        chunkIndex < readerImageChunks.length &&
        wordCount > 0 &&
        readerImageChunks[chunkIndex].startWord - 1 >= paragraphStart &&
        readerImageChunks[chunkIndex].startWord - 1 < paragraphEnd
      ) {
        const chunk = readerImageChunks[chunkIndex];
        if (
          isReaderImageDisplayable(chunk.index) ||
          (
            chunk.index === activeReaderImageChunkIndex &&
            (readerImages[chunk.index]?.status === "loading" || readerImages[chunk.index]?.status === "checking")
          )
        ) {
          const items = insertions.get(paragraphIndex) ?? [];
          items.push(chunk);
          insertions.set(paragraphIndex, items);
        }
        chunkIndex += 1;
      }

    });

    return insertions;
  }, [activeReaderImageChunkIndex, book, isReaderImageDisplayable, paragraphWordMetrics, readerImageChunks, readerImageMode, readerImages]);

  const navigateDashboard = useCallback((path: string) => {
    window.history.pushState({}, "", path);
    setDashboardPath(window.location.pathname);
  }, []);

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
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (window.location.pathname === "/auth/youtube/callback" && code) {
      const exchangeToken = async () => {
        try {
          const clientId = localStorage.getItem("reader-yt-client-id") || YOUTUBE_DEFAULT_CLIENT_ID;
          const redirectUri = localStorage.getItem("reader-yt-redirect-uri") || `${window.location.origin}/auth/youtube/callback`;

          const { data, error } = await supabase.functions.invoke("youtube-token-exchange", {
            body: { code, redirectUri, clientId }
          });

          if (error) throw new Error(await edgeFunctionErrorMessage(error));

          if (data?.access_token) {
            localStorage.setItem("reader-yt-access-token", data.access_token);
            localStorage.removeItem("reader-yt-api-key");
            localStorage.setItem("reader-yt-status", "connected");
            if (data.refresh_token) {
              localStorage.setItem("reader-yt-refresh-token", data.refresh_token);
              const { data: sessionData } = await supabase.auth.getSession();
              const { error: storeError } = await supabase.functions.invoke("youtube-analytics", {
                body: {
                  action: "store",
                  channel: localStorage.getItem("reader-yt-channel") || "@ilumereader",
                  refreshToken: data.refresh_token
                },
                headers: sessionData.session?.access_token
                  ? { Authorization: `Bearer ${sessionData.session.access_token}` }
                  : undefined
              });
              if (storeError) throw new Error(await edgeFunctionErrorMessage(storeError));
            }
            alert("Successfully connected your YouTube channel!");
          } else {
            throw new Error("No access token returned from exchange");
          }
        } catch (err) {
          console.error("YouTube authentication failed:", err);
          alert("Failed to connect YouTube account: " + (err instanceof Error ? err.message : String(err)));
        } finally {
          window.location.href = `${window.location.origin}/dashboard?tab=content`;
        }
      };

      void exchangeToken();
    }

    if (window.location.pathname === "/auth/tiktok/callback" && code) {
      const exchangeToken = async () => {
        try {
          const clientKey = localStorage.getItem("reader-tt-client-key") || TIKTOK_DEFAULT_CLIENT_KEY;
          const redirectUri = localStorage.getItem("reader-tt-redirect-uri") || `${window.location.origin}/auth/tiktok/callback`;

          const { data, error } = await supabase.functions.invoke("tiktok-token-exchange", {
            body: { code, redirectUri, clientKey }
          });

          if (error) throw new Error(await edgeFunctionErrorMessage(error));
          if (!data?.access_token) throw new Error("No TikTok access token returned from exchange.");

          localStorage.setItem("reader-tt-status", "connected");
          const { data: sessionData } = await supabase.auth.getSession();
          const { error: storeError } = await supabase.functions.invoke("tiktok-feed", {
            body: {
              action: "store",
              accessToken: data.access_token,
              expiresIn: data.expires_in,
              openId: data.open_id,
              refreshExpiresIn: data.refresh_expires_in,
              refreshToken: data.refresh_token
            },
            headers: sessionData.session?.access_token
              ? { Authorization: `Bearer ${sessionData.session.access_token}` }
              : undefined
          });
          if (storeError) throw new Error(await edgeFunctionErrorMessage(storeError));
          alert("Successfully connected your TikTok account!");
        } catch (err) {
          console.error("TikTok authentication failed:", err);
          alert("Failed to connect TikTok account: " + (err instanceof Error ? err.message : String(err)));
        } finally {
          window.location.href = `${window.location.origin}/dashboard?tab=tiktok`;
        }
      };

      void exchangeToken();
    }

    if (window.location.pathname === "/auth/instagram/callback" && code) {
      const exchangeToken = async () => {
        try {
          const redirectUri = localStorage.getItem("reader-ig-redirect-uri") || `${window.location.origin}/auth/instagram/callback`;
          const { data: sessionData } = await supabase.auth.getSession();
          const { data, error } = await supabase.functions.invoke("instagram-token-exchange", {
            body: { code, redirectUri },
            headers: sessionData.session?.access_token
              ? { Authorization: `Bearer ${sessionData.session.access_token}` }
              : undefined
          });

          if (error) throw new Error(await edgeFunctionErrorMessage(error));
          if (!data?.connected) throw new Error("No Instagram connection returned from Meta.");

          localStorage.setItem("reader-ig-status", "connected");
          localStorage.removeItem("reader-ig-posts-cache");
          localStorage.removeItem("reader-ig-user-insights-cache");
          alert(`Successfully connected Instagram${data.profile?.username ? ` @${data.profile.username}` : ""}!`);
        } catch (err) {
          console.error("Instagram authentication failed:", err);
          alert("Failed to connect Instagram account: " + (err instanceof Error ? err.message : String(err)));
        } finally {
          window.location.href = `${window.location.origin}/dashboard?tab=instagram`;
        }
      };

      void exchangeToken();
    }
  }, []);

  useEffect(() => {
    if (!session) return;

    const url = new URL(window.location.href);
    const redirectPath = url.searchParams.get("redirect");
    if (!redirectPath?.startsWith("/dashboard")) return;

    window.history.replaceState({}, "", redirectPath);
    setDashboardPath(window.location.pathname);
    const tab = new URL(window.location.href).searchParams.get("tab");
    setDashboardTab(tab === "content" || tab === "instagram" || tab === "tiktok" || tab === "weekly_views" ? tab : "users");
  }, [session?.user?.id]);

  useEffect(() => {
    if (!isReaderDashboard) return;

    const handlePopState = () => setDashboardPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isReaderDashboard]);

  useEffect(() => {
    if (isReaderDashboard) return;

    if (!user) {
      setCatalogBooks([]);
      setCatalogReady(false);
      setBillingProfile(null);
      setReaderImageCount(0);
      setReaderImageUpgradeOpen(false);
      setBook(null);
      setOpeningBook(null);
      setOpeningBookProgress(0);
      setOpeningPdfSettled(false);
      setOpeningTextSettled(false);
      setOpeningPdfPreview(null);
      setActiveBookFile(null);
      setView("catalog");
      setActiveBookId("");
      coverLookupRef.current.clear();
      parsedBookFiles.current.clear();
      return;
    }

    void loadLibrary(user);
    void loadBillingProfile(user);
    void loadReaderImageUsage();
  }, [isReaderDashboard, user?.id]);

  useEffect(() => {
    if (!user || isReaderDashboard) return;
    void loadReaderImageUsage();
  }, [isPro, isReaderDashboard, user?.id]);

  useEffect(() => {
    if (!profileOpen || !user || isReaderDashboard) return;
    void loadReaderImageUsage();
  }, [isReaderDashboard, profileOpen, user?.id]);

  useEffect(() => {
    if (!isReaderDashboard || !user) {
      setDashboardData(null);
      setDashboardError("");
      setDashboardLoading(false);
      return;
    }

    if (user.email?.toLowerCase() !== "r.lobo2003@gmail.com") return;
    void loadReaderDashboard();
  }, [isReaderDashboard, user?.id]);

  useEffect(() => {
    if (!user || !catalogBooks.length) return;

    const hydrateMissingCovers = async () => {
      const coverUpdates = new Map<string, string>();

      for (let bookIndex = 0; bookIndex < catalogBooks.length; bookIndex++) {
        const catalogBook = catalogBooks[bookIndex];
        if (catalogBook.cover_url || coverLookupRef.current.has(catalogBook.id)) continue;

        coverLookupRef.current.add(catalogBook.id);
        const coverUrl = await getOpenLibraryCoverUrl(catalogBook.title, catalogBook.author);
        if (!coverUrl) continue;

        coverUpdates.set(catalogBook.id, coverUrl);
        const { error: updateError } = await supabase.from("books").update({ cover_url: coverUrl }).eq("id", catalogBook.id);
        if (updateError) {
          console.error("Failed to save Open Library cover to database:", updateError);
        }
      }

      if (!coverUpdates.size) return;

      setCatalogBooks((items) =>
        sortBooksByRecentActivity(
          items.map((item) => {
            const coverUrl = coverUpdates.get(item.id);
            return coverUrl ? { ...item, cover_url: coverUrl } : item;
          })
        )
      );
    };

    void hydrateMissingCovers();
  }, [catalogBooks, user]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");

    if (checkout === "success") {
      setCheckoutResult("success");
      setNotice("Thanks. Your Pro subscription is being confirmed.");
      window.history.replaceState({ illumeView: "catalog" } satisfies AppHistoryState, "", window.location.pathname);
    }

    if (checkout === "canceled") {
      setCheckoutResult("canceled");
      setNotice("Checkout was canceled.");
      window.history.replaceState({ illumeView: "catalog" } satisfies AppHistoryState, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (checkoutResult !== "success" || !user) return;

    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      void loadBillingProfile(user);
      if (attempts >= 8) window.clearInterval(interval);
    }, 2500);

    return () => window.clearInterval(interval);
  }, [checkoutResult, user?.id]);

  useEffect(() => {
    if (isReaderDashboard) {
      document.title = "Reader Dashboard | illume";
      return;
    }

    if (view === "reader" && (book?.title || openingBook?.title)) {
      document.title = book?.title ?? openingBook?.title ?? APP_TITLE;
      return;
    }

    document.title = APP_TITLE;
  }, [book?.title, isReaderDashboard, openingBook?.title, view]);

  useEffect(() => {
    if (isReaderDashboard) return;

    const state = window.history.state as AppHistoryState | null;
    if (state?.illumeView) return;

    window.history.replaceState(
      { illumeView: "catalog" } satisfies AppHistoryState,
      "",
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  }, [isReaderDashboard]);

  useEffect(() => {
    setReturnPoint(null);
  }, [activeBookId, view]);

  useEffect(() => stopAudio, []);

  useEffect(() => () => {
    if (pendingDeleteRef.current) window.clearTimeout(pendingDeleteRef.current.timer);
  }, []);

  useEffect(() => () => {
    if (readingScrollFrame.current !== null) window.cancelAnimationFrame(readingScrollFrame.current);
  }, []);

  useEffect(() => () => {
    if (readerImageSettleTimerRef.current !== null) {
      window.clearTimeout(readerImageSettleTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const desktopQuery = window.matchMedia(CHAPTER_SIDEBAR_DESKTOP_QUERY);
    const syncChapterSidebar = (event: MediaQueryListEvent | MediaQueryList) => {
      const openingFormat = openingBook ? bookFormat(openingBook) : null;
      const isOpeningPdf = openingFormat === "pdf";
      if (isPdfBook || isOpeningPdf) {
        setChapterDrawerOpen(false);
        return;
      }

      setChapterDrawerOpen(event.matches && hasChapterSidebarEntries);
    };

    syncChapterSidebar(desktopQuery);
    desktopQuery.addEventListener("change", syncChapterSidebar);
    return () => desktopQuery.removeEventListener("change", syncChapterSidebar);
  }, [hasChapterSidebarEntries, isPdfBook, openingBook]);

  useEffect(() => {
    window.localStorage.setItem("reader-font-mode", readerFontMode);
  }, [readerFontMode]);

  useEffect(() => {
    window.localStorage.setItem("reader-theme-mode", readerThemeMode);
  }, [readerThemeMode]);

  useEffect(() => {
    document.documentElement.dataset.colorScheme = readerThemeMode;
  }, [readerThemeMode]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const explicit = window.localStorage.getItem("reader-theme-mode");
      if (!explicit) setReaderThemeMode(e.matches ? "dark" : "light");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("reader-theme", readerTheme);
  }, [readerTheme]);

  useEffect(() => {
    if (view !== "reader" || !readerImageMode) {
      setReaderImageResizeMasked(false);
      return;
    }

    let resizeTimer: number | null = null;
    const handleResize = () => {
      setReaderImageResizeMasked(true);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        window.requestAnimationFrame(() => setReaderImageResizeMasked(false));
      }, 240);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    };
  }, [readerImageMode, view]);

  useEffect(() => {
    window.localStorage.setItem("reader-text-scale", readerTextScale.toFixed(2));
    window.localStorage.setItem("reader-font-size", Math.round(readerTextScale * 16).toFixed(0));
  }, [readerTextScale]);

  useEffect(() => {
    window.localStorage.setItem("reader-line-height", readerLineHeight.toFixed(1));
  }, [readerLineHeight]);

  useEffect(() => {
    window.localStorage.setItem("reader-line-width", readerLineWidth.toFixed(0));
  }, [readerLineWidth]);

  useEffect(() => {
    window.localStorage.setItem("reader-narration-rate", narrationRate.toFixed(2));
    edgeTtsPlayerRef.current?.setRate(narrationRate);
  }, [narrationRate]);

  useEffect(() => {
    if (!activeBookId || view !== "reader") return;

    writeBookReaderPreferences(activeBookId, {
      fontMode: readerFontMode,
      lineHeight: readerLineHeight,
      lineWidth: readerLineWidth,
      narrationRate,
      textScale: readerTextScale,
      theme: readerTheme,
      themeMode: readerThemeMode
    });
  }, [
    activeBookId,
    narrationRate,
    readerFontMode,
    readerLineHeight,
    readerLineWidth,
    readerTextScale,
    readerTheme,
    readerThemeMode,
    view
  ]);

  useEffect(() => {
    if (!speedPopoverOpen) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && speedControlRef.current?.contains(event.target)) return;
      setSpeedPopoverOpen(false);
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSpeedPopoverOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [speedPopoverOpen]);

  useEffect(() => {
    if (!voicePopoverOpen) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && voiceControlRef.current?.contains(event.target)) return;
      setVoicePopoverOpen(false);
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setVoicePopoverOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [voicePopoverOpen]);

  useEffect(() => {
    if (!readerImageStyleOpen) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && imageStyleMenuRef.current?.contains(event.target)) return;
      setReaderImageStyleOpen(false);
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setReaderImageStyleOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [readerImageStyleOpen]);

  useEffect(() => {
    if (!catalogActionBookId) return;

    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      if (event.target instanceof Node && catalogActionMenuRef.current?.contains(event.target)) return;
      setCatalogActionBookId("");
    };

    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setCatalogActionBookId("");
    };

    window.addEventListener("pointerdown", closeOnOutsidePointer);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [catalogActionBookId]);

  useEffect(() => {
    const savedStyle = window.localStorage.getItem("reader-image-style");
    if (savedStyle === "cartoon" || savedStyle === "cute") setReaderImageStyle(savedStyle);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("reader-image-style", readerImageStyle);
  }, [readerImageStyle]);

  useEffect(() => {
    if (playback !== "playing" || !current) return;

    if (suppressNextPlaybackStartRef.current) {
      suppressNextPlaybackStartRef.current = false;
      return;
    }

    stopAudio();
    if (current.kind === "image") {
      if (book && currentIndex < book.paragraphs.length - 1) {
        advance();
      } else {
        setPlayback("idle");
      }
      return;
    }

    speakEdge(current);
  }, [currentIndex]);

  useEffect(() => {
    const chapterButton = chapterRefs.current.get(isPdfBook ? activePdfChapterIndex : current?.chapterIndex ?? -1);
    chapterButton?.scrollIntoView({ block: "nearest" });
  }, [activePdfChapterIndex, current?.chapterIndex, isPdfBook]);

  useEffect(() => {
    if (!current?.pageNumber || pdfReaderViewMode === "pdf") return;
    setCurrentPage(current.pageNumber);
  }, [current?.pageNumber, pdfReaderViewMode]);

  useEffect(() => {
    const targetIndex = pendingScrollIndex.current;
    if (targetIndex === null || !book) return;

    const target = book.paragraphs[targetIndex];
    const node = target ? paragraphRefs.current.get(target.id) : null;
    if (node) {
      pendingScrollIndex.current = null;
      if (isInitialOpenRef.current || isInstantScrollRef.current) {
        node.scrollIntoView({ block: "start", behavior: "auto" });
        isInitialOpenRef.current = false;
        isInstantScrollRef.current = false;
      } else {
        node.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }
  }, [book?.paragraphs, currentIndex]);

  useEffect(() => {
    if (view !== "reader" || !book || book.format === "pdf" || !openingBook || openingBook.id !== activeBookId) return;

    let cancelled = false;
    let frame = 0;
    let settleTimer = 0;
    const startedAt = performance.now();

    const settleAfterPaint = () => {
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          settleTimer = window.setTimeout(() => {
            if (!cancelled) setOpeningTextSettled(true);
          }, 120);
        });
      });
    };

    const waitForTextLayout = () => {
      if (cancelled) return;

      const timedOut = performance.now() - startedAt > 1800;
      const surfaceReady = Boolean(readingSurfaceRef.current);
      const targetIndex = Math.max(0, Math.min(currentIndex, book.paragraphs.length - 1));
      const target = book.paragraphs[targetIndex];
      const targetReady = !target || paragraphRefs.current.has(target.id);

      if ((!surfaceReady || !targetReady || pendingScrollIndex.current !== null) && !timedOut) {
        frame = window.requestAnimationFrame(waitForTextLayout);
        return;
      }

      settleAfterPaint();
    };

    void waitForReaderFonts().then(() => {
      if (!cancelled) waitForTextLayout();
    });

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (settleTimer) window.clearTimeout(settleTimer);
    };
  }, [activeBookId, book, currentIndex, openingBook, view]);

  useEffect(() => {
    if (view !== "reader" || !book || !openingBook || openingBook.id !== activeBookId) return;

    let cancelled = false;
    let frame = 0;
    let exitTimer = 0;
    const startedAt = performance.now();

    const settleOpening = () => {
      if (cancelled) return;

      const timedOut = performance.now() - startedAt > 1400;
      if (book.format === "pdf" && !openingPdfSettled) {
        frame = window.requestAnimationFrame(settleOpening);
        return;
      }

      if (book.format !== "pdf" && !openingTextSettled) {
        frame = window.requestAnimationFrame(settleOpening);
        return;
      }

      if (pendingScrollIndex.current !== null && !timedOut) {
        frame = window.requestAnimationFrame(settleOpening);
        return;
      }

      exitTimer = window.setTimeout(() => {
        if (!cancelled) {
          setOpeningBook(null);
          setOpeningBookProgress(0);
          setOpeningPdfSettled(false);
          setOpeningTextSettled(false);
        }
      }, 260);
    };

    frame = window.requestAnimationFrame(settleOpening);

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (exitTimer) window.clearTimeout(exitTimer);
    };
  }, [activeBookId, book, openingBook, openingPdfSettled, openingTextSettled, view]);

  useEffect(() => {
    if (view !== "reader" || !book || openingBook || pendingScrollIndex.current === null) return;
    pendingScrollIndex.current = null;
    isInitialOpenRef.current = false;
    isInstantScrollRef.current = false;
  }, [book, openingBook, view]);

  useEffect(() => {
    if (progressNotice) {
      const timer = window.setTimeout(() => {
        setProgressNotice(false);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [progressNotice, progressNoticeToken]);

  useEffect(() => {
    if (!activeBookId || !book || view !== "reader") return;
    if (progressSaveTimer.current !== null) window.clearTimeout(progressSaveTimer.current);

    progressSaveTimer.current = window.setTimeout(() => {
      void saveReadingProgress(activeBookId, currentIndex, currentPage);
    }, 600);

    return () => {
      if (progressSaveTimer.current !== null) window.clearTimeout(progressSaveTimer.current);
    };
  }, [activeBookId, book, currentIndex, currentPage, view]);

  useEffect(() => {
    if (readerImageSettleTimerRef.current !== null) {
      window.clearTimeout(readerImageSettleTimerRef.current);
      readerImageSettleTimerRef.current = null;
    }

    if (!readerImageMode || activeReaderImageChunkIndex < 0) return;

    const chunkIndex = activeReaderImageChunkIndex;
    const runId = readerImageRunRef.current;
    if (readerImageModeRef.current && runId === readerImageRunRef.current) {
      void ensureReaderImage(chunkIndex, runId);
    }

    readerImageSettleTimerRef.current = window.setTimeout(() => {
      readerImageSettleTimerRef.current = null;
      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
      void ensureReaderImage(chunkIndex + 1, runId);
    }, READER_IMAGE_SETTLE_DELAY_MS);

    return () => {
      if (readerImageSettleTimerRef.current !== null) {
        window.clearTimeout(readerImageSettleTimerRef.current);
        readerImageSettleTimerRef.current = null;
      }
    };
  }, [activeReaderImageChunkIndex, readerImageMode, readerImageStyle]);

  useEffect(() => {
    if (!readerImageMode || activeReaderImageChunkIndex < 0) return;
    const activeImage = readerImages[activeReaderImageChunkIndex];
    if (activeImage?.status === "ready" || activeImage?.status === "error") {
      setDisplayedReaderImageChunkIndex(activeReaderImageChunkIndex);
    }
  }, [activeReaderImageChunkIndex, readerImageMode, readerImages]);

  useEffect(() => {
    if (!activeBookId || !book || view !== "reader") return;

    const flushProgress = () => {
      if (progressSaveTimer.current !== null) {
        window.clearTimeout(progressSaveTimer.current);
        progressSaveTimer.current = null;
      }

      void saveReadingProgress(activeBookId, currentIndex, currentPage);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushProgress();
    };

    window.addEventListener("beforeunload", flushProgress);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushProgress);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeBookId, book, currentIndex, currentPage, view]);

  const isReaderImageRunActive = (runId: number) =>
    readerImageModeRef.current && runId === readerImageRunRef.current;

  const generateReaderImageForBook = async (
    bookId: string,
    sourceBook: ReaderBook,
    chunk: ReaderImageChunk,
    runId = readerImageRunRef.current,
    style = readerImageStyle
  ): Promise<ReaderImageGenerationResult> => {
    if (!isReaderImageRunActive(runId)) return "skipped";
    if (imageRequestsRef.current.has(chunk.index)) return "skipped";

    imageRequestsRef.current.add(chunk.index);

    try {
      const requestBody = {
        author: sourceBook.author,
        bookId,
        bookTitle: sourceBook.title,
        chunkIndex: chunk.index,
        endWord: chunk.endWord,
        imageStyle: style,
        style,
        startWord: chunk.startWord,
        text: chunk.text
      };

      setReaderImages((items) => {
        const fallbackSrc = readerImageFallbackSrcFromState(
          items,
          chunk.index,
          displayedReaderImageChunkIndexRef.current
        );
        return {
          ...items,
          [chunk.index]: { fallbackSrc, status: "checking", style }
        };
      });
      const checkFeedbackStartedAt = performance.now();
      const finishCheckFeedback = async () => {
        const elapsed = performance.now() - checkFeedbackStartedAt;
        if (elapsed < READER_IMAGE_CHECK_FEEDBACK_MS) {
          await wait(READER_IMAGE_CHECK_FEEDBACK_MS - elapsed);
        }
      };

      const cachedImage = await getCachedReaderImage(bookId, chunk, style);
      if (!isReaderImageRunActive(runId)) return "skipped";
      if (cachedImage?.src) {
        await finishCheckFeedback();
        if (!isReaderImageRunActive(runId)) return "skipped";
        void loadReaderImageUsage();
        setReaderImages((items) => ({
          ...items,
          [chunk.index]: {
            prompt: cachedImage.prompt,
            src: cachedImage.src,
            status: "ready",
            style
          }
        }));
        return "ready";
      }

      const { data: storedData, error: storedError } = await supabase.functions.invoke("generate-reader-image", {
        method: "POST",
        body: {
          ...requestBody,
          checkOnly: true
        }
      });

      if (!isReaderImageRunActive(runId)) return "skipped";
      if (storedError) throw storedError;
      if (typeof storedData?.imageCount === "number") setReaderImageCount(storedData.imageCount);
      if (storedData?.imageUrl) {
        await finishCheckFeedback();
        if (!isReaderImageRunActive(runId)) return "skipped";
        const prompt = typeof storedData.prompt === "string" ? storedData.prompt : undefined;
        void cacheReaderImage({
          bookId,
          createdAt: new Date().toISOString(),
          endWord: chunk.endWord,
          key: readerImageCacheKey(bookId, chunk, style),
          prompt,
          src: storedData.imageUrl,
          startWord: chunk.startWord,
          style
        });
        setReaderImages((items) => ({
          ...items,
          [chunk.index]: {
            prompt,
            imageCount: typeof storedData.imageCount === "number" ? storedData.imageCount : undefined,
            imageLimit: typeof storedData.imageLimit === "number" ? storedData.imageLimit : undefined,
            src: storedData.imageUrl,
            status: "ready",
            style
          }
        }));
        return "ready";
      }

      await finishCheckFeedback();
      if (!isReaderImageRunActive(runId)) return "skipped";
      setGeneratingReaderImageChunkIndex(chunk.index);
      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          fallbackSrc: items[chunk.index]?.fallbackSrc,
          isFreshGeneration: true,
          status: "loading",
          style
        }
      }));
      await waitForNextPaint();
      if (!isReaderImageRunActive(runId)) return "skipped";

      const generationRequest = supabase.functions.invoke("generate-reader-image", {
        method: "POST",
        body: requestBody
      });
      const [{ data, error }] = await Promise.all([
        generationRequest,
        wait(READER_IMAGE_GENERATION_FEEDBACK_MS)
      ]);

      if (!isReaderImageRunActive(runId)) return "skipped";
      if (error) throw error;
      if (data?.limitReached) {
        const imageLimit = typeof data.imageLimit === "number" ? data.imageLimit : readerImageLimit;
        const imageCount = typeof data.imageCount === "number" ? data.imageCount : imageLimit;
        const plan = data.plan === "pro" ? "pro" : "free";
        const message =
          plan === "free"
            ? `You have used all ${imageLimit} free lifetime images.`
            : `You have reached your ${imageLimit}-image Pro monthly limit.`;

        setReaderImageCount(imageCount);
        if (plan === "free") setReaderImageUpgradeOpen(true);
        setReaderImages((items) => ({
          ...items,
          [chunk.index]: {
            error: message,
            imageCount,
            imageLimit,
            limitReached: true,
            plan,
            status: "error",
            style
          }
        }));
        setGeneratingReaderImageChunkIndex((current) => current === chunk.index ? null : current);
        return "error";
      }
      if (!data?.imageUrl) throw new Error("Image generation returned no image.");

      const prompt = typeof data.prompt === "string" ? data.prompt : undefined;
      if (typeof data.imageCount === "number") setReaderImageCount(data.imageCount);
      else void loadReaderImageUsage();
      void cacheReaderImage({
        bookId,
        createdAt: new Date().toISOString(),
        endWord: chunk.endWord,
        key: readerImageCacheKey(bookId, chunk, style),
        prompt,
        src: data.imageUrl,
        startWord: chunk.startWord,
        style
      });

      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          prompt,
          imageCount: typeof data.imageCount === "number" ? data.imageCount : undefined,
          imageLimit: typeof data.imageLimit === "number" ? data.imageLimit : undefined,
          src: data.imageUrl,
          status: "ready",
          style
        }
      }));
      setGeneratingReaderImageChunkIndex((current) => current === chunk.index ? null : current);
      return "ready";
    } catch (error) {
      if (!isReaderImageRunActive(runId)) return "skipped";
      const message = readerImageErrorMessage(await edgeFunctionErrorMessage(error));
      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          error: message,
          status: "error",
          style
        }
      }));
      setGeneratingReaderImageChunkIndex((current) => current === chunk.index ? null : current);
      return "error";
    } finally {
      if (runId === readerImageRunRef.current) imageRequestsRef.current.delete(chunk.index);
    }
  };

  const generateReaderImage = async (
    chunk: ReaderImageChunk,
    runId = readerImageRunRef.current,
    style = readerImageStyle
  ) => {
    if (!book || !activeBookId) return;
    await generateReaderImageForBook(activeBookId, book, chunk, runId, style);
  };

  const ensureReaderImage = async (chunkIndex: number, runId = readerImageRunRef.current) => {
    const chunk = readerImageChunkByIndex.get(chunkIndex);
    if (!chunk) return;

    const existing = readerImages[chunk.index];
    if (existing?.style === readerImageStyle && (existing?.status === "ready" || existing?.status === "checking" || existing?.status === "loading")) return;
    await generateReaderImage(chunk, runId);
  };

  const stopReaderImageMode = () => {
    readerImageRunRef.current += 1;
    readerImageModeRef.current = false;
    if (readerImageSettleTimerRef.current !== null) {
      window.clearTimeout(readerImageSettleTimerRef.current);
      readerImageSettleTimerRef.current = null;
    }
    imageRequestsRef.current.clear();
    setReaderImageMode(false);
    setReaderImageStyleOpen(false);
    setReaderImages({});
    setVisibleReaderImageChunkIndex(null);
    setDisplayedReaderImageChunkIndex(null);
    setGeneratingReaderImageChunkIndex(null);
  };

  const selectReaderImageStyle = (style: ReaderImageStyle) => {
    if (style === readerImageStyle) {
      setReaderImageStyleOpen(false);
      return;
    }

    setReaderImageStyle(style);
    setReaderImageStyleOpen(false);
    if (!readerImageMode || !book || activeReaderImageChunkIndex < 0) return;

    const runId = readerImageRunRef.current + 1;
    readerImageRunRef.current = runId;
    readerImageModeRef.current = true;
    if (readerImageSettleTimerRef.current !== null) {
      window.clearTimeout(readerImageSettleTimerRef.current);
      readerImageSettleTimerRef.current = null;
    }
    imageRequestsRef.current.clear();
    setReaderImages({});
    setVisibleReaderImageChunkIndex(null);
    setDisplayedReaderImageChunkIndex(null);
    setGeneratingReaderImageChunkIndex(null);

    const chunk = readerImageChunkByIndex.get(activeReaderImageChunkIndex);
    const nextChunk = readerImageChunkByIndex.get(activeReaderImageChunkIndex + 1);
    if (chunk) void generateReaderImage(chunk, runId, style);
    if (nextChunk) void generateReaderImage(nextChunk, runId, style);
  };

  const toggleReaderImageMode = () => {
    if (readerImageMode) {
      stopReaderImageMode();
      return;
    }

    if (!book || activeReaderImageChunkIndex < 0) return;
    if (!readerImageChunkByIndex.has(activeReaderImageChunkIndex)) return;

    const runId = readerImageRunRef.current + 1;
    readerImageRunRef.current = runId;
    readerImageModeRef.current = true;
    imageRequestsRef.current.clear();
    setReaderImages({});
    setVisibleReaderImageChunkIndex(null);
    setDisplayedReaderImageChunkIndex(null);
    setGeneratingReaderImageChunkIndex(null);
    setReaderImageMode(true);
  };

  const loadLibrary = async (_user: User) => {
    const runId = libraryLoadRunRef.current + 1;
    libraryLoadRunRef.current = runId;
    setBusy(true);
    setCatalogReady(false);
    setNotice("");

    try {
      const { data, error } = await supabase
        .from("books")
        .select("*")
        .order("last_opened_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .abortSignal(libraryAbortSignal());

      if (runId !== libraryLoadRunRef.current) return;

      if (error) {
        setNotice(error.message.includes("AbortError") ? "Could not load your library. Please check your connection and try again." : error.message);
        setCatalogBooks([]);
      } else {
        const rows = (data ?? []) as BookRow[];
        const pending = readPendingBookDelete();
        const visibleRows = sortBooksByRecentActivity(pending ? rows.filter((row) => row.id !== pending.row.id) : rows);

        setCatalogBooks(visibleRows);
        setCatalogReady(true);
        void waitForLibraryCovers(visibleRows);

        if (pending) {
          if (Date.now() >= pending.deadline) {
            void permanentlyDeleteBook(pending.row).catch((deleteError) => {
              clearPendingBookDelete(pending.row.id);
              setNotice(deleteError instanceof Error ? deleteError.message : "Could not delete this book.");
              setCatalogBooks((items) => {
                if (items.some((item) => item.id === pending.row.id)) return items;
                return sortBooksByRecentActivity([...items, pending.row]);
              });
            });
          } else if (!pendingDeleteRef.current || pendingDeleteRef.current.row.id !== pending.row.id) {
            if (pendingDeleteRef.current) window.clearTimeout(pendingDeleteRef.current.timer);
            const resumedPending: PendingDelete = {
              book: parsedBooks.current.get(pending.row.id) ?? null,
              deadline: pending.deadline,
              file: parsedBookFiles.current.get(pending.row.id) ?? null,
              index: pending.index,
              row: pending.row,
              timer: 0,
              wasActive: activeBookId === pending.row.id
            };

            resumedPending.timer = window.setTimeout(() => {
              if (pendingDeleteRef.current?.row.id !== pending.row.id) return;
              setPendingDeleteExiting(true);
              pendingDeleteExitTimer.current = window.setTimeout(() => {
                pendingDeleteRef.current = null;
                setPendingDelete(null);
                setPendingDeleteExiting(false);
                pendingDeleteExitTimer.current = null;
                void permanentlyDeleteBook(pending.row).catch((deleteError) => {
                  clearPendingBookDelete(pending.row.id);
                  setNotice(deleteError instanceof Error ? deleteError.message : "Could not delete this book.");
                  setCatalogBooks((items) => {
                    if (items.some((item) => item.id === pending.row.id)) return items;
                    return sortBooksByRecentActivity([...items, pending.row]);
                  });
                });
              }, TOAST_ANIMATION_MS);
            }, pending.deadline - Date.now());

            pendingDeleteRef.current = resumedPending;
            setPendingDeleteExiting(false);
            setPendingDelete(resumedPending);
          }
        }
      }

      setCatalogReady(true);
    } catch (error) {
      if (runId !== libraryLoadRunRef.current) return;
      setNotice(error instanceof Error ? error.message : "Could not load your library.");
      setCatalogBooks([]);
      setCatalogReady(true);
    } finally {
      if (runId === libraryLoadRunRef.current) setBusy(false);
    }
  };

  const loadBillingProfile = async (_user: User) => {
    const { data, error } = await supabase
      .from("billing_profiles")
      .select("*")
      .maybeSingle();

    if (!error) setBillingProfile(data as BillingProfile | null);
  };

  const loadReaderImageUsage = async () => {
    const currentMonthStart = new Date().toISOString().slice(0, 7) + "-01";
    const usageRequest = supabase
      .from("reader_image_usage")
      .select("generated_count, monthly_generated_count, monthly_period_start")
      .maybeSingle();
    let imageRowsRequest = supabase
      .from("reader_images")
      .select("id", { count: "exact", head: true });

    if (isPro) imageRowsRequest = imageRowsRequest.gte("created_at", currentMonthStart);

    const [{ data, error }, { count, error: imageRowsError }] = await Promise.all([
      usageRequest,
      imageRowsRequest
    ]);
    const savedImageCount = imageRowsError ? 0 : count ?? 0;

    if (error) {
      setReaderImageCount(savedImageCount);
      return;
    }

    if (isPro) {
      const usageCount = data?.monthly_period_start === currentMonthStart ? data?.monthly_generated_count ?? 0 : 0;
      setReaderImageCount(Math.max(usageCount, savedImageCount));
      return;
    }

    setReaderImageCount(Math.max(data?.generated_count ?? 0, savedImageCount));
  };

  const loadReaderDashboard = async () => {
    setDashboardLoading(true);
    setDashboardError("");

    const { data, error } = await supabase.functions.invoke("reader-dashboard", {
      method: "GET"
    });

    if (error) {
      setDashboardError(await edgeFunctionErrorMessage(error));
    } else {
      setDashboardData(data as ReaderDashboardData);
    }

    setDashboardLoading(false);
  };

  const saveReadingProgress = async (bookId: string, index: number, page = currentPage) => {
    const savedAt = new Date().toISOString();
    const { error } = await supabase
      .from("books")
      .update({ current_index: index, current_page: Math.max(1, page), last_opened_at: savedAt })
      .eq("id", bookId);

    if (error) return;

    setCatalogBooks((items) =>
      sortBooksByRecentActivity(items.map((item) =>
        item.id === bookId
          ? { ...item, current_index: index, current_page: Math.max(1, page), last_opened_at: savedAt, updated_at: savedAt }
          : item
      ))
    );
  };

  const markBookOpened = (bookId: string) => {
    const openedAt = new Date().toISOString();
    setCatalogBooks((items) =>
      sortBooksByRecentActivity(items.map((item) =>
        item.id === bookId ? { ...item, last_opened_at: openedAt, updated_at: openedAt } : item
      ))
    );
    void supabase.from("books").update({ last_opened_at: openedAt }).eq("id", bookId);
  };

  const openRenameDialog = (row: BookRow) => {
    setCatalogActionBookId("");
    setRenameTarget(row);
    setRenameTitle(row.title);
    setRenameError("");
    setNotice("");
  };

  const closeRenameDialog = () => {
    if (isRenamingBook) return;
    setRenameTarget(null);
    setRenameTitle("");
    setRenameError("");
  };

  const applyRenamedBook = (renamedRow: BookRow) => {
    setCatalogBooks((items) =>
      sortBooksByRecentActivity(items.map((item) => (item.id === renamedRow.id ? renamedRow : item)))
    );
    setOpeningBook((current) => (current?.id === renamedRow.id ? renamedRow : current));

    const parsed = parsedBooks.current.get(renamedRow.id);
    if (parsed) {
      parsedBooks.current.set(renamedRow.id, { ...parsed, title: renamedRow.title });
    }

    if (activeBookId === renamedRow.id) {
      setBook((current) => (current ? { ...current, title: renamedRow.title } : current));
    }
  };

  useEffect(() => {
    if (!renameTarget) return;
    catalogRenameInputRef.current?.focus();
    catalogRenameInputRef.current?.select();
  }, [renameTarget]);

  useEffect(() => {
    if (!readerRenameTarget) return;
    readerRenameInputRef.current?.focus();
    readerRenameInputRef.current?.select();
  }, [readerRenameTarget]);

  const openReaderRename = (row: BookRow, displayTitle = row.title) => {
    setReaderRenameTarget(row);
    setReaderRenameTitle(displayTitle);
    setReaderRenameError("");
    setSettingsOpen(false);
    setReaderMenuOpen(null);
  };

  const cancelReaderRename = () => {
    if (isReaderRenamingBook) return;
    setReaderRenameTarget(null);
    setReaderRenameTitle("");
    setReaderRenameError("");
  };

  const commitReaderRename = async () => {
    if (!readerRenameTarget || !user) return;
    if (isReaderRenamingBook) return;

    const nextTitle = readerRenameTitle.trim().replace(/\s+/g, " ");
    if (!nextTitle) {
      cancelReaderRename();
      return;
    }

    if (nextTitle === readerRenameTarget.title) {
      cancelReaderRename();
      return;
    }

    setIsReaderRenamingBook(true);
    setReaderRenameError("");
    setNotice("");

    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("books")
      .update({ title: nextTitle, updated_at: updatedAt })
      .eq("id", readerRenameTarget.id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
      setReaderRenameError(error.message);
      setIsReaderRenamingBook(false);
      return;
    }

    applyRenamedBook(data as BookRow);
    setReaderRenameTarget(null);
    setReaderRenameTitle("");
    setIsReaderRenamingBook(false);
  };

  const renameReaderBook = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void commitReaderRename();
  };

  const renameBook = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameTarget || !user) return;

    const nextTitle = renameTitle.trim().replace(/\s+/g, " ");
    if (!nextTitle) {
      setRenameError("Add a title for this document.");
      return;
    }

    if (nextTitle === renameTarget.title) {
      closeRenameDialog();
      return;
    }

    setIsRenamingBook(true);
    setRenameError("");
    setNotice("");

    const updatedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("books")
      .update({ title: nextTitle, updated_at: updatedAt })
      .eq("id", renameTarget.id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
      setRenameError(error.message);
      setIsRenamingBook(false);
      return;
    }

    applyRenamedBook(data as BookRow);
    setRenameTarget(null);
    setRenameTitle("");
    setIsRenamingBook(false);
  };

  const stopAudio = () => {
    edgeTtsPlayerRef.current?.stop();
    edgeTtsPlayerRef.current = null;
    setSpeechHighlight(null);
  };

  const adjustReaderTextScale = (delta: number) => {
    setReaderTextScale((scale) => clampReaderTextScale(Number((scale + delta / 16).toFixed(4))));
  };

  const adjustReaderLineHeight = (delta: number) => {
    setReaderLineHeight((height) => clampReaderLineHeight(Number((height + delta).toFixed(1))));
  };

  const adjustReaderLineWidth = (delta: number) => {
    setReaderLineWidth((width) => clampReaderLineWidth(Math.round(width + delta)));
  };

  const adjustPdfPageScale = (delta: number) => {
    setPdfPageScale((scale) => clampPdfPageScale(Number((scale + delta).toFixed(2))));
  };

  const handleNarrationRateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (!Number.isFinite(value)) return;
    setNarrationRate(clampNarrationRate(value));
  };

  const chooseNarrationRate = (value: number) => {
    setNarrationRate(clampNarrationRate(value));
  };

  const chooseNarrationVoice = (voiceId: string) => {
    setNarrationVoice(voiceId);
    window.localStorage.setItem(VOICE_STORAGE_KEY, voiceId);
    setVoicePopoverOpen(false);
    if (playback !== "idle") {
      edgeTtsPlayerRef.current?.setRate(narrationRate);
    }
  };

  const speedRateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
    const speed = NARRATION_RATE_MIN + ratio * (NARRATION_RATE_MAX - NARRATION_RATE_MIN);
    return clampNarrationRate(Number((Math.round(speed / 0.05) * 0.05).toFixed(2)));
  };

  const previewNarrationRate = (event: PointerEvent<HTMLDivElement>) => {
    setSpeedPreviewRate(speedRateFromPointer(event));
  };

  const selectNarrationRateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const nextRate = speedRateFromPointer(event);
    setSpeedPreviewRate(nextRate);
    chooseNarrationRate(nextRate);
  };

  const handleSpeedPickerKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowDown" && event.key !== "ArrowRight" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -0.05 : 0.05;
    chooseNarrationRate(Number((narrationRate + delta).toFixed(2)));
  };

  const advance = () => {
    if (!book) return;
    const target = Math.min(currentIndex + 1, book.paragraphs.length - 1);
    pendingScrollIndex.current = target;
    setCurrentIndex(target);
  };

  const speakEdge = (paragraph: ReaderParagraph) => {
    if (paragraph.kind === "image") return;

    edgeTtsPlayerRef.current?.stop();
    edgeTtsPlayerRef.current = null;
    const wordRanges = wordRangesFromText(paragraph.text);

    if (wordRanges[0]) {
      setSpeechHighlight({ paragraphId: paragraph.id, ...wordRanges[0] });
    } else {
      setSpeechHighlight({ paragraphId: paragraph.id, start: 0, end: 0 });
    }

    edgeTtsPlayerRef.current = createEdgeTtsPlayer({
      onBoundary: (range) => {
        setSpeechHighlight({ paragraphId: paragraph.id, ...range });
      },
      onEnded: () => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        if (book && currentIndex < book.paragraphs.length - 1) {
          advance();
        } else {
          setPlayback("idle");
        }
      },
      onError: (error) => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        setNotice(error.message || "Edge voice could not play this paragraph.");
        setPlayback("idle");
      },
      text: paragraph.text,
      rate: narrationRate,
      voice: narrationVoice,
      wordRanges
    });
  };

  const speakEdgeFromWord = (paragraph: ReaderParagraph, wordCharStart: number) => {
    if (paragraph.kind === "image") return;

    const fullRanges = wordRangesFromText(paragraph.text);
    const wordIndex = fullRanges.findIndex((r) => r.start === wordCharStart);
    if (wordIndex < 0) return;

    edgeTtsPlayerRef.current?.stop();
    edgeTtsPlayerRef.current = null;

    const slicedText = paragraph.text.slice(wordCharStart);
    const slicedRanges = wordRangesFromText(slicedText);

    if (slicedRanges[0]) {
      setSpeechHighlight({ paragraphId: paragraph.id, start: wordCharStart + slicedRanges[0].start, end: wordCharStart + slicedRanges[0].end });
    }

    setPlayback("playing");

    const paragraphIndex = book?.paragraphs.findIndex((p) => p.id === paragraph.id) ?? -1;
    if (paragraphIndex >= 0 && paragraphIndex !== currentIndex) {
      suppressNextPlaybackStartRef.current = true;
      setCurrentIndex(paragraphIndex);
    }

    edgeTtsPlayerRef.current = createEdgeTtsPlayer({
      onBoundary: (range) => {
        setSpeechHighlight({ paragraphId: paragraph.id, start: wordCharStart + range.start, end: wordCharStart + range.end });
      },
      onEnded: () => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        if (book && paragraphIndex >= 0 && paragraphIndex < book.paragraphs.length - 1) {
          const nextIndex = paragraphIndex + 1;
          pendingScrollIndex.current = nextIndex;
          setCurrentIndex(nextIndex);
        } else {
          setPlayback("idle");
        }
      },
      onError: (error) => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        setNotice(error.message || "Edge voice could not play this paragraph.");
        setPlayback("idle");
      },
      text: slicedText,
      rate: narrationRate,
      voice: narrationVoice,
      wordRanges: slicedRanges
    });
  };

  const speakPdfPageFromWord = (pageNumber: number, pageText: string, wordCharStart: number) => {
    const trimmedText = pageText.trim();
    if (!trimmedText) return;

    const safeStart = Math.max(0, Math.min(wordCharStart, trimmedText.length - 1));
    const slicedText = trimmedText.slice(safeStart);
    const slicedRanges = wordRangesFromText(slicedText);
    const speechParagraphId = pdfPageSpeechId(pageNumber);

    edgeTtsPlayerRef.current?.stop();
    edgeTtsPlayerRef.current = null;

    if (slicedRanges[0]) {
      setSpeechHighlight({
        paragraphId: speechParagraphId,
        start: safeStart + slicedRanges[0].start,
        end: safeStart + slicedRanges[0].end
      });
    }

    setCurrentPage(pageNumber);
    setPlayback("playing");

    edgeTtsPlayerRef.current = createEdgeTtsPlayer({
      onBoundary: (range) => {
        setSpeechHighlight({
          paragraphId: speechParagraphId,
          start: safeStart + range.start,
          end: safeStart + range.end
        });
      },
      onEnded: () => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        setPlayback("idle");
      },
      onError: (error) => {
        edgeTtsPlayerRef.current = null;
        setSpeechHighlight(null);
        setNotice(error.message || "Edge voice could not play this PDF page.");
        setPlayback("idle");
      },
      text: slicedText,
      rate: narrationRate,
      voice: narrationVoice,
      wordRanges: slicedRanges
    });
  };

  const handleParagraphClick = (e: MouseEvent<HTMLElement>, paragraph: ReaderParagraph, index: number) => {
    const target = e.target as HTMLElement;
    const wordSpan = target.closest(".reader-word");
    if (wordSpan) {
      const startAttr = wordSpan.getAttribute("data-word-start");
      if (startAttr !== null) {
        const start = parseInt(startAttr, 10);
        speakEdgeFromWord(paragraph, start);
        return;
      }
    }
    moveTo(index);
  };

  const handlePdfWordClick = useCallback((pageNumber: number, pageWordIndex: number, word?: PdfTextLayerWord, pageText?: string) => {
    if (word && pageText) {
      speakPdfPageFromWord(pageNumber, pageText, word.charStart);
      return;
    }

    if (!book) return;
    const pageParagraphs = book.paragraphs.filter((paragraph) => paragraph.pageNumber === pageNumber);
    if (pageParagraphs.length === 0) return;

    let accumulatedWordCount = 0;
    for (let pIndex = 0; pIndex < pageParagraphs.length; pIndex++) {
      const paragraph = pageParagraphs[pIndex];
      const paragraphRanges = wordRangesFromText(paragraph.text);
      const paragraphWordCount = paragraphRanges.length;

      if (pageWordIndex >= accumulatedWordCount && pageWordIndex < accumulatedWordCount + paragraphWordCount) {
        const localWordIndex = pageWordIndex - accumulatedWordCount;
        const clickedRange = paragraphRanges[localWordIndex];
        if (clickedRange) {
          speakEdgeFromWord(paragraph, clickedRange.start);
          return;
        }
      }
      accumulatedWordCount += paragraphWordCount;
    }
  }, [book, narrationRate]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setNotice("");

    const credentials = { email, password };
    const { error } =
      authMode === "sign-in"
        ? await supabase.auth.signInWithPassword(credentials)
        : await supabase.auth.signUp({
            ...credentials,
            options: {
              emailRedirectTo: authRedirectUrl()
            }
          });

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
        redirectTo: authRedirectUrl()
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
      setNotice(await edgeFunctionErrorMessage(error));
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
      setNotice(await edgeFunctionErrorMessage(error));
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

  const renderProComparison = () => (
    <div className="pro-comparison-overlay" role="presentation" onClick={() => setReaderImageUpgradeOpen(false)}>
      <section
        aria-labelledby="pro-comparison-title"
        aria-modal="true"
        className="pro-comparison-page"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="pro-comparison-close" onClick={() => setReaderImageUpgradeOpen(false)} title="Close" type="button">
          <X size={18} aria-hidden="true" />
        </button>
        <div className="pro-comparison-hero">
          <h2 className="pro-comparison-brand library-brand-mark" id="pro-comparison-title">
            <img src="/landing/logo.webp" alt="" aria-hidden="true" />
            <span>illume</span>
            <span className="library-plan-badge pro">
              <span>Pro</span>
            </span>
          </h2>
          <p>Keep image mode alive with a monthly allowance built for deeper reading.</p>
        </div>
        <div className={`pro-usage-strip ${isPro ? "pro" : "free"}`} aria-label="Current image usage">
          <span>{isPro ? `${readerImageCount} of ${PRO_READER_IMAGE_MONTHLY_LIMIT} Pro images used this month` : `${Math.min(readerImageCount, FREE_READER_IMAGE_LIFETIME_LIMIT)} of ${FREE_READER_IMAGE_LIFETIME_LIMIT} free images used`}</span>
          <div>
            <span style={{ width: `${Math.min(100, (readerImageCount / readerImageLimit) * 100)}%` }} />
          </div>
        </div>
        <div className="pro-plan-comparison" aria-label="Plan comparison">
          <div className="pro-plan-column free">
            <span className="pro-plan-label">illume Free</span>
            <div className="pro-plan-price">
              <strong>25</strong>
              <small>images</small>
            </div>
            <p>Included with your free account.</p>
            <p>{formatBytes(FREE_USER_STORAGE_QUOTA_BYTES)} library storage.</p>
          </div>
          <div className="pro-plan-column pro">
            <div className="pro-plan-heading">
              <span className="pro-plan-label">illume Pro</span>
            </div>
            <div className="pro-plan-price">
              <strong>{PRO_READER_IMAGE_MONTHLY_LIMIT}</strong>
              <small>images / month</small>
            </div>
            <p>Your Pro allowance refreshes monthly.</p>
            <p>{formatBytes(PRO_USER_STORAGE_QUOTA_BYTES)} library storage.</p>
          </div>
        </div>
        <div className="pro-comparison-actions">
          <button className="pro-checkout-button" disabled={busy} onClick={() => void startCheckout()} type="button">
            {busy ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Crown size={16} aria-hidden="true" />}
            <span>Upgrade to Pro</span>
          </button>
          <button className="pro-later-button" onClick={() => setReaderImageUpgradeOpen(false)} type="button">
            Not now
          </button>
        </div>
      </section>
    </div>
  );

  const showUploadedBookNotice = (title: string) => {
    if (uploadedBookNoticeTimer.current) {
      window.clearTimeout(uploadedBookNoticeTimer.current);
    }
    if (uploadedBookNoticeExitTimer.current) {
      window.clearTimeout(uploadedBookNoticeExitTimer.current);
      uploadedBookNoticeExitTimer.current = null;
    }

    setUploadedBookNoticeExiting(false);
    setUploadedBookNotice(title);
    uploadedBookNoticeTimer.current = window.setTimeout(() => {
      setUploadedBookNoticeExiting(true);
      uploadedBookNoticeExitTimer.current = window.setTimeout(() => {
        setUploadedBookNotice("");
        setUploadedBookNoticeExiting(false);
        uploadedBookNoticeExitTimer.current = null;
      }, TOAST_ANIMATION_MS);
      uploadedBookNoticeTimer.current = null;
    }, 4200);
  };

  const clearUploadedBookNotice = () => {
    if (uploadedBookNoticeTimer.current) {
      window.clearTimeout(uploadedBookNoticeTimer.current);
      uploadedBookNoticeTimer.current = null;
    }
    if (uploadedBookNoticeExitTimer.current) {
      window.clearTimeout(uploadedBookNoticeExitTimer.current);
      uploadedBookNoticeExitTimer.current = null;
    }
    if (!uploadedBookNotice) return;
    setUploadedBookNoticeExiting(true);
    uploadedBookNoticeExitTimer.current = window.setTimeout(() => {
      setUploadedBookNotice("");
      setUploadedBookNoticeExiting(false);
      uploadedBookNoticeExitTimer.current = null;
    }, TOAST_ANIMATION_MS);
  };

  const updatePendingImportProgress = (id: string | undefined, progress: number) => {
    if (!id) return;
    const clampedProgress = Math.max(0, Math.min(100, Math.round(progress)));
    setPendingBookImports((items) =>
      items.map((item) => (item.id === id ? { ...item, progress: clampedProgress } : item))
    );
  };

  const updatePendingImportDetails = (
    id: string | undefined,
    details: Partial<Pick<PendingBookImport, "author" | "coverUrl" | "statusText" | "title">>
  ) => {
    if (!id) return;
    setPendingBookImports((items) =>
      items.map((item) => (item.id === id ? { ...item, ...details } : item))
    );
  };

  const loadStoredPdfPages = async (bookId: string): Promise<StoredPdfPage[]> => {
    const { data, error } = await supabase
      .from("book_pages")
      .select("page_number, text")
      .eq("book_id", bookId)
      .order("page_number", { ascending: true });

    if (error) {
      console.warn("Could not load processed PDF pages.", error);
      return [];
    }

    return (data ?? []) as StoredPdfPage[];
  };

  const queuePdfProcessing = (bookId: string) => {
    setCatalogBooks((items) =>
      items.map((item) => item.id === bookId ? { ...item, processing_status: "queued" } : item)
    );

    void supabase.functions.invoke("process-reader-document", {
      method: "POST",
      body: { bookId }
    }).then(({ error }) => {
      if (error) {
        console.error("Could not queue PDF processing:", error);
        setCatalogBooks((items) =>
          items.map((item) => item.id === bookId ? { ...item, processing_status: "failed", processing_error: error.message } : item)
        );
      }
    });
  };

  const importDocumentFile = async (file: File, openAfterImport = true, pendingImportId?: string) => {
    if (!user) return;

    if (!isEpubFile(file) && !isPdfFile(file)) {
      throw new Error("Please select an EPUB or PDF file.");
    }

    if (storageUsed + file.size > storageQuotaBytes) {
      throw new Error(`This upload would exceed your ${formatBytes(storageQuotaBytes)} library limit.`);
    }

    const format = isPdfFile(file) ? "pdf" : "epub";
    const mimeType = documentMimeType(format);
    updatePendingImportProgress(pendingImportId, 12);
    const pdfPreview = format === "pdf" ? await readPdfPreview(file) : null;
    updatePendingImportProgress(pendingImportId, 25);
    const parsed = format === "pdf" ? await parsePdf(file) : await parseEpub(file);
    updatePendingImportProgress(pendingImportId, 42);
    const embeddedCoverUrl = parsed.coverUrl ? await shrinkCoverDataUrl(parsed.coverUrl) : "";
    const coverUrl = embeddedCoverUrl || (format === "epub" ? await getOpenLibraryCoverUrl(parsed.title, parsed.author) : "");
    updatePendingImportDetails(pendingImportId, {
      author: parsed.author,
      coverUrl: coverUrl || null,
      statusText: "Generating visuals",
      title: parsed.title
    });
    updatePendingImportProgress(pendingImportId, 58);
    const id = crypto.randomUUID();
    const storagePath = `${user.id}/${id}/${safeDocumentFileName(file.name, format)}`;

    updatePendingImportProgress(pendingImportId, 68);
    const upload = await supabase.storage.from(EPUB_BUCKET).upload(storagePath, file, {
      contentType: mimeType,
      upsert: false
    });

    if (upload.error) {
      if (format === "pdf" && /mime type .*not supported/i.test(upload.error.message)) {
        throw new Error("PDF uploads are not enabled in Supabase Storage yet. Apply the PDF support migration so the epubs bucket allows application/pdf.");
      }
      throw upload.error;
    }
    updatePendingImportProgress(pendingImportId, 82);

    const newBook = {
      id,
      user_id: user.id,
      title: parsed.title,
      author: parsed.author,
      cover_url: coverUrl || null,
      document_type: format,
      storage_path: storagePath,
      file_name: file.name,
      file_size: file.size,
      mime_type: mimeType,
      page_count: parsed.pageCount ?? null,
      paragraph_count: parsed.paragraphs.length,
      chapter_count: parsed.chapters.length,
      pdf_page_metrics: pdfPreview?.pageMetrics ?? [],
      pdf_toc: pdfPreview
        ? pdfPreview.chapters.map((title, index) => ({
            pageNumber: pdfPreview.chapterPageNumbers[index] ?? 1,
            pageOffsetRatio: pdfPreview.chapterPageOffsets[index] ?? 0,
            title
          }))
        : [],
      processing_status: format === "pdf" ? "queued" : "ready",
      current_index: 0,
      current_page: 1,
      last_opened_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("books").insert(newBook).select("*").single();
    updatePendingImportProgress(pendingImportId, 90);

    if (error) {
      await supabase.storage.from(EPUB_BUCKET).remove([storagePath]);
      throw error;
    }

    const row = data as BookRow;
    parsedBooks.current.set(row.id, parsed);
    parsedBookFiles.current.set(row.id, file);
    void cacheBookFile(row, file);
    if (format === "pdf") queuePdfProcessing(row.id);

    const imageContext = readerImageOpenContext(row, parsed, row.current_index);
    let initialReaderImage: ReaderImageState | null = null;
    if (imageContext.firstChunk) {
      updatePendingImportProgress(pendingImportId, 94);
      updatePendingImportDetails(pendingImportId, { statusText: "Generating visuals" });
      try {
        initialReaderImage = await preGenerateReaderImageForBook(row, parsed, imageContext.firstChunk);
      } catch (error) {
        console.warn("Could not prepare the first reader image during upload:", error);
      }
    }

    setCatalogBooks((items) => sortBooksByRecentActivity([row, ...items]));
    updatePendingImportProgress(pendingImportId, 100);
    if (pendingImportId) {
      setPendingBookImports((items) => items.filter((item) => item.id !== pendingImportId));
    }
    showUploadedBookNotice(row.title);
    if (openAfterImport) {
      openParsedBook(row, parsed, 0, file, { initialReaderImage });
    }
  };

  const importDocumentFiles = async (files: File[]) => {
    if (!files.length || !user) return;

    if (files.some((file) => !isEpubFile(file) && !isPdfFile(file))) {
      setNotice("Please select EPUB or PDF files only.");
      return;
    }

    const totalUploadSize = files.reduce((total, file) => total + file.size, 0);
    if (storageUsed + totalUploadSize > storageQuotaBytes) {
      setNotice(`This upload would exceed your ${formatBytes(storageQuotaBytes)} library limit.`);
      return;
    }

    stopAudio();
    setPlayback("idle");
    setNotice("");
    clearUploadedBookNotice();

    for (const file of files) {
      const pendingImportId = `upload-${crypto.randomUUID()}`;
      const displayTitle = file.name.replace(/\.[^.]+$/, "").trim() || file.name;
      setPendingBookImports((items) => [
        {
          author: "Preparing document",
          coverUrl: null,
          fileName: file.name,
          id: pendingImportId,
          progress: 6,
          statusText: "Generating visuals",
          title: displayTitle
        },
        ...items
      ]);

      try {
        await importDocumentFile(file, files.length === 1, pendingImportId);
      } catch (error) {
        setPendingBookImports((items) => items.filter((item) => item.id !== pendingImportId));
        setNotice(error instanceof Error ? error.message : "Could not upload this document.");
      }
    }
  };

  const addClassicToLibrary = async (classic: ClassicBook) => {
    if (!user) return;
    stopAudio();
    setPlayback("idle");
    setNotice("");
    clearUploadedBookNotice();
    const pendingImportId = `classic-${classic.id}-${Date.now()}`;
    setPendingBookImports((items) => [
      {
        author: classic.author,
        coverUrl: classic.coverUrl,
        fileName: `${safeFileName(classic.title)}.epub`,
        id: pendingImportId,
        progress: 6,
        statusText: "Generating visuals",
        title: classic.title
      },
      ...items
    ]);
    setImportingClassicId(classic.id);

    try {
      updatePendingImportProgress(pendingImportId, 16);
      const response = await fetch(classicDownloadUrl(classic.downloadUrl));
      if (!response.ok) throw new Error("Could not download ebook from Standard Ebooks.");

      const blob = await response.blob();
      updatePendingImportProgress(pendingImportId, 34);
      if (!await blobLooksLikeEpub(blob)) {
        throw new Error(`The download for ${classic.title} did not return an EPUB. Please try again in a moment.`);
      }

      const filename = `${safeFileName(classic.title)}.epub`;
      const file = new File([blob], filename, { type: "application/epub+zip" });

      await importDocumentFile(file, false, pendingImportId);
    } catch (error) {
      setPendingBookImports((items) => items.filter((item) => item.id !== pendingImportId));
      setNotice(error instanceof Error ? error.message : "Failed to import classic book.");
    } finally {
      setImportingClassicId(null);
    }
  };

  const handleCatalogUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    await importDocumentFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const catalogDragHasFiles = (event: DragEvent<HTMLElement>) => Array.from(event.dataTransfer.types).includes("Files");

  const handleCatalogDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!user || !catalogDragHasFiles(event)) return;
    event.preventDefault();
    catalogDropDepth.current += 1;
    setIsCatalogDragActive(true);
  };

  const handleCatalogDragOver = (event: DragEvent<HTMLElement>) => {
    if (!user || !catalogDragHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsCatalogDragActive(true);
  };

  const handleCatalogDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!user || !catalogDragHasFiles(event)) return;
    event.preventDefault();
    catalogDropDepth.current = Math.max(0, catalogDropDepth.current - 1);
    if (catalogDropDepth.current === 0) {
      setIsCatalogDragActive(false);
    }
  };

  const handleCatalogDrop = (event: DragEvent<HTMLElement>) => {
    if (!user || !catalogDragHasFiles(event)) return;
    event.preventDefault();
    catalogDropDepth.current = 0;
    setIsCatalogDragActive(false);
    void importDocumentFiles(Array.from(event.dataTransfer.files));
  };

  const writeAppHistory = (state: AppHistoryState, mode: "push" | "replace" = "push") => {
    const nextUrl = `${window.location.pathname}${window.location.hash}`;
    if (mode === "replace") {
      window.history.replaceState(state, "", nextUrl);
      return;
    }
    window.history.pushState(state, "", nextUrl);
  };

  const readerImageOpenContext = (
    row: BookRow,
    parsed: ReaderBook,
    targetIndex = row.current_index
  ): ReaderImageOpenContext => {
    const start = resolveMeaningfulStart(parsed, row, targetIndex);
    const safeIndex = parsed.paragraphs.length ? Math.max(0, Math.min(start.index, parsed.paragraphs.length - 1)) : 0;
    const pageFromIndex = parsed.paragraphs[safeIndex]?.pageNumber ?? 1;
    const initialPage = Math.max(1, Math.min(start.page || pageFromIndex, parsed.pageCount ?? pageFromIndex));
    const startOffset =
      parsed.format === "pdf"
        ? 0
        : buildParagraphWordMetrics(parsed).offsets[safeIndex] ?? 0;
    const chunks =
      parsed.format === "pdf"
        ? buildPdfReaderImageChunks(parsed)
        : buildReaderImageChunks(parsed);
    const pdfStartOffset = parsed.format === "pdf" ? pdfWordOffsetBeforePage(parsed, initialPage) : 0;
    const firstChunk =
      parsed.format === "pdf"
        ? chunks.find((chunk) => chunk.startWord - 1 <= pdfStartOffset && chunk.endWord > pdfStartOffset) ?? chunks[0]
        : chunks[Math.min(chunks.length - 1, Math.floor(startOffset / READER_IMAGE_CHUNK_WORDS))] ?? chunks[0];

    return { chunks, firstChunk, initialPage, safeIndex, start, startOffset };
  };

  const preGenerateReaderImageForBook = async (
    row: BookRow,
    parsed: ReaderBook,
    chunk: ReaderImageChunk,
    style = readerImageStyle
  ): Promise<ReaderImageState | null> => {
    const requestBody = {
      author: parsed.author,
      bookId: row.id,
      bookTitle: parsed.title,
      chunkIndex: chunk.index,
      endWord: chunk.endWord,
      imageStyle: style,
      style,
      startWord: chunk.startWord,
      text: chunk.text
    };

    const { data, error } = await supabase.functions.invoke("generate-reader-image", {
      method: "POST",
      body: requestBody
    });

    if (error) throw error;
    if (typeof data?.imageCount === "number") setReaderImageCount(data.imageCount);
    else void loadReaderImageUsage();
    if (data?.limitReached || !data?.imageUrl) return null;

    const prompt = typeof data.prompt === "string" ? data.prompt : undefined;
    void cacheReaderImage({
      bookId: row.id,
      createdAt: new Date().toISOString(),
      endWord: chunk.endWord,
      key: readerImageCacheKey(row.id, chunk, style),
      prompt,
      src: data.imageUrl,
      startWord: chunk.startWord,
      style
    });
    return {
      imageCount: typeof data.imageCount === "number" ? data.imageCount : undefined,
      imageLimit: typeof data.imageLimit === "number" ? data.imageLimit : undefined,
      prompt,
      src: data.imageUrl,
      status: "ready",
      style
    };
  };

  const prepareOpeningReaderImage = async (
    row: BookRow,
    parsed: ReaderBook,
    chunk: ReaderImageChunk,
    style = readerImageStyle
  ): Promise<ReaderImageState | null> => {
    const readyState = (src: string, prompt?: string, counts?: Pick<ReaderImageState, "imageCount" | "imageLimit">) => ({
        ...counts,
        prompt,
        src,
        status: "ready" as const,
        style
    });

    try {
      const cachedImage = await getCachedReaderImage(row.id, chunk, style);
      if (cachedImage?.src) {
        void loadReaderImageUsage();
        return readyState(cachedImage.src, cachedImage.prompt);
      }

      const requestBody = {
        author: parsed.author,
        bookId: row.id,
        bookTitle: parsed.title,
        chunkIndex: chunk.index,
        endWord: chunk.endWord,
        imageStyle: style,
        style,
        startWord: chunk.startWord,
        text: chunk.text
      };

      const { data: storedData, error: storedError } = await supabase.functions.invoke("generate-reader-image", {
        method: "POST",
        body: {
          ...requestBody,
          checkOnly: true
        }
      });

      if (storedError) throw storedError;
      if (typeof storedData?.imageCount === "number") setReaderImageCount(storedData.imageCount);
      if (storedData?.imageUrl) {
        const prompt = typeof storedData.prompt === "string" ? storedData.prompt : undefined;
        void cacheReaderImage({
          bookId: row.id,
          createdAt: new Date().toISOString(),
          endWord: chunk.endWord,
          key: readerImageCacheKey(row.id, chunk, style),
          prompt,
          src: storedData.imageUrl,
          startWord: chunk.startWord,
          style
        });
        return readyState(storedData.imageUrl, prompt, {
          imageCount: typeof storedData.imageCount === "number" ? storedData.imageCount : undefined,
          imageLimit: typeof storedData.imageLimit === "number" ? storedData.imageLimit : undefined
        });
      }

      return null;
    } catch (error) {
      const message = readerImageErrorMessage(await edgeFunctionErrorMessage(error));
      return {
        error: message,
        status: "error",
        style
      };
    }
  };

  const openParsedBook = (
    row: BookRow,
    parsed: ReaderBook,
    targetIndex = row.current_index,
    file?: File,
    options: {
      defaultImageMode?: boolean;
      initialReaderImage?: ReaderImageState | null;
      updateHistory?: boolean;
    } = {}
  ) => {
    const { defaultImageMode = true, initialReaderImage = null, updateHistory = true } = options;
    const imageContext = readerImageOpenContext(row, parsed, targetIndex);
    stopAudio();
    setPlayback("idle");
    setNotice("");
    readerImageRunRef.current += 1;
    setReaderImages(initialReaderImage && imageContext.firstChunk ? { [imageContext.firstChunk.index]: initialReaderImage } : {});
    setVisibleReaderImageChunkIndex(null);
    setDisplayedReaderImageChunkIndex(initialReaderImage && imageContext.firstChunk ? imageContext.firstChunk.index : null);
    setGeneratingReaderImageChunkIndex(null);
    imageRequestsRef.current.clear();
    if (defaultImageMode && imageContext.firstChunk) {
      readerImageModeRef.current = true;
      setReaderImageMode(true);
    } else {
      readerImageModeRef.current = false;
      setReaderImageMode(false);
    }
    const readerPreferences = readerPreferencesForBook(row.id, readerThemeMode);
    setReaderFontMode(readerPreferences.fontMode);
    setReaderThemeMode(readerPreferences.themeMode);
    setReaderTheme(readerPreferences.theme);
    setReaderTextScale(readerPreferences.textScale);
    setReaderLineHeight(readerPreferences.lineHeight);
    setReaderLineWidth(readerPreferences.lineWidth);
    setNarrationRate(readerPreferences.narrationRate);
    setActiveBookId(row.id);
    setBook(parsed);
    setOpeningPdfPreview(null);
    setActiveBookFile(file ?? null);
    setPdfReaderViewMode(parsed.format === "pdf" ? "pdf" : "text");
    setOpeningPdfSettled(parsed.format !== "pdf");
    setOpeningTextSettled(parsed.format === "pdf");
    if (parsed.format === "pdf") {
      setChapterDrawerOpen(false);
      setPdfPageLayout("single");
      setPdfPageScale(1);
    }
    setPdfScrollOffsetRatio(imageContext.start.offsetRatio);
    setPdfScrollPage(imageContext.initialPage);
    setPdfScrollRequest(imageContext.start.offsetRatio > 0 ? 1 : 0);
    setPdfVisibleOffsetRatio(imageContext.start.offsetRatio);
    setCurrentPage(imageContext.initialPage);
    setCurrentIndex(imageContext.safeIndex);
    pendingScrollIndex.current = parsed.paragraphs.length ? imageContext.safeIndex : null;
    isInitialOpenRef.current = true;
    if (!imageContext.start.usedSmartStart && (imageContext.safeIndex > 0 || imageContext.initialPage > 1)) {
      setProgressNoticeToken((token) => token + 1);
      setProgressNotice(true);
    }
    setView("reader");
    markBookOpened(row.id);
    if (updateHistory) writeAppHistory({ illumeView: "reader", bookId: row.id });
  };

  const openBook = async (row: BookRow, options: { updateHistory?: boolean } = {}) => {
    const { updateHistory = true } = options;
    const cached = parsedBooks.current.get(row.id);
    const cachedFile = parsedBookFiles.current.get(row.id);
    const cachedPdfNeedsProcessedText =
      cached?.format === "pdf" &&
      row.processing_status === "processed" &&
      row.paragraph_count > 0 &&
      cached.paragraphs.length === 0;
    const runId = bookOpenRunRef.current + 1;
    bookOpenRunRef.current = runId;
    stopAudio();
    setPlayback("idle");
    setBusy(true);
    setNotice("");
    setProgressNotice(false);
    readerImageRunRef.current += 1;
    readerImageModeRef.current = false;
    setReaderImageMode(false);
    setReaderImages({});
    setVisibleReaderImageChunkIndex(null);
    setDisplayedReaderImageChunkIndex(null);
    setGeneratingReaderImageChunkIndex(null);
    imageRequestsRef.current.clear();
    const readerPreferences = readerPreferencesForBook(row.id, readerThemeMode);
    setReaderFontMode(readerPreferences.fontMode);
    setReaderThemeMode(readerPreferences.themeMode);
    setReaderTheme(readerPreferences.theme);
    setReaderTextScale(readerPreferences.textScale);
    setReaderLineHeight(readerPreferences.lineHeight);
    setReaderLineWidth(readerPreferences.lineWidth);
    setNarrationRate(readerPreferences.narrationRate);
    setActiveBookId(row.id);
    setBook(null);
    setOpeningBook(row);
    setOpeningBookProgress(8);
    setOpeningPdfSettled(bookFormat(row) !== "pdf");
    setOpeningTextSettled(bookFormat(row) === "pdf");
    setOpeningPdfPreview(null);
    setActiveBookFile(null);
    setPdfReaderViewMode(bookFormat(row) === "pdf" ? "pdf" : "text");
    if (bookFormat(row) === "pdf") {
      setChapterDrawerOpen(false);
      setPdfPageLayout("single");
      setPdfPageScale(1);
    }
    setCurrentPage(Math.max(1, row.current_page ?? 1));
    setCurrentIndex(Math.max(0, row.current_index ?? 0));
    setView("reader");
    if (updateHistory) writeAppHistory({ illumeView: "reader", bookId: row.id });

    await waitForOpeningPaint();
    if (runId !== bookOpenRunRef.current) return;
    if (row.cover_url) {
      await preloadLibraryCover(row.cover_url);
      if (runId !== bookOpenRunRef.current) return;
    }
    setOpeningBookProgress(18);

    if (cached && !cachedPdfNeedsProcessedText && (cached.format !== "pdf" || cachedFile)) {
      const imageContext = readerImageOpenContext(row, cached);
      if (imageContext.firstChunk) setOpeningBookProgress(96);
      const initialReaderImage = imageContext.firstChunk
        ? await prepareOpeningReaderImage(row, cached, imageContext.firstChunk)
        : null;
      if (runId !== bookOpenRunRef.current) return;
      setOpeningBookProgress(100);
      setBusy(false);
      openParsedBook(row, cached, undefined, cachedFile, { initialReaderImage, updateHistory: false });
      return;
    }

    try {
      let file = await getCachedBookFile(row);
      if (runId !== bookOpenRunRef.current) return;
      setOpeningBookProgress(file ? 56 : 28);

      if (!file) {
        const { data, error } = await supabase.storage.from(EPUB_BUCKET).download(row.storage_path);
        if (error) throw error;
        if (runId !== bookOpenRunRef.current) return;
        file = new File([data], row.file_name, { type: documentMimeType(bookFormat(row)) });
        void cacheBookFile(row, file);
        setOpeningBookProgress(56);
      }

      const format = bookFormat(row);
      const pdfPagesPromise = format === "pdf" ? loadStoredPdfPages(row.id) : Promise.resolve([]);
      setOpeningBookProgress(68);
      const preview = format === "pdf" ? pdfPreviewFromRow(row) ?? await readPdfPreview(file) : null;
      const pages = await pdfPagesPromise;
      setOpeningBookProgress(82);
      const parsed =
        format === "pdf"
          ? pages.length && preview
            ? pdfPreviewToBook(file, preview, pages)
            : await parsePdf(file)
          : await parseEpub(file);
      if (runId !== bookOpenRunRef.current) return;
      setOpeningBookProgress(92);
      if (format === "pdf") {
        setActiveBookFile(file);
        setOpeningPdfPreview({
          author: parsed.author,
          chapterPageNumbers: parsed.chapterPageNumbers ?? [],
          chapterPageOffsets: parsed.chapterPageOffsets ?? [],
          chapters: parsed.chapters,
          pageCount: parsed.pageCount ?? 0,
          pageMetrics: [],
          title: parsed.title
        });
        if (!pdfPreviewFromRow(row)) {
          const pdfToc = (preview?.chapters ?? []).map((title, index) => ({
            pageNumber: preview?.chapterPageNumbers[index] ?? 1,
            pageOffsetRatio: preview?.chapterPageOffsets[index] ?? 0,
            title
          }));
          void supabase
            .from("books")
            .update({
              page_count: parsed.pageCount ?? null,
              pdf_page_metrics: preview?.pageMetrics ?? [],
              pdf_toc: pdfToc
            })
            .eq("id", row.id);
        }
        if (row.processing_status === "queued" || row.processing_status === "failed") {
          queuePdfProcessing(row.id);
        }
      }
      if (format === "epub" && !row.cover_url && parsed.coverUrl) {
        const coverUrl = await shrinkCoverDataUrl(parsed.coverUrl);
        row = { ...row, cover_url: coverUrl };
        setCatalogBooks((items) => sortBooksByRecentActivity(items.map((item) => (item.id === row.id ? row : item))));
        const { error: updateError } = await supabase.from("books").update({ cover_url: coverUrl }).eq("id", row.id);
        if (updateError) {
          console.error("Failed to save book cover to database:", updateError);
        }
      }
      parsedBooks.current.set(row.id, parsed);
      parsedBookFiles.current.set(row.id, file);
      const imageContext = readerImageOpenContext(row, parsed);
      if (imageContext.firstChunk) setOpeningBookProgress(96);
      const initialReaderImage = imageContext.firstChunk
        ? await prepareOpeningReaderImage(row, parsed, imageContext.firstChunk)
        : null;
      if (runId !== bookOpenRunRef.current) return;
      setOpeningBookProgress(100);
      openParsedBook(row, parsed, undefined, file, { initialReaderImage, updateHistory: false });
    } catch (error) {
      if (runId !== bookOpenRunRef.current) return;
      setNotice(error instanceof Error ? error.message : "Could not open this book.");
      setOpeningBook(null);
      setOpeningBookProgress(0);
      setOpeningPdfSettled(false);
      setOpeningTextSettled(false);
      setBook(null);
      setActiveBookFile(null);
      setActiveBookId("");
      setView("catalog");
      if (updateHistory) writeAppHistory({ illumeView: "catalog" }, "replace");
    } finally {
      if (runId === bookOpenRunRef.current) setBusy(false);
    }
  };

  const permanentlyDeleteBook = async (row: BookRow) => {
    const { error } = await supabase.functions.invoke("delete-reader-book", {
      method: "POST",
      body: { bookId: row.id }
    });

    if (error) {
      console.warn("delete-reader-book Edge Function failed, falling back to direct delete:", error);

      const { error: storageError } = await supabase.storage.from(EPUB_BUCKET).remove([row.storage_path]);
      if (storageError) {
        throw storageError;
      }

      const { error: deleteError } = await supabase
        .from("books")
        .delete()
        .eq("id", row.id)
        .eq("user_id", row.user_id);

      if (deleteError) {
        throw deleteError;
      }
    }

    void deleteCachedBookFile(row.id);
    void deleteCachedReaderImagesForBook(row.id);
    parsedBooks.current.delete(row.id);
    parsedBookFiles.current.delete(row.id);
    clearPendingBookDelete(row.id);
    void loadReaderImageUsage();
  };

  const restorePendingDelete = () => {
    const pending = pendingDeleteRef.current;
    if (!pending) return;

    window.clearTimeout(pending.timer);
    if (pendingDeleteExitTimer.current) {
      window.clearTimeout(pendingDeleteExitTimer.current);
      pendingDeleteExitTimer.current = null;
    }
    pendingDeleteRef.current = null;
    clearPendingBookDelete(pending.row.id);
    setPendingDeleteExiting(true);
    pendingDeleteExitTimer.current = window.setTimeout(() => {
      setPendingDelete(null);
      setPendingDeleteExiting(false);
      pendingDeleteExitTimer.current = null;
    }, TOAST_ANIMATION_MS);
    setCatalogBooks((items) => {
      if (items.some((item) => item.id === pending.row.id)) return items;
      return sortBooksByRecentActivity([...items, pending.row]);
    });
    if (pending.book) parsedBooks.current.set(pending.row.id, pending.book);
    if (pending.file) parsedBookFiles.current.set(pending.row.id, pending.file);
    if (pending.wasActive) {
      setActiveBookId(pending.row.id);
      setBook(pending.book);
      setActiveBookFile(pending.file);
    }
  };

  const deleteBook = (row: BookRow) => {
    stopAudio();
    setNotice("");

    if (pendingDeleteRef.current) {
      window.clearTimeout(pendingDeleteRef.current.timer);
      if (pendingDeleteExitTimer.current) {
        window.clearTimeout(pendingDeleteExitTimer.current);
        pendingDeleteExitTimer.current = null;
      }
      const previousRow = pendingDeleteRef.current.row;
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      setPendingDeleteExiting(false);
      clearPendingBookDelete(previousRow.id);
      void permanentlyDeleteBook(previousRow).catch((error) => {
        setNotice(error instanceof Error ? error.message : "Could not delete this book.");
      });
    }

    const pending: PendingDelete = {
      book: parsedBooks.current.get(row.id) ?? (activeBookId === row.id ? book : null),
      deadline: Date.now() + DELETE_UNDO_TIMEOUT_MS,
      file: parsedBookFiles.current.get(row.id) ?? (activeBookId === row.id ? activeBookFile : null),
      index: Math.max(0, catalogBooks.findIndex((item) => item.id === row.id)),
      row,
      timer: 0,
      wasActive: activeBookId === row.id
    };

    setCatalogBooks((items) => items.filter((item) => item.id !== row.id));
    writePendingBookDelete({
      deadline: pending.deadline,
      index: pending.index,
      row: pending.row
    });

    if (activeBookId === row.id) {
      setBook(null);
      setOpeningBook(null);
      setOpeningBookProgress(0);
      setOpeningPdfSettled(false);
      setOpeningTextSettled(false);
      setActiveBookFile(null);
      setActiveBookId("");
      setView("catalog");
    }

    pending.timer = window.setTimeout(() => {
      if (pendingDeleteRef.current?.row.id !== row.id) return;
      setPendingDeleteExiting(true);
      pendingDeleteExitTimer.current = window.setTimeout(() => {
        pendingDeleteRef.current = null;
        setPendingDelete(null);
        setPendingDeleteExiting(false);
        pendingDeleteExitTimer.current = null;
        void permanentlyDeleteBook(row).catch((error) => {
          setNotice(error instanceof Error ? error.message : "Could not delete this book.");
          clearPendingBookDelete(row.id);
          setCatalogBooks((items) => {
            if (items.some((item) => item.id === pending.row.id)) return items;
            return sortBooksByRecentActivity([...items, pending.row]);
          });
        });
      }, TOAST_ANIMATION_MS);
    }, DELETE_UNDO_TIMEOUT_MS);

    pendingDeleteRef.current = pending;
    setPendingDeleteExiting(false);
    setPendingDelete(pending);
  };

  const togglePlayback = () => {
    setNotice("");

    if (playback === "playing") {
      edgeTtsPlayerRef.current?.pause();
      setPlayback("paused");
      return;
    }

    if (playback === "paused") {
      edgeTtsPlayerRef.current?.resume();
      setPlayback("playing");
      return;
    }

    stopAudio();
    setPlayback("playing");

    if (isPdfPageOnlyMode) {
      if (!book) {
        setPlayback("idle");
        return;
      }

      const pageParagraphIndex = book.paragraphs.findIndex((paragraph) => paragraph.pageNumber === currentPage);
      if (pageParagraphIndex < 0) {
        setPlayback("idle");
        return;
      }

      const pageParagraph = book.paragraphs[pageParagraphIndex];
      if (!pageParagraph) {
        setPlayback("idle");
        return;
      }

      if (pageParagraphIndex !== currentIndex) {
        setCurrentIndex(pageParagraphIndex);
        return;
      }

      speakEdge(pageParagraph);
      return;
    }

    if (!current) {
      setPlayback("idle");
      return;
    }

    if (current.kind === "image") {
      if (book && currentIndex < book.paragraphs.length - 1) {
        advance();
      } else {
        setPlayback("idle");
      }
      return;
    }

    speakEdge(current);
  };

  useEffect(() => {
    if (view !== "reader" || !book) return;

    const handleSpacePlayback = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== " " && event.code !== "Space") return;
      if (isEditableKeyboardTarget(event.target)) return;

      event.preventDefault();
      togglePlayback();
    };

    window.addEventListener("keydown", handleSpacePlayback);
    return () => window.removeEventListener("keydown", handleSpacePlayback);
  }, [book, togglePlayback, view]);

  const moveTo = (index: number, options: { scroll?: boolean; stop?: boolean; instant?: boolean } = {}) => {
    if (!book) return;
    const { scroll = true, stop = true, instant = false } = options;
    const target = Math.max(0, Math.min(index, book.paragraphs.length - 1));

    setProgressNotice(false);

    if (stop) {
      stopAudio();
      setPlayback("idle");
    }

    if (scroll) {
      pendingScrollIndex.current = target;
      if (instant) {
        isInstantScrollRef.current = true;
      }
    }
    const targetPage = book.paragraphs[target]?.pageNumber;
    if (targetPage) setCurrentPage(targetPage);
    setCurrentIndex(target);
  };

  textReaderActionsRef.current.moveTo = moveTo;
  textReaderActionsRef.current.paragraphClick = handleParagraphClick;

  const rememberReturnPoint = () => {
    if (!book) return;
    setReturnPoint({
      index: currentIndex,
      offsetRatio: pdfVisibleOffsetRatio,
      page: currentPage
    });
  };

  const goBackToReturnPoint = () => {
    if (!book || !returnPoint) return;
    const point = returnPoint;
    setReturnPoint(null);

    if (book.format === "pdf" && pdfReaderViewMode === "pdf") {
      moveToPdfPage(point.page, { offsetRatio: point.offsetRatio });
      return;
    }

    moveTo(point.index, { instant: true });
  };

  const handlePdfDocumentReady = useCallback(() => {
    setOpeningPdfSettled(true);
    if (!progressNotice) return;
    setProgressNoticeToken((token) => token + 1);
  }, [progressNotice]);

  const moveToAndNarrate = (index: number) => {
    if (!book) return;
    const target = Math.max(0, Math.min(index, book.paragraphs.length - 1));

    setProgressNotice(false);
    stopAudio();
    setPlayback("playing");
    pendingScrollIndex.current = target;

    const targetPage = book.paragraphs[target]?.pageNumber;
    if (targetPage) setCurrentPage(targetPage);

    if (target === currentIndex) {
      const targetParagraph = book.paragraphs[target];
      if (targetParagraph) speakEdge(targetParagraph);
      return;
    }

    setCurrentIndex(target);
  };

  const moveToChapter = (chapterIndex: number) => {
    if (!book) return;
    if (!window.matchMedia(CHAPTER_SIDEBAR_DESKTOP_QUERY).matches) {
      setChapterDrawerOpen(false);
    }

    if (book.format === "pdf") {
      const pageNumber = book.chapterPageNumbers?.[chapterIndex];
      const offsetRatio = book.chapterPageOffsets?.[chapterIndex] ?? 0;
      if (pageNumber) {
        if (pageNumber !== currentPage || Math.abs(offsetRatio - pdfVisibleOffsetRatio) > 0.015) {
          rememberReturnPoint();
        }
        moveToPdfPage(pageNumber, { offsetRatio });
      }
      return;
    }

    const firstParagraph = book.paragraphs.findIndex(
      (paragraph) => paragraph.chapterIndex === chapterIndex
    );
    if (firstParagraph >= 0) {
      if (firstParagraph !== currentIndex) rememberReturnPoint();
      moveTo(firstParagraph, { instant: true });
    }
  };

  const moveToPdfPage = (page: number, options: { offsetRatio?: number; scroll?: boolean } = {}) => {
    if (!book?.pageCount) return;
    const { offsetRatio = 0, scroll = true } = options;
    const safePage = Math.max(1, Math.min(page, book.pageCount));

    if (scroll) setProgressNotice(false);

    setCurrentPage(safePage);
    setPdfVisibleOffsetRatio(Math.max(0, Math.min(1, offsetRatio)));
    if (scroll) {
      setPdfScrollOffsetRatio(Math.max(0, Math.min(1, offsetRatio)));
      setPdfScrollPage(safePage);
      setPdfScrollRequest((request) => request + 1);
    }
    const firstParagraph = book.paragraphs.findIndex((paragraph) => paragraph.pageNumber === safePage);
    if (firstParagraph >= 0) {
      if (pdfReaderViewMode !== "pdf") pendingScrollIndex.current = firstParagraph;
      setCurrentIndex(firstParagraph);
    }
  };

  const moveToPdfPageAndNarrate = (page: number) => {
    if (!book?.pageCount) return;
    const safePage = Math.max(1, Math.min(page, book.pageCount));
    const firstParagraph = book.paragraphs.findIndex((paragraph) => paragraph.pageNumber === safePage);

    moveToPdfPage(safePage);
    if (firstParagraph < 0) return;

    stopAudio();
    setPlayback("playing");

    if (firstParagraph === currentIndex) {
      const targetParagraph = book.paragraphs[firstParagraph];
      if (targetParagraph) speakEdge(targetParagraph);
    }
  };

  const openCatalog = (options: { updateHistory?: boolean } = {}) => {
    const { updateHistory = true } = options;
    bookOpenRunRef.current += 1;
    stopAudio();
    setPlayback("idle");
    setBusy(false);
    setProgressNotice(false);
    if (activeBookId && book) void saveReadingProgress(activeBookId, currentIndex, currentPage);
    setOpeningBook(null);
    setOpeningBookProgress(0);
    setOpeningPdfSettled(false);
    setOpeningTextSettled(false);
    setOpeningPdfPreview(null);
    setView("catalog");
    if (updateHistory) writeAppHistory({ illumeView: "catalog" });
  };

  useEffect(() => {
    if (isReaderDashboard) return;

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as AppHistoryState | null;

      if (state?.illumeView === "reader" && state.bookId) {
        const row = catalogBooks.find((catalogBook) => catalogBook.id === state.bookId);
        if (row) {
          void openBook(row, { updateHistory: false });
          return;
        }
      }

      openCatalog({ updateHistory: false });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [catalogBooks, isReaderDashboard, openBook, openCatalog]);

  const handleReadingScroll = () => {
    if (!book) return;
    const surface = readingSurfaceRef.current;
    if (playback === "playing") return;
    if (!surface) return;
    if (readingScrollFrame.current !== null) return;

    readingScrollFrame.current = window.requestAnimationFrame(() => {
      readingScrollFrame.current = null;

      const nextBook = book;
      const surfaceRect = surface.getBoundingClientRect();
      const anchorTop = surfaceRect.top + 72;
      const viewportBottom = surfaceRect.bottom + 320;
      let closestIndex = currentIndex;
      let closestDistance = Number.POSITIVE_INFINITY;
      let foundVisibleParagraph = false;
      const scanStart = Math.max(0, currentIndex - 80);
      const scanEnd = Math.min(nextBook.paragraphs.length - 1, currentIndex + 160);
      let anchorVisibleWordOffset = currentReaderWordOffset;
      let anchorWordDistance = Number.POSITIVE_INFINITY;

      const scoreParagraph = (index: number) => {
        const paragraph = nextBook.paragraphs[index];
        const node = paragraphRefs.current.get(paragraph.id);
        if (!node) return false;

        const rect = node.getBoundingClientRect();
        if (rect.bottom < surfaceRect.top - 320) return false;
        if (rect.top > viewportBottom) return false;

        foundVisibleParagraph = true;
        const distance = Math.abs(rect.top - anchorTop);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }

        if (paragraph.kind !== "image") {
          const wordCount = paragraphWordMetrics.counts[index] ?? 0;
          const wordOffset = paragraphWordMetrics.offsets[index] ?? 0;
          const anchorDistance =
            anchorTop < rect.top
              ? rect.top - anchorTop
              : anchorTop > rect.bottom
              ? anchorTop - rect.bottom
              : 0;

          if (wordCount > 0 && anchorDistance < anchorWordDistance) {
            const positionRatio =
              anchorTop < rect.top
                ? 0
                : anchorTop > rect.bottom
                ? 1
                : clampUnit((anchorTop - rect.top) / Math.max(1, rect.height));
            anchorWordDistance = anchorDistance;
            anchorVisibleWordOffset = wordOffset + Math.floor(wordCount * positionRatio);
          }
        }

        return true;
      };

      for (let index = scanStart; index <= scanEnd; index++) {
        if (!scoreParagraph(index)) continue;
      }

      if (!foundVisibleParagraph) {
        for (let index = 0; index < nextBook.paragraphs.length; index++) {
          scoreParagraph(index);
        }
      }

      if (closestIndex !== currentIndex) setCurrentIndex(closestIndex);
      if (readerImageMode && !isPdfBook && readerImageChunks.length) {
        const nextVisibleChunkIndex = readerImageChunkIndexForWordOffset(readerImageChunks, anchorVisibleWordOffset);
        setVisibleReaderImageChunkIndex((current) =>
          current === nextVisibleChunkIndex ? current : nextVisibleChunkIndex
        );
      }
    });
  };

  textReaderActionsRef.current.scroll = handleReadingScroll;

  const setParagraphRef = (id: string) => (node: HTMLElement | null) => {
    if (node) {
      paragraphRefs.current.set(id, node);

      const targetIndex = pendingScrollIndex.current;
      if (targetIndex !== null && book) {
        const target = book.paragraphs[targetIndex];
        if (target && target.id === id) {
          pendingScrollIndex.current = null;
          node.scrollIntoView({ block: "start", behavior: "auto" });
          isInitialOpenRef.current = false;
          isInstantScrollRef.current = false;
        }
      }
    } else {
      paragraphRefs.current.delete(id);
    }
  };

  const renderGeneratedReaderImage = useCallback((chunk: ReaderImageChunk) => {
    const image = readerImages[chunk.index];
    const checkingImageSrc =
      image?.status === "checking" ? image.fallbackSrc || fallbackReaderImageSrc(chunk.index) : "";
    const generatingImageSrc =
      image?.status === "loading" ? image.fallbackSrc || fallbackReaderImageSrc(chunk.index) : "";
    const isFreshGeneration = image?.status === "loading" && image.isFreshGeneration;
    const isLimit = Boolean(image?.limitReached);
    const label = chunk.pageNumber ? `Page ${chunk.pageNumber}` : `Words ${chunk.startWord}-${chunk.endWord}`;

    return (
      <figure
        className={`reader-generated-image ${chunk.index % 2 === 0 ? "left" : "right"}`}
        key={`generated-${chunk.index}`}
      >
        {image?.status === "ready" && image.src ? (
          <img
            alt={chunk.pageNumber ? `Generated visual for page ${chunk.pageNumber}` : `Generated visual for words ${chunk.startWord} to ${chunk.endWord}`}
            key={`ready-${chunk.index}-${image.src}`}
            src={image.src}
          />
        ) : image?.status === "checking" ? (
          <div className="reader-generated-placeholder checking">
            {checkingImageSrc && <img alt="" aria-hidden="true" src={checkingImageSrc} />}
          </div>
        ) : (
          <div
            className={[
              "reader-generated-placeholder",
              image?.status === "error" ? "error" : "",
              image?.status !== "error" ? "generating" : "",
              isFreshGeneration ? "fresh-generation" : "",
              generatingImageSrc ? "from-blur" : "",
              isLimit ? "limit" : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {generatingImageSrc && <img className="reader-image-generating-backdrop" alt="" aria-hidden="true" src={generatingImageSrc} />}
            {image?.status !== "error" && (
              <div className="reader-image-generating-lights" aria-hidden="true">
                <span className="reader-image-generating-light aurora" />
                <span className="reader-image-generating-light bloom" />
                <span className="reader-image-generating-light ember" />
              </div>
            )}
            {isLimit && image.plan === "free" && (
              <button className="text-upgrade-button" onClick={() => setReaderImageUpgradeOpen(true)} type="button">
                Upgrade to Pro
              </button>
            )}
          </div>
        )}
        <figcaption>
          {label}
        </figcaption>
      </figure>
    );
  }, [fallbackReaderImageSrc, readerImages]);

  const renderPdfPageReaderImage = useCallback((pageNumber: number) => {
    if (!readerImageMode || !isPdfBook) return null;

    const chunk = readerImageChunkByPageNumber.get(pageNumber);
    if (!chunk) return null;
    if (
      !isReaderImageDisplayable(chunk.index) &&
      (
        chunk.index !== activeReaderImageChunkIndex ||
        (readerImages[chunk.index]?.status !== "loading" && readerImages[chunk.index]?.status !== "checking")
      )
    ) return null;

    return renderGeneratedReaderImage(chunk);
  }, [
    activeReaderImageChunkIndex,
    isPdfBook,
    isReaderImageDisplayable,
    readerImageChunkByPageNumber,
    readerImages,
    readerImageMode,
    renderGeneratedReaderImage
  ]);

  const renderReaderImageStage = () => {
    const activeImage = activeReaderImageChunkIndex >= 0 ? readerImages[activeReaderImageChunkIndex] : undefined;
    const generatingImage =
      generatingReaderImageChunkIndex !== null ? readerImages[generatingReaderImageChunkIndex] : undefined;
    const shouldShowActiveChunk =
      activeImage?.status === "ready" ||
      activeImage?.status === "error" ||
      activeImage?.status === "loading" ||
      activeImage?.status === "checking";
    const chunk =
      shouldShowActiveChunk
        ? activeReaderImageChunk
        : generatingImage?.status === "loading"
        ? generatingReaderImageChunk
        : displayedReaderImageChunk;
    const image = chunk ? readerImages[chunk.index] : undefined;
    if (!chunk) return null;

    const isLimit = Boolean(image?.limitReached);
    const isError = image?.status === "error";
    const isReady = image?.status === "ready" && image.src;
    const checkingImageSrc =
      image?.status === "checking" ? image.fallbackSrc || fallbackReaderImageSrc(chunk.index) : "";
    const generatingImageSrc =
      image?.status === "loading" ? image.fallbackSrc || fallbackReaderImageSrc(chunk.index) : "";
    const isFreshGeneration = image?.status === "loading" && image.isFreshGeneration;

    return (
      <aside className="reader-image-stage" aria-label="Current generated image">
        <div className="reader-image-hero">
          {isReady ? (
            <img
              alt={`Generated visual for words ${chunk?.startWord} to ${chunk?.endWord}`}
              key={`stage-ready-${chunk.index}-${image.src}`}
              src={image.src}
            />
          ) : image?.status === "checking" ? (
            <div className="reader-image-hero-checking">
              {checkingImageSrc && <img alt="" aria-hidden="true" src={checkingImageSrc} />}
            </div>
          ) : (
            <div
              className={[
                "reader-image-hero-placeholder",
                isError ? "error" : "generating",
                isFreshGeneration ? "fresh-generation" : "",
                generatingImageSrc ? "from-blur" : "",
                isLimit ? "limit" : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {generatingImageSrc && <img className="reader-image-generating-backdrop" alt="" aria-hidden="true" src={generatingImageSrc} />}
              {!isError && (
                <div className="reader-image-generating-lights" aria-hidden="true">
                  <span className="reader-image-generating-light aurora" />
                  <span className="reader-image-generating-light bloom" />
                  <span className="reader-image-generating-light ember" />
                </div>
              )}
              {isLimit && image?.plan === "free" && (
                <button className="reader-image-upgrade-inline" onClick={() => setReaderImageUpgradeOpen(true)} type="button">
                  Upgrade to Pro
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    );
  };

  const renderTextReadingSurface = (className = "reading-surface") => {
    if (!book) return null;

    return (
      <TextReadingSurface
        book={book}
        className={className}
        currentIndex={currentIndex}
        readerActionsRef={textReaderActionsRef}
        readerFontMode={readerFontMode}
        readerImageInsertions={readerImageInsertions}
        readerImageMode={readerImageMode}
        readerLineHeight={readerLineHeight}
        readerLineWidth={readerLineWidth}
        readerTextScale={readerTextScale}
        readingSurfaceRef={readingSurfaceRef}
        renderGeneratedReaderImage={renderGeneratedReaderImage}
        setParagraphRef={setParagraphRef}
        speechHighlight={speechHighlight}
      />
    );
  };

  const scrubToPointer = (event: PointerEvent<HTMLDivElement>, options: { remember?: boolean } = {}) => {
    if (!book) return;
    const { remember = false } = options;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    if (isPdfPageOnlyMode && book.pageCount) {
      const targetPage = Math.max(1, Math.round(ratio * (book.pageCount - 1)) + 1);
      if (remember && targetPage !== currentPage) rememberReturnPoint();
      moveToPdfPage(targetPage);
      return;
    }
    const targetIndex = Math.round(ratio * (book.paragraphs.length - 1));
    if (remember && targetIndex !== currentIndex) rememberReturnPoint();
    moveTo(targetIndex, { instant: true });
  };

  const handleProgressKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!book) return;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      if (isPdfPageOnlyMode) {
        moveToPdfPage(currentPage - 1);
        return;
      }
      moveTo(currentIndex - 1);
    }

    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      if (isPdfPageOnlyMode) {
        moveToPdfPage(currentPage + 1);
        return;
      }
      moveTo(currentIndex + 1);
    }

    if (event.key === "Home") {
      event.preventDefault();
      if (isPdfPageOnlyMode) {
        moveToPdfPage(1);
        return;
      }
      moveTo(0);
    }

    if (event.key === "End") {
      event.preventDefault();
      if (isPdfPageOnlyMode && book.pageCount) {
        moveToPdfPage(book.pageCount);
        return;
      }
      moveTo(book.paragraphs.length - 1);
    }
  };

  const renderReaderModeToggle = () => (
    <div className="typography-mode-toggle" aria-label="Reader appearance">
      <button
        aria-label="Use light mode"
        aria-pressed={readerThemeMode === "light"}
        className={readerThemeMode === "light" ? "active" : undefined}
        onClick={() => setReaderThemeMode("light")}
        title="Light mode"
        type="button"
      >
        <Sun size={14} aria-hidden="true" />
      </button>
      <button
        aria-label="Use dark mode"
        aria-pressed={readerThemeMode === "dark"}
        className={readerThemeMode === "dark" ? "active" : undefined}
        onClick={() => setReaderThemeMode("dark")}
        title="Dark mode"
        type="button"
      >
        <Moon size={14} aria-hidden="true" />
      </button>
    </div>
  );

  const renderOpeningSettingsPopover = (isPdfMode: boolean) => (
    <>
      <div
        className="settings-popover-overlay"
        onClick={() => {
          setSettingsOpen(false);
          setReaderMenuOpen(null);
        }}
      />
      <div className="settings-popover-card reader-typography-popover">
        <div className="settings-popover-body">
          <div className="settings-section typography-settings-section" aria-label={isPdfMode ? "PDF page settings" : "Typography settings"}>
            {isPdfMode ? (
              <>
                <div className="typography-font-group pdf-page-layout-group" aria-label="PDF pages visible">
                  <button
                    aria-pressed={pdfPageLayout === "single"}
                    className={pdfPageLayout === "single" ? "active" : undefined}
                    onClick={() => setPdfPageLayout("single")}
                    title="Show one page"
                    type="button"
                  >
                    1 Page
                  </button>
                  <button
                    aria-pressed={pdfPageLayout === "double"}
                    className={pdfPageLayout === "double" ? "active" : undefined}
                    onClick={() => setPdfPageLayout("double")}
                    title="Show two pages"
                    type="button"
                  >
                    2 Pages
                  </button>
                </div>

                <div className="typography-button-group" aria-label="PDF page size">
                  <button
                    aria-label="Decrease page size"
                    disabled={pdfPageScale <= PDF_PAGE_SCALE_MIN}
                    onClick={() => adjustPdfPageScale(-0.1)}
                    title="Decrease page size"
                    type="button"
                  >
                    <Minus size={14} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="Increase page size"
                    disabled={pdfPageScale >= PDF_PAGE_SCALE_MAX}
                    onClick={() => adjustPdfPageScale(0.1)}
                    title="Increase page size"
                    type="button"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>

                {renderReaderModeToggle()}
              </>
            ) : (
              <>
                <div className="typography-button-group" aria-label="Text size">
                  <button
                    aria-label="Decrease text size"
                    disabled={readerTextScale <= READER_TEXT_SCALE_MIN}
                    onClick={() => adjustReaderTextScale(-1)}
                    title="Decrease text size"
                    type="button"
                  >
                    <Minus size={14} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="Increase text size"
                    disabled={readerTextScale >= READER_TEXT_SCALE_MAX}
                    onClick={() => adjustReaderTextScale(1)}
                    title="Increase text size"
                    type="button"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>

                <div className="typography-button-group" aria-label="Line width">
                  <button
                    aria-label="Narrow line width"
                    disabled={readerLineWidth <= READER_LINE_WIDTH_MIN}
                    onClick={() => adjustReaderLineWidth(-1)}
                    title="Narrow line width"
                    type="button"
                  >
                    <MoveHorizontal className="narrow-width-icon" size={17} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="Widen line width"
                    disabled={readerLineWidth >= READER_LINE_WIDTH_MAX}
                    onClick={() => adjustReaderLineWidth(1)}
                    title="Widen line width"
                    type="button"
                  >
                    <MoveHorizontal size={17} aria-hidden="true" />
                  </button>
                </div>

                <div className="typography-button-group" aria-label="Line height">
                  <button
                    aria-label="Decrease line height"
                    disabled={readerLineHeight <= READER_LINE_HEIGHT_MIN}
                    onClick={() => adjustReaderLineHeight(-0.1)}
                    title="Decrease line height"
                    type="button"
                  >
                    <AlignJustify className="compact-lines-icon" size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="Increase line height"
                    disabled={readerLineHeight >= READER_LINE_HEIGHT_MAX}
                    onClick={() => adjustReaderLineHeight(0.1)}
                    title="Increase line height"
                    type="button"
                  >
                    <AlignJustify size={16} aria-hidden="true" />
                  </button>
                </div>

                <div className="typography-font-group" aria-label="Reader font">
                  <button
                    aria-pressed={readerFontMode === "sans"}
                    className={readerFontMode === "sans" ? "active" : undefined}
                    onClick={() => setReaderFontMode("sans")}
                    title="Sans-serif font"
                    type="button"
                  >
                    Sans
                  </button>
                  <button
                    aria-pressed={readerFontMode === "serif"}
                    className={readerFontMode === "serif" ? "active" : undefined}
                    onClick={() => setReaderFontMode("serif")}
                    title="Serif font"
                    type="button"
                  >
                    Serif
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );

  const renderReaderBookTitle = (row: BookRow | null, title: string) => {
    const isEditing = Boolean(row && readerRenameTarget?.id === row.id);

    if (!row) {
      return <div className="top-title">{title}</div>;
    }

    if (isEditing) {
      return (
        <form className="top-title reader-title-editor" onSubmit={renameReaderBook}>
          <input
            aria-label="Document title"
            disabled={isReaderRenamingBook}
            onChange={(event) => {
              setReaderRenameTitle(event.target.value);
              setReaderRenameError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelReaderRename();
              }
            }}
            onBlur={() => {
              void commitReaderRename();
            }}
            ref={readerRenameInputRef}
            value={readerRenameTitle}
          />
          <button
            className="reader-title-icon reader-title-cancel"
            disabled={isReaderRenamingBook}
            onClick={cancelReaderRename}
            onPointerDown={(event) => event.preventDefault()}
            title="Cancel rename"
            type="button"
          >
            <X size={14} aria-hidden="true" />
          </button>
          {readerRenameError && <span className="reader-title-error" role="status">{readerRenameError}</span>}
        </form>
      );
    }

    return (
      <div className="top-title reader-title-rename-trigger">
        <span>{title}</span>
        <button
          className="reader-title-icon"
          onClick={() => openReaderRename(row, title)}
          title="Rename document"
          type="button"
        >
          <Pencil size={13} aria-hidden="true" />
        </button>
      </div>
    );
  };

  const renderOpeningHeader = (row: BookRow) => (
    <header className="topbar">
      <div className="reader-top-actions">
        <button className="top-icon" type="button" title="Back to library" onClick={() => openCatalog()}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <button
          aria-controls="reader-chapter-sidebar"
          aria-expanded={chapterDrawerOpen}
          className="top-icon toc-toggle-button"
          onClick={() => setChapterDrawerOpen((isOpen) => !isOpen)}
          title={bookFormat(row) === "pdf" ? "Table of contents" : "Chapters"}
          type="button"
        >
          <PanelLeft size={18} aria-hidden="true" />
        </button>
      </div>
      {renderReaderBookTitle(row, openingPdfPreview?.title || row.title)}
      <div className="settings-button-wrapper" style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button
          aria-expanded={settingsOpen}
          className="top-icon typography-trigger"
          onClick={() => {
            setSettingsOpen((isOpen) => !isOpen);
            setReaderMenuOpen(null);
          }}
          title={bookFormat(row) === "pdf" ? "PDF page settings" : "Typography"}
          type="button"
        >
          <CaseSensitive size={18} aria-hidden="true" />
        </button>
        {settingsOpen && renderOpeningSettingsPopover(bookFormat(row) === "pdf")}
      </div>
    </header>
  );

  const renderOpeningTocSkeleton = (length = 8) => (
    Array.from({ length }).map((_, index) => (
      <div className="chapter-item-container reader-loading-toc-container" key={index}>
        <span className={index === 0 ? "chapter-item active reader-loading-toc-item" : "chapter-item reader-loading-toc-item"}>
          <span className="reader-loading-line" style={{ width: `${82 - (index % 4) * 8}%` }} />
          <span className="reader-loading-line" style={{ width: `${58 + (index % 3) * 9}%` }} />
        </span>
      </div>
    ))
  );

  const renderOpeningControls = (row: BookRow) => {
    const isPdfMode = bookFormat(row) === "pdf";

    return (
      <footer className="control-rail reader-loading-controls" aria-label="Reader controls loading">
        <div className="control-rail-left" aria-hidden="true" />
        <div className="transport">
          <button
            className="rail-icon"
            disabled
            title={isPdfMode ? "Previous page" : "Previous paragraph"}
            type="button"
          >
            <RotateCcw size={21} aria-hidden="true" />
          </button>
          <button className="play-button" disabled title="Play or pause" type="button">
            <Play size={28} aria-hidden="true" />
          </button>
          <button
            className="rail-icon"
            disabled
            title={isPdfMode ? "Next page" : "Next paragraph"}
            type="button"
          >
            <RotateCw size={21} aria-hidden="true" />
          </button>
          <button className="narration-speed-trigger" disabled title="Narration speed" type="button">
            {formatNarrationRate(narrationRate)}
          </button>
        </div>
        <div className="control-rail-right" />
      </footer>
    );
  };

  const renderOpeningBookStage = (row: BookRow) => (
      <section
        className="reader-cover-loading-stage"
        role="status"
        aria-label="Opening book"
        style={{ "--cover-load-progress": openingBookProgress } as CSSProperties}
      >
        <div className="reader-loading-cover-page">
          <BookCover book={row} />
        </div>
        <div className="reader-cover-loading-copy">
          <h1>{row.title}</h1>
          <p>
            Opening your book
            <span className="reader-opening-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </p>
        </div>
      </section>
  );

  const renderOpeningBookSkeleton = (row: BookRow) => (
    <main
      aria-busy="true"
      className="app-shell reader-themed-shell reader-loading-shell reader-cover-loading-shell"
      data-reader-mode={readerThemeMode}
      data-reader-theme={readerTheme}
    >
      {renderOpeningBookStage(row)}
    </main>
  );

  if (authLoading) {
    return (
      <main className="auth-shell">
        <Loader2 className="spin" size={28} aria-hidden="true" />
      </main>
    );
  }

  if (isReaderDashboard) {
    return (
      <DashboardErrorBoundary key={dashboardPath}>
        <ReaderDashboard
          busy={busy || dashboardLoading}
          data={dashboardData}
          error={dashboardError}
          onNavigate={navigateDashboard}
          onRefresh={() => {
            void loadReaderDashboard();
            setContentRefreshSignal((value) => value + 1);
          }}
          onContentTabClick={() => {}}
          onSignInWithGoogle={() => void signInWithGoogle()}
          onSignOut={() => void signOut()}
          selectedUserId={selectedDashboardUserId}
          session={session}
          activeTab={dashboardTab}
          contentRefreshSignal={contentRefreshSignal}
          setActiveTab={setDashboardTab}
        />
      </DashboardErrorBoundary>
    );
  }

  if (!session) {
    return (
      <LandingPage
        handleAuth={handleAuth}
        signInWithGoogle={signInWithGoogle}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        authMode={authMode}
        setAuthMode={setAuthMode}
        busy={busy}
        notice={notice}
        colorScheme={readerThemeMode}
        onToggleColorScheme={() => setReaderThemeMode(readerThemeMode === "dark" ? "light" : "dark")}
      />
    );
  }

  if (view === "catalog") {
    return (
      <main className="app-shell catalog-shell" data-reader-mode={readerThemeMode} data-reader-theme={readerTheme}>
        <header className="topbar catalog-topbar" style={{ position: "relative" }}>
          <div className="catalog-storage-summary">
            <div className="library-brand-mark" aria-label={`illume ${isPro ? "Pro" : "Free"}`}>
              <img src="/landing/logo.webp" alt="" aria-hidden="true" />
              <span>illume</span>
              {isPro ? (
                <span className="library-plan-badge pro">
                  <span>Pro</span>
                </span>
              ) : (
                <button className="library-upgrade-button" onClick={() => setReaderImageUpgradeOpen(true)} type="button">
                  <Crown size={13} aria-hidden="true" />
                  <span>Upgrade</span>
                </button>
              )}
            </div>
          </div>
          <div className="top-actions">
            <label className="catalog-upload" title="Upload document">
              {isBookImporting ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              <span>Upload</span>
              <input disabled={isBookImporting} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} multiple onChange={handleCatalogUpload} />
            </label>

            <div className="profile-button-wrapper" style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <button
                className="profile-avatar-btn"
                onClick={(event) => {
                  if (event.detail === 0) setProfileOpen((isOpen) => !isOpen);
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  setProfileOpen((isOpen) => !isOpen);
                }}
                title="Account Settings"
                type="button"
              >
                {user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
                  <img
                    src={user.user_metadata.avatar_url || user.user_metadata.picture}
                    alt="Profile"
                    className="profile-avatar-img"
                  />
                ) : (
                  <span className="profile-avatar-initials">
                    {user?.email?.[0].toUpperCase() ?? "U"}
                  </span>
                )}
              </button>

              {profileOpen && (
                <>
                  <div className="profile-popover-overlay" onClick={() => setProfileOpen(false)} />
                  <div className="profile-popover-card">
                    <div className="profile-popover-header">
                      <div className="profile-user-details">
                        <div className="profile-name-row">
                          <span className="profile-name">
                            {user?.user_metadata?.full_name || user?.user_metadata?.name || "Reader User"}
                          </span>
                          {isPro && (
                            <span className="profile-plan-badge pro">PRO</span>
                          )}
                        </div>
                        <span className="profile-email">{user?.email}</span>
                      </div>
                    </div>

                    <div className="profile-popover-body">
                      <div className="profile-section">
                        <div className="profile-usage-item">
                          <div className="profile-usage-header">
                            <span>Storage</span>
                            <span>{formatBytes(storageUsed)} / {formatBytes(storageQuotaBytes)}</span>
                          </div>
                          <div className="profile-progress-bar">
                            <div
                              className="profile-progress-fill"
                              style={{ width: `${Math.min(100, (storageUsed / storageQuotaBytes) * 100)}%` }}
                            />
                          </div>
                        </div>

                        <div className="profile-usage-item">
                          <div className="profile-usage-header">
                            <span>AI Images</span>
                            <span>{readerImageUsageLabel}{isPro ? " / mo" : " total"}</span>
                          </div>
                          <div className="profile-progress-bar">
                            <div
                              className="profile-progress-fill"
                              style={{ width: `${Math.min(100, (readerImageCount / readerImageLimit) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="profile-section">
                        <span className="profile-section-label">Appearance</span>
                        <div className="profile-appearance-row">
                          <button
                            className={`profile-appearance-btn ${readerThemeMode === "light" ? "active" : ""}`}
                            onClick={() => setReaderThemeMode("light")}
                            type="button"
                          >
                            <Sun size={13} aria-hidden="true" />
                            <span>Light</span>
                          </button>
                          <button
                            className={`profile-appearance-btn ${readerThemeMode === "dark" ? "active" : ""}`}
                            onClick={() => setReaderThemeMode("dark")}
                            type="button"
                          >
                            <Moon size={13} aria-hidden="true" />
                            <span>Dark</span>
                          </button>
                        </div>
                      </div>

                      <div className="profile-section billing-actions-section">
                        {!isPro && (
                          <button className="primary-button upgrade-btn" disabled={busy} onClick={() => { setProfileOpen(false); setReaderImageUpgradeOpen(true); }} type="button">
                            <Crown size={12} aria-hidden="true" />
                            <span>Upgrade to Pro</span>
                          </button>
                        )}
                        <div className="profile-actions-row">
                          {billingProfile?.stripe_customer_id && (
                            <button className="secondary-button manage-btn" disabled={busy} onClick={() => { setProfileOpen(false); void openBillingPortal(); }} type="button">
                              <CreditCard size={12} aria-hidden="true" />
                              <span>Billing</span>
                            </button>
                          )}
                          <button className="secondary-button signout-btn" onClick={() => { setProfileOpen(false); void signOut(); }} type="button">
                            <LogOut size={12} aria-hidden="true" />
                            <span>Sign out</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {pendingDelete && (
          <div className={pendingDeleteExiting ? "undo-delete-toast leaving" : "undo-delete-toast"} role="status" aria-live="polite">
            <span>
              <span className="toast-book-title">{toastTitle(pendingDelete.row.title)}</span>
              <span className="toast-action">deleted</span>
            </span>
            <button type="button" onClick={restorePendingDelete}>
              Undo
            </button>
          </div>
        )}

        {uploadedBookNotice && (
          <div
            className={[
              "undo-delete-toast",
              "upload-complete-toast",
              uploadedBookNoticeExiting ? "leaving" : ""
            ].filter(Boolean).join(" ")}
            role="status"
            aria-live="polite"
          >
            <span>
              <span className="toast-book-title">{toastTitle(uploadedBookNotice)}</span>
              <span className="toast-action">ready</span>
            </span>
          </div>
        )}

        <section
          className={[
            "catalog-view",
            catalogReady ? "catalog-ready" : "catalog-loading",
            isCatalogDragActive ? "drag-active" : ""
          ].filter(Boolean).join(" ")}
          aria-busy={!catalogReady}
          aria-label="Book library"
          onDragEnter={handleCatalogDragEnter}
          onDragLeave={handleCatalogDragLeave}
          onDragOver={handleCatalogDragOver}
          onDrop={handleCatalogDrop}
        >
          <div className="catalog-books-section">
            {isCatalogDragActive && (
              <div className="catalog-drop-overlay" aria-hidden="true">
                <div className="catalog-drop-target">
                  <Upload size={22} />
                  <span>Drop EPUB or PDF books to upload</span>
                </div>
              </div>
            )}
            <div className="catalog-header">
              <h1>Books</h1>
              <label className="catalog-heading-upload" title="Upload document">
                {isBookImporting ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
                <span>Upload</span>
                <input disabled={isBookImporting} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} multiple onChange={handleCatalogUpload} />
              </label>
            </div>
            {notice && <div className="notice catalog-notice">{notice}</div>}
            {!catalogReady ? (
              <div className="catalog-list catalog-skeleton-list" role="status" aria-label="Loading library">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div className="catalog-book catalog-book-skeleton" key={`library-skeleton-${index}`}>
                    <div className="catalog-book-open">
                      <span className="catalog-cover-art catalog-cover-skeleton" aria-hidden="true" />
                      <span className="catalog-book-copy">
                        <span className="catalog-skeleton-line title" aria-hidden="true" />
                        <span className="catalog-skeleton-line meta" aria-hidden="true" />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="catalog-list">
              {catalogBooks.length || pendingBookImports.length ? (
                <>
                {pendingBookImports.map((pendingImport) => (
                  <div
                    className="catalog-book catalog-book-pending"
                    key={pendingImport.id}
                    aria-busy="true"
                    style={{ "--cover-load-progress": pendingImport.progress } as CSSProperties}
                  >
                    <div className="catalog-book-open" role="status" aria-label={`${pendingImport.title} is being added`}>
                      <span className="catalog-pending-cover">
                        <BookCover
                          book={{
                            cover_url: pendingImport.coverUrl,
                            document_type: "epub",
                            file_name: pendingImport.fileName,
                            id: pendingImport.id,
                            mime_type: "application/epub+zip",
                            title: pendingImport.title
                          }}
                        />
                      </span>
                      <span className="catalog-book-copy">
                        <strong>{pendingImport.title}</strong>
                        <small>
                          {pendingImport.statusText ?? "Generating visuals"}
                          <span className="pending-status-dots" aria-hidden="true" />
                        </small>
                      </span>
                    </div>
                  </div>
                ))}
                {catalogBooks.map((catalogBook) => {
                  const isCatalogRenameActive = renameTarget?.id === catalogBook.id;

                  return (
                    <div
                      className={catalogBook.id === activeBookId ? "catalog-book active" : "catalog-book"}
                      key={catalogBook.id}
                    >
                      <div className="catalog-book-open">
                        <button
                          className="catalog-book-main"
                          onClick={() => void openBook(catalogBook)}
                          type="button"
                        >
                          <BookCover book={catalogBook} />
                        </button>
                        {isCatalogRenameActive ? (
                          <form className="catalog-inline-rename" onSubmit={renameBook}>
                            <textarea
                              aria-label={`Rename ${catalogBook.title}`}
                              disabled={isRenamingBook}
                              onChange={(event) => {
                                setRenameTitle(event.target.value);
                                setRenameError("");
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Escape") closeRenameDialog();
                              }}
                              ref={catalogRenameInputRef}
                              rows={2}
                              value={renameTitle}
                            />
                            <span className="catalog-inline-rename-actions">
                              <button disabled={isRenamingBook} title="Save title" type="submit">
                                {isRenamingBook ? <Loader2 className="spin" size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}
                              </button>
                              <button disabled={isRenamingBook} onClick={closeRenameDialog} title="Cancel rename" type="button">
                                <X size={13} aria-hidden="true" />
                              </button>
                            </span>
                            {renameError && <span className="catalog-inline-rename-error" role="status">{renameError}</span>}
                          </form>
                        ) : (
                          <span className="catalog-book-copy">
                            <span className="catalog-book-title-row">
                              <button className="catalog-title-button" onClick={() => void openBook(catalogBook)} type="button">
                                <strong>{catalogBook.title}</strong>
                              </button>
                              <div
                                className="catalog-actions"
                                ref={catalogActionBookId === catalogBook.id ? catalogActionMenuRef : null}
                              >
                                <button
                                  aria-expanded={catalogActionBookId === catalogBook.id}
                                  aria-haspopup="menu"
                                  className="catalog-actions-trigger"
                                  disabled={busy}
                                  onClick={(event) => {
                                    if (event.detail === 0) {
                                      setCatalogActionBookId((openId) => (openId === catalogBook.id ? "" : catalogBook.id));
                                    }
                                  }}
                                  onPointerDown={(event) => {
                                    if (busy) return;
                                    event.preventDefault();
                                    setCatalogActionBookId((openId) => (openId === catalogBook.id ? "" : catalogBook.id));
                                  }}
                                  title="Book actions"
                                  type="button"
                                >
                                  <MoreHorizontal size={16} aria-hidden="true" />
                                </button>
                                {catalogActionBookId === catalogBook.id && (
                                  <div className="catalog-actions-menu" role="menu" aria-label={`Actions for ${catalogBook.title}`}>
                                    <button onClick={() => openRenameDialog(catalogBook)} role="menuitem" type="button">
                                      <Pencil size={14} aria-hidden="true" />
                                      <span>Rename</span>
                                    </button>
                                    <button
                                      className="danger"
                                      onClick={() => {
                                        setCatalogActionBookId("");
                                        void deleteBook(catalogBook);
                                      }}
                                      role="menuitem"
                                      type="button"
                                    >
                                      <Trash2 size={14} aria-hidden="true" />
                                      <span>Delete</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            </span>
                            <small>
                              {catalogBook.author || catalogBook.file_name}
                            </small>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                </>
              ) : (
                <div className="empty-library-container">
                  <BookOpen size={28} aria-hidden="true" className="empty-icon" />
                  <h2>No books yet</h2>
                  <p>Upload an EPUB or PDF, or browse the classics below to get started.</p>
                  <label className="empty-upload-btn" title="Upload document">
                    {isBookImporting ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
                    <span>Upload</span>
                    <input disabled={isBookImporting} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} multiple onChange={handleCatalogUpload} />
                  </label>
                </div>
              )}
            </div>
            )}
          </div>

          {/* Explore Classics Section */}
          {!catalogReady ? (
            <>
              <div className="explore-divider explore-divider-skeleton" aria-hidden="true">
                <span className="catalog-skeleton-line divider" />
              </div>

              <div className="explore-section explore-section-skeleton" role="status" aria-label="Loading classics">
                <div className="explore-grid">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div className="explore-card explore-card-skeleton" key={`classic-skeleton-${index}`}>
                      <div className="explore-cover-container explore-cover-skeleton" aria-hidden="true" />
                      <div className="explore-meta">
                        <span className="catalog-skeleton-line title" aria-hidden="true" />
                        <span className="catalog-skeleton-line meta" aria-hidden="true" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="explore-divider">
                <span>Explore Classics</span>
              </div>

              <div className="explore-section">
                <div className="explore-grid">
                  {CURATED_CLASSICS.map((classicBook) => {
                    const matchingBook = catalogBooks.find(
                      (cb) => cb.title.toLowerCase().trim() === classicBook.title.toLowerCase().trim()
                    );
                    const alreadyAdded = !!matchingBook;
                    const isImporting = importingClassicId === classicBook.id;

                    return (
                      <div className="explore-card" key={classicBook.id}>
                        <div className="explore-cover-container">
                          <img
                            className="explore-cover"
                            src={classicBook.coverUrl}
                            alt={classicBook.title}
                            loading="lazy"
                          />
                          <div className="explore-cover-overlay">
                            <div className="explore-synopsis">
                              <span className="explore-synopsis-label">Synopsis</span>
                              <p>{classicBook.summary || "No synopsis available."}</p>
                            </div>

                            <button
                              className={`explore-action-btn primary-action ${alreadyAdded ? "already-added" : ""}`}
                              disabled={isImporting || (!alreadyAdded && importingClassicId !== null)}
                              onClick={() => {
                                if (alreadyAdded && matchingBook) {
                                  void openBook(matchingBook);
                                } else {
                                  void addClassicToLibrary(classicBook);
                                }
                              }}
                              title={alreadyAdded ? "Read Book" : "Add to Library"}
                              type="button"
                            >
                              {isImporting ? (
                                <Loader2 className="spin" size={16} />
                              ) : alreadyAdded ? (
                                <BookOpen size={16} />
                              ) : (
                                <Plus size={16} />
                              )}
                              <span>{isImporting ? "Adding..." : alreadyAdded ? "Read" : "Add to Library"}</span>
                            </button>
                          </div>
                        </div>

                        <div className="explore-meta">
                          <h3 className="explore-title" title={classicBook.title}>{classicBook.title}</h3>
                          <p className="explore-author">{classicBook.author}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </section>
        {readerImageUpgradeOpen && renderProComparison()}
      </main>
    );
  }

  if (!book) {
    if (openingBook) return renderOpeningBookSkeleton(openingBook);
    return null;
  }

  const readerImageStage = readerImageMode ? renderReaderImageStage() : null;
  const isWaitingForOpeningOverlay = Boolean(
    openingBook &&
    openingBook.id === activeBookId &&
    (
      (book?.format === "pdf" && !openingPdfSettled) ||
      (book?.format !== "pdf" && !openingTextSettled)
    )
  );

  return (
    <main
      className="app-shell reader-themed-shell"
      data-reader-mode={readerThemeMode}
      data-reader-theme={readerTheme}
    >
      {openingBook && openingBook.id === activeBookId && (
        <div
          className={[
            "reader-opening-overlay",
            isWaitingForOpeningOverlay ? "reader-opening-wait-overlay" : "reader-opening-settle-overlay"
          ].join(" ")}
          aria-busy="true"
        >
          {renderOpeningBookStage(openingBook)}
        </div>
      )}
      <header className="topbar" style={{ position: "relative" }}>
        <div className="reader-top-actions">
          <button className="top-icon" type="button" title="Back to library" onClick={() => openCatalog()}>
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <button
            aria-controls="reader-chapter-sidebar"
            aria-expanded={chapterDrawerOpen}
            className="top-icon toc-toggle-button"
            onClick={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              setChapterDrawerOpen((isOpen) => !isOpen);
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              setChapterDrawerOpen((isOpen) => !isOpen);
            }}
            title={isPdfBook ? "Table of contents" : "Chapters"}
            type="button"
          >
            <PanelLeft size={18} aria-hidden="true" />
          </button>
        </div>
        {renderReaderBookTitle(activeReaderRow, book.title)}
        <div className="settings-button-wrapper" style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <button
            aria-expanded={settingsOpen}
            className="top-icon typography-trigger"
            onClick={() => {
              setSettingsOpen((isOpen) => !isOpen);
              setReaderMenuOpen(null);
            }}
            title={isPdfBook ? "PDF page settings" : "Typography"}
            type="button"
          >
            <CaseSensitive size={18} aria-hidden="true" />
          </button>

          {settingsOpen && (
            <>
              <div
                className="settings-popover-overlay"
                onClick={() => {
                  setSettingsOpen(false);
                  setReaderMenuOpen(null);
                }}
              />
              <div className="settings-popover-card reader-typography-popover">
                <div className="settings-popover-body">
                  <div className="settings-section typography-settings-section" aria-label={isPdfBook ? "PDF page settings" : "Typography settings"}>
                    {isPdfBook ? (
                      <>
                        <div className="typography-font-group pdf-page-layout-group" aria-label="PDF pages visible">
                          <button
                            aria-pressed={pdfPageLayout === "single"}
                            className={pdfPageLayout === "single" ? "active" : undefined}
                            onClick={() => setPdfPageLayout("single")}
                            title="Show one page"
                            type="button"
                          >
                            1 Page
                          </button>
                          <button
                            aria-pressed={pdfPageLayout === "double"}
                            className={pdfPageLayout === "double" ? "active" : undefined}
                            onClick={() => setPdfPageLayout("double")}
                            title="Show two pages"
                            type="button"
                          >
                            2 Pages
                          </button>
                        </div>

                        <div className="typography-button-group" aria-label="PDF page size">
                          <button
                            aria-label="Decrease page size"
                            disabled={pdfPageScale <= PDF_PAGE_SCALE_MIN}
                            onClick={() => adjustPdfPageScale(-0.1)}
                            title="Decrease page size"
                            type="button"
                          >
                            <Minus size={14} aria-hidden="true" />
                          </button>
                          <button
                            aria-label="Increase page size"
                            disabled={pdfPageScale >= PDF_PAGE_SCALE_MAX}
                            onClick={() => adjustPdfPageScale(0.1)}
                            title="Increase page size"
                            type="button"
                          >
                            <Plus size={14} aria-hidden="true" />
                          </button>
                        </div>

                        {renderReaderModeToggle()}
                      </>
                    ) : (
                      <>
                        <div className="typography-button-group" aria-label="Text size">
                      <button
                        aria-label="Decrease text size"
                        disabled={readerTextScale <= READER_TEXT_SCALE_MIN}
                        onClick={() => adjustReaderTextScale(-1)}
                        title="Decrease text size"
                        type="button"
                      >
                        <Minus size={14} aria-hidden="true" />
                      </button>
                      <button
                        aria-label="Increase text size"
                        disabled={readerTextScale >= READER_TEXT_SCALE_MAX}
                        onClick={() => adjustReaderTextScale(1)}
                        title="Increase text size"
                        type="button"
                      >
                        <Plus size={14} aria-hidden="true" />
                      </button>
                        </div>

                        <div className="typography-button-group" aria-label="Line width">
                      <button
                        aria-label="Narrow line width"
                        disabled={readerLineWidth <= READER_LINE_WIDTH_MIN}
                        onClick={() => adjustReaderLineWidth(-1)}
                        title="Narrow line width"
                        type="button"
                      >
                        <MoveHorizontal className="narrow-width-icon" size={17} aria-hidden="true" />
                      </button>
                      <button
                        aria-label="Widen line width"
                        disabled={readerLineWidth >= READER_LINE_WIDTH_MAX}
                        onClick={() => adjustReaderLineWidth(1)}
                        title="Widen line width"
                        type="button"
                      >
                        <MoveHorizontal size={17} aria-hidden="true" />
                      </button>
                        </div>

                        <div className="typography-button-group" aria-label="Line height">
                      <button
                        aria-label="Decrease line height"
                        disabled={readerLineHeight <= READER_LINE_HEIGHT_MIN}
                        onClick={() => adjustReaderLineHeight(-0.1)}
                        title="Decrease line height"
                        type="button"
                      >
                        <AlignJustify className="compact-lines-icon" size={16} aria-hidden="true" />
                      </button>
                      <button
                        aria-label="Increase line height"
                        disabled={readerLineHeight >= READER_LINE_HEIGHT_MAX}
                        onClick={() => adjustReaderLineHeight(0.1)}
                        title="Increase line height"
                        type="button"
                      >
                        <AlignJustify size={16} aria-hidden="true" />
                      </button>
                        </div>

                        <div className="typography-font-group" aria-label="Reader font">
                      <button
                        aria-pressed={readerFontMode === "sans"}
                        className={readerFontMode === "sans" ? "active" : undefined}
                        onClick={() => setReaderFontMode("sans")}
                        title="Sans-serif font"
                        type="button"
                      >
                        Sans
                      </button>
                      <button
                        aria-pressed={readerFontMode === "serif"}
                        className={readerFontMode === "serif" ? "active" : undefined}
                        onClick={() => setReaderFontMode("serif")}
                        title="Serif font"
                        type="button"
                      >
                        Serif
                      </button>
                        </div>

                        <div className="typography-theme-menu">
                      <Palette size={14} aria-hidden="true" />
                      <button
                        aria-expanded={readerMenuOpen === "theme"}
                        aria-haspopup="listbox"
                        aria-label="Reader theme"
                        className="typography-menu-trigger"
                        onClick={() => setReaderMenuOpen(readerMenuOpen === "theme" ? null : "theme")}
                        title="Reader theme"
                        type="button"
                      >
                        <span>{READER_THEMES.find((theme) => theme.value === readerTheme)?.label ?? "Default"}</span>
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      {readerMenuOpen === "theme" && (
                        <div className="typography-menu-list" role="listbox" aria-label="Reader theme">
                          {READER_THEMES.map((theme) => (
                            <button
                              aria-selected={readerTheme === theme.value}
                              className={readerTheme === theme.value ? "active" : undefined}
                              key={theme.value}
                              onClick={() => {
                                setReaderTheme(theme.value);
                                setReaderMenuOpen(null);
                              }}
                              role="option"
                              type="button"
                            >
                              <span>{theme.label}</span>
                              {readerTheme === theme.value && <Check size={13} aria-hidden="true" />}
                            </button>
                          ))}
                        </div>
                      )}
                        </div>

                        <div className="typography-theme-menu">
                      <Moon size={14} aria-hidden="true" />
                      <button
                        aria-expanded={readerMenuOpen === "appearance"}
                        aria-haspopup="listbox"
                        aria-label="Reader appearance"
                        className="typography-menu-trigger"
                        onClick={() => setReaderMenuOpen(readerMenuOpen === "appearance" ? null : "appearance")}
                        title="Reader appearance"
                        type="button"
                      >
                        <span>{readerThemeMode === "dark" ? "Dark" : "Light"}</span>
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      {readerMenuOpen === "appearance" && (
                        <div className="typography-menu-list" role="listbox" aria-label="Reader appearance">
                          {[
                            { value: "light", label: "Light" },
                            { value: "dark", label: "Dark" }
                          ].map((option) => (
                            <button
                              aria-selected={readerThemeMode === option.value}
                              className={readerThemeMode === option.value ? "active" : undefined}
                              key={option.value}
                              onClick={() => {
                                setReaderThemeMode(option.value as ReaderThemeMode);
                                setReaderMenuOpen(null);
                              }}
                              role="option"
                              type="button"
                            >
                              <span>{option.label}</span>
                              {readerThemeMode === option.value && <Check size={13} aria-hidden="true" />}
                            </button>
                          ))}
                        </div>
                      )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {(returnPoint || progressNotice) && (
        <div className="reader-back-anchor">
          {returnPoint ? (
            <button className="reader-back-button" onClick={goBackToReturnPoint} type="button">
              <ChevronLeft size={15} aria-hidden="true" />
              <span>Back</span>
            </button>
          ) : (
            <span className="reader-progress-notice" role="status" aria-live="polite">
              Continuing where you left off
            </span>
          )}
        </div>
      )}

      <section className={["reader-frame", chapterDrawerOpen ? "chapter-sidebar-open" : "chapter-sidebar-collapsed", isPdfBook ? "pdf-reader-frame" : ""].filter(Boolean).join(" ")}>
        <button
          aria-hidden={!chapterDrawerOpen}
          aria-label="Close table of contents"
          className={["chapter-drawer-scrim", chapterDrawerOpen ? "open" : ""].filter(Boolean).join(" ")}
          onClick={(event) => event.preventDefault()}
          onPointerDown={(event) => {
            event.preventDefault();
            setChapterDrawerOpen(false);
          }}
          tabIndex={chapterDrawerOpen ? 0 : -1}
          type="button"
        />
        <aside
          className={["chapter-sidebar", chapterDrawerOpen ? "open" : ""].filter(Boolean).join(" ")}
          id="reader-chapter-sidebar"
        >
          <div className="chapter-heading">{isPdfBook ? "Table of contents" : "Chapters"}</div>
          <nav className="chapter-list" aria-label={isPdfBook ? "Table of contents" : "Chapters"}>
            {book.chapters.length ? (
              book.chapters.map((chapter, index) => {
                const isActive = index === (isPdfBook ? activePdfChapterIndex : current?.chapterIndex);
                return (
                  <div key={`${chapter}-${index}`} className="chapter-item-container" style={{ display: "flex", flexDirection: "column" }}>
                    <button
                      className={isActive ? "chapter-item active" : "chapter-item"}
                      ref={(node) => {
                        if (node) {
                          chapterRefs.current.set(index, node);
                        } else {
                          chapterRefs.current.delete(index);
                        }
                      }}
                      type="button"
                      onClick={() => moveToChapter(index)}
                      title={chapter.trim()}
                    >
                      {chapter}
                    </button>
                  </div>
                );
              })
            ) : (
              <span className="chapter-empty">{isPdfBook ? "No table of contents found." : "No chapters found."}</span>
            )}
          </nav>
        </aside>

        <div className={[
          readerImageMode ? "main-spread reader-only image-mode" : "main-spread reader-only",
          readerImageStage ? "has-reader-image" : "",
          readerImageResizeMasked ? "reader-image-resizing" : "",
          isPdfBook ? `pdf-reader-main pdf-reader-${pdfReaderViewMode} pdf-layout-${pdfPageLayout}` : ""
        ].filter(Boolean).join(" ")}>
          {isPdfBook ? (
            <PdfDocumentView
              currentPage={currentPage}
              file={activeBookFile}
              onDocumentReady={handlePdfDocumentReady}
              onPageChange={moveToPdfPage}
              pageCount={pdfPageCount}
              paragraphs={book.paragraphs}
              scrollOffsetRatio={pdfScrollOffsetRatio}
              scrollPage={pdfScrollPage}
              scrollRequest={pdfScrollRequest}
              renderPageImage={renderPdfPageReaderImage}
              speechHighlight={speechHighlight}
              pdfPageLayout={pdfPageLayout}
              pdfPageScale={pdfPageScale}
              onWordClick={handlePdfWordClick}
            />
          ) : (
            renderTextReadingSurface()
          )}
          {readerImageStage}
          {readerImageResizeMasked && <div className="reader-image-resize-veil" aria-hidden="true" />}
        </div>
      </section>

      <div
        className="progress-wrap"
        aria-label="Reading progress"
        aria-valuemax={isPdfPageOnlyMode ? pdfPageCount : book.paragraphs.length}
        aria-valuemin={1}
        aria-valuenow={isPdfPageOnlyMode ? currentPage : currentIndex + 1}
        onKeyDown={handleProgressKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          scrubToPointer(event, { remember: true });
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
        <div className="control-rail-left" aria-hidden="true" />
        <div className="transport">
          <div className="narration-voice-control" ref={voiceControlRef}>
            <button
              aria-expanded={voicePopoverOpen}
              aria-haspopup="dialog"
              className="narration-voice-trigger"
              onClick={(event) => {
                if (event.detail === 0) {
                  setVoicePopoverOpen((open) => !open);
                  setSpeedPopoverOpen(false);
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                setVoicePopoverOpen((open) => !open);
                setSpeedPopoverOpen(false);
              }}
              title="Narration voice"
              type="button"
            >
              {VOICE_OPTIONS.find((v) => v.id === narrationVoice)?.flag ?? "🇺🇸"}
            </button>
            {voicePopoverOpen && (
              <div className="narration-voice-popover" role="dialog" aria-label="Choose narration voice">
                {VOICE_OPTIONS.map((option) => (
                  <button
                    className={narrationVoice === option.id ? "narration-voice-option active" : "narration-voice-option"}
                    key={option.id}
                    onClick={() => chooseNarrationVoice(option.id)}
                    type="button"
                  >
                    <span className="narration-voice-flag">{option.flag}</span>
                    <span className="narration-voice-label">{option.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            className="rail-icon"
            type="button"
            onClick={() => isPdfPageOnlyMode ? moveToPdfPageAndNarrate(currentPage - 1) : moveToAndNarrate(currentIndex - 1)}
            disabled={isPdfPageOnlyMode ? currentPage <= 1 : currentIndex <= 0}
            title={isPdfPageOnlyMode ? "Previous page" : "Previous paragraph"}
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
            onClick={() => isPdfPageOnlyMode ? moveToPdfPageAndNarrate(currentPage + 1) : moveToAndNarrate(currentIndex + 1)}
            disabled={isPdfPageOnlyMode ? currentPage >= pdfPageCount : currentIndex >= book.paragraphs.length - 1}
            title={isPdfPageOnlyMode ? "Next page" : "Next paragraph"}
          >
            <RotateCw size={21} aria-hidden="true" />
          </button>
          <div className="narration-speed-control" ref={speedControlRef}>
            <button
              aria-expanded={speedPopoverOpen}
              aria-haspopup="dialog"
              className="narration-speed-trigger"
              onClick={(event) => {
                if (event.detail === 0) {
                  setSpeedPopoverOpen((open) => !open);
                  setVoicePopoverOpen(false);
                }
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                setSpeedPopoverOpen((open) => !open);
                setVoicePopoverOpen(false);
              }}
              title="Narration speed"
              type="button"
            >
              {formatNarrationRate(speedPreviewRate ?? narrationRate)}
            </button>
            {speedPopoverOpen && (
              <div className="narration-speed-popover" role="dialog" aria-label="Narration speed">
                <div
                  aria-label="Narration speed"
                  aria-valuemax={NARRATION_RATE_MAX}
                  aria-valuemin={NARRATION_RATE_MIN}
                  aria-valuenow={narrationRate}
                  className="narration-speed-picker"
                  onKeyDown={handleSpeedPickerKey}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    selectNarrationRateFromPointer(event);
                  }}
                  onPointerLeave={() => setSpeedPreviewRate(null)}
                  onPointerMove={(event) => {
                    previewNarrationRate(event);
                    if (event.buttons === 1) selectNarrationRateFromPointer(event);
                  }}
                  role="slider"
                  style={{
                    "--speed-active": `${((narrationRate - NARRATION_RATE_MIN) / (NARRATION_RATE_MAX - NARRATION_RATE_MIN)) * 100}%`,
                    "--speed-preview": `${(((speedPreviewRate ?? narrationRate) - NARRATION_RATE_MIN) / (NARRATION_RATE_MAX - NARRATION_RATE_MIN)) * 100}%`
                  } as CSSProperties}
                  tabIndex={0}
                >
                  {Array.from({ length: 27 }).map((_, index) => (
                    (() => {
                      const barRate = NARRATION_RATE_MIN + (index / 26) * (NARRATION_RATE_MAX - NARRATION_RATE_MIN);
                      const distance = Math.abs(barRate - (speedPreviewRate ?? narrationRate)) / (NARRATION_RATE_MAX - NARRATION_RATE_MIN);
                      const scale = 1 + Math.max(0, 1 - distance * 18) * 0.45;
                      const isSelected = Math.abs(barRate - (speedPreviewRate ?? narrationRate)) < 0.026;
                      return (
                        <span
                          aria-hidden="true"
                          className={isSelected ? "narration-speed-bar selected" : "narration-speed-bar"}
                          key={index}
                          style={{
                            "--bar-scale": scale.toFixed(2)
                          } as CSSProperties}
                        />
                      );
                    })()
                  ))}
                </div>
                <div className="narration-speed-presets" aria-label="Preset speeds">
                  {NARRATION_RATE_PRESETS.map((preset) => (
                    <button
                      className={Math.abs(narrationRate - preset) < 0.01 ? "active" : ""}
                      key={preset}
                      onClick={() => chooseNarrationRate(preset)}
                      type="button"
                    >
                      {formatNarrationRate(preset)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="control-rail-right">
          <div className="image-mode-control">
            <button
              className={readerImageMode ? "secondary-button active" : "secondary-button"}
              disabled={!readerImageMode && activeReaderImageChunkIndex < 0}
              onClick={toggleReaderImageMode}
              title={
                isPdfBook && !pdfHasText
                  ? "Text extraction is required for PDF image mode"
                  : isPdfBook && activeReaderImageChunkIndex < 0
                    ? "No page text is available for image mode here"
                  : readerImageMode
                    ? "Stop generating reading images"
                    : "Show reader images"
              }
              type="button"
            >
              {isReaderImageLoading ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <ImageIcon size={16} aria-hidden="true" />
              )}
              <span>Image mode</span>
            </button>
            {readerImageMode && (
              <div className="image-style-menu-anchor" ref={imageStyleMenuRef}>
                <button
                  aria-controls="image-style-menu"
                  aria-expanded={readerImageStyleOpen}
                  className="secondary-button image-style-button"
                  onClick={(event) => {
                    if (event.detail === 0) setReaderImageStyleOpen((isOpen) => !isOpen);
                  }}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setReaderImageStyleOpen((isOpen) => !isOpen);
                  }}
                  title="Choose image style"
                  type="button"
                >
                  <Palette size={16} aria-hidden="true" />
                  <span>Styles</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                {readerImageStyleOpen && (
                  <section
                    aria-label="Image style"
                    className="image-style-menu"
                    id="image-style-menu"
                  >
                    <div className="image-style-menu-heading">
                      <strong>Styles</strong>
                    </div>
                    <div className="image-style-options">
                      {READER_IMAGE_STYLES.map((style) => (
                        <button
                          aria-pressed={readerImageStyle === style.id}
                          className={readerImageStyle === style.id ? "image-style-option active" : "image-style-option"}
                          key={style.id}
                          onClick={() => selectReaderImageStyle(style.id)}
                          type="button"
                        >
                          <img className="image-style-preview" src={style.previewSrc} alt={style.previewAlt} />
                          <span className="image-style-option-copy">
                            <strong>{style.label}</strong>
                            <small>{style.summary}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </div>
      </footer>

      {notice && <div className="notice">{notice}</div>}

      {readerImageUpgradeOpen && renderProComparison()}


    </main>
  );
}

export default App;
