import { describe, test, expect } from '@jest/globals';
import {
  camelCaseKeys,
  libraryByRecentActivity,
  imageUsageCount,
} from '../src/lib';
import type { BookRow, BillingProfile } from '../src/types';

// Shape straight from the live PostgREST API (snake_case).
const liveRow = {
  id: 'book-1',
  user_id: 'user-1',
  title: 'Dune',
  author: 'Frank Herbert',
  cover_url: null,
  document_type: 'pdf',
  storage_path: 'user-1/book-1.pdf',
  file_name: 'dune.pdf',
  file_size: 123456,
  mime_type: 'application/pdf',
  page_count: 412,
  paragraph_count: 0,
  chapter_count: 0,
  pdf_page_metrics: [],
  pdf_toc: [{ level: 0, pageNumber: 1, pageOffsetRatio: 0, title: 'Start' }],
  processing_status: 'ready',
  processing_error: null,
  current_index: 0,
  current_page: 1,
  last_opened_at: null,
  created_at: '2026-09-27T00:00:00Z',
  updated_at: '2026-09-27T00:00:00Z',
};

describe('supabase row mapping (live backend shape)', () => {
  test('raw row misses camelCase keys (the old crash)', () => {
    const raw = liveRow as unknown as BookRow;
    expect(raw.documentType).toBeUndefined();
    expect(() => (raw.documentType as unknown as string).toUpperCase()).toThrow();
    // Guarded badge path never throws, even un-normalized:
    expect((raw.documentType ?? 'epub').toUpperCase()).toBe('EPUB');
  });

  test('camelCaseKeys normalizes rows, keeps nested toc', () => {
    const row = camelCaseKeys<BookRow>(liveRow);
    expect(row.documentType).toBe('pdf');
    expect(row.fileSize).toBe(123456);
    expect(row.storagePath).toBe('user-1/book-1.pdf');
    expect(row.currentIndex).toBe(0);
    expect(row.pdfToc).toEqual([{ level: 0, pageNumber: 1, pageOffsetRatio: 0, title: 'Start' }]);
    expect((row.documentType ?? 'epub').toUpperCase()).toBe('PDF');
  });

  test('library sort works on normalized rows', () => {
    const rows = camelCaseKeys<BookRow[]>([liveRow]);
    expect(() => libraryByRecentActivity(rows)).not.toThrow();
    expect(libraryByRecentActivity(rows)).toHaveLength(1);
  });

  test('billing profile normalizes; pro check stays false-safe', () => {
    const profile = camelCaseKeys<BillingProfile>({
      user_id: 'user-1',
      plan: 'free',
      status: 'inactive',
      cancel_at_period_end: false,
    });
    expect(profile.plan).toBe('free');
    expect(profile.cancelAtPeriodEnd).toBe(false);
  });

  test('image usage without monthly columns never yields NaN', () => {
    const usage = camelCaseKeys<{ generatedCount: number }>({
      user_id: 'user-1',
      generated_count: 7,
    });
    expect(imageUsageCount({ ...usage, monthlyGeneratedCount: 0 } as never, 0, false)).toBe(7);
    expect(imageUsageCount({ generatedCount: 0 } as never, 0, true)).toBe(0);
    expect(Number.isNaN(imageUsageCount({} as never, 0, false))).toBe(false);
  });
});
