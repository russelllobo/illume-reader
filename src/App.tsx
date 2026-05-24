import type { Session, User } from "@supabase/supabase-js";
import {
  AlignJustify,
  BarChart3,
  BookOpen,
  CaseSensitive,
  ChevronDown,
  ChevronLeft,
  CreditCard,
  Crown,
  Database,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  LogOut,
  Moon,
  Palette,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
  Upload,
  MoveHorizontal,
  Minus,
  Plus,
  Check,
  Settings,
  Users,
  X
} from "lucide-react";
import { ChangeEvent, CSSProperties, FormEvent, Fragment, KeyboardEvent, MouseEvent, PointerEvent, ReactNode, RefObject, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEpub, ReaderBook, ReaderParagraph } from "./epub";
import { parsePdf, pdfjsLib } from "./pdf";
import { createEdgeTtsPlayer, EdgeTtsPlayer } from "./edgeTts";
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
  imageCount?: number;
  imageLimit?: number;
  limitReached?: boolean;
  plan?: "free" | "pro";
  prompt?: string;
  src?: string;
  status: "loading" | "ready" | "error";
  style?: ReaderImageStyle;
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
const READER_TEXT_SCALE_MIN = 9 / 16;
const READER_TEXT_SCALE_MAX = 1.5;
const READER_LINE_HEIGHT_MIN = 1.1;
const READER_LINE_HEIGHT_MAX = 2;
const READER_LINE_WIDTH_MIN = 30;
const READER_LINE_WIDTH_MAX = 60;
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

const clampNarrationRate = (value: number) =>
  Math.min(NARRATION_RATE_MAX, Math.max(NARRATION_RATE_MIN, value));

const clampReaderTextScale = (value: number) =>
  Math.min(READER_TEXT_SCALE_MAX, Math.max(READER_TEXT_SCALE_MIN, value));

const clampReaderLineHeight = (value: number) =>
  Math.min(READER_LINE_HEIGHT_MAX, Math.max(READER_LINE_HEIGHT_MIN, value));

const clampReaderLineWidth = (value: number) =>
  Math.min(READER_LINE_WIDTH_MAX, Math.max(READER_LINE_WIDTH_MIN, value));

const formatNarrationRate = (value: number) =>
  Number.isInteger(value) ? `${value.toFixed(0)}x` : `${value.toFixed(2).replace(/0$/, "")}x`;

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
  paragraph_count: number;
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
type ReaderDashboardUser = {
  bookStorageBytes: number;
  books: ReaderDashboardBook[];
  createdAt: string | null;
  email: string;
  id: string;
  imageStorageBytes: number;
  imagesGenerated: number;
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
  users: ReaderDashboardUser[];
};

