import Foundation
import Testing
@testable import IllumeCore

@Test func decodesBookRowsFromSupabaseSnakeCase() throws {
    let json = """
    {
      "id": "4F6B7E1A-1E7D-4C8E-B9D2-157A7F23D5BE",
      "user_id": "65F14940-3328-4D38-8947-B3A8D5F5C3C6",
      "title": "Pride and Prejudice",
      "author": "Jane Austen",
      "cover_url": "https://example.com/cover.jpg",
      "document_type": "epub",
      "storage_path": "user/book/pride.epub",
      "file_name": "pride.epub",
      "file_size": 42,
      "mime_type": "application/epub+zip",
      "page_count": null,
      "paragraph_count": 100,
      "chapter_count": 12,
      "pdf_page_metrics": [],
      "pdf_toc": [],
      "processing_status": "ready",
      "processing_error": null,
      "current_index": 7,
      "current_page": 3,
      "last_opened_at": "2026-05-26T10:15:30Z",
      "created_at": "2026-05-25T10:15:30Z",
      "updated_at": "2026-05-26T10:15:30Z"
    }
    """.data(using: .utf8)!

    let book = try IllumeJSON.decoder().decode(BookRow.self, from: json)

    #expect(book.title == "Pride and Prejudice")
    #expect(book.userId.uuidString == "65F14940-3328-4D38-8947-B3A8D5F5C3C6")
    #expect(book.documentType == .epub)
    #expect(book.currentIndex == 7)
    #expect(book.currentPage == 3)
}

@Test func decodesBookRowsWithNullableServerDefaults() throws {
    let json = """
    {
      "id": "4F6B7E1A-1E7D-4C8E-B9D2-157A7F23D5BE",
      "user_id": "65F14940-3328-4D38-8947-B3A8D5F5C3C6",
      "title": "Older Import",
      "author": null,
      "document_type": "PDF",
      "storage_path": "user/book/older.pdf",
      "file_name": "older.pdf",
      "file_size": "42",
      "mime_type": null,
      "page_count": "12",
      "paragraph_count": null,
      "chapter_count": null,
      "pdf_page_metrics": null,
      "pdf_toc": "[{\\"page_number\\":1,\\"page_offset_ratio\\":0,\\"title\\":\\"Start\\"}]",
      "processing_status": null,
      "current_index": null,
      "current_page": null,
      "created_at": "2026-05-25T10:15:30Z",
      "updated_at": "2026-05-26T10:15:30Z"
    }
    """.data(using: .utf8)!

    let book = try IllumeJSON.decoder().decode(BookRow.self, from: json)

    #expect(book.author == "")
    #expect(book.documentType == .pdf)
    #expect(book.fileSize == 42)
    #expect(book.mimeType == "application/pdf")
    #expect(book.pageCount == 12)
    #expect(book.paragraphCount == 0)
    #expect(book.pdfPageMetrics.isEmpty)
    #expect(book.pdfToc == [PdfTocEntry(pageNumber: 1, pageOffsetRatio: 0, title: "Start")])
    #expect(book.processingStatus == .ready)
    #expect(book.currentIndex == 0)
    #expect(book.currentPage == nil)
}

@Test func progressPayloadClampsNegativeValues() {
    let date = Date(timeIntervalSince1970: 100)
    let progress = ReadingProgress(currentIndex: -5, currentPage: 0, lastOpenedAt: date)
    let payload = ReadingProgressPayload(progress)

    #expect(payload.currentIndex == 0)
    #expect(payload.currentPage == 1)
    #expect(payload.lastOpenedAt == date)
}

@Test func storagePathsMatchBackendFolderShape() {
    let userId = UUID(uuidString: "65F14940-3328-4D38-8947-B3A8D5F5C3C6")!
    let bookId = UUID(uuidString: "4F6B7E1A-1E7D-4C8E-B9D2-157A7F23D5BE")!

    let documentPath = StoragePath.documentPath(
        userId: userId,
        bookId: bookId,
        originalFileName: "My Book!!.PDF",
        type: .pdf
    )
    let imagePath = StoragePath.readerImagePath(
        userId: userId,
        bookId: bookId,
        style: .cute,
        startWord: 10,
        endWord: 40
    )

    #expect(documentPath == "65f14940-3328-4d38-8947-b3a8d5f5c3c6/4f6b7e1a-1e7d-4c8e-b9d2-157a7f23d5be/My-Book.pdf")
    #expect(imagePath == "65f14940-3328-4d38-8947-b3a8d5f5c3c6/4f6b7e1a-1e7d-4c8e-b9d2-157a7f23d5be/cute/10-40.webp")
}

@Test func epubMetadataAndParagraphExtractionWorksForFixtures() {
    let opf = """
    <package>
      <metadata>
        <dc:title>The Great Test</dc:title>
        <dc:creator>Example Author</dc:creator>
      </metadata>
    </package>
    """
    let html = """
    <html><body>
      <h1>Opening</h1>
      <p>This is a sufficiently long paragraph that should become a reader paragraph.</p>
      <p>Too short.</p>
      <blockquote>This quoted paragraph is long enough to be preserved by the extractor.</blockquote>
    </body></html>
    """

    let metadata = EpubMetadataExtractor.metadata(opfXML: opf, fileName: "fallback-title.epub")
    let paragraphs = EpubMetadataExtractor.paragraphs(fromHTML: html, chapterTitle: "Opening")

    #expect(metadata.title == "The Great Test")
    #expect(metadata.author == "Example Author")
    #expect(paragraphs.count == 3)
    #expect(paragraphs[0].kind == .heading)
    #expect(paragraphs[2].kind == .quote)
}

