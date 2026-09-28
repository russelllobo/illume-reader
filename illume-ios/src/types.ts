// Port of Sources/IllumeCore/Models.swift
export type DocumentType = 'epub' | 'pdf';
export type ProcessingStatus = 'ready' | 'queued' | 'processing' | 'processed' | 'failed';
export type ReaderImageStyle = 'cartoon' | 'cute';

export interface PdfTocEntry {
  pageNumber: number;
  pageOffsetRatio: number;
  title: string;
}

export interface PdfPageMetric {
  height: number;
  width: number;
}

export interface BookRow {
  id: string;
  userId: string;
  title: string;
  author: string;
  coverUrl?: string | null;
  documentType: DocumentType;
  storagePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  pageCount?: number | null;
  paragraphCount: number;
  chapterCount: number;
  pdfPageMetrics: PdfPageMetric[];
  pdfToc: PdfTocEntry[];
  processingStatus: ProcessingStatus;
  processingError?: string | null;
  currentIndex: number;
  currentPage?: number | null;
  lastOpenedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookPage {
  id?: string | null;
  bookId: string;
  userId: string;
  pageNumber: number;
  text: string;
  wordCount: number;
}

export interface BillingProfile {
  userId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
  plan: string;
  status: string;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd: boolean;
  appleOriginalTransactionId?: string | null;
  appleProductId?: string | null;
  appleEnvironment?: string | null;
  appleExpiresAt?: string | null;
  appleRevocationDate?: string | null;
}

export interface ReaderImageUsage {
  userId?: string | null;
  generatedCount: number;
  monthlyGeneratedCount: number;
  monthlyPeriodStart?: string | null;
}

export type ReaderParagraphKind = 'heading' | 'paragraph' | 'quote' | 'list' | 'image';

export interface ReaderParagraph {
  id: string;
  chapterIndex: number;
  chapterTitle: string;
  kind: ReaderParagraphKind;
  pageNumber?: number | null;
  text: string;
}

export interface ReaderBook {
  title: string;
  author: string;
  coverUrl?: string | null;
  fileName?: string | null;
  format: DocumentType;
  pageCount?: number | null;
  chapterPageNumbers: number[];
  chapterPageOffsets: number[];
  paragraphs: ReaderParagraph[];
  chapters: string[];
}

export interface AuthUser {
  id: string;
  email?: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  tokenType?: string | null;
  user: AuthUser;
}

export interface ReaderImageFunctionResponse {
  imageUrl?: string | null;
  prompt?: string | null;
  imageCount?: number | null;
  imageLimit?: number | null;
  limitReached?: boolean | null;
  plan?: string | null;
}

export type ReaderThemeChoice = 'Paper' | 'Night' | 'Mint';

export interface ReaderSettings {
  theme: ReaderThemeChoice;
  textScale: number;
  lineHeight: number;
  lineWidth: number;
  narrationRate: number;
  imageStyle: ReaderImageStyle;
}

export const defaultReaderSettings: ReaderSettings = {
  theme: 'Paper',
  textScale: 1.05,
  lineHeight: 1.55,
  lineWidth: 42,
  narrationRate: 0.52,
  imageStyle: 'cartoon',
};