const EPUB_BUCKET = "epubs";
const DOCUMENT_UPLOAD_ACCEPT = ".epub,application/epub+zip,.pdf,application/pdf";
const BOOK_CACHE_NAME = "epub-vision-reader-books-v1";
const READER_IMAGE_DB_NAME = "epub-vision-reader-images";
const READER_IMAGE_STORE_NAME = "images";
const READER_IMAGE_CHUNK_WORDS = 1000;
const FREE_READER_IMAGE_LIFETIME_LIMIT = 25;
const PRO_READER_IMAGE_MONTHLY_LIMIT = 100;
const APP_TITLE = "Illume Reader | Make reading more immersive";
const READER_IMAGE_STYLES: Array<{ id: ReaderImageStyle; label: string; summary: string }> = [
  { id: "cartoon", label: "Cartoon", summary: "Bold Sunday funnies look with bright 1980s color." },
  { id: "cute", label: "Cute", summary: "Kawaii anime feel with pastel modern colors." }
];
const USER_STORAGE_QUOTA_BYTES = Number(
  import.meta.env.VITE_USER_STORAGE_QUOTA_BYTES ?? 104_857_600
);

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
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/jane-austen_pride-and-prejudice.epub",
    summary: "A classic romantic novel of manners following Elizabeth Bennet as she navigates issues of manners, upbringing, morality, education, and marriage in the British Regency gentry."
  },
  {
    id: "mary-shelley-frankenstein",
    title: "Frankenstein",
    author: "Mary Shelley",
    coverUrl: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/mary-shelley/frankenstein/downloads/mary-shelley_frankenstein.epub",
    summary: "The iconic Gothic novel telling the story of Victor Frankenstein, a young scientist who creates a sapient creature in an unorthodox scientific experiment, and its tragic consequences."
  },
  {
    id: "bram-stoker-dracula",
    title: "Dracula",
    author: "Bram Stoker",
    coverUrl: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.epub",
    summary: "The seminal vampire horror novel that introduced Count Dracula and established many conventions of subsequent vampire fantasy, structured as an epistolary sequence of diaries."
  },
  {
    id: "lewis-carroll-alices-adventures-in-wonderland",
    title: "Alice’s Adventures in Wonderland",
    author: "Lewis Carroll",
    coverUrl: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/lewis-carroll/alices-adventures-in-wonderland/john-tenniel/downloads/lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub",
    summary: "A fantastical tale of a young girl named Alice who falls through a rabbit hole into a subterranean fantasy world populated by peculiar, anthropomorphic creatures."
  },
  {
    id: "arthur-conan-doyle-the-adventures-of-sherlock-holmes",
    title: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    coverUrl: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-adventures-of-sherlock-holmes/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/arthur-conan-doyle/the-adventures-of-sherlock-holmes/downloads/arthur-conan-doyle_the-adventures-of-sherlock-holmes.epub",
    summary: "A collection of twelve stories featuring the consulting detective Sherlock Holmes and his companion Dr. John H. Watson, showcasing Holmes' brilliant analytical deduction skills."
  },
  {
    id: "f-scott-fitzgerald-the-great-gatsby",
    title: "The Great Gatsby",
    author: "F. Scott Fitzgerald",
    coverUrl: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/f-scott-fitzgerald/the-great-gatsby/downloads/f-scott-fitzgerald_the-great-gatsby.epub",
    summary: "Set in the Jazz Age on Long Island, the novel depicts narrator Nick Carraway's interactions with mysterious millionaire Jay Gatsby and Gatsby's obsession to reunite with Daisy Buchanan."
  },
  {
    id: "oscar-wilde-the-picture-of-dorian-gray",
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    coverUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-picture-of-dorian-gray/downloads/oscar-wilde_the-picture-of-dorian-gray.epub",
    summary: "A philosophical novel about Dorian Gray, a handsome young man who sells his soul so that a painted portrait of him will age and record his decay, while he remains forever young."
  },
  {
    id: "herman-melville-moby-dick",
    title: "Moby-Dick",
    author: "Herman Melville",
    coverUrl: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/herman-melville/moby-dick/downloads/herman-melville_moby-dick.epub",
    summary: "The epic sailor Ishmael's narrative of the obsessive quest of Ahab, captain of the whaling ship Pequod, for revenge on Moby Dick, the giant white whale."
  },
  {
    id: "charles-dickens-a-tale-of-two-cities",
    title: "A Tale of Two Cities",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/a-tale-of-two-cities/downloads/charles-dickens_a-tale-of-two-cities.epub",
    summary: "Set in London and Paris before and during the French Revolution, the novel depicts the plight of the French peasantry and the demagogic excesses of the revolutionaries."
  },
  {
    id: "joseph-conrad-heart-of-darkness",
    title: "Heart of Darkness",
    author: "Joseph Conrad",
    coverUrl: "https://standardebooks.org/ebooks/joseph-conrad/heart-of-darkness/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/joseph-conrad/heart-of-darkness/downloads/joseph-conrad_heart-of-darkness.epub",
    summary: "A powerful novella following Charles Marlow's voyage up the Congo River in the Congo Free State, exploring the hypocrisy of European imperialism and the darkness of human nature."
  },
  {
    id: "h-g-wells-the-time-machine",
    title: "The Time Machine",
    author: "H. G. Wells",
    coverUrl: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/h-g-wells/the-time-machine/downloads/h-g-wells_the-time-machine.epub",
    summary: "The pioneering science fiction novella that popularized the concept of time travel using a vehicle, following a Victorian inventor's journey to the far future and the split of humanity."
  },
  {
    id: "h-g-wells-the-war-of-the-worlds",
    title: "The War of the Worlds",
    author: "H. G. Wells",
    coverUrl: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/h-g-wells/the-war-of-the-worlds/downloads/h-g-wells_the-war-of-the-worlds.epub",
    summary: "One of the earliest and most influential novels detailing an alien invasion, following a nameless narrator as Martians attack Victorian England with advanced technology."
  },
  {
    id: "robert-louis-stevenson-the-strange-case-of-dr-jekyll-and-mr-hyde",
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    author: "Robert Louis Stevenson",
    coverUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/the-strange-case-of-dr-jekyll-and-mr-hyde/downloads/robert-louis-stevenson_the-strange-case-of-dr-jekyll-and-mr-hyde.epub",
    summary: "A gothic novella about a London legal practitioner named John Gabriel Utterson who investigates strange occurrences between his old friend, Dr. Henry Jekyll, and the evil Edward Hyde."
  },
  {
    id: "robert-louis-stevenson-treasure-island",
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    coverUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/treasure-island/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/robert-louis-stevenson/treasure-island/downloads/robert-louis-stevenson_treasure-island.epub",
    summary: "The classic adventure novel telling the story of 'buccaneers and buried gold', following young Jim Hawkins as he boards the Hispaniola to locate Captain Flint's treasure."
  },
  {
    id: "charlotte-bronte-jane-eyre",
    title: "Jane Eyre",
    author: "Charlotte Brontë",
    coverUrl: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charlotte-bronte/jane-eyre/downloads/charlotte-bronte_jane-eyre.epub",
    summary: "Following the emotions and experiences of its eponymous heroine, including her growth to adulthood and her love for Mr. Rochester, the master of Thornfield Hall."
  },
  {
    id: "emily-bronte-wuthering-heights",
    title: "Wuthering Heights",
    author: "Emily Brontë",
    coverUrl: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/emily-bronte/wuthering-heights/downloads/emily-bronte_wuthering-heights.epub",
    summary: "A passionate story of obsessive love and revenge on the Yorkshire moors, following the tumultuous relationship between Heathcliff and Catherine Earnshaw."
  },
  {
    id: "homer-the-odyssey",
    title: "The Odyssey",
    author: "Homer",
    coverUrl: "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/homer/the-odyssey/william-cullen-bryant/downloads/homer_the-odyssey_william-cullen-bryant.epub",
    summary: "One of two major ancient Greek epic poems, following the Greek hero Odysseus, king of Ithaca, and his journey home after the fall of Troy, translated by William Cullen Bryant."
  },
  {
    id: "homer-the-iliad",
    title: "The Iliad",
    author: "Homer",
    coverUrl: "https://standardebooks.org/ebooks/homer/the-iliad/william-cullen-bryant/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/homer/the-iliad/william-cullen-bryant/downloads/homer_the-iliad_william-cullen-bryant.epub",
    summary: "Set during the ten-year siege of the city of Troy by a coalition of Greek states, detailing the battle between Achilles and King Agamemnon, translated by William Cullen Bryant."
  },
  {
    id: "fyodor-dostoevsky-crime-and-punishment",
    title: "Crime and Punishment",
    author: "Fyodor Dostoevsky",
    coverUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/crime-and-punishment/constance-garnett/downloads/fyodor-dostoevsky_crime-and-punishment_constance-garnett.epub",
    summary: "Following Rodion Raskolnikov, an impoverished ex-student in Saint Petersburg who formulates a plan to kill an unscrupulous pawnbroker for her money, translated by Constance Garnett."
  },
  {
    id: "fyodor-dostoevsky-the-brothers-karamazov",
    title: "The Brothers Karamazov",
    author: "Fyodor Dostoevsky",
    coverUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/the-brothers-karamazov/constance-garnett/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/fyodor-dostoevsky/the-brothers-karamazov/constance-garnett/downloads/fyodor-dostoevsky_the-brothers-karamazov_constance-garnett.epub",
    summary: "A passionate philosophical novel that enters deeply into the questions of God, free will, and morality, detailing the drama of the Karamazov family, translated by Constance Garnett."
  },
  {
    id: "henry-david-thoreau-walden",
    title: "Walden",
    author: "Henry David Thoreau",
    coverUrl: "https://standardebooks.org/ebooks/henry-david-thoreau/walden/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/henry-david-thoreau/walden/downloads/henry-david-thoreau_walden.epub",
    summary: "Thoreau's reflection upon simple living in natural surroundings, detailing his experiences over two years in a cabin he built near Walden Pond, Massachusetts."
  },
  {
    id: "walt-whitman-leaves-of-grass",
    title: "Leaves of Grass",
    author: "Walt Whitman",
    coverUrl: "https://standardebooks.org/ebooks/walt-whitman/leaves-of-grass/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/walt-whitman/leaves-of-grass/downloads/walt-whitman_leaves-of-grass.epub",
    summary: "A landmark poetry collection in American literature, celebrating nature, humanity, individualism, and the sensual experience of the human spirit."
  },
  {
    id: "alexandre-dumas-the-count-of-monte-cristo",
    title: "The Count of Monte Cristo",
    author: "Alexandre Dumas",
    coverUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-count-of-monte-cristo/chapman-and-hall/downloads/alexandre-dumas_the-count-of-monte-cristo_chapman-and-hall.epub",
    summary: "Following Edmond Dantès, a young French sailor who is falsely accused of treason, escapes from prison, and seeks retribution against his betrayers."
  },
  {
    id: "alexandre-dumas-the-three-musketeers",
    title: "The Three Musketeers",
    author: "Alexandre Dumas",
    coverUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-three-musketeers/william-robson/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/alexandre-dumas/the-three-musketeers/william-robson/downloads/alexandre-dumas_the-three-musketeers_william-robson.epub",
    summary: "The adventures of young d'Artagnan as he travels to Paris to join the Musketeers of the Guard, befriending Athos, Porthos, and Aramis, translated by William Robson."
  },
  {
    id: "charles-dickens-great-expectations",
    title: "Great Expectations",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/great-expectations/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/great-expectations/downloads/charles-dickens_great-expectations.epub",
    summary: "Pip, an orphan growing up in a humble blacksmith's household, is suddenly elevated to the rank of gentleman by an anonymous benefactor, navigating London high society."
  },
  {
    id: "charles-dickens-oliver-twist",
    title: "Oliver Twist",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/oliver-twist/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/oliver-twist/downloads/charles-dickens_oliver-twist.epub",
    summary: "The story of the orphan Oliver Twist, who starts his life in a workhouse and is then apprenticed with an undertaker, escaping to London and finding a gang of juvenile pickpockets."
  },
  {
    id: "charles-dickens-a-christmas-carol",
    title: "A Christmas Carol",
    author: "Charles Dickens",
    coverUrl: "https://standardebooks.org/ebooks/charles-dickens/a-christmas-carol/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/charles-dickens/a-christmas-carol/downloads/charles-dickens_a-christmas-carol.epub",
    summary: "The transformation of Ebenezer Scrooge, a miserly old businessman, after he is visited by the ghosts of Christmas Past, Present, and Yet to Come."
  },
  {
    id: "james-joyce-dubliners",
    title: "Dubliners",
    author: "James Joyce",
    coverUrl: "https://standardebooks.org/ebooks/james-joyce/dubliners/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/dubliners/downloads/james-joyce_dubliners.epub",
    summary: "A collection of fifteen short stories depicting Irish middle-class life in and around Dublin in the early years of the 20th century, exploring moments of epiphany."
  },
  {
    id: "james-joyce-a-portrait-of-the-artist-as-a-young-man",
    title: "A Portrait of the Artist as a Young Man",
    author: "James Joyce",
    coverUrl: "https://standardebooks.org/ebooks/james-joyce/a-portrait-of-the-artist-as-a-young-man/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/a-portrait-of-the-artist-as-a-young-man/downloads/james-joyce_a-portrait-of-the-artist-as-a-young-man.epub",
    summary: "A semi-autobiographical novel tracing the intellectual, philosophical, and aesthetic awakening of Stephen Dedalus, a young man who rebels against his Catholic upbringing."
  },
  {
    id: "james-joyce-ulysses",
    title: "Ulysses",
    author: "James Joyce",
    coverUrl: "https://standardebooks.org/ebooks/james-joyce/ulysses/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/james-joyce/ulysses/downloads/james-joyce_ulysses.epub",
    summary: "A modern masterpiece chronicling the passage of Leopold Bloom through Dublin in the course of an ordinary day, establishing parallels to Homer's epic Odyssey."
  },
  {
    id: "jonathan-swift-gullivers-travels",
    title: "Gulliver’s Travels",
    author: "Jonathan Swift",
    coverUrl: "https://standardebooks.org/ebooks/jonathan-swift/gullivers-travels/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jonathan-swift/gullivers-travels/downloads/jonathan-swift_gullivers-travels.epub",
    summary: "A brilliant satire of human nature and traveler's tales, following Lemuel Gulliver's voyages to Lilliput, Brobdingnag, Laputa, and the land of the Houyhnhnms."
  },
  {
    id: "kenneth-grahame-the-wind-in-the-willows",
    title: "The Wind in the Willows",
    author: "Kenneth Grahame",
    coverUrl: "https://standardebooks.org/ebooks/kenneth-grahame/the-wind-in-the-willows/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/kenneth-grahame/the-wind-in-the-willows/downloads/kenneth-grahame_the-wind-in-the-willows.epub",
    summary: "The charming adventures of Mole, Water Rat, Badger, and the eccentric Mr. Toad of Toad Hall, exploring the Thames Valley wilderness and themes of friendship."
  },
  {
    id: "jack-london-the-call-of-the-wild",
    title: "The Call of the Wild",
    author: "Jack London",
    coverUrl: "https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jack-london/the-call-of-the-wild/downloads/jack-london_the-call-of-the-wild.epub",
    summary: "Set in the Yukon Territory during the Klondike Gold Rush, following Buck, a domesticated dog who is stolen, sold into service, and reverts to wild instincts."
  },
  {
    id: "jack-london-white-fang",
    title: "White Fang",
    author: "Jack London",
    coverUrl: "https://standardebooks.org/ebooks/jack-london/white-fang/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jack-london/white-fang/downloads/jack-london_white-fang.epub",
    summary: "A companion novel to Call of the Wild, focusing on a wild wolf-dog's journey to domestication in the Yukon Territory during the Gold Rush."
  },
  {
    id: "george-bernard-shaw-pygmalion",
    title: "Pygmalion",
    author: "George Bernard Shaw",
    coverUrl: "https://standardebooks.org/ebooks/george-bernard-shaw/pygmalion/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/george-bernard-shaw/pygmalion/downloads/george-bernard-shaw_pygmalion.epub",
    summary: "A brilliant play about Henry Higgins, a professor of phonetics, who makes a bet that he can train a bedraggled Cockney flower girl, Eliza Doolittle, to pass for a duchess."
  },
  {
    id: "leo-tolstoy-anna-karenina",
    title: "Anna Karenina",
    author: "Leo Tolstoy",
    coverUrl: "https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/leo-tolstoy/anna-karenina/constance-garnett/downloads/leo-tolstoy_anna-karenina_constance-garnett.epub",
    summary: "A complex novel in eight parts, tracing the tragic extramarital affair between the socialite Anna Karenina and the dashing cavalry officer Count Vronsky, translated by Constance Garnett."
  },
  {
    id: "leo-tolstoy-war-and-peace",
    title: "War and Peace",
    author: "Leo Tolstoy",
    coverUrl: "https://standardebooks.org/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/leo-tolstoy/war-and-peace/louise-maude_aylmer-maude/downloads/leo-tolstoy_war-and-peace_louise-maude_aylmer-maude.epub",
    summary: "An epic chronicle of the history of the French invasion of Russia and the impact of the Napoleonic era on Tsarist society through five Russian aristocratic families."
  },
  {
    id: "oscar-wilde-the-importance-of-being-earnest",
    title: "The Importance of Being Earnest",
    author: "Oscar Wilde",
    coverUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-importance-of-being-earnest/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/oscar-wilde/the-importance-of-being-earnest/downloads/oscar-wilde_the-importance-of-being-earnest.epub",
    summary: "A farcical comedy in which the protagonists maintain fictitious personae in order to escape burdensome social obligations, showcasing Wilde's sharp wit."
  },
  {
    id: "jane-austen-sense-and-sensibility",
    title: "Sense and Sensibility",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/sense-and-sensibility/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/sense-and-sensibility/downloads/jane-austen_sense-and-sensibility.epub",
    summary: "Following the Dashwood sisters, Elinor (representing sense) and Marianne (representing sensibility), as they navigate romance, family, and financial hardship."
  },
  {
    id: "jane-austen-emma",
    title: "Emma",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/emma/downloads/jane-austen_emma.epub",
    summary: "Emma Woodhouse, beautiful, clever, and rich, has a very happy home and little to distress her. But she has an unfortunate habit of matchmaking in her small village."
  },
  {
    id: "jane-austen-persuasion",
    title: "Persuasion",
    author: "Jane Austen",
    coverUrl: "https://standardebooks.org/ebooks/jane-austen/persuasion/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/jane-austen/persuasion/downloads/jane-austen_persuasion.epub",
    summary: "The story of Anne Elliot, who, years after breaking her engagement to naval captain Frederick Wentworth, meets him again and must navigate unresolved feelings."
  },
  {
    id: "niccolo-machiavelli-the-prince",
    title: "The Prince",
    author: "Niccolò Machiavelli",
    coverUrl: "https://standardebooks.org/ebooks/niccolo-machiavelli/the-prince/w-k-marriott/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/niccolo-machiavelli/the-prince/w-k-marriott/downloads/niccolo-machiavelli_the-prince_w-k-marriott.epub",
    summary: "The classic political treatise on statecraft, describing how a ruler should acquire, maintain, and govern a principality, translated by W. K. Marriott."
  },
  {
    id: "friedrich-nietzsche-beyond-good-and-evil",
    title: "Beyond Good and Evil",
    author: "Friedrich Nietzsche",
    coverUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/beyond-good-and-evil/helen-zimmern/downloads/friedrich-nietzsche_beyond-good-and-evil_helen-zimmern.epub",
    summary: "A fundamental critique of traditional morality and philosophy, introducing Nietzsche's concepts of the will to power and master-slave moralities."
  },
  {
    id: "friedrich-nietzsche-thus-spoke-zarathustra",
    title: "Thus Spoke Zarathustra",
    author: "Friedrich Nietzsche",
    coverUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/thus-spake-zarathustra/thomas-common/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/friedrich-nietzsche/thus-spake-zarathustra/thomas-common/downloads/friedrich-nietzsche_thus-spake-zarathustra_thomas-common.epub",
    summary: "A philosophical novel containing the fictional travels and speeches of Zarathustra, introducing the concepts of the Übermensch and eternal recurrence."
  },
  {
    id: "kahlil-gibran-the-prophet",
    title: "The Prophet",
    author: "Kahlil Gibran",
    coverUrl: "https://standardebooks.org/ebooks/khalil-gibran/the-prophet/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/khalil-gibran/the-prophet/downloads/khalil-gibran_the-prophet.epub",
    summary: "A book of 26 poetic essays delivered by the prophet Almustafa, offering spiritual insights on love, marriage, children, work, joy, sorrow, and death."
  },
  {
    id: "frances-hodgson-burnett-the-secret-garden",
    title: "The Secret Garden",
    author: "Frances Hodgson Burnett",
    coverUrl: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/frances-hodgson-burnett/the-secret-garden/downloads/frances-hodgson-burnett_the-secret-garden.epub",
    summary: "Following Mary Lennox, a spoiled and unloved orphan who is sent to Yorkshire to live with her uncle, discovering a locked and neglected secret garden."
  },
  {
    id: "j-m-barrie-peter-and-wendy",
    title: "Peter and Wendy",
    author: "J. M. Barrie",
    coverUrl: "https://standardebooks.org/ebooks/j-m-barrie/peter-and-wendy/downloads/cover-thumbnail.jpg",
    downloadUrl: "https://standardebooks.org/ebooks/j-m-barrie/peter-and-wendy/downloads/j-m-barrie_peter-and-wendy.epub",
    summary: "The classic fantasy story of Peter Pan, the boy who wouldn't grow up, as he takes Wendy Darling and her brothers to the magical island of Neverland."
  },
  {
    id: "brothers-grimm-fairy-tales",
    title: "Grimms’ Fairy Tales",
    author: "Brothers Grimm",
    coverUrl: "https://standardebooks.org/ebooks/jacob-grimm_wilhelm-grimm/household-tales/margaret-hunt/downloads/cover-thumbnail.jpg",
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

const buildPdfReaderImageChunks = (book: ReaderBook): ReaderImageChunk[] => {
  const chunks: ReaderImageChunk[] = [];
  let wordOffset = 0;

  for (let pageNumber = 1; pageNumber <= (book.pageCount ?? 0); pageNumber += 1) {
    const pageWords: string[] = [];

    for (let pIndex = 0; pIndex < book.paragraphs.length; pIndex++) {
      const paragraph = book.paragraphs[pIndex];
      if (paragraph.kind === "image" || paragraph.pageNumber !== pageNumber) continue;
      pageWords.push(...wordsFromText(paragraph.text));
    }

    if (pageWords.length) {
      chunks.push({
        endWord: wordOffset + pageWords.length,
        index: pageNumber - 1,
        pageNumber,
        startWord: wordOffset + 1,
        text: pageWords.join(" ")
      });
    }

    wordOffset += pageWords.length;
  }

  return chunks;
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
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
};

const formatShortDate = (value: string | null) => {
  if (!value) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
};

const bookFormat = (row: Pick<BookRow, "document_type" | "file_name" | "mime_type">): "epub" | "pdf" => {
  if (row.document_type === "pdf" || row.mime_type === "application/pdf" || row.file_name.toLowerCase().endsWith(".pdf")) {
    return "pdf";
  }
  return "epub";
};

const isPdfFile = (file: File) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

const isEpubFile = (file: File) => file.type === "application/epub+zip" || file.name.toLowerCase().endsWith(".epub");

const safeFileName = (name: string) =>
  name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "document";

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
  pdf,
  rootRef,
  sideImage,
  speechHighlight,
  paragraphs,
  onWordClick
}: {
  active: boolean;
  metrics?: PdfPageMetrics;
  pageNumber: number;
  paragraphs: ReaderParagraph[];
  pdf: pdfjsLib.PDFDocumentProxy;
  rootRef: RefObject<HTMLElement | null>;
  sideImage?: ReactNode;
  speechHighlight: SpeechHighlight | null;
  onWordClick?: (pageNumber: number, pageWordIndex: number) => void;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [shouldRender, setShouldRender] = useState(active);
  const [pageSize, setPageSize] = useState({ height: 0, width: 0 });
  const [textLayerWords, setTextLayerWords] = useState<PdfTextLayerWord[]>([]);

  const activePageWordIndex = useMemo(() => {
    if (!speechHighlight || speechHighlight.end <= speechHighlight.start) return null;

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
  }, [pageNumber, paragraphs, speechHighlight]);

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
      const availableWidth = Math.max(280, holder.clientWidth - 8);
      const scale = Math.min(2.1, availableWidth / unscaledViewport.width);
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

      setTextLayerWords(words);
    };

    void render();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pageNumber, pdf, shouldRender]);

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
                onWordClick(pageNumber, parseInt(wordIndexStr, 10));
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
  onPageChange,
  pageCount,
  paragraphs,
  scrollOffsetRatio,
  scrollPage,
  scrollRequest,
  renderPageImage,
  speechHighlight,
  pdfPageLayout,
  onWordClick
}: {
  currentPage: number;
  file: File | null;
  onPageChange: (page: number, options?: { offsetRatio?: number; scroll?: boolean }) => void;
  pageCount: number;
  paragraphs: ReaderParagraph[];
  scrollOffsetRatio: number;
  scrollPage: number;
  scrollRequest: number;
  renderPageImage?: (pageNumber: number) => ReactNode;
  speechHighlight: SpeechHighlight | null;
  pdfPageLayout: "single" | "double";
  onWordClick?: (pageNumber: number, pageWordIndex: number) => void;
}) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const [pageMetrics, setPageMetrics] = useState<PdfPageMetrics[]>([]);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    if (!file) {
      setPdf(null);
      setPageMetrics([]);
      return;
    }

    let cancelled = false;
    let loadedPdf: pdfjsLib.PDFDocumentProxy | null = null;

    const load = async () => {
      setError("");
      try {
        const bytes = await file.arrayBuffer();
        loadedPdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        const metrics = await Promise.all(
          Array.from({ length: loadedPdf.numPages }, async (_, index) => {
            const page = await loadedPdf!.getPage(index + 1);
            const viewport = page.getViewport({ scale: 1 });
            return { height: viewport.height, width: viewport.width };
          })
        );
        if (!cancelled) {
          setPageMetrics(metrics);
          setPdf(loadedPdf);
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not render this PDF.");
      }
    };

    void load();

    return () => {
      cancelled = true;
      void loadedPdf?.destroy();
    };
  }, [file]);

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
  }, []);

  const handleScroll = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
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
            pdf={pdf}
            rootRef={surfaceRef}
            sideImage={renderPageImage?.(page1)}
            speechHighlight={speechHighlight}
            onWordClick={onWordClick}
          />
          {page2 && (
            <PdfPageCanvas
              active={currentPage === page2}
              metrics={pageMetrics[page2 - 1]}
              pageNumber={page2}
              paragraphs={paragraphs}
              pdf={pdf}
              rootRef={surfaceRef}
              sideImage={renderPageImage?.(page2)}
              speechHighlight={speechHighlight}
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
          pdf={pdf}
          rootRef={surfaceRef}
          sideImage={renderPageImage?.(index + 1)}
          speechHighlight={speechHighlight}
          onWordClick={onWordClick}
        />
      ));
    }
  };

  return (
    <section className="pdf-surface" onScroll={handleScroll} ref={surfaceRef} aria-label="PDF pages">
      {renderPages()}
    </section>
  );
}

