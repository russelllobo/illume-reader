// Port of Sources/IllumeCore/Parsing.swift + ReaderState.swift
import type { BookRow, PdfTocEntry, BookPage, ReaderBook, ReaderParagraph, BillingProfile, ReaderImageUsage } from './types';

export function normaliseSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function stripTags(html: string): string {
  return normaliseSpace(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

function capture(text: string, pattern: string): string {
  const m = new RegExp(pattern, 'is').exec(text);
  return m?.[1] ?? '';
}

function fallbackTitle(fileName: string): string {
  return fileName
    .replace(/\.(epub|pdf)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

export function epubMetadata(opfXML: string, fileName: string): ReaderBook {
  const rawTitle = capture(opfXML, '<[^>]*title[^>]*>(.*?)</[^>]*title>');
  const rawCreator = capture(opfXML, '<[^>]*creator[^>]*>(.*?)</[^>]*creator>');
  const title = stripTags(rawTitle);
  return {
    title: title === '' ? fallbackTitle(fileName) : title,
    author: stripTags(rawCreator),
    fileName,
    format: 'epub',
    chapterPageNumbers: [],
    chapterPageOffsets: [],
    paragraphs: [],
    chapters: [],
  };
}

export function epubParagraphsFromHTML(html: string, chapterTitle = 'Chapter'): ReaderParagraph[] {
  const pattern = /<(h[1-6]|p|li|blockquote)\b[^>]*>(.*?)<\/\1>/gis;
  const out: ReaderParagraph[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const text = stripTags(match[2]);
    const kind: ReaderParagraph['kind'] =
      tag.startsWith('h') ? 'heading' : tag === 'li' ? 'list' : tag === 'blockquote' ? 'quote' : 'paragraph';
    if (kind === 'heading' ? text === '' : text.length <= 35) continue;
    out.push({ id: `epub-${index}`, chapterIndex: 0, chapterTitle, kind, text });
    index += 1;
  }
  return out;
}

export function pdfReaderBook(opts: {
  title: string;
  author?: string;
  fileName: string;
  pageCount: number;
  toc: PdfTocEntry[];
  pages: BookPage[];
}): ReaderBook {
  const { title, author = '', fileName, pageCount, toc, pages } = opts;
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const chapters = toc.map((t) => t.title);
  const paragraphs: ReaderParagraph[] = [];
  for (const page of sorted) {
    const chapterIndex = chapterIndexForPage(page.pageNumber, toc);
    const chapterTitle = toc[chapterIndex]?.title ?? title;
    const chunks = splitPageText(page.text);
    chunks.forEach((text, offset) => {
      paragraphs.push({
        id: `pdf-${page.pageNumber}-${offset}`,
        chapterIndex,
        chapterTitle,
        kind: 'paragraph',
        pageNumber: page.pageNumber,
        text,
      });
    });
  }
  return {
    title,
    author,
    fileName,
    format: 'pdf',
    pageCount,
    chapterPageNumbers: toc.map((t) => t.pageNumber),
    chapterPageOffsets: toc.map((t) => t.pageOffsetRatio),
    paragraphs,
    chapters,
  };
}

export function chapterIndexForPage(pageNumber: number, toc: PdfTocEntry[]): number {
  if (toc.length === 0) return 0;
  let index = 0;
  toc.forEach((entry, i) => {
    if (entry.pageNumber <= pageNumber) index = i;
  });
  return index;
}

export function splitPageText(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map(normaliseSpace)
    .filter((t) => t.length > 35);
}

// --- ReaderState ports ---
export const FREE_READER_IMAGE_LIFETIME_LIMIT = 25;
export const PRO_READER_IMAGE_MONTHLY_LIMIT = 1000;
export const DEFAULT_USER_STORAGE_QUOTA_BYTES = 104_857_600;
export const APPLE_PRODUCT_ID = 'illume.pro.monthly';

export function libraryByRecentActivity(books: BookRow[]): BookRow[] {
  return [...books].sort((a, b) => {
    const la = a.lastOpenedAt ?? a.createdAt;
    const lb = b.lastOpenedAt ?? b.createdAt;
    if (la !== lb) return la < lb ? 1 : -1;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}

export function hasProAccess(profile: BillingProfile | null, now = new Date()): boolean {
  if (!profile) return false;
  if (profile.plan === 'pro' && ['active', 'trialing'].includes(profile.status)) {
    if (profile.currentPeriodEnd) return new Date(profile.currentPeriodEnd) > now || profile.cancelAtPeriodEnd;
    return true;
  }
  if (
    profile.appleProductId === APPLE_PRODUCT_ID &&
    !profile.appleRevocationDate &&
    profile.appleExpiresAt &&
    new Date(profile.appleExpiresAt) > now
  ) {
    return true;
  }
  return false;
}

export function imageLimit(isPro: boolean): number {
  return isPro ? PRO_READER_IMAGE_MONTHLY_LIMIT : FREE_READER_IMAGE_LIFETIME_LIMIT;
}

// --- Supabase row mapping ---
// PostgREST returns snake_case columns; the app model is camelCase.
// Every loader normalizes at the boundary so one malformed row can never
// crash a render (e.g. undefined.toUpperCase() in the library list).
const snakeToCamel = (key: string): string =>
  key.replace(/_([a-z])/g, (_m: string, c: string) => c.toUpperCase());

export function camelCaseKeys<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelCaseKeys(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[snakeToCamel(k)] = camelCaseKeys(v);
    }
    return out as T;
  }
  return value as T;
}

export function imageUsageCount(usage: ReaderImageUsage | null, rowCount: number, isPro: boolean): number {
  if (!usage) return rowCount;
  // The live table has no monthly_* columns yet; default missing counts to 0 (never NaN).
  if (isPro) return Math.max(usage.monthlyGeneratedCount ?? 0, rowCount);
  return Math.max(usage.generatedCount ?? 0, rowCount);
}

export function safeDocumentFileName(name: string, type: 'epub' | 'pdf'): string {
  const fallback = type === 'pdf' ? 'document.pdf' : 'book.epub';
  const stem =
    name.split('/').pop()?.trim() || fallback;
  const sanitized = stem
    .replace(/[^\w.\- ]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  const ext = type === 'pdf' ? 'pdf' : 'epub';
  const base = sanitized.replace(/\.(epub|pdf)$/i, '').replace(/^[.-]+|[.-]+$/g, '') || fallback.replace(`.${ext}`, '');
  return `${base}.${ext}`;
}

export function documentPath(userId: string, bookId: string, originalFileName: string, type: 'epub' | 'pdf'): string {
  return `${userId.toLowerCase()}/${bookId.toLowerCase()}/${safeDocumentFileName(originalFileName, type)}`;
}