@Test func pdfTocMappingBuildsReaderParagraphs() {
    let bookId = UUID()
    let userId = UUID()
    let pages = [
        BookPage(bookId: bookId, userId: userId, pageNumber: 1, text: "This first page has enough words to become a reader paragraph.", wordCount: 11),
        BookPage(bookId: bookId, userId: userId, pageNumber: 4, text: "This fourth page belongs to the second chapter and also has enough text.", wordCount: 12)
    ]
    let toc = [
        PdfTocEntry(pageNumber: 1, title: "Start"),
        PdfTocEntry(pageNumber: 3, title: "Middle")
    ]

    let book = PdfTextMapper.readerBook(
        title: "PDF Fixture",
        fileName: "fixture.pdf",
        pageCount: 4,
        toc: toc,
        pages: pages
    )

    #expect(book.format == .pdf)
    #expect(book.chapters == ["Start", "Middle"])
    #expect(book.paragraphs.count == 2)
    #expect(book.paragraphs[1].chapterIndex == 1)
    #expect(book.paragraphs[1].chapterTitle == "Middle")
}

@Test func billingStateGrantsProForStripeOrApple() {
    let userId = UUID()
    let now = Date(timeIntervalSince1970: 1_000)
    let stripe = BillingProfile(
        userId: userId,
        plan: "pro",
        status: "active",
        currentPeriodEnd: Date(timeIntervalSince1970: 2_000)
    )
    let apple = BillingProfile(
        userId: userId,
        plan: "free",
        status: "inactive",
        appleProductId: BillingAccess.appleProductId,
        appleEnvironment: "Sandbox",
        appleExpiresAt: Date(timeIntervalSince1970: 2_000)
    )
    let expiredApple = BillingProfile(
        userId: userId,
        appleProductId: BillingAccess.appleProductId,
        appleExpiresAt: Date(timeIntervalSince1970: 500)
    )

    #expect(BillingAccess.hasProAccess(profile: stripe, now: now))
    #expect(BillingAccess.hasProAccess(profile: apple, now: now))
    #expect(!BillingAccess.hasProAccess(profile: expiredApple, now: now))
}

@Test func billingStateNormalisesStatusAndStopsExpiredStripeAccess() {
    let userId = UUID()
    let now = Date(timeIntervalSince1970: 2_000)
    let activeMixedCase = BillingProfile(
        userId: userId,
        plan: " Pro ",
        status: " ACTIVE ",
        currentPeriodEnd: Date(timeIntervalSince1970: 3_000)
    )
    let expiredCancelAtPeriodEnd = BillingProfile(
        userId: userId,
        plan: "pro",
        status: "active",
        currentPeriodEnd: Date(timeIntervalSince1970: 1_000),
        cancelAtPeriodEnd: true
    )

    #expect(BillingAccess.hasProAccess(profile: activeMixedCase, now: now))
    #expect(!BillingAccess.hasProAccess(profile: expiredCancelAtPeriodEnd, now: now))
}

@Test func storageQuotaUsesProAllowance() {
    #expect(BillingAccess.storageQuotaBytes(isPro: false) == 104_857_600)
    #expect(BillingAccess.storageQuotaBytes(isPro: true) == 5_368_709_120)
}

@Test func imageUsageFallsBackToActualSavedRows() {
    let usage = ReaderImageUsage(generatedCount: 2, monthlyGeneratedCount: 3)

    #expect(BillingAccess.imageUsageCount(usage: usage, rowCount: 5, isPro: false) == 5)
    #expect(BillingAccess.imageUsageCount(usage: nil, rowCount: 4, isPro: true) == 4)
}

@Test func decodesReaderImageUsageDateOnlyPeriodStart() throws {
    let json = """
    {
      "user_id": "65F14940-3328-4D38-8947-B3A8D5F5C3C6",
      "generated_count": 40,
      "monthly_generated_count": 12,
      "monthly_period_start": "2026-05-01"
    }
    """.data(using: .utf8)!

    let usage = try IllumeJSON.decoder().decode(ReaderImageUsage.self, from: json)

    #expect(usage.generatedCount == 40)
    #expect(usage.monthlyGeneratedCount == 12)
    let components = Calendar(identifier: .gregorian).dateComponents(in: TimeZone(secondsFromGMT: 0)!, from: try #require(usage.monthlyPeriodStart))
    #expect(components.year == 2026)
    #expect(components.month == 5)
    #expect(components.day == 1)
}

@Test func proImageUsageIgnoresPreviousMonthUsageRows() {
    let now = Date(timeIntervalSince1970: 1_768_003_200) // 2026-01-10T00:00:00Z
    let previousMonth = Date(timeIntervalSince1970: 1_764_547_200) // 2025-12-01T00:00:00Z
    let usage = ReaderImageUsage(
        generatedCount: 40,
        monthlyGeneratedCount: 25,
        monthlyPeriodStart: previousMonth
    )

    #expect(BillingAccess.imageUsageCount(usage: usage, rowCount: 1, isPro: true, now: now) == 1)
}