function ReaderDashboard({
  busy,
  data,
  error,
  onRefresh,
  onSignInWithGoogle,
  onSignOut,
  session
}: {
  busy: boolean;
  data: ReaderDashboardData | null;
  error: string;
  onRefresh: () => void;
  onSignInWithGoogle: () => void;
  onSignOut: () => void;
  session: Session | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const email = session?.user.email ?? "";
  const isOwner = email.toLowerCase() === "r.lobo2003@gmail.com";
  const storageTotal = data?.storage.totalBytes ?? 0;

  if (!session) {
    return (
      <main className="dashboard-shell auth-dashboard-shell">
        <section className="dashboard-auth-panel">
          <div className="dashboard-mark">
            <Database size={24} aria-hidden="true" />
          </div>
          <h1>Reader dashboard</h1>
          <p>Sign in with Google to view project storage, users, books, and generated images.</p>
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
          <div className="dashboard-mark blocked">
            <X size={24} aria-hidden="true" />
          </div>
          <h1>No access</h1>
          <p>This dashboard is restricted to r.lobo2003@gmail.com.</p>
          <button className="dashboard-secondary-button" onClick={onSignOut} type="button">
            <LogOut size={17} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </section>
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
            <span>Refresh</span>
          </button>
          <button className="dashboard-secondary-button" onClick={onSignOut} type="button">
            <LogOut size={17} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </header>

      {error && <div className="dashboard-error">{error}</div>}

      <section className="dashboard-metrics" aria-label="Reader project metrics">
        <article className="dashboard-metric">
          <HardDrive size={20} aria-hidden="true" />
          <span>Supabase storage</span>
          <strong>{formatBytes(storageTotal)}</strong>
        </article>
        <article className="dashboard-metric">
          <BookOpen size={20} aria-hidden="true" />
          <span>Books</span>
          <strong>{formatBytes(data?.storage.booksBytes ?? 0)}</strong>
          <small>{data?.totals.books ?? 0} uploaded</small>
        </article>
        <article className="dashboard-metric">
          <ImageIcon size={20} aria-hidden="true" />
          <span>Images</span>
          <strong>{formatBytes(data?.storage.imagesBytes ?? 0)}</strong>
          <small>{data?.totals.imagesGenerated ?? 0} generated</small>
        </article>
        <article className="dashboard-metric">
          <Users size={20} aria-hidden="true" />
          <span>Users</span>
          <strong>{data?.totals.users ?? 0}</strong>
        </article>
      </section>

      <section className="dashboard-user-section">
        <div className="dashboard-section-heading">
          <div>
            <h2>Users</h2>
            <p>{data ? `Updated ${formatShortDate(data.generatedAt)}` : "Loading project data"}</p>
          </div>
          <button
            aria-pressed={showDetails}
            className={showDetails ? "dashboard-toggle active" : "dashboard-toggle"}
            onClick={() => setShowDetails((value) => !value)}
            type="button"
          >
            <BarChart3 size={16} aria-hidden="true" />
            <span>{showDetails ? "Hide details" : "Show books & images"}</span>
          </button>
        </div>

        <div className="dashboard-user-list">
          {(data?.users ?? []).map((item) => (
            <article className="dashboard-user-row" key={item.id}>
              <div className="dashboard-user-main">
                <div className="dashboard-avatar">{item.email[0]?.toUpperCase() ?? "U"}</div>
                <div>
                  <h3>{item.email}</h3>
                  <p>Joined {formatShortDate(item.createdAt)}</p>
                </div>
              </div>
              <div className="dashboard-user-stats">
                <span>{item.books.length} books</span>
                <span>{item.imagesGenerated} images</span>
                <span>{formatBytes(item.bookStorageBytes + item.imageStorageBytes)}</span>
              </div>
              {showDetails && (
                <div className="dashboard-user-details">
                  <div className="dashboard-detail-summary">
                    <span>Books: {formatBytes(item.bookStorageBytes)}</span>
                    <span>Images: {formatBytes(item.imageStorageBytes)}</span>
                  </div>
                  {item.books.length ? (
                    <div className="dashboard-book-list">
                      {item.books.map((book) => (
                        <div className="dashboard-book-row" key={book.id}>
                          <FileText size={15} aria-hidden="true" />
                          <span>{book.title || book.fileName}</span>
                          <small>{book.documentType.toUpperCase()} · {formatBytes(book.fileSize)}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="dashboard-empty-detail">No uploaded books yet.</p>
                  )}
                </div>
              )}
            </article>
          ))}
          {!data && !error && (
            <div className="dashboard-loading">
              <Loader2 className="spin" size={22} aria-hidden="true" />
              <span>Loading dashboard</span>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

const authRedirectUrl = () => {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
};

const initialReaderFontMode = (): ReaderFontMode =>
  window.localStorage.getItem("reader-font-mode") === "sans" ? "sans" : DEFAULT_READER_PREFERENCES.fontMode;

const initialReaderThemeMode = (): ReaderThemeMode =>
  window.localStorage.getItem("reader-theme-mode") === "dark" ? "dark" : DEFAULT_READER_PREFERENCES.themeMode;

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

const normalizeReaderPreferences = (value: Partial<ReaderPreferences> | undefined): ReaderPreferences => {
  const fontMode = value?.fontMode === "sans" ? "sans" : DEFAULT_READER_PREFERENCES.fontMode;
  const themeMode = value?.themeMode === "dark" ? "dark" : DEFAULT_READER_PREFERENCES.themeMode;
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

const readerPreferencesForBook = (bookId: string) =>
  normalizeReaderPreferences(readBookReaderPreferences()[bookId]);

const writeBookReaderPreferences = (bookId: string, preferences: ReaderPreferences) => {
  const items = readBookReaderPreferences();
  items[bookId] = normalizeReaderPreferences(preferences);
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

    return new File([blob], row.file_name, { type: row.mime_type || blob.type || "application/epub+zip" });
  } catch (error) {
    console.warn("Could not read EPUB from browser cache.", error);
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
          "Content-Type": row.mime_type || file.type || "application/epub+zip"
        }
      })
    );
  } catch (error) {
    console.warn("Could not store EPUB in browser cache.", error);
  }
};

const deleteCachedBookFile = async (bookId: string) => {
  if (!("caches" in window)) return;

  try {
    const cache = await caches.open(BOOK_CACHE_NAME);
    await cache.delete(bookCacheRequest(bookId));
  } catch (error) {
    console.warn("Could not remove EPUB from browser cache.", error);
  }
};

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
  const [speedPopoverOpen, setSpeedPopoverOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<"success" | "canceled" | "">("");
  const [speechHighlight, setSpeechHighlight] = useState<SpeechHighlight | null>(null);
  const [readerImageMode, setReaderImageMode] = useState(false);
  const [readerImages, setReaderImages] = useState<Record<number, ReaderImageState>>({});
  const [readerImageCount, setReaderImageCount] = useState(0);
  const [readerImageStyle, setReaderImageStyle] = useState<ReaderImageStyle>("cartoon");
  const [readerImageStyleOpen, setReaderImageStyleOpen] = useState(false);
  const [readerImageUpgradeOpen, setReaderImageUpgradeOpen] = useState(false);
  const [hoveredReaderParagraphId, setHoveredReaderParagraphId] = useState<string | null>(null);
  const parsedBooks = useRef(new Map<string, ReaderBook>());
  const parsedBookFiles = useRef(new Map<string, File>());
  const readingSurfaceRef = useRef<HTMLElement | null>(null);
  const paragraphRefs = useRef(new Map<string, HTMLElement>());
  const chapterRefs = useRef(new Map<number, HTMLButtonElement>());
  const imageRequestsRef = useRef(new Set<number>());
  const readerImageModeRef = useRef(false);
  const readerImageRunRef = useRef(0);
  const pendingScrollIndex = useRef<number | null>(null);
  const edgeTtsPlayerRef = useRef<EdgeTtsPlayer | null>(null);
  const suppressNextPlaybackStartRef = useRef(false);
  const speedControlRef = useRef<HTMLDivElement | null>(null);
  const progressSaveTimer = useRef<number | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  const readingScrollFrame = useRef<number | null>(null);
  const coverLookupRef = useRef(new Set<string>());
  const isInitialOpenRef = useRef(false);
  const isInstantScrollRef = useRef(false);
  const [progressNotice, setProgressNotice] = useState(false);
  const [returnPoint, setReturnPoint] = useState<ReturnPoint | null>(null);
  const [pdfPageLayout, setPdfPageLayout] = useState<"single" | "double">(() => {
    const saved = window.localStorage.getItem("pdf-page-layout");
    return saved === "double" ? "double" : "single";
  });

  useEffect(() => {
    window.localStorage.setItem("pdf-page-layout", pdfPageLayout);
  }, [pdfPageLayout]);

  const [importingClassicId, setImportingClassicId] = useState<string | null>(null);
  const [pendingBookImports, setPendingBookImports] = useState<PendingBookImport[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [readerMenuOpen, setReaderMenuOpen] = useState<ReaderMenuId | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [dashboardData, setDashboardData] = useState<ReaderDashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [dashboardLoading, setDashboardLoading] = useState(false);

  const user = session?.user ?? null;
  const isReaderDashboard =
    window.location.hostname === "russell.systems" ||
    window.location.hostname === "www.russell.systems" ||
    window.location.pathname.startsWith("/dashboard");
  const current = book?.paragraphs[currentIndex];
  const isPdfBook = book?.format === "pdf";
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
  const immersiveReaderImageMode = readerImageMode && !isPdfBook;
  const storageUsed = catalogBooks.reduce((total, item) => total + item.file_size, 0);
  const isBookImporting = pendingBookImports.length > 0;
  const isPro = billingProfile?.plan === "pro" && ["active", "trialing"].includes(billingProfile.status);
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
  const readerImageStartOffset = 0;
  const readerImageChunks = useMemo(
    () => (book ? (book.format === "pdf" ? buildPdfReaderImageChunks(book) : buildReaderImageChunks(book, readerImageStartOffset)) : []),
    [book, readerImageStartOffset]
  );
  const readerImageChunkByIndex = useMemo(
    () => new Map(readerImageChunks.map((chunk) => [chunk.index, chunk])),
    [readerImageChunks]
  );
  const activeReaderImageChunkIndex = useMemo(() => {
    if (!book || !readerImageChunks.length) return -1;
    if (book.format === "pdf") return readerImageChunkByIndex.has(currentPage - 1) ? currentPage - 1 : -1;
    const relativeWordOffset = Math.max(0, currentReaderWordOffset - readerImageStartOffset);
    return Math.min(readerImageChunks.length - 1, Math.floor(relativeWordOffset / READER_IMAGE_CHUNK_WORDS));
  }, [book, currentPage, currentReaderWordOffset, readerImageChunkByIndex, readerImageChunks.length, readerImageStartOffset]);
  const visibleReaderImageIndexes = useMemo(() => {
    if (!readerImageMode || activeReaderImageChunkIndex < 0) return new Set<number>();
    return new Set([activeReaderImageChunkIndex, activeReaderImageChunkIndex + 1]);
  }, [activeReaderImageChunkIndex, readerImageMode]);
  const activeReaderImageChunk =
    activeReaderImageChunkIndex >= 0 ? readerImageChunkByIndex.get(activeReaderImageChunkIndex) ?? null : null;
  const isReaderImageLoading =
    readerImageMode &&
    activeReaderImageChunkIndex >= 0 &&
    [readerImages[activeReaderImageChunkIndex], readerImages[activeReaderImageChunkIndex + 1]].some(
      (image) => image?.status === "loading"
    );
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
        if (visibleReaderImageIndexes.has(chunk.index) || readerImages[chunk.index]) {
          const items = insertions.get(paragraphIndex) ?? [];
          items.push(chunk);
          insertions.set(paragraphIndex, items);
        }
        chunkIndex += 1;
      }

    });

    return insertions;
  }, [book, paragraphWordMetrics, readerImageChunks, readerImageMode, readerImages, visibleReaderImageIndexes]);

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
    if (isReaderDashboard) return;

    if (!user) {
      setCatalogBooks([]);
      setBillingProfile(null);
      setReaderImageCount(0);
      setReaderImageUpgradeOpen(false);
      setBook(null);
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
      for (let bookIndex = 0; bookIndex < catalogBooks.length; bookIndex++) {
        const catalogBook = catalogBooks[bookIndex];
        if (catalogBook.cover_url || coverLookupRef.current.has(catalogBook.id)) continue;

        coverLookupRef.current.add(catalogBook.id);
        const coverUrl = await getOpenLibraryCoverUrl(catalogBook.title, catalogBook.author);
        if (!coverUrl) continue;

        setCatalogBooks((items) =>
          sortBooksByRecentActivity(items.map((item) => (item.id === catalogBook.id ? { ...item, cover_url: coverUrl } : item)))
        );
        const { error: updateError } = await supabase.from("books").update({ cover_url: coverUrl }).eq("id", catalogBook.id);
        if (updateError) {
          console.error("Failed to save Open Library cover to database:", updateError);
        }
      }
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

    if (view === "reader" && book?.title) {
      document.title = book.title;
      return;
    }

    document.title = APP_TITLE;
  }, [book?.title, isReaderDashboard, view]);

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

  useEffect(() => {
    window.localStorage.setItem("reader-font-mode", readerFontMode);
  }, [readerFontMode]);

  useEffect(() => {
    window.localStorage.setItem("reader-theme-mode", readerThemeMode);
  }, [readerThemeMode]);

  useEffect(() => {
    window.localStorage.setItem("reader-theme", readerTheme);
  }, [readerTheme]);

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

    pendingScrollIndex.current = null;
    const target = book.paragraphs[targetIndex];
    const node = target ? paragraphRefs.current.get(target.id) : null;
    if (node) {
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
    if (progressNotice) {
      const timer = window.setTimeout(() => {
        setProgressNotice(false);
      }, 3000);
      return () => window.clearTimeout(timer);
    }
  }, [progressNotice]);

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
    if (!readerImageMode || activeReaderImageChunkIndex < 0) return;
    void ensureReaderImages(activeReaderImageChunkIndex);
  }, [activeReaderImageChunkIndex, readerImageMode, readerImageStyle]);

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

  const generateReaderImage = async (
    chunk: ReaderImageChunk,
    runId = readerImageRunRef.current,
    style = readerImageStyle
  ) => {
    if (!book || !activeBookId) return;
    if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
    if (imageRequestsRef.current.has(chunk.index)) return;

    imageRequestsRef.current.add(chunk.index);

    try {
      const cachedImage = await getCachedReaderImage(activeBookId, chunk, style);
      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
      if (cachedImage?.src) {
        setReaderImages((items) => ({
          ...items,
          [chunk.index]: {
            prompt: cachedImage.prompt,
            src: cachedImage.src,
            status: "ready",
            style
          }
        }));
        return;
      }

      setReaderImages((items) => ({
        ...items,
        [chunk.index]: { status: "loading", style }
      }));

      const { data, error } = await supabase.functions.invoke("generate-reader-image", {
        method: "POST",
        body: {
          author: book.author,
          bookId: activeBookId,
          bookTitle: book.title,
          chunkIndex: chunk.index,
          endWord: chunk.endWord,
          imageStyle: style,
          startWord: chunk.startWord,
          text: chunk.text
        }
      });

      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
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
        return;
      }
      if (!data?.imageUrl) throw new Error("Image generation returned no image.");

      const prompt = typeof data.prompt === "string" ? data.prompt : undefined;
      if (typeof data.imageCount === "number") setReaderImageCount(data.imageCount);
      void cacheReaderImage({
        bookId: activeBookId,
        createdAt: new Date().toISOString(),
        endWord: chunk.endWord,
        key: readerImageCacheKey(activeBookId, chunk, style),
        prompt,
        src: data.imageUrl,
        startWord: chunk.startWord,
        style
      });

      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          prompt,
          src: data.imageUrl,
          status: "ready",
          style
        }
      }));
    } catch (error) {
      if (!readerImageModeRef.current || runId !== readerImageRunRef.current) return;
      setReaderImages((items) => ({
        ...items,
        [chunk.index]: {
          error: error instanceof Error ? error.message : "Could not generate this image.",
          status: "error",
          style
        }
      }));
    } finally {
      if (runId === readerImageRunRef.current) imageRequestsRef.current.delete(chunk.index);
    }
  };

  const ensureReaderImages = async (chunkIndex: number) => {
    const runId = readerImageRunRef.current;
    const targets = [chunkIndex, chunkIndex + 1]
      .map((index) => readerImageChunkByIndex.get(index))
      .filter((chunk): chunk is ReaderImageChunk => Boolean(chunk));

    await Promise.all(
      targets.map((chunk) => {
        const existing = readerImages[chunk.index];
        if (existing?.style === readerImageStyle && (existing?.status === "ready" || existing?.status === "loading")) return Promise.resolve();
        return generateReaderImage(chunk, runId);
      })
    );
  };

  const stopReaderImageMode = () => {
    readerImageRunRef.current += 1;
    readerImageModeRef.current = false;
    imageRequestsRef.current.clear();
    setReaderImageMode(false);
    setReaderImageStyleOpen(false);
    setReaderImages({});
  };

  const selectReaderImageStyle = (style: ReaderImageStyle) => {
    if (style === readerImageStyle) {
      setReaderImageStyleOpen(false);
      return;
    }

    setReaderImageStyle(style);
    setReaderImageStyleOpen(false);
    if (!readerImageMode || !book || activeReaderImageChunkIndex < 0) return;

    const targetChunks = readerImageChunks
      .filter((chunk) => chunk.index === activeReaderImageChunkIndex || chunk.index === activeReaderImageChunkIndex + 1)
      .filter((chunk): chunk is ReaderImageChunk => Boolean(chunk));
    const runId = readerImageRunRef.current + 1;
    readerImageRunRef.current = runId;
    readerImageModeRef.current = true;
    imageRequestsRef.current.clear();
    setReaderImages({});
    void Promise.all(targetChunks.map((chunk) => generateReaderImage(chunk, runId, style)));
  };

  const toggleReaderImageMode = () => {
    if (readerImageMode) {
      stopReaderImageMode();
      return;
    }

    if (!book || activeReaderImageChunkIndex < 0) return;
    const targetChunks = readerImageChunks
      .filter((chunk) => chunk.index === activeReaderImageChunkIndex || chunk.index === activeReaderImageChunkIndex + 1)
      .filter((chunk): chunk is ReaderImageChunk => Boolean(chunk));
    if (!targetChunks.length) return;

    const runId = readerImageRunRef.current + 1;
    readerImageRunRef.current = runId;
    readerImageModeRef.current = true;
    imageRequestsRef.current.clear();
    setReaderImages({});
    setReaderImageMode(true);
    void Promise.all(targetChunks.map((chunk) => generateReaderImage(chunk, runId)));
  };

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
      const rows = (data ?? []) as BookRow[];
      const pending = readPendingBookDelete();
      setCatalogBooks(sortBooksByRecentActivity(pending ? rows.filter((row) => row.id !== pending.row.id) : rows));

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
            pendingDeleteRef.current = null;
            setPendingDelete(null);
            void permanentlyDeleteBook(pending.row).catch((deleteError) => {
              clearPendingBookDelete(pending.row.id);
              setNotice(deleteError instanceof Error ? deleteError.message : "Could not delete this book.");
              setCatalogBooks((items) => {
                if (items.some((item) => item.id === pending.row.id)) return items;
                return sortBooksByRecentActivity([...items, pending.row]);
              });
            });
          }, pending.deadline - Date.now());

          pendingDeleteRef.current = resumedPending;
          setPendingDelete(resumedPending);
        }
      }
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

  const loadReaderImageUsage = async () => {
    const { data, error } = await supabase
      .from("reader_image_usage")
      .select("generated_count, monthly_generated_count, monthly_period_start")
      .maybeSingle();

    if (error) return;

    if (isPro) {
      const currentMonthStart = new Date().toISOString().slice(0, 7) + "-01";
      setReaderImageCount(data?.monthly_period_start === currentMonthStart ? data?.monthly_generated_count ?? 0 : 0);
      return;
    }

    setReaderImageCount(data?.generated_count ?? 0);
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

  const handleNarrationRateChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.currentTarget.value);
    if (!Number.isFinite(value)) return;
    setNarrationRate(clampNarrationRate(value));
  };

  const chooseNarrationRate = (value: number) => {
    setNarrationRate(clampNarrationRate(value));
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

  const handleReaderParagraphEnter = (paragraphId: string) => {
    setHoveredReaderParagraphId((currentId) => (currentId === paragraphId ? currentId : paragraphId));
  };

  const handleReaderParagraphLeave = (paragraphId: string) => {
    setHoveredReaderParagraphId((currentId) => (currentId === paragraphId ? null : currentId));
  };

  const handlePdfWordClick = useCallback((pageNumber: number, pageWordIndex: number) => {
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
  }, [book, currentIndex]);

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
          <img src="/landing/logo.jpeg" alt="" aria-hidden="true" />
          <div>
            <span className="pro-comparison-kicker">Illume Pro</span>
            <h2 id="pro-comparison-title">Keep image mode alive.</h2>
            <p>Upgrade for 100 AI images every month and a calmer reading workflow as your library grows.</p>
          </div>
        </div>
        <div className="pro-usage-strip" aria-label="Current image usage">
          <span>{isPro ? `${readerImageCount} of ${PRO_READER_IMAGE_MONTHLY_LIMIT} Pro images used this month` : `${Math.min(readerImageCount, FREE_READER_IMAGE_LIFETIME_LIMIT)} of ${FREE_READER_IMAGE_LIFETIME_LIMIT} free images used`}</span>
          <div>
            <span style={{ width: `${Math.min(100, (readerImageCount / readerImageLimit) * 100)}%` }} />
          </div>
        </div>
        <div className="pro-plan-comparison" aria-label="Plan comparison">
          <div className="pro-plan-column free">
            <span className="pro-plan-label">Free</span>
            <strong>25</strong>
            <small>lifetime AI images</small>
            <p>Read, listen, upload EPUBs and PDFs, and try image mode in your private library.</p>
          </div>
          <div className="pro-plan-column pro">
            <span className="pro-plan-label">Pro</span>
            <strong>100</strong>
            <small>AI images per month</small>
            <p>Your Pro allowance refreshes monthly, with billing handled securely through Stripe.</p>
          </div>
        </div>
        <div className="pro-feature-lines">
          <p><Check size={17} aria-hidden="true" /> Synced library, narration, and reading progress</p>
          <p><Check size={17} aria-hidden="true" /> Private generated images stored with your books</p>
          <p><Check size={17} aria-hidden="true" /> Manage or cancel from your billing portal</p>
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

  const importDocumentFile = async (file: File, openAfterImport = true, pendingImportId?: string) => {
    if (!user) return;

    if (!isEpubFile(file) && !isPdfFile(file)) {
      throw new Error("Please select an EPUB or PDF file.");
    }

    if (storageUsed + file.size > USER_STORAGE_QUOTA_BYTES) {
      throw new Error(`This upload would exceed your ${formatBytes(USER_STORAGE_QUOTA_BYTES)} library limit.`);
    }

    const format = isPdfFile(file) ? "pdf" : "epub";
    const parsed = format === "pdf" ? await parsePdf(file) : await parseEpub(file);
    const embeddedCoverUrl = parsed.coverUrl ? await shrinkCoverDataUrl(parsed.coverUrl) : "";
    const coverUrl = embeddedCoverUrl || (format === "epub" ? await getOpenLibraryCoverUrl(parsed.title, parsed.author) : "");
    const id = crypto.randomUUID();
    const storagePath = `${user.id}/${id}/${safeFileName(file.name)}`;

    const upload = await supabase.storage.from(EPUB_BUCKET).upload(storagePath, file, {
      contentType: file.type || (format === "pdf" ? "application/pdf" : "application/epub+zip"),
      upsert: false
    });

    if (upload.error) {
      if (format === "pdf" && /mime type .*not supported/i.test(upload.error.message)) {
        throw new Error("PDF uploads are not enabled in Supabase Storage yet. Apply the PDF support migration so the epubs bucket allows application/pdf.");
      }
      throw upload.error;
    }

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
      mime_type: file.type || (format === "pdf" ? "application/pdf" : "application/epub+zip"),
      paragraph_count: parsed.paragraphs.length,
      chapter_count: parsed.chapters.length,
      current_index: 0,
      current_page: 1,
      last_opened_at: new Date().toISOString()
    };
    const { data, error } = await supabase.from("books").insert(newBook).select("*").single();

    if (error) {
      await supabase.storage.from(EPUB_BUCKET).remove([storagePath]);
      throw error;
    }

    const row = data as BookRow;
    parsedBooks.current.set(row.id, parsed);
    parsedBookFiles.current.set(row.id, file);
    void cacheBookFile(row, file);
    setCatalogBooks((items) => sortBooksByRecentActivity([row, ...items]));
    if (pendingImportId) {
      setPendingBookImports((items) => items.filter((item) => item.id !== pendingImportId));
    }
    if (openAfterImport) {
      openParsedBook(row, parsed, 0, file);
    }
  };

  const addClassicToLibrary = async (classic: ClassicBook) => {
    if (!user) return;
    stopAudio();
    setPlayback("idle");
    setNotice("");
    const pendingImportId = `classic-${classic.id}-${Date.now()}`;
    setPendingBookImports((items) => [
      {
        author: classic.author,
        coverUrl: classic.coverUrl,
        fileName: `${safeFileName(classic.title)}.epub`,
        id: pendingImportId,
        title: classic.title
      },
      ...items
    ]);
    setImportingClassicId(classic.id);

    try {
      const response = await fetch(classicDownloadUrl(classic.downloadUrl));
      if (!response.ok) throw new Error("Could not download ebook from Standard Ebooks.");

      const blob = await response.blob();
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
    const file = event.target.files?.[0];
    if (!file || !user) return;

    stopAudio();
    setPlayback("idle");
    setNotice("");
    const pendingImportId = `upload-${crypto.randomUUID()}`;
    const displayTitle = file.name.replace(/\.[^.]+$/, "").trim() || file.name;
    setPendingBookImports((items) => [
      {
        author: "Preparing document",
        coverUrl: null,
        fileName: file.name,
        id: pendingImportId,
        title: displayTitle
      },
      ...items
    ]);

    try {
      await importDocumentFile(file, false, pendingImportId);
    } catch (error) {
      setPendingBookImports((items) => items.filter((item) => item.id !== pendingImportId));
      setNotice(error instanceof Error ? error.message : "Could not upload this document.");
    } finally {
      event.target.value = "";
    }
  };

  const writeAppHistory = (state: AppHistoryState, mode: "push" | "replace" = "push") => {
    const nextUrl = `${window.location.pathname}${window.location.hash}`;
    if (mode === "replace") {
      window.history.replaceState(state, "", nextUrl);
      return;
    }
    window.history.pushState(state, "", nextUrl);
  };

  const openParsedBook = (
    row: BookRow,
    parsed: ReaderBook,
    targetIndex = row.current_index,
    file?: File,
    options: { updateHistory?: boolean } = {}
  ) => {
    const { updateHistory = true } = options;
    stopAudio();
    setPlayback("idle");
    setNotice("");
    readerImageRunRef.current += 1;
    readerImageModeRef.current = false;
    setReaderImageMode(false);
    setReaderImages({});
    imageRequestsRef.current.clear();
    const readerPreferences = readerPreferencesForBook(row.id);
    setReaderFontMode(readerPreferences.fontMode);
    setReaderThemeMode(readerPreferences.themeMode);
    setReaderTheme(readerPreferences.theme);
    setReaderTextScale(readerPreferences.textScale);
    setReaderLineHeight(readerPreferences.lineHeight);
    setReaderLineWidth(readerPreferences.lineWidth);
    setNarrationRate(readerPreferences.narrationRate);
    setActiveBookId(row.id);
    setBook(parsed);
    setActiveBookFile(file ?? null);
    setPdfReaderViewMode(parsed.format === "pdf" ? "pdf" : "text");
    const safeIndex = parsed.paragraphs.length ? Math.max(0, Math.min(targetIndex, parsed.paragraphs.length - 1)) : 0;
    const pageFromIndex = parsed.paragraphs[safeIndex]?.pageNumber ?? 1;
    const initialPage = Math.max(1, Math.min(row.current_page ?? pageFromIndex, parsed.pageCount ?? pageFromIndex));
    setPdfScrollOffsetRatio(0);
    setPdfScrollPage(initialPage);
    setPdfScrollRequest(0);
    setPdfVisibleOffsetRatio(0);
    setCurrentPage(initialPage);
    setCurrentIndex(safeIndex);
    pendingScrollIndex.current = parsed.paragraphs.length ? safeIndex : null;
    isInitialOpenRef.current = true;
    if (safeIndex > 0 || initialPage > 1) {
      setProgressNotice(true);
    }
    setView("reader");
    markBookOpened(row.id);
    if (updateHistory) writeAppHistory({ illumeView: "reader", bookId: row.id });
  };

  const openBook = async (row: BookRow, options: { updateHistory?: boolean } = {}) => {
    const cached = parsedBooks.current.get(row.id);
    const cachedFile = parsedBookFiles.current.get(row.id);
    if (cached && (cached.format !== "pdf" || cachedFile)) {
      openParsedBook(row, cached, undefined, cachedFile, options);
      return;
    }

    setBusy(true);
    setNotice("");

    try {
      let file = await getCachedBookFile(row);

      if (!file) {
        const { data, error } = await supabase.storage.from(EPUB_BUCKET).download(row.storage_path);
        if (error) throw error;
        file = new File([data], row.file_name, { type: row.mime_type || (bookFormat(row) === "pdf" ? "application/pdf" : "application/epub+zip") });
        void cacheBookFile(row, file);
      }

      const format = bookFormat(row);
      const parsed = format === "pdf" ? await parsePdf(file) : await parseEpub(file);
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
      openParsedBook(row, parsed, undefined, file, options);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open this book.");
    } finally {
      setBusy(false);
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
    pendingDeleteRef.current = null;
    clearPendingBookDelete(pending.row.id);
    setPendingDelete(null);
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
      const previousRow = pendingDeleteRef.current.row;
      pendingDeleteRef.current = null;
      setPendingDelete(null);
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
      setActiveBookFile(null);
      setActiveBookId("");
      setView("catalog");
    }

    pending.timer = window.setTimeout(() => {
      if (pendingDeleteRef.current?.row.id !== row.id) return;
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      void permanentlyDeleteBook(row).catch((error) => {
        setNotice(error instanceof Error ? error.message : "Could not delete this book.");
        clearPendingBookDelete(row.id);
        setCatalogBooks((items) => {
          if (items.some((item) => item.id === pending.row.id)) return items;
          return sortBooksByRecentActivity([...items, pending.row]);
        });
      });
    }, DELETE_UNDO_TIMEOUT_MS);

    pendingDeleteRef.current = pending;
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

    if (!current) return;
    stopAudio();
    setPlayback("playing");
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

    setProgressNotice(false);

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
    stopAudio();
    setPlayback("idle");
    setProgressNotice(false);
    if (activeBookId && book) void saveReadingProgress(activeBookId, currentIndex, currentPage);
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
    if (playback === "playing" || playback === "paused") return;
    if (!surface) return;
    if (readingScrollFrame.current !== null) return;

    readingScrollFrame.current = window.requestAnimationFrame(() => {
      readingScrollFrame.current = null;

      const nextBook = book;
      const viewportTop = surface.getBoundingClientRect().top + 72;
      let closestIndex = currentIndex;
      let closestDistance = Number.POSITIVE_INFINITY;

      for (let index = 0; index < nextBook.paragraphs.length; index++) {
        const paragraph = nextBook.paragraphs[index];
        const node = paragraphRefs.current.get(paragraph.id);
        if (!node) continue;

        const bounds = node.getBoundingClientRect();
        if (bounds.bottom < viewportTop - 320) continue;
        if (bounds.top > viewportTop + 320) break;

        const distance = Math.abs(bounds.top - viewportTop);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      }

      if (closestIndex !== currentIndex) setCurrentIndex(closestIndex);
    });
  };

  const setParagraphRef = (id: string) => (node: HTMLElement | null) => {
    if (node) {
      paragraphRefs.current.set(id, node);

      const targetIndex = pendingScrollIndex.current;
      if (targetIndex !== null && book) {
        const target = book.paragraphs[targetIndex];
        if (target && target.id === id) {
          pendingScrollIndex.current = null;
          if (isInitialOpenRef.current || isInstantScrollRef.current) {
            node.scrollIntoView({ block: "start", behavior: "auto" });
            isInitialOpenRef.current = false;
            isInstantScrollRef.current = false;
          } else {
            node.scrollIntoView({ block: "start", behavior: "smooth" });
          }
        }
      }
    } else {
      paragraphRefs.current.delete(id);
    }
  };

  const renderReaderText = (paragraph: ReaderParagraph, shouldRenderWords: boolean) => {
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

  const renderGeneratedReaderImage = useCallback((chunk: ReaderImageChunk) => {
    const image = readerImages[chunk.index];
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
            src={image.src}
          />
        ) : (
          <div
            className={[
              "reader-generated-placeholder",
              image?.status === "error" ? "error" : "",
              isLimit ? "limit" : ""
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {image?.status === "loading" ? (
              <Loader2 className="spin" size={22} aria-hidden="true" />
            ) : image?.status === "error" ? (
              <Crown size={22} aria-hidden="true" />
            ) : (
              <ImageIcon size={22} aria-hidden="true" />
            )}
            <span>{image?.status === "error" ? image.error ?? "Image failed" : "Generating image"}</span>
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
  }, [readerImages]);

  const renderPdfPageReaderImage = useCallback((pageNumber: number) => {
    if (!readerImageMode || !isPdfBook) return null;

    const chunk = readerImageChunkByIndex.get(pageNumber - 1);
    if (!chunk || (!visibleReaderImageIndexes.has(chunk.index) && !readerImages[chunk.index])) return null;

    return renderGeneratedReaderImage(chunk);
  }, [isPdfBook, readerImageChunkByIndex, readerImageMode, readerImages, renderGeneratedReaderImage, visibleReaderImageIndexes]);

  const renderReaderImageStage = () => {
    const chunk = activeReaderImageChunk;
    const image = chunk ? readerImages[chunk.index] : undefined;
    const isLimit = Boolean(image?.limitReached);

    return (
      <aside className="reader-image-stage" aria-label="Current generated image">
        <div className="reader-image-hero" key={chunk?.index ?? "empty"}>
          {image?.status === "ready" && image.src ? (
            <img alt={`Generated visual for words ${chunk?.startWord} to ${chunk?.endWord}`} src={image.src} />
          ) : (
            <div
              className={[
                "reader-image-hero-placeholder",
                image?.status === "error" ? "error" : "",
                isLimit ? "limit" : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {image?.status === "error" ? (
                <Crown size={34} aria-hidden="true" />
              ) : (
                <Loader2 className="spin" size={34} aria-hidden="true" />
              )}
              <span>{image?.status === "error" ? image.error ?? "Image failed" : "Building the scene"}</span>
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
      <section
        className={className}
        aria-live="polite"
        onScroll={handleReadingScroll}
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
            const shouldRenderWords = isActive || isSpeaking || hoveredReaderParagraphId === paragraph.id;

            return (
              <div className="reader-block" key={paragraph.id}>
                {!readerImageMode && readerImageInsertions.get(index)?.map((chunk) => renderGeneratedReaderImage(chunk))}
                {showChapterHeading && !isChapterHeading && (
                  <h2 className="reader-chapter-title">{paragraph.chapterTitle}</h2>
                )}
                {paragraph.kind === "image" && paragraph.image ? (
                  <figure
                    className={["reader-image", isActive ? "active" : ""].filter(Boolean).join(" ")}
                    onClick={() => moveTo(index)}
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
                    onClick={(e) => handleParagraphClick(e, paragraph, index)}
                    onPointerEnter={() => handleReaderParagraphEnter(paragraph.id)}
                    onPointerLeave={() => handleReaderParagraphLeave(paragraph.id)}
                    ref={setParagraphRef(paragraph.id)}
                  >
                    {renderReaderText(paragraph, shouldRenderWords)}
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
                    onClick={(e) => handleParagraphClick(e, paragraph, index)}
                    onPointerEnter={() => handleReaderParagraphEnter(paragraph.id)}
                    onPointerLeave={() => handleReaderParagraphLeave(paragraph.id)}
                    ref={setParagraphRef(paragraph.id)}
                  >
                    {renderReaderText(paragraph, shouldRenderWords)}
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
                    onClick={(e) => handleParagraphClick(e, paragraph, index)}
                    onPointerEnter={() => handleReaderParagraphEnter(paragraph.id)}
                    onPointerLeave={() => handleReaderParagraphLeave(paragraph.id)}
                    ref={setParagraphRef(paragraph.id)}
                  >
                    {renderReaderText(paragraph, shouldRenderWords)}
                  </p>
                )}
              </div>
            );
          })}
        </article>
      ) : (
        <div className="pdf-text-empty">
          <FileText size={30} aria-hidden="true" />
          <span>No selectable text was found in this PDF.</span>
        </div>
        )}
      </section>
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

  if (authLoading) {
    return (
      <main className="auth-shell">
        <Loader2 className="spin" size={28} aria-hidden="true" />
      </main>
    );
  }

  if (isReaderDashboard) {
    return (
      <ReaderDashboard
        busy={busy || dashboardLoading}
        data={dashboardData}
        error={dashboardError}
        onRefresh={() => void loadReaderDashboard()}
        onSignInWithGoogle={() => void signInWithGoogle()}
        onSignOut={() => void signOut()}
        session={session}
      />
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
      />
    );
  }

  if (view === "catalog") {
    return (
      <main className="app-shell catalog-shell">
        <header className="topbar catalog-topbar" style={{ position: "relative" }}>
          <div className="catalog-storage-summary">
            <div className="library-brand-mark" aria-label={`illume ${isPro ? "Pro" : "Free"}`}>
              <img src="/landing/logo.jpeg" alt="" aria-hidden="true" />
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
              <input disabled={isBookImporting} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} onChange={handleCatalogUpload} />
            </label>
            
            <div className="profile-button-wrapper" style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <button 
                className="profile-avatar-btn" 
                onClick={() => setProfileOpen(!profileOpen)} 
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
                      <div className="profile-user-info">
                        <div className="profile-popover-avatar">
                          {user?.user_metadata?.avatar_url || user?.user_metadata?.picture ? (
                            <img 
                              src={user.user_metadata.avatar_url || user.user_metadata.picture} 
                              alt="Profile" 
                            />
                          ) : (
                            <span>{user?.email?.[0].toUpperCase() ?? "U"}</span>
                          )}
                        </div>
                        <div className="profile-user-details">
                          <span className="profile-name">
                            {user?.user_metadata?.full_name || user?.user_metadata?.name || "Reader User"}
                          </span>
                          <span className="profile-email">{user?.email}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="profile-popover-body">
                      {/* Plan Status */}
                      <div className="profile-section">
                        <div className="profile-plan-badge-wrapper">
                          <span className={`profile-plan-badge ${isPro ? "pro" : "free"}`}>
                            {isPro ? <Crown size={14} aria-hidden="true" /> : <CreditCard size={14} aria-hidden="true" />}
                            <span>{isPro ? "Pro Plan" : "Free Plan"}</span>
                          </span>
                          <small className="plan-price-label">
                            {isPro ? "100 AI images included every month" : "25 lifetime AI images included"}
                          </small>
                        </div>
                      </div>

                      {/* Storage and Usage stats */}
                      <div className="profile-section">
                        <span className="profile-section-label">Usage &amp; Quotas</span>
                        
                        <div className="profile-usage-item">
                          <div className="profile-usage-header">
                            <span>Storage</span>
                            <span>{formatBytes(storageUsed)} of {formatBytes(USER_STORAGE_QUOTA_BYTES)}</span>
                          </div>
                          <div className="profile-progress-bar">
                            <div 
                              className="profile-progress-fill" 
                              style={{ width: `${Math.min(100, (storageUsed / USER_STORAGE_QUOTA_BYTES) * 100)}%` }} 
                            />
                          </div>
                        </div>

                        <div className="profile-usage-item">
                          <div className="profile-usage-header">
                            <span>AI Images</span>
                            <span>{readerImageUsageLabel}</span>
                          </div>
                          <div className="profile-progress-bar">
                            <div 
                              className="profile-progress-fill" 
                              style={{ width: `${Math.min(100, (readerImageCount / readerImageLimit) * 100)}%` }} 
                            />
                          </div>
                        </div>
                      </div>

                      {/* Billing Action Buttons */}
                      <div className="profile-section billing-actions-section">
                        {!isPro && (
                          <button className="primary-button upgrade-btn" disabled={busy} onClick={() => { setProfileOpen(false); setReaderImageUpgradeOpen(true); }} type="button">
                            <Crown size={15} aria-hidden="true" />
                            <span>Upgrade to Pro</span>
                          </button>
                        )}
                        {billingProfile?.stripe_customer_id && (
                          <button className="secondary-button manage-btn" disabled={busy} onClick={() => { setProfileOpen(false); void openBillingPortal(); }} type="button">
                            <Settings size={15} aria-hidden="true" />
                            <span>Manage billing</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="profile-popover-footer">
                      <button className="signout-btn" onClick={() => { setProfileOpen(false); void signOut(); }} type="button">
                        <LogOut size={15} aria-hidden="true" />
                        <span>Sign Out</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {pendingDelete && (
          <div className="undo-delete-toast" role="status" aria-live="polite">
            <span>{pendingDelete.row.title} deleted</span>
            <button type="button" onClick={restorePendingDelete}>
              Undo
            </button>
          </div>
        )}

        <section className="catalog-view" aria-label="Book library">
          <div className="catalog-books-section">
            <div className="catalog-header">
              <h1>Books</h1>
              <label className="catalog-heading-upload" title="Upload document">
                {isBookImporting ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Upload size={14} aria-hidden="true" />}
                <span>Upload</span>
                <input disabled={isBookImporting} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} onChange={handleCatalogUpload} />
              </label>
            </div>
            <div className="catalog-list">
              {catalogBooks.length || pendingBookImports.length ? (
                <>
                {pendingBookImports.map((pendingImport) => (
                  <div className="catalog-book catalog-book-pending" key={pendingImport.id} aria-busy="true">
                    <div className="catalog-book-open" role="status" aria-label={`${pendingImport.title} is being added`}>
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
                      <span className="catalog-book-copy">
                        <strong>{pendingImport.title}</strong>
                        <small>{pendingImport.author || pendingImport.fileName}</small>
                      </span>
                      <span className="catalog-import-progress" aria-hidden="true">
                        <Loader2 className="spin" size={20} />
                      </span>
                    </div>
                  </div>
                ))}
                {catalogBooks.map((catalogBook) => (
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
                      <BookCover book={catalogBook} />
                      <span className="catalog-book-copy">
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
                ))}
                </>
              ) : (
                <div className="empty-library-container">
                  <BookOpen size={28} aria-hidden="true" className="empty-icon" />
                  <h2>No books yet</h2>
                  <p>Upload an EPUB or PDF, or browse the classics below to get started.</p>
                  <label className="empty-upload-btn" title="Upload document">
                    {isBookImporting ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
                    <span>Upload</span>
                    <input disabled={isBookImporting} type="file" accept={DOCUMENT_UPLOAD_ACCEPT} onChange={handleCatalogUpload} />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Explore Classics Section */}
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
        </section>

        {notice && <div className="notice">{notice}</div>}
        {readerImageUpgradeOpen && renderProComparison()}
      </main>
    );
  }

  if (!book) return null;

  return (
    <main
      className={["app-shell reader-themed-shell", immersiveReaderImageMode ? "image-reader-shell" : ""].filter(Boolean).join(" ")}
      data-reader-mode={readerThemeMode}
      data-reader-theme={readerTheme}
    >
      <header className={immersiveReaderImageMode ? "topbar image-topbar" : "topbar"} style={{ position: "relative" }}>
        <button className="top-icon" type="button" title="Back to library" onClick={() => openCatalog()}>
          <ChevronLeft size={22} aria-hidden="true" />
        </button>
        <div className="top-title">{book.title}</div>
        <div className="settings-button-wrapper" style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <button
            aria-expanded={settingsOpen}
            className="top-icon typography-trigger"
            onClick={() => {
              setSettingsOpen(!settingsOpen);
              setReaderMenuOpen(null);
            }}
            title="Typography"
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
                  <div className="settings-section typography-settings-section" aria-label="Typography settings">
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
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

      {returnPoint && (
        <div className="reader-back-anchor">
          <button className="reader-back-button" onClick={goBackToReturnPoint} type="button">
            <ChevronLeft size={15} aria-hidden="true" />
            <span>Back</span>
          </button>
        </div>
      )}

      <section className={[immersiveReaderImageMode ? "reader-frame image-mode-frame" : "reader-frame", isPdfBook ? "pdf-reader-frame" : ""].filter(Boolean).join(" ")}>
        <aside className="chapter-sidebar">
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
                    {progressNotice && isActive && (
                      <span className="toc-progress-notice">
                        Continuing where you left off
                      </span>
                    )}
                  </div>
                );
              })
            ) : (
              <span className="chapter-empty">{isPdfBook ? "No table of contents found." : "No chapters found."}</span>
            )}
          </nav>
        </aside>

        <div className={[
          immersiveReaderImageMode ? "main-spread reader-only image-mode" : "main-spread reader-only",
          isPdfBook ? `pdf-reader-main pdf-reader-${pdfReaderViewMode} pdf-layout-${pdfPageLayout}` : ""
        ].filter(Boolean).join(" ")}>
          {immersiveReaderImageMode && renderReaderImageStage()}
          {isPdfBook ? (
            <PdfDocumentView
              currentPage={currentPage}
              file={activeBookFile}
              onPageChange={moveToPdfPage}
              pageCount={pdfPageCount}
              paragraphs={book.paragraphs}
              scrollOffsetRatio={pdfScrollOffsetRatio}
              scrollPage={pdfScrollPage}
              scrollRequest={pdfScrollRequest}
              renderPageImage={renderPdfPageReaderImage}
              speechHighlight={speechHighlight}
              pdfPageLayout={pdfPageLayout}
              onWordClick={handlePdfWordClick}
            />
          ) : (
            renderTextReadingSurface()
          )}
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
              onClick={() => setSpeedPopoverOpen((open) => !open)}
              title="Narration speed"
              type="button"
            >
              {formatNarrationRate(narrationRate)}
            </button>
            {speedPopoverOpen && (
              <div className="narration-speed-popover" role="dialog" aria-label="Narration speed">
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
                <input
                  aria-label="Narration speed"
                  max={NARRATION_RATE_MAX}
                  min={NARRATION_RATE_MIN}
                  onChange={handleNarrationRateChange}
                  step="0.05"
                  type="range"
                  value={narrationRate}
                />
                <strong>{formatNarrationRate(narrationRate)}</strong>
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
              <button
                className="secondary-button image-style-button"
                onClick={() => setReaderImageStyleOpen(true)}
                title="Choose image style"
                type="button"
              >
                <Palette size={16} aria-hidden="true" />
                <span>Styles</span>
              </button>
            )}
          </div>
        </div>
      </footer>

      {notice && <div className="notice">{notice}</div>}

      {readerImageStyleOpen && (
        <div className="image-style-modal-overlay" role="presentation" onClick={() => setReaderImageStyleOpen(false)}>
          <section
            aria-labelledby="image-style-title"
            aria-modal="true"
            className="image-style-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <button className="image-style-close" onClick={() => setReaderImageStyleOpen(false)} title="Close" type="button">
              <X size={18} aria-hidden="true" />
            </button>
            <div className="image-style-copy">
              <span className="image-style-kicker">Image mode</span>
              <h2 id="image-style-title">Styles</h2>
            </div>
            <div className="image-style-options">
              {READER_IMAGE_STYLES.map((style) => (
                <button
                  className={readerImageStyle === style.id ? "image-style-option active" : "image-style-option"}
                  key={style.id}
                  onClick={() => selectReaderImageStyle(style.id)}
                  type="button"
                >
                  <span>
                    <strong>{style.label}</strong>
                    <small>{style.summary}</small>
                  </span>
                  {readerImageStyle === style.id && <Check size={17} aria-hidden="true" />}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {readerImageUpgradeOpen && renderProComparison()}


    </main>
  );
}

export default App;
