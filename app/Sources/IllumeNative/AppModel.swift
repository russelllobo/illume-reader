#if os(iOS)
import AuthenticationServices
import AVFoundation
import CryptoKit
import Foundation
import IllumeCore
import MediaPlayer
import Security
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private let readerImageRequestChunkWords = 100
private let narrationChunkMinimumCharacters = 80
private let narrationChunkMaximumCharacters = 220
private let narrationChunkHardMaximumCharacters = 420
private let narrationChunkMaximumParagraphs = 1
private let narrationChunkPreferredSentenceMinimumCharacters = 60
private let narrationPrefetchLookahead = 3
private let narrationAudioCacheLimit = 12
private let persistentNarrationAudioCacheLimit = 240
private let narrationResumeRewindWordCount = 3
private let narrationResumePointsDefaultsKey = "IllumeNarrationResumePoints.v1"
private let narrationVoicePreviewText = "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do."
private let narrationVoicePreviewRate = 1.0
private let narrationKokoroGenerationRate = 1.0
private let narrationNonTerminalAbbreviations: Set<String> = [
    "adm", "atty", "capt", "cmdr", "col", "dr", "fr", "gen", "gov", "hon",
    "jr", "lt", "maj", "messrs", "miss", "mlle", "mme", "mr", "mrs", "ms",
    "mt", "mx", "no", "prof", "rep", "rev", "sen", "sgt", "sr", "st"
]
private let narrationNumberedReferenceAbbreviations: Set<String> = [
    "ch", "fig", "p", "pp", "vol"
]
private let narrationLowercaseContinuationAbbreviations: Set<String> = [
    "bros", "co", "corp", "dept", "etc", "inc", "ltd", "vs"
]
private let narrationMultiPeriodAbbreviations = [
    "e.g.", "i.e.", "u.k.", "u.s.", "u.s.a."
]
private let narrationSpeechMultiPeriodReplacements: [(pattern: String, replacement: String)] = [
    (#"\be\.g\."#, "for example"),
    (#"\bi\.e\."#, "that is"),
    (#"\bU\.S\.A\."#, "USA"),
    (#"\bU\.K\."#, "UK"),
    (#"\bU\.S\."#, "US")
]

@MainActor
final class IllumeAppModel: NSObject, ObservableObject {
    @Published var session: AuthSession?
    @Published var books: [BookRow] = []
    @Published var activeBookRow: BookRow?
    @Published var activeBook: ReaderBook?
    @Published var isReaderPresented = false
    @Published var openingBook: BookRow?
    @Published var closingBook: BookRow?
    @Published var bookTransitionSourceFrame: CGRect?
    @Published var billingProfile: BillingProfile?
    @Published var readerImageUsage: ReaderImageUsage?
    @Published var readerImageRowCount = 0
    @Published var hasBootstrapped = false
    @Published var isLibraryLoaded = false
    @Published var isLoading = false
    @Published var isImporting = false
    @Published var importingClassicID: String?
    @Published var authMode: AuthMode = .signIn
    @Published var notice = ""
    @Published var pendingBookImports: [PendingBookImport] = []
    @Published var uploadedBookNotice: String?
    @Published var deletingBookIDs: Set<UUID> = []
    @Published var readerSettings = ReaderSettings()
    @Published var readerImageResponse: ReaderImageFunctionResponse?
    @Published var readerImageChunkIndex: Int?
    @Published var readerImageStyle: ReaderImageStyle?
    @Published var readerImagePhase: ReaderImagePhase = .idle
    @Published var proUpgradePrompt: ProUpgradePrompt?
    @Published var narration = NarrationState()

    let backend = SupabaseBackend()
    lazy var billing = BillingService(backend: backend)
    private var audioPlayer: AVPlayer?
    private var streamingAudioPlayer: NarrationStreamingAudioPlayer?
    private var audioEndObserver: NSObjectProtocol?
    private var audioFailedObserver: NSObjectProtocol?
    private var audioStatusObserver: NSKeyValueObservation?
    private var audioTimeObserver: Any?
    private var audioTimeTimer: Timer?
    private var narrationAudioURL: URL?
    private var voicePreviewPlayer: AVPlayer?
    private var voicePreviewAudioURL: URL?
    private var voicePreviewEndObserver: NSObjectProtocol?
    private var voicePreviewFailedObserver: NSObjectProtocol?
    private var voicePreviewTask: Task<Void, Never>?
    private var voicePreviewPreparationTasks: [String: Task<KokoroRenderedAudio?, Never>] = [:]
    private var storedVoicePreviewURLs: [String: URL] = [:]
    private var nowPlayingArtworkTask: Task<Void, Never>?
    private var nowPlayingArtworkSource: String?
    private var nowPlayingArtworkImage: UIImage?
    private var remoteCommandTargets: [Any] = []
    private var hasConfiguredRemoteCommands = false
    private var narrationTask: Task<Void, Never>?
    private var openingNarrationTask: Task<Void, Never>?
    private var openingNarrationID: UUID?
    private var narrationPrefetchTasks: [NarrationAudioCacheKey: Task<NarrationPreparedAudio?, Never>] = [:]
    private var narrationAudioCache: [NarrationAudioCacheKey: NarrationPreparedAudio] = [:]
    private var narrationAudioCacheOrder: [NarrationAudioCacheKey] = []
    private var narrationCurrentAudioCacheKey: NarrationAudioCacheKey?
    private var kokoroWarmupTask: Task<Void, Never>?
    private var readerImageGenerationTask: Task<Void, Never>?
    private var readerImagePrefetchTasks: [ReaderImagePrefetchKey: Task<ReaderImageFunctionResponse?, Never>] = [:]
    private var uploadedBookNoticeTask: Task<Void, Never>?
    private var narrationParagraphIndex: Int?
    private var narrationChunkEndParagraphIndex: Int?
    private var narrationContinuationParagraphIndex: Int?
    private var narrationContinuationWordStart: Int?
    private var narrationCurrentChunk: NarrationChunk?
    private var narrationWordMarkers: [NarrationWordMarker] = []
    private var narrationWordIndex = 0
    private var narrationRateSnapshot = 1.0
    private var progressTask: Task<Void, Never>?
    private var appleContinuation: CheckedContinuation<AuthSession, Error>?
    private var googleWebAuthSession: ASWebAuthenticationSession?
    private var appleNonce = ""
    private var bookTransitionFrames: [UUID: CGRect] = [:]
    private var continueBookTransitionFrame: CGRect?

    enum AuthMode {
        case signIn
        case signUp
    }

    private struct NarrationWordMarker: Sendable {
        let paragraphIndex: Int
        let range: NSRange
        let weight: Double
        let speechTokenCount: Int
        let startSeconds: Double?
        let endSeconds: Double?

        func aligned(startSeconds: Double, endSeconds: Double) -> NarrationWordMarker {
            NarrationWordMarker(
                paragraphIndex: paragraphIndex,
                range: range,
                weight: weight,
                speechTokenCount: speechTokenCount,
                startSeconds: startSeconds,
                endSeconds: endSeconds
            )
        }
    }

    private struct NarrationChunk: Sendable {
        let startParagraphIndex: Int
        let startWordStart: Int
        let text: String
        let firstParagraphID: String
        let endParagraphIndex: Int
        let continuationParagraphIndex: Int?
        let continuationWordStart: Int?
        let wordMarkers: [NarrationWordMarker]
    }

    private struct NarrationAudioCacheKey: Hashable, Sendable {
        let bookID: UUID?
        let firstParagraphID: String
        let startParagraphIndex: Int
        let startWordStart: Int
        let endParagraphIndex: Int
        let continuationParagraphIndex: Int?
        let continuationWordStart: Int?
        let voiceID: String
        let rateKey: Int
        let text: String
    }

    private struct NarrationPreparedAudio: Sendable {
        let chunk: NarrationChunk
        let audio: KokoroRenderedAudio
        let cacheKey: NarrationAudioCacheKey?
    }

    private struct PersistedNarrationTiming: Codable {
        let start: Double
        let end: Double
    }

    private struct NarrationResumePoint: Codable, Equatable {
        let paragraphIndex: Int
        let wordStart: Int
        let updatedAt: Date
    }

    private struct CachedReaderBook: Codable {
        let schemaVersion: Int
        let bookID: UUID
        let documentType: DocumentType
        let storagePath: String
        let fileSize: Int
        let pageCount: Int?
        let paragraphCount: Int
        let chapterCount: Int
        let book: ReaderBook
    }

    private struct PendingReaderImageGeneration: Sendable {
        let chunk: ReaderImageRequestChunk
        let style: ReaderImageStyle
    }

    private struct ReaderImagePrefetchKey: Hashable, Sendable {
        let bookID: UUID
        let chunkIndex: Int
        let style: ReaderImageStyle
    }

    var isSignedIn: Bool {
        session != nil
    }

    var canLaunch: Bool {
        hasBootstrapped && (!isSignedIn || isLibraryLoaded)
    }

    var isPro: Bool {
        BillingAccess.hasProAccess(profile: billingProfile) || billing.hasActiveProEntitlement
    }

    var storageUsed: Int {
        books.reduce(0) { $0 + $1.fileSize }
    }

    var storageQuotaBytes: Int {
        BillingAccess.storageQuotaBytes(isPro: isPro)
    }

    var imageUsageCount: Int {
        BillingAccess.imageUsageCount(usage: readerImageUsage, rowCount: readerImageRowCount, isPro: isPro)
    }

    var imageLimit: Int {
        BillingAccess.imageLimit(isPro: isPro)
    }

    var imageUsageLabel: String {
        "\(imageUsageCount) / \(imageLimit)"
    }

    var imageUsageSuffix: String {
        isPro ? "/ mo" : "total"
    }

    var visibleNotice: String? {
        let trimmedNotice = notice.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmedNotice.isEmpty ? nil : trimmedNotice
    }

    func bootstrap() async {
        hasBootstrapped = false
        isLibraryLoaded = false
        warmKokoroTTSIfNeeded()
        session = KeychainStore.loadSession()
        if let refreshToken = session?.refreshToken {
            do {
                let refreshed = try await backend.refreshSession(refreshToken: refreshToken)
                apply(session: refreshed)
            } catch {
                KeychainStore.deleteSession()
                session = nil
            }
        }
        if session != nil {
            await reload()
        } else {
            books = []
            isLibraryLoaded = true
        }
        await billing.loadProducts()
        hasBootstrapped = true
    }

    func authenticate(email: String, password: String) async {
        await runBusy { [self] in
            let next = authMode == .signIn
                ? try await backend.signIn(email: email, password: password)
                : try await backend.signUp(email: email, password: password)
            apply(session: next)
            isLibraryLoaded = false
            await reload()
        }
    }

    func signInWithApple() async {
        do {
            let next = try await performAppleSignIn()
            apply(session: next)
            isLibraryLoaded = false
            await reload()
        } catch {
            notice = "Apple sign in was cancelled."
        }
    }

    func signInWithGoogle() async {
        do {
            let next = try await performGoogleSignIn()
            apply(session: next)
            isLibraryLoaded = false
            await reload()
        } catch {
            notice = error.localizedDescription
        }
    }

    func signOut() {
        stopSpeaking()
        googleWebAuthSession?.cancel()
        googleWebAuthSession = nil
        readerImageGenerationTask?.cancel()
        readerImageGenerationTask = nil
        KeychainStore.deleteSession()
        session = nil
        isLibraryLoaded = true
        books = []
        activeBook = nil
        activeBookRow = nil
        isReaderPresented = false
        openingBook = nil
        closingBook = nil
        bookTransitionSourceFrame = nil
        billingProfile = nil
        readerImageUsage = nil
        readerImageRowCount = 0
        cancelReaderImagePrefetchTasks()
        readerImageResponse = nil
        readerImageChunkIndex = nil
        readerImageStyle = nil
        readerImagePhase = .idle
        proUpgradePrompt = nil
        pendingBookImports = []
        uploadedBookNotice = nil
        importingClassicID = nil
        uploadedBookNoticeTask?.cancel()
        uploadedBookNoticeTask = nil
    }

    func reload() async {
        guard let accessToken = session?.accessToken else {
            books = []
            isLibraryLoaded = true
            return
        }

        let shouldGateLibrary = !hasBootstrapped || !isLibraryLoaded
        isLoading = true
        if shouldGateLibrary {
            isLibraryLoaded = false
        }
        notice = ""
        do {
            await billing.refreshCurrentEntitlements(accessToken: accessToken)
            async let library = backend.loadLibrary(accessToken: accessToken)
            async let profile = backend.loadBillingProfile(accessToken: accessToken)
            async let usage = backend.loadReaderImageUsage(accessToken: accessToken)

            books = try await library
            if let first = books.first,
               let cachedBook = Self.cachedParsedReaderBook(for: first) {
                prewarmFirstNarrationChunk(for: first, book: cachedBook, startIndex: first.currentIndex)
            }

            let loadedProfile = try? await profile
            let loadedUsage = try? await usage
            let loadedIsPro = BillingAccess.hasProAccess(profile: loadedProfile) || billing.hasActiveProEntitlement
            let imageRows = try? await backend.countReaderImages(
                accessToken: accessToken,
                since: loadedIsPro ? Self.currentMonthStartUTC() : nil
            )

            billingProfile = loadedProfile
            readerImageUsage = loadedUsage
            readerImageRowCount = imageRows ?? 0
            isLibraryLoaded = true
        } catch {
            if !Self.isCancellation(error) {
                notice = error.localizedDescription
            }
        }
        isLoading = false
    }

    func importDocument(from url: URL) async {
        guard let session else { return }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess { url.stopAccessingSecurityScopedResource() }
        }

        let pendingImportID = UUID().uuidString
        addPendingImport(id: pendingImportID, fileName: url.lastPathComponent)

        await runImporting { [self] in
            let data = try Data(contentsOf: url)
            let type = documentType(for: url)
            try await importDocumentData(
                data,
                fileName: url.lastPathComponent,
                type: type,
                pendingImportID: pendingImportID,
                session: session,
                parseProgress: 12
            )
        }
        removePendingImport(id: pendingImportID)
    }

    @discardableResult
    func addClassicToLibrary(_ classic: ClassicBook) async -> BookRow? {
        guard let session, importingClassicID == nil else { return nil }
        stopSpeaking()
        notice = ""
        clearUploadedBookNotice()
        importingClassicID = classic.id
        var importedRow: BookRow?

        let pendingImportID = "classic-\(classic.id)-\(Int(Date().timeIntervalSince1970))"
        addPendingImport(id: pendingImportID, fileName: classic.fileName)
        updatePendingImport(
            id: pendingImportID,
            author: classic.author,
            progress: 6,
            statusText: "Downloading",
            title: classic.title
        )

        await runImporting { [self] in
            updatePendingImport(id: pendingImportID, progress: 16)
            let (data, response) = try await URLSession.shared.data(from: classic.standardEbooksDownloadUrl)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                throw NSError(domain: "Illume", code: 502, userInfo: [NSLocalizedDescriptionKey: "Could not download ebook from Standard Ebooks."])
            }
            updatePendingImport(id: pendingImportID, progress: 34)
            guard Self.dataLooksLikeEpub(data) else {
                throw NSError(domain: "Illume", code: 415, userInfo: [NSLocalizedDescriptionKey: "The download for \(classic.title) did not return an EPUB. Please try again in a moment."])
            }
            importedRow = try await importDocumentData(
                data,
                fileName: classic.fileName,
                type: .epub,
                pendingImportID: pendingImportID,
                session: session,
                parseProgress: 38
            )
        }
        removePendingImport(id: pendingImportID)
        importingClassicID = nil
        return importedRow
    }

    func readClassicNow(_ classic: ClassicBook) async {
        if let matchingBook = bookMatchingClassic(classic) {
            await open(matchingBook)
            return
        }

        guard let importedRow = await addClassicToLibrary(classic) else { return }
        await open(importedRow)
    }

    func bookMatchingClassic(_ classic: ClassicBook) -> BookRow? {
        let targetTitle = Self.normalizedTitle(classic.title)
        let targetFileName = classic.fileName
        return books.first { book in
            book.documentType == .epub &&
            (
                book.fileName == targetFileName ||
                Self.normalizedTitle(book.title) == targetTitle
            )
        }
    }

    func hasImportedClassic(_ classic: ClassicBook) -> Bool {
        books.contains { book in
            book.documentType == .epub &&
            (
                book.fileName == classic.fileName ||
                Self.normalizedTitle(book.title) == Self.normalizedTitle(classic.title)
            )
        }
    }

    func availableClassics(from catalog: [ClassicBook] = ClassicCatalog.books) -> [ClassicBook] {
        catalog.filter { !hasImportedClassic($0) }
    }

    @discardableResult
    private func importDocumentData(
        _ data: Data,
        fileName: String,
        type: DocumentType,
        pendingImportID: String,
        session: AuthSession,
        parseProgress: Int
    ) async throws -> BookRow {
        guard storageUsed + data.count <= storageQuotaBytes else {
            throw NSError(domain: "Illume", code: 413, userInfo: [NSLocalizedDescriptionKey: "This upload would exceed your library storage limit."])
        }

        updatePendingImport(id: pendingImportID, progress: parseProgress)
        let parsed = try DocumentParser.parse(data: data, fileName: fileName, type: type)
        updatePendingImport(
            id: pendingImportID,
            author: parsed.book.author,
            coverUrl: parsed.coverDataURL,
            progress: 42,
            statusText: "Uploading",
            title: parsed.book.title
        )
        let bookId = UUID()
        let storagePath = StoragePath.documentPath(
            userId: session.user.id,
            bookId: bookId,
            originalFileName: fileName,
            type: type
        )
        let mimeType = type == .pdf ? "application/pdf" : "application/epub+zip"
        updatePendingImport(id: pendingImportID, progress: 68)
        try await backend.uploadDocument(data: data, storagePath: storagePath, mimeType: mimeType, accessToken: session.accessToken)
        updatePendingImport(id: pendingImportID, progress: 82, statusText: "Generating visuals")
        let visualProgressTask = startPendingImportProgressAnimation(id: pendingImportID, from: 82, through: 99)
        defer {
            visualProgressTask.cancel()
        }

        do {
            var importedBook = parsed.book
            importedBook.coverUrl = parsed.coverDataURL
            let start = Self.resolveMeaningfulStart(in: importedBook, requestedIndex: 0, savedIndex: 0, savedPage: 1)
            let row = BookRow(
                id: bookId,
                userId: session.user.id,
                title: parsed.book.title,
                author: parsed.book.author,
                coverUrl: parsed.coverDataURL,
                documentType: type,
                storagePath: storagePath,
                fileName: fileName,
                fileSize: data.count,
                mimeType: mimeType,
                pageCount: parsed.book.pageCount,
                paragraphCount: parsed.book.paragraphs.count,
                chapterCount: parsed.book.chapters.count,
                processingStatus: type == .pdf ? .queued : .ready,
                currentIndex: start.index,
                currentPage: start.page,
                lastOpenedAt: Date()
            )
            let inserted = try await backend.insertBook(row, accessToken: session.accessToken)
            updatePendingImport(id: pendingImportID, progress: 90)
            Self.storeParsedReaderBook(importedBook, for: inserted)
            prewarmFirstNarrationChunk(for: inserted, book: importedBook, startIndex: inserted.currentIndex)
            warmKokoroTTSIfNeeded()
            if type == .pdf {
                try? await backend.queuePdfProcessing(bookId: inserted.id, accessToken: session.accessToken)
            }

            if let chunk = Self.readerImageChunk(in: importedBook, currentIndex: inserted.currentIndex) {
                updatePendingImport(id: pendingImportID, progress: 94, statusText: "Generating visuals")
                do {
                    try await preGenerateReaderImage(for: inserted, book: importedBook, chunk: chunk, accessToken: session.accessToken)
                } catch {
                    print("Could not prepare the first reader image during upload: \(error)")
                }
            }

            books = LibrarySort.byRecentActivity([inserted] + books)
            updatePendingImport(id: pendingImportID, progress: 100)
            try? await Task.sleep(for: .milliseconds(180))
            removePendingImport(id: pendingImportID)
            showUploadedBookNotice(inserted.title)
            return inserted
        } catch {
            try? await backend.deleteBook(bookId: bookId, accessToken: session.accessToken)
            throw error
        }
    }

    func open(_ row: BookRow, sourceFrame: CGRect? = nil) async {
        guard let accessToken = session?.accessToken else { return }
        bookTransitionSourceFrame = sourceFrame ?? bookTransitionFrames[row.id]
        stopSpeaking()
        await runOpening(row) { [self] in
            var parsed = try await loadReaderBookForOpening(row, accessToken: accessToken)
            let start = Self.resolveMeaningfulStart(
                in: parsed,
                requestedIndex: row.currentIndex,
                savedIndex: row.currentIndex,
                savedPage: row.currentPage ?? 1
            )
            let resumePoint = narrationResumePoint(for: row.id, in: parsed)
            let openingIndex = resumePoint?.paragraphIndex ?? start.index
            var openingRow = row
            openingRow.currentIndex = openingIndex
            openingRow.currentPage = parsed.paragraphs.indices.contains(openingIndex)
                ? parsed.paragraphs[openingIndex].pageNumber ?? start.page
                : start.page
            parsed.coverUrl = row.coverUrl
            readerImageGenerationTask?.cancel()
            readerImageGenerationTask = nil
            cancelReaderImagePrefetchTasks()
            readerImageResponse = nil
            readerImageChunkIndex = nil
            readerImageStyle = nil
            readerImagePhase = .idle
            activeBookRow = openingRow
            activeBook = parsed
            isReaderPresented = true
            openingBook = nil
            warmKokoroTTSIfNeeded()
            startOpeningNarration(
                book: parsed,
                bookID: openingRow.id,
                paragraphIndex: openingIndex,
                wordStart: resumePoint?.wordStart ?? 0
            )
            startReaderImagePreparationForOpening(book: parsed, row: openingRow, accessToken: accessToken)
            updateLocalProgress(
                bookId: row.id,
                index: openingRow.currentIndex,
                page: openingRow.currentPage ?? start.page,
                lastOpenedAt: Date()
            )
            Task { [backend] in
                try? await backend.saveProgress(
                    bookId: row.id,
                    progress: ReadingProgress(currentIndex: openingRow.currentIndex, currentPage: openingRow.currentPage ?? start.page),
                    accessToken: accessToken
                )
            }
        }
    }

    private func loadReaderBookForOpening(_ row: BookRow, accessToken: String) async throws -> ReaderBook {
        if var cached = Self.cachedParsedReaderBook(for: row) {
            Self.applyLibraryMetadata(from: row, to: &cached)
            return cached
        }

        var parsed: ReaderBook
        if row.documentType == .pdf {
            let pages = (try? await backend.loadBookPages(bookId: row.id, accessToken: accessToken)) ?? []
            if !pages.isEmpty {
                parsed = PdfTextMapper.readerBook(
                    title: row.title,
                    author: row.author,
                    fileName: row.fileName,
                    pageCount: row.pageCount ?? pages.count,
                    toc: row.pdfToc,
                    pages: pages
                )
                Self.applyLibraryMetadata(from: row, to: &parsed)
                Self.storeParsedReaderBook(parsed, for: row)
                return parsed
            }
        }

        let data = try await backend.downloadDocument(storagePath: row.storagePath, accessToken: accessToken)
        parsed = try DocumentParser.parse(data: data, fileName: row.fileName, type: row.documentType).book
        Self.applyLibraryMetadata(from: row, to: &parsed)
        Self.storeParsedReaderBook(parsed, for: row)
        return parsed
    }

    private func startReaderImagePreparationForOpening(book: ReaderBook, row: BookRow, accessToken: String) {
        readerImageGenerationTask?.cancel()
        readerImageGenerationTask = Task { [weak self] in
            guard let self else { return }
            let pendingImageGeneration = await self.prepareReaderImageForOpening(
                book: book,
                row: row,
                accessToken: accessToken
            )
            guard !Task.isCancelled,
                  self.activeBookRow?.id == row.id,
                  let pendingImageGeneration else {
                return
            }
            self.startReaderImageGeneration(
                book: book,
                row: row,
                chunk: pendingImageGeneration.chunk,
                accessToken: accessToken,
                style: pendingImageGeneration.style
            )
        }
    }

    func closeReader() {
        let row = activeBookRow
        saveCurrentNarrationResumePoint()
        if let frame = continueBookTransitionFrame {
            bookTransitionSourceFrame = frame
        } else if bookTransitionSourceFrame == nil, let row, let frame = bookTransitionFrames[row.id] {
            bookTransitionSourceFrame = frame
        }
        cancelOpeningNarration()
        readerImageGenerationTask?.cancel()
        readerImageGenerationTask = nil
        cancelReaderImagePrefetchTasks()
        closingBook = row
        isReaderPresented = false
        openingBook = nil
        readerImageResponse = nil
        readerImageChunkIndex = nil
        readerImageStyle = nil
        readerImagePhase = .idle
    }

    func finishClosingBookTransition(for bookID: UUID) {
        guard closingBook?.id == bookID else { return }
        closingBook = nil
        bookTransitionSourceFrame = nil
    }

    func recordBookTransitionFrame(bookID: UUID, frame: CGRect, isContinueTarget: Bool = false) {
        guard frame.width > 1,
              frame.height > 1,
              frame.minX.isFinite,
              frame.minY.isFinite,
              frame.width.isFinite,
              frame.height.isFinite else {
            return
        }

        bookTransitionFrames[bookID] = frame
        if isContinueTarget {
            continueBookTransitionFrame = frame
        }

        guard isContinueTarget || (closingBook?.id == bookID && bookTransitionSourceFrame == nil) else { return }
        guard closingBook != nil else { return }
        withAnimation(IllumeTheme.blurLoadIn) {
            bookTransitionSourceFrame = frame
        }
    }

    func renameBook(_ row: BookRow, title: String) async {
        guard let accessToken = session?.accessToken else { return }
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else { return }
        await runBusy { [self] in
            let updated = try await backend.renameBook(bookId: row.id, title: trimmedTitle, accessToken: accessToken)
            if let index = books.firstIndex(where: { $0.id == updated.id }) {
                books[index] = updated
            }
            if activeBookRow?.id == updated.id {
                activeBookRow = updated
                activeBook?.title = updated.title
            }
        }
    }

    func deleteBook(_ row: BookRow) async {
        guard let accessToken = session?.accessToken else { return }
        guard !deletingBookIDs.contains(row.id) else { return }

        isLoading = true
        notice = ""
        withAnimation(IllumeTheme.blurLoadIn) {
            _ = deletingBookIDs.insert(row.id)
        }

        do {
            try await backend.deleteBook(bookId: row.id, accessToken: accessToken)
            if activeBookRow?.id == row.id {
                closeReader()
                stopSpeaking()
                activeBook = nil
                activeBookRow = nil
                isReaderPresented = false
            }
            try? await Task.sleep(for: .milliseconds(220))
            withAnimation(IllumeTheme.blurLoadIn) {
                books.removeAll { $0.id == row.id }
                _ = deletingBookIDs.remove(row.id)
            }
        } catch {
            withAnimation(IllumeTheme.blurLoadIn) {
                _ = deletingBookIDs.remove(row.id)
            }
            notice = error.localizedDescription
        }
        isLoading = false
    }

    func saveProgress(index: Int, page: Int) {
        guard let row = activeBookRow, let accessToken = session?.accessToken else { return }
        let savedAt = Date()
        updateLocalProgress(bookId: row.id, index: index, page: page, lastOpenedAt: savedAt)
        progressTask?.cancel()
        progressTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(450))
            guard let self else { return }
            try? await self.backend.saveProgress(
                bookId: row.id,
                progress: ReadingProgress(currentIndex: index, currentPage: page, lastOpenedAt: savedAt),
                accessToken: accessToken
            )
        }
    }

    private func updateLocalProgress(bookId: UUID, index: Int, page: Int, lastOpenedAt: Date) {
        let progress = ReadingProgress(currentIndex: index, currentPage: page, lastOpenedAt: lastOpenedAt)
        if let activeBookRow, activeBookRow.id == bookId {
            var updated = activeBookRow
            updated.currentIndex = progress.currentIndex
            updated.currentPage = progress.currentPage
            updated.lastOpenedAt = progress.lastOpenedAt
            updated.updatedAt = progress.lastOpenedAt
            self.activeBookRow = updated
        }

        if let bookIndex = books.firstIndex(where: { $0.id == bookId }) {
            books[bookIndex].currentIndex = progress.currentIndex
            books[bookIndex].currentPage = progress.currentPage
            books[bookIndex].lastOpenedAt = progress.lastOpenedAt
            books[bookIndex].updatedAt = progress.lastOpenedAt
            books = LibrarySort.byRecentActivity(books)
        }
    }

    private func narrationResumeWordStart(for paragraphIndex: Int, in book: ReaderBook) -> Int {
        guard let bookID = activeBookRow?.id,
              let point = narrationResumePoint(for: bookID, in: book),
              point.paragraphIndex == paragraphIndex else {
            return 0
        }

        return point.wordStart
    }

    private func saveCurrentNarrationResumePoint() {
        guard let bookID = activeBookRow?.id,
              let book = activeBook,
              let point = currentNarrationResumePoint(in: book) else {
            return
        }

        saveNarrationResumePoint(point, for: bookID)
    }

    private func currentNarrationResumePoint(in book: ReaderBook) -> NarrationResumePoint? {
        if !narrationWordMarkers.isEmpty {
            let markerIndex = min(max(narrationWordIndex, 0), narrationWordMarkers.count - 1)
            let rewindIndex = narrationWordIndexByRewinding(from: markerIndex, words: narrationResumeRewindWordCount)
            let marker = narrationWordMarkers[rewindIndex]
            guard book.paragraphs.indices.contains(marker.paragraphIndex) else { return nil }
            return NarrationResumePoint(
                paragraphIndex: marker.paragraphIndex,
                wordStart: marker.range.location,
                updatedAt: Date()
            )
        }

        if let chunk = narrationCurrentChunk,
           book.paragraphs.indices.contains(chunk.startParagraphIndex) {
            return NarrationResumePoint(
                paragraphIndex: chunk.startParagraphIndex,
                wordStart: chunk.startWordStart,
                updatedAt: Date()
            )
        }

        if let paragraphIndex = narrationParagraphIndex,
           book.paragraphs.indices.contains(paragraphIndex) {
            return NarrationResumePoint(paragraphIndex: paragraphIndex, wordStart: 0, updatedAt: Date())
        }

        return nil
    }

    private func narrationWordIndexByRewinding(from index: Int, words: Int) -> Int {
        guard words > 0, !narrationWordMarkers.isEmpty else { return max(0, index) }

        var remaining = words
        var candidate = min(max(index, 0), narrationWordMarkers.count - 1)
        let paragraphIndex = narrationWordMarkers[candidate].paragraphIndex
        while candidate > 0, remaining > 0 {
            let previous = candidate - 1
            guard narrationWordMarkers[previous].paragraphIndex == paragraphIndex else { break }
            candidate = previous
            remaining -= 1
        }

        return candidate
    }

    private func narrationResumePoint(for bookID: UUID, in book: ReaderBook) -> NarrationResumePoint? {
        guard let point = narrationResumePoints()[bookID.uuidString.lowercased()],
              book.paragraphs.indices.contains(point.paragraphIndex),
              Self.wordRanges(in: book.paragraphs[point.paragraphIndex].text).contains(where: { $0.location == point.wordStart }) else {
            return nil
        }

        return point
    }

    private func saveNarrationResumePoint(_ point: NarrationResumePoint, for bookID: UUID) {
        var points = narrationResumePoints()
        points[bookID.uuidString.lowercased()] = point
        guard let data = try? IllumeJSON.encoder().encode(points) else { return }
        UserDefaults.standard.set(data, forKey: narrationResumePointsDefaultsKey)
    }

    private func narrationResumePoints() -> [String: NarrationResumePoint] {
        guard let data = UserDefaults.standard.data(forKey: narrationResumePointsDefaultsKey),
              let points = try? IllumeJSON.decoder().decode([String: NarrationResumePoint].self, from: data) else {
            return [:]
        }

        return points
    }

    func speak(_ text: String) {
        guard let book = activeBook,
              let paragraphIndex = book.paragraphs.firstIndex(where: { $0.text == text }) else { return }
        speak(book: book, paragraphIndex: paragraphIndex, wordStart: 0)
    }

    func toggleNarration(for book: ReaderBook, from index: Int, wordStart: Int? = nil) {
        let startWord = wordStart ?? narrationResumeWordStart(for: index, in: book)
        if narration.isPreparing {
            stopSpeaking()
            return
        }
        if narration.isPlaying {
            pauseNarration()
            return
        }
        if audioPlayer != nil || streamingAudioPlayer != nil {
            guard narrationParagraphIndex == index else {
                stopSpeaking()
                speak(book: book, paragraphIndex: index, wordStart: startWord)
                return
            }
            resumeNarration()
            return
        }
        if narrationParagraphIndex != nil {
            if narrationParagraphIndex == index {
                stopSpeaking()
            } else {
                stopSpeaking()
                speak(book: book, paragraphIndex: index, wordStart: startWord)
            }
            return
        }
        speak(book: book, paragraphIndex: index, wordStart: startWord)
    }

    func narrationControlIndex(in book: ReaderBook) -> Int {
        if let narrationParagraphIndex,
           book.paragraphs.indices.contains(narrationParagraphIndex) {
            return narrationParagraphIndex
        }

        if let activeBookRow,
           book.paragraphs.indices.contains(activeBookRow.currentIndex) {
            return activeBookRow.currentIndex
        }

        return book.paragraphs.isEmpty ? 0 : min(max(activeBookRow?.currentIndex ?? 0, 0), book.paragraphs.count - 1)
    }

    func moveNarrationControl(to index: Int, in book: ReaderBook) {
        guard book.paragraphs.indices.contains(index) else { return }
        let paragraph = book.paragraphs[index]
        saveProgress(index: index, page: paragraph.pageNumber ?? 1)
        speak(book: book, paragraphIndex: index, wordStart: 0)
    }

    func openNarrationSpot(in book: ReaderBook) {
        guard activeBook != nil else { return }
        let index = narrationControlIndex(in: book)
        guard book.paragraphs.indices.contains(index) else {
            isReaderPresented = true
            return
        }

        let paragraph = book.paragraphs[index]
        saveProgress(index: index, page: paragraph.pageNumber ?? 1)
        isReaderPresented = true
    }

    func setNarrationRate(_ value: Double) {
        let rate = Self.kokoroSpeechRate(from: value)
        guard abs(readerSettings.narrationRate - rate) > 0.001 else { return }

        readerSettings.narrationRate = rate
        applyCurrentNarrationPlaybackRate()
    }

    func setNarrationVoice(_ id: String) {
        let voice = KokoroNarrationVoice.availableVoice(for: id)
        guard readerSettings.narrationVoice != voice.id else { return }

        updateNarrationHighlight(at: currentNarrationPlaybackSeconds)
        saveCurrentNarrationResumePoint()
        readerSettings.narrationVoice = voice.id
        narrationTask?.cancel()
        narrationTask = nil
        clearPrefetchedNarration()
        stopPlayback(keepNarrationState: false)
        clearNarrationAudioCache()
        resetNarrationTracking()
    }

    func previewNarrationVoice(_ voice: KokoroNarrationVoice, in book: ReaderBook, from paragraphIndex: Int) {
        voicePreviewTask?.cancel()
        stopVoicePreview()
        if narration.isPlaying {
            pauseNarration()
        }

        let rate = Self.kokoroSpeechRate(from: readerSettings.narrationRate)
        voicePreviewTask = Task {
            await playNarrationVoicePreview(
                voice: voice,
                book: book,
                paragraphIndex: paragraphIndex,
                rate: rate
            )
        }
    }

    func pauseNarration() {
        guard audioPlayer != nil || streamingAudioPlayer != nil else {
            stopSpeaking()
            return
        }
        audioPlayer?.pause()
        streamingAudioPlayer?.pause()
        updateNarrationHighlight(at: currentNarrationPlaybackSeconds)
        saveCurrentNarrationResumePoint()
        narration.isPlaying = false
        narration.isPreparing = false
        updateNowPlayingPlaybackState(isPlaying: false)
    }

    private func resumeNarration() {
        guard audioPlayer != nil || streamingAudioPlayer != nil else { return }
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        narration.isPlaying = true
        narration.isPreparing = false
        updateNowPlayingPlaybackState(isPlaying: true)
        if let player = audioPlayer {
            player.playImmediately(atRate: currentNarrationPlaybackRate)
        } else {
            streamingAudioPlayer?.resume()
        }
    }

    private func startOpeningNarration(book: ReaderBook, bookID: UUID, paragraphIndex: Int, wordStart: Int = 0) {
        openingNarrationTask?.cancel()
        narrationTask?.cancel()
        stopPlayback(keepNarrationState: false)

        let openingNarrationID = UUID()
        self.openingNarrationID = openingNarrationID
        let task = Task { [weak self] in
            guard !Task.isCancelled else { return }
            let shouldStart = await MainActor.run {
                guard let self,
                      self.openingNarrationID == openingNarrationID,
                      self.isReaderPresented,
                      self.activeBookRow?.id == bookID,
                      self.activeBook != nil else {
                    return false
                }
                return true
            }
            guard shouldStart, !Task.isCancelled else { return }
            await self?.speakKokoro(book: book, paragraphIndex: paragraphIndex, wordStart: wordStart)
            try? await Task.sleep(for: .milliseconds(1500))
            await MainActor.run {
                guard let self, self.openingNarrationID == openingNarrationID else { return }
                self.openingNarrationTask = nil
                self.openingNarrationID = nil
                self.narrationTask = nil
            }
        }

        openingNarrationTask = task
        narrationTask = task
    }

    private func cancelOpeningNarration() {
        guard let openingNarrationTask else { return }
        openingNarrationTask.cancel()
        narrationTask?.cancel()
        narrationTask = nil
        openingNarrationID = nil
        stopPlayback(keepNarrationState: false)
        resetNarrationTracking()
        self.openingNarrationTask = nil
    }

    func speak(book: ReaderBook, paragraphIndex: Int, wordStart: Int? = nil) {
        let startWord = wordStart ?? narrationResumeWordStart(for: paragraphIndex, in: book)
        cancelOpeningNarration()
        narrationTask?.cancel()
        prioritizeUserNarration()
        stopPlayback(keepNarrationState: false)
        narrationTask = Task {
            await speakKokoro(book: book, paragraphIndex: paragraphIndex, wordStart: startWord)
        }
    }

    private func warmKokoroTTSIfNeeded() {
        guard kokoroWarmupTask == nil,
              session?.accessToken != nil else { return }

        kokoroWarmupTask = Task(priority: .utility) { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            let canPreparePreviews = await MainActor.run { [weak self] in
                guard let self else { return false }
                return self.activeBookRow == nil &&
                    self.openingBook == nil &&
                    !self.narration.isPlaying &&
                    !self.narration.isPreparing &&
                    self.audioPlayer == nil &&
                    self.streamingAudioPlayer == nil
            }
            guard canPreparePreviews else { return }
            await self?.prepareStoredNarrationVoicePreviews()
        }
    }

    private func prewarmFirstNarrationChunk(
        for row: BookRow,
        book: ReaderBook,
        startIndex: Int,
        delayMilliseconds: Int = 1500,
        onlyWhenIdle: Bool = true
    ) {
        guard session?.accessToken != nil,
              let chunk = Self.narrationChunk(in: book, from: startIndex, wordStart: 0) else { return }

        let voice = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        let key = narrationAudioCacheKey(for: chunk, bookID: row.id, voiceID: voice.id, rate: narrationKokoroGenerationRate)
        guard cachedPreparedNarration(for: key, chunk: chunk) == nil,
              narrationPrefetchTasks[key] == nil else { return }

        Task { @MainActor [weak self] in
            if delayMilliseconds > 0 {
                try? await Task.sleep(for: .milliseconds(delayMilliseconds))
            }
            guard let self else { return }
            if onlyWhenIdle {
                guard self.activeBookRow == nil,
                      self.openingBook == nil,
                      !self.narration.isPlaying,
                      !self.narration.isPreparing,
                      self.audioPlayer == nil,
                      self.streamingAudioPlayer == nil else {
                    return
                }
            }
            guard self.cachedPreparedNarration(for: key, chunk: chunk) == nil,
                  self.narrationPrefetchTasks[key] == nil else {
                return
            }

            self.startNarrationPrefetchTask(
                for: key,
                chunk: chunk,
                voice: voice,
                rate: narrationKokoroGenerationRate,
                priority: .utility
            )
        }
    }

    func prewarmNarration(at paragraphIndex: Int, in book: ReaderBook) {
        guard let row = activeBookRow,
              session?.accessToken != nil,
              let chunk = Self.narrationChunk(in: book, from: paragraphIndex, wordStart: 0) else { return }

        let voice = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        let key = narrationAudioCacheKey(for: chunk, bookID: row.id, voiceID: voice.id, rate: narrationKokoroGenerationRate)
        let desired = narrationPrefetchCandidates(
            in: book,
            after: chunk,
            bookID: row.id,
            voiceID: voice.id,
            rate: narrationKokoroGenerationRate
        )
        clearPrefetchedNarration(preserving: Set(([key] + desired.map(\.key))))

        if cachedPreparedNarration(for: key, chunk: chunk) == nil,
           narrationPrefetchTasks[key] == nil {
            startNarrationPrefetchTask(
                for: key,
                chunk: chunk,
                voice: voice,
                rate: narrationKokoroGenerationRate,
                priority: .userInitiated
            )
        }

        prefetchNarrationChunks(
            in: book,
            after: chunk,
            voice: voice,
            rate: narrationKokoroGenerationRate,
            preserving: [key]
        )
    }

    private func speakKokoro(book: ReaderBook, paragraphIndex: Int, wordStart: Int = 0) async {
        guard let chunk = Self.narrationChunk(in: book, from: paragraphIndex, wordStart: wordStart) else { return }

        stopPlayback(keepNarrationState: true)

        narrationRateSnapshot = narrationKokoroGenerationRate
        let narrationVoiceSnapshot = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        applyNarrationState(for: chunk, in: book, isPlaying: false, isPreparing: true)

        do {
            let key = narrationAudioCacheKey(
                for: chunk,
                bookID: activeBookRow?.id,
                voiceID: narrationVoiceSnapshot.id,
                rate: narrationRateSnapshot
            )
            clearPrefetchedNarration()
            if let prepared = cachedPreparedNarration(for: key, chunk: chunk) {
                guard (narration.isPlaying || narration.isPreparing),
                      narrationParagraphIndex == chunk.startParagraphIndex,
                      narrationChunkEndParagraphIndex == chunk.endParagraphIndex,
                      narrationContinuationParagraphIndex == chunk.continuationParagraphIndex,
                      narrationContinuationWordStart == chunk.continuationWordStart,
                      !Task.isCancelled else {
                    discardPreparedNarration(prepared)
                    return
                }
                guard FileManager.default.fileExists(atPath: prepared.audio.url.path) else {
                    throw NarrationPlaybackError.emptyAudio
                }
                applyNarrationState(for: prepared.chunk, in: book, isPlaying: false, isPreparing: true)
                try playNarrationAudio(at: prepared.audio.url, cacheKey: prepared.cacheKey)
                prefetchNarrationChunks(
                    in: book,
                    after: prepared.chunk,
                    voice: narrationVoiceSnapshot,
                    rate: narrationRateSnapshot
                )
                return
            }

            let prepared = try await preparedNarrationAudio(
                for: chunk,
                bookID: activeBookRow?.id,
                voice: narrationVoiceSnapshot,
                rate: narrationRateSnapshot
            )
            guard !Task.isCancelled else {
                discardPreparedNarration(prepared)
                return
            }
            playPreparedNarration(prepared, in: book)
        } catch {
            guard !Task.isCancelled else { return }
            stopSpeaking()
            notice = error.localizedDescription.isEmpty ? "Kokoro TTS could not play this paragraph." : error.localizedDescription
        }
    }

    func stopSpeaking() {
        updateNarrationHighlight(at: currentNarrationPlaybackSeconds)
        saveCurrentNarrationResumePoint()
        openingNarrationTask?.cancel()
        openingNarrationTask = nil
        openingNarrationID = nil
        narrationTask?.cancel()
        narrationTask = nil
        voicePreviewTask?.cancel()
        voicePreviewTask = nil
        stopVoicePreview()
        clearPrefetchedNarration()
        stopPlayback(keepNarrationState: false)
        resetNarrationTracking()
    }

    private func prioritizeUserNarration() {
        clearPrefetchedNarration()
        for (_, task) in voicePreviewPreparationTasks {
            task.cancel()
        }
        voicePreviewPreparationTasks.removeAll()
    }

    private func resetNarrationTracking() {
        narrationParagraphIndex = nil
        narrationChunkEndParagraphIndex = nil
        narrationContinuationParagraphIndex = nil
        narrationContinuationWordStart = nil
        narrationCurrentChunk = nil
        narrationWordMarkers = []
        narrationWordIndex = 0
        narration = NarrationState()
    }

    private func playNarrationAudio(at url: URL, cacheKey: NarrationAudioCacheKey?) throws {
        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.volume = 1
        audioPlayer = player
        narrationAudioURL = url
        narrationCurrentAudioCacheKey = cacheKey
        configureRemoteNarrationCommandsIfNeeded()
        updateNowPlayingInfo(duration: nil)
        audioStatusObserver = item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                guard self.audioPlayer === player else { return }
                switch item.status {
                case .readyToPlay:
                    self.updateNowPlayingInfo(duration: item.duration.seconds)
                    self.startPreparedNarrationPlayback(player)
                    self.installNarrationTimeObserver(for: player)
                case .failed:
                    let message = item.error?.localizedDescription ?? "Narration audio could not load."
                    self.stopSpeaking()
                    self.notice = message
                default:
                    break
                }
            }
        }
        audioEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.finishCurrentNarrationItem()
            }
        }
        audioFailedObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] notification in
            let message = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
                ?? "Narration audio could not play."
            Task { @MainActor in
                guard let self else { return }
                self.stopSpeaking()
                self.notice = message
            }
        }

        narration.isPlaying = false
        narration.isPreparing = true
        updateNowPlayingPlaybackState(isPlaying: false)
    }

    private func playStreamingNarrationAudio(sampleRate: Int32, cacheKey: NarrationAudioCacheKey?) throws {
        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif

        let player = try NarrationStreamingAudioPlayer(
            sampleRate: Double(sampleRate),
            rate: currentNarrationPlaybackRate
        ) { [weak self] in
            Task { @MainActor in
                self?.finishCurrentNarrationItem()
            }
        }
        streamingAudioPlayer = player
        narrationCurrentAudioCacheKey = cacheKey
        configureRemoteNarrationCommandsIfNeeded()
        updateNowPlayingInfo(duration: nil)
        narration.isPlaying = false
        narration.isPreparing = true
        updateNowPlayingPlaybackState(isPlaying: false)
    }

    private func startPreparedNarrationPlayback(_ player: AVPlayer) {
        guard audioPlayer === player,
              !narration.isPlaying else { return }

        narration.isPlaying = true
        narration.isPreparing = false
        updateNarrationHighlight(at: 0)
        updateNowPlayingPlaybackState(isPlaying: true)
        player.playImmediately(atRate: currentNarrationPlaybackRate)
    }

    private func startStreamingNarrationPlayback(_ player: NarrationStreamingAudioPlayer) {
        guard streamingAudioPlayer === player,
              !narration.isPlaying else { return }

        narration.isPlaying = true
        narration.isPreparing = false
        updateNarrationHighlight(at: 0)
        installStreamingNarrationTimeObserver()
        updateNowPlayingPlaybackState(isPlaying: true)
        player.resume()
    }

    private func playNarrationVoicePreview(
        voice: KokoroNarrationVoice,
        book: ReaderBook,
        paragraphIndex: Int,
        rate: Double
    ) async {
        _ = book
        _ = paragraphIndex
        _ = rate

        do {
            let renderedAudio = try await storedNarrationVoicePreviewAudio(
                for: voice,
                createIfMissing: true
            )
            guard !Task.isCancelled,
                  KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice) == voice else {
                return
            }
            try playVoicePreviewAudio(at: renderedAudio.url)
        } catch {
            guard !Task.isCancelled else { return }
            stopVoicePreview()
            notice = error.localizedDescription.isEmpty ? "Kokoro TTS could not preview this voice." : error.localizedDescription
        }
    }

    private func playVoicePreviewAudio(at url: URL) throws {
        stopVoicePreview()

        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.volume = 1
        voicePreviewPlayer = player
        voicePreviewAudioURL = url
        voicePreviewEndObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.stopVoicePreview()
            }
        }
        voicePreviewFailedObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemFailedToPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] notification in
            let message = (notification.userInfo?[AVPlayerItemFailedToPlayToEndTimeErrorKey] as? Error)?.localizedDescription
                ?? "Voice preview could not play."
            Task { @MainActor in
                guard let self else { return }
                self.stopVoicePreview()
                self.notice = message
            }
        }
        player.playImmediately(atRate: 1)
    }

    private func stopVoicePreview() {
        if let voicePreviewEndObserver {
            NotificationCenter.default.removeObserver(voicePreviewEndObserver)
            self.voicePreviewEndObserver = nil
        }
        if let voicePreviewFailedObserver {
            NotificationCenter.default.removeObserver(voicePreviewFailedObserver)
            self.voicePreviewFailedObserver = nil
        }
        voicePreviewPlayer?.pause()
        voicePreviewPlayer = nil
        if let voicePreviewAudioURL {
            if !isStoredVoicePreviewURL(voicePreviewAudioURL) {
                try? FileManager.default.removeItem(at: voicePreviewAudioURL)
            }
            self.voicePreviewAudioURL = nil
        }
    }

    private func prepareStoredNarrationVoicePreviews() async {
        for voice in KokoroNarrationVoice.allCases {
            guard !Task.isCancelled else { return }
            _ = try? await storedNarrationVoicePreviewAudio(
                for: voice,
                createIfMissing: true
            )
        }
    }

    private func storedNarrationVoicePreviewAudio(
        for voice: KokoroNarrationVoice,
        createIfMissing: Bool
    ) async throws -> KokoroRenderedAudio {
        let url = try Self.storedNarrationVoicePreviewURL(for: voice)
        if FileManager.default.fileExists(atPath: url.path) {
            do {
                storedVoicePreviewURLs[voice.id] = url
                return KokoroRenderedAudio(url: url, duration: try Self.audioDuration(at: url))
            } catch {
                storedVoicePreviewURLs[voice.id] = nil
                try? FileManager.default.removeItem(at: url)
            }
        }

        if let task = voicePreviewPreparationTasks[voice.id],
           let renderedAudio = await task.value {
            return renderedAudio
        }

        guard createIfMissing else {
            throw NarrationPlaybackError.emptyAudio
        }

        guard let accessToken = session?.accessToken else {
            throw NarrationPlaybackError.notSignedIn
        }
        let backend = backend
        let presetVoice = voice.deepInfraPresetVoice

        let task = Task<KokoroRenderedAudio?, Never>(priority: .utility) {
            do {
                let renderedAudio = try await withThrowingTaskGroup(of: KokoroRenderedAudio.self) { group in
                    group.addTask {
                        try await Self.renderKokoroAudio(
                            text: Self.narrationTextForSpeech(narrationVoicePreviewText),
                            presetVoice: presetVoice,
                            rate: narrationVoicePreviewRate,
                            accessToken: accessToken,
                            backend: backend
                        )
                    }
                    group.addTask {
                        try await Task.sleep(for: .seconds(60))
                        throw NarrationPlaybackError.kokoroTimedOut
                    }
                    guard let renderedAudio = try await group.next() else {
                        throw NarrationPlaybackError.emptyAudio
                    }
                    group.cancelAll()
                    return renderedAudio
                }
                try Self.storeNarrationVoicePreview(renderedAudio, at: url)
                return KokoroRenderedAudio(url: url, duration: renderedAudio.duration)
            } catch {
                return nil
            }
        }
        voicePreviewPreparationTasks[voice.id] = task

        guard let renderedAudio = await task.value else {
            voicePreviewPreparationTasks[voice.id] = nil
            throw NarrationPlaybackError.emptyAudio
        }
        voicePreviewPreparationTasks[voice.id] = nil
        storedVoicePreviewURLs[voice.id] = renderedAudio.url
        return renderedAudio
    }

    nonisolated private static func storedNarrationVoicePreviewURL(for voice: KokoroNarrationVoice) throws -> URL {
        let directory = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        .appendingPathComponent("Illume", isDirectory: true)
        .appendingPathComponent("VoicePreviews", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("\(voice.id)-alice-bank-v1").appendingPathExtension("wav")
    }

    nonisolated private static func storeNarrationVoicePreview(_ renderedAudio: KokoroRenderedAudio, at destinationURL: URL) throws {
        let fileManager = FileManager.default
        try fileManager.createDirectory(at: destinationURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: destinationURL.path) {
            try fileManager.removeItem(at: destinationURL)
        }
        try fileManager.moveItem(at: renderedAudio.url, to: destinationURL)
    }

    nonisolated private static func audioDuration(at url: URL) throws -> TimeInterval {
        let file = try AVAudioFile(forReading: url)
        guard file.fileFormat.sampleRate > 0 else {
            throw NarrationPlaybackError.emptyAudio
        }
        return Double(file.length) / file.fileFormat.sampleRate
    }

    private func renderKokoroAudio(
        text: String,
        voice: KokoroNarrationVoice,
        rate: Double
    ) async throws -> KokoroRenderedAudio {
        guard let accessToken = session?.accessToken else {
            throw NarrationPlaybackError.notSignedIn
        }

        let response = try await backend.invokeReaderNarration(
            ReaderNarrationFunctionRequest(
                text: text,
                voice: voice.deepInfraPresetVoice,
                rate: Self.kokoroSpeechRate(from: rate)
            ),
            accessToken: accessToken
        )
        return try Self.writeRenderedNarrationAudio(response)
    }

    nonisolated private static func renderKokoroAudio(
        text: String,
        presetVoice: String,
        rate: Double,
        accessToken: String,
        backend: SupabaseBackend
    ) async throws -> KokoroRenderedAudio {
        let response = try await backend.invokeReaderNarration(
            ReaderNarrationFunctionRequest(
                text: text,
                voice: presetVoice,
                rate: kokoroSpeechRate(from: rate)
            ),
            accessToken: accessToken
        )
        return try writeRenderedNarrationAudio(response)
    }

    nonisolated private static func writeRenderedNarrationAudio(_ response: ReaderNarrationFunctionResponse) throws -> KokoroRenderedAudio {
        guard let data = Data(base64Encoded: response.audio, options: .ignoreUnknownCharacters) else {
            throw NarrationPlaybackError.emptyAudio
        }
        guard !data.isEmpty else {
            throw NarrationPlaybackError.emptyAudio
        }

        let outputURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("illume-kokoro-deepinfra-\(UUID().uuidString)")
            .appendingPathExtension("wav")
        try data.write(to: outputURL, options: .atomic)
        let timings = (response.words ?? []).compactMap(Self.kokoroWordTiming)
        return KokoroRenderedAudio(url: outputURL, duration: try audioDuration(at: outputURL), wordTimings: timings)
    }

    nonisolated private static func kokoroWordTiming(_ word: ReaderNarrationFunctionWord) -> KokoroWordTiming? {
        guard word.start.isFinite,
              word.end.isFinite,
              word.end > word.start,
              word.text.rangeOfCharacter(from: CharacterSet.alphanumerics) != nil else {
            return nil
        }
        return KokoroWordTiming(text: word.text, start: max(0, word.start), end: max(0, word.end))
    }

    nonisolated private static func persistentNarrationAudioURL(for key: NarrationAudioCacheKey) -> URL {
        persistentNarrationAudioCacheDirectory()
            .appendingPathComponent(persistentNarrationAudioFileName(for: key))
            .appendingPathExtension("wav")
    }

    nonisolated private static func persistentNarrationTimingsURL(for key: NarrationAudioCacheKey) -> URL {
        persistentNarrationAudioURL(for: key).deletingPathExtension().appendingPathExtension("timings.json")
    }

    nonisolated private static func persistentNarrationTimingsURL(forAudioURL url: URL) -> URL {
        url.deletingPathExtension().appendingPathExtension("timings.json")
    }

    nonisolated private static func persistentNarrationAudioFileName(for key: NarrationAudioCacheKey) -> String {
        let bookPart = key.bookID?.uuidString.lowercased() ?? "local"
        let continuationPart = [
            key.continuationParagraphIndex.map(String.init) ?? "none",
            key.continuationWordStart.map(String.init) ?? "none"
        ].joined(separator: "-")
        let identity = [
            bookPart,
            key.firstParagraphID,
            String(key.startParagraphIndex),
            String(key.startWordStart),
            String(key.endParagraphIndex),
            continuationPart,
            key.voiceID,
            String(key.rateKey),
            sha256Hex(key.text)
        ].joined(separator: "|")
        return sha256Hex(identity)
    }

    nonisolated private static func persistentNarrationAudioCacheDirectory() -> URL {
        let base = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("Illume", isDirectory: true)
            .appendingPathComponent("NarrationAudio", isDirectory: true)
            .appendingPathComponent("v1", isDirectory: true)
    }

    nonisolated private static func isPersistentNarrationAudioURL(_ url: URL) -> Bool {
        url.deletingLastPathComponent().standardizedFileURL == persistentNarrationAudioCacheDirectory().standardizedFileURL
    }

    nonisolated private static func touchPersistentNarrationAudio(at url: URL) {
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: url.path)
    }

    nonisolated private static func persistedNarrationTimings(for key: NarrationAudioCacheKey) -> [KokoroWordTiming] {
        let url = persistentNarrationTimingsURL(for: key)
        guard let data = try? Data(contentsOf: url),
              let timings = try? IllumeJSON.decoder().decode([PersistedNarrationTiming].self, from: data) else {
            return []
        }

        return timings.enumerated().compactMap { index, timing in
            guard timing.start.isFinite,
                  timing.end.isFinite,
                  timing.end > timing.start else {
                return nil
            }
            return KokoroWordTiming(text: String(index), start: timing.start, end: timing.end)
        }
    }

    nonisolated private static func persistNarrationTimings(from chunk: NarrationChunk, for key: NarrationAudioCacheKey) {
        let timings = chunk.wordMarkers.compactMap { marker -> PersistedNarrationTiming? in
            guard let start = marker.startSeconds,
                  let end = marker.endSeconds,
                  start.isFinite,
                  end.isFinite,
                  end > start else {
                return nil
            }
            return PersistedNarrationTiming(start: start, end: end)
        }

        let url = persistentNarrationTimingsURL(for: key)
        guard timings.count == chunk.wordMarkers.count,
              let data = try? IllumeJSON.encoder().encode(timings) else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        try? data.write(to: url, options: .atomic)
    }

    nonisolated private static func sha256Hex(_ value: String) -> String {
        let digest = SHA256.hash(data: Data(value.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    private func isStoredVoicePreviewURL(_ url: URL) -> Bool {
        storedVoicePreviewURLs.values.contains(url)
    }

    private var currentNarrationPlaybackRate: Float {
        let desiredRate = Self.kokoroSpeechRate(from: readerSettings.narrationRate)
        let generatedRate = max(0.1, narrationRateSnapshot)
        return Float(desiredRate / generatedRate)
    }

    private func applyCurrentNarrationPlaybackRate() {
        guard narration.isPlaying,
              audioPlayer != nil || streamingAudioPlayer != nil else { return }
        audioPlayer?.rate = currentNarrationPlaybackRate
        streamingAudioPlayer?.rate = currentNarrationPlaybackRate
        updateNowPlayingPlaybackState(isPlaying: true)
    }

    private func renderNarrationAudio(
        for chunk: NarrationChunk,
        voice: KokoroNarrationVoice,
        rate: Double
    ) async throws -> KokoroRenderedAudio {
        let speechText = Self.narrationTextForSpeech(chunk.text)
        guard let accessToken = session?.accessToken else {
            throw NarrationPlaybackError.notSignedIn
        }
        let backend = backend
        let presetVoice = voice.deepInfraPresetVoice
        return try await withThrowingTaskGroup(of: KokoroRenderedAudio.self) { group in
            group.addTask {
                try await Self.renderKokoroAudio(
                    text: speechText,
                    presetVoice: presetVoice,
                    rate: rate,
                    accessToken: accessToken,
                    backend: backend
                )
            }
            group.addTask {
                try await Task.sleep(for: .seconds(60))
                throw NarrationPlaybackError.kokoroTimedOut
            }
            guard let renderedAudio = try await group.next() else {
                throw NarrationPlaybackError.emptyAudio
            }
            group.cancelAll()
            return renderedAudio
        }
    }

    private func preparedNarrationAudio(
        for chunk: NarrationChunk,
        bookID: UUID?,
        voice: KokoroNarrationVoice,
        rate: Double
    ) async throws -> NarrationPreparedAudio {
        let key = narrationAudioCacheKey(for: chunk, bookID: bookID, voiceID: voice.id, rate: rate)
        if let cached = cachedPreparedNarration(for: key, chunk: chunk) {
            return cached
        }

        if let task = narrationPrefetchTasks.removeValue(forKey: key),
           let prefetched = await task.value,
           FileManager.default.fileExists(atPath: prefetched.audio.url.path) {
            return storePreparedNarration(prefetched, for: key)
        }

        let renderedAudio = try await renderNarrationAudio(
            for: chunk,
            voice: voice,
            rate: rate
        )
        let alignedChunk = Self.narrationChunk(
            chunk,
            alignedToAudioDuration: renderedAudio.duration,
            wordTimings: renderedAudio.wordTimings
        )
        let prepared = NarrationPreparedAudio(chunk: alignedChunk, audio: renderedAudio, cacheKey: key)
        return storePreparedNarration(prepared, for: key)
    }

    private func preparedNarrationAudioIfAvailable(for key: NarrationAudioCacheKey, chunk: NarrationChunk) async -> NarrationPreparedAudio? {
        if let cached = cachedPreparedNarration(for: key, chunk: chunk) {
            return cached
        }

        guard let task = narrationPrefetchTasks.removeValue(forKey: key),
              let prefetched = await task.value,
              FileManager.default.fileExists(atPath: prefetched.audio.url.path) else {
            return nil
        }
        return storePreparedNarration(prefetched, for: key)
    }

    private func prefetchNarrationChunks(
        in book: ReaderBook,
        after chunk: NarrationChunk,
        voice: KokoroNarrationVoice,
        rate: Double,
        preserving preservedKeys: Set<NarrationAudioCacheKey> = []
    ) {
        let desired = narrationPrefetchCandidates(
            in: book,
            after: chunk,
            bookID: activeBookRow?.id,
            voiceID: voice.id,
            rate: rate
        )
        let desiredKeys = Set(desired.map(\.key)).union(preservedKeys)
        let stalePrefetches = narrationPrefetchTasks.filter { key, _ in !desiredKeys.contains(key) }
        for (key, task) in stalePrefetches {
            narrationPrefetchTasks[key] = nil
            task.cancel()
            Task { @MainActor [weak self] in
                if let prepared = await task.value {
                    self?.discardPreparedNarration(prepared)
                }
            }
        }

        for candidate in desired {
            guard cachedPreparedNarration(for: candidate.key, chunk: candidate.chunk) == nil,
                  narrationPrefetchTasks[candidate.key] == nil else { continue }

            startNarrationPrefetchTask(
                for: candidate.key,
                chunk: candidate.chunk,
                voice: voice,
                rate: rate,
                priority: .utility
            )
        }
    }

    private func startNarrationPrefetchTask(
        for key: NarrationAudioCacheKey,
        chunk: NarrationChunk,
        voice: KokoroNarrationVoice,
        rate: Double,
        priority: TaskPriority
    ) {
        guard cachedPreparedNarration(for: key, chunk: chunk) == nil,
              narrationPrefetchTasks[key] == nil,
              let accessToken = session?.accessToken else { return }

        let backend = backend
        let presetVoice = voice.deepInfraPresetVoice
        let task = Task<NarrationPreparedAudio?, Never>(priority: priority) {
            do {
                let speechText = Self.narrationTextForSpeech(chunk.text)
                let renderedAudio = try await withThrowingTaskGroup(of: KokoroRenderedAudio.self) { group in
                    group.addTask {
                        try await Self.renderKokoroAudio(
                            text: speechText,
                            presetVoice: presetVoice,
                            rate: rate,
                            accessToken: accessToken,
                            backend: backend
                        )
                    }
                    group.addTask {
                        try await Task.sleep(for: .seconds(60))
                        throw NarrationPlaybackError.kokoroTimedOut
                    }
                    guard let renderedAudio = try await group.next() else {
                        throw NarrationPlaybackError.emptyAudio
                    }
                    group.cancelAll()
                    return renderedAudio
                }
                guard !Task.isCancelled else {
                    try? FileManager.default.removeItem(at: renderedAudio.url)
                    return nil
                }
                let alignedChunk = Self.narrationChunk(
                    chunk,
                    alignedToAudioDuration: renderedAudio.duration,
                    wordTimings: renderedAudio.wordTimings
                )
                return NarrationPreparedAudio(chunk: alignedChunk, audio: renderedAudio, cacheKey: key)
            } catch {
                return nil
            }
        }
        narrationPrefetchTasks[key] = task

        Task { @MainActor [weak self] in
            guard let prepared = await task.value else {
                self?.narrationPrefetchTasks[key] = nil
                return
            }
            guard !task.isCancelled else {
                self?.discardPreparedNarration(prepared)
                self?.narrationPrefetchTasks[key] = nil
                return
            }
            _ = self?.storePreparedNarration(prepared, for: key)
            self?.narrationPrefetchTasks[key] = nil
        }
    }

    private func clearPrefetchedNarration(preserving preservedKeys: Set<NarrationAudioCacheKey> = []) {
        let staleTasks = narrationPrefetchTasks.filter { key, _ in !preservedKeys.contains(key) }
        for (key, task) in staleTasks {
            narrationPrefetchTasks[key] = nil
            task.cancel()
            Task {
                if let prepared = await task.value {
                    discardPreparedNarration(prepared)
                }
            }
        }
    }

    private func narrationAudioCacheKey(
        for chunk: NarrationChunk,
        bookID: UUID?,
        voiceID: String,
        rate: Double
    ) -> NarrationAudioCacheKey {
        NarrationAudioCacheKey(
            bookID: bookID,
            firstParagraphID: chunk.firstParagraphID,
            startParagraphIndex: chunk.startParagraphIndex,
            startWordStart: chunk.startWordStart,
            endParagraphIndex: chunk.endParagraphIndex,
            continuationParagraphIndex: chunk.continuationParagraphIndex,
            continuationWordStart: chunk.continuationWordStart,
            voiceID: voiceID,
            rateKey: Int((rate * 1_000).rounded()),
            text: chunk.text
        )
    }

    private func narrationPrefetchCandidates(
        in book: ReaderBook,
        after chunk: NarrationChunk,
        bookID: UUID?,
        voiceID: String,
        rate: Double
    ) -> [(key: NarrationAudioCacheKey, chunk: NarrationChunk)] {
        var candidates: [(key: NarrationAudioCacheKey, chunk: NarrationChunk)] = []
        var cursor = chunk

        for _ in 0..<narrationPrefetchLookahead {
            guard let start = Self.nextNarrationStart(in: book, after: cursor),
                  let nextChunk = Self.narrationChunk(in: book, from: start.paragraphIndex, wordStart: start.wordStart) else {
                break
            }
            let key = narrationAudioCacheKey(for: nextChunk, bookID: bookID, voiceID: voiceID, rate: rate)
            candidates.append((key: key, chunk: nextChunk))
            cursor = nextChunk
        }

        return candidates
    }

    private func cachedPreparedNarration(for key: NarrationAudioCacheKey) -> NarrationPreparedAudio? {
        guard let prepared = narrationAudioCache[key] else { return nil }
        guard FileManager.default.fileExists(atPath: prepared.audio.url.path) else {
            removeCachedNarration(for: key)
            return nil
        }

        touchCachedNarration(for: key)
        return prepared
    }

    private func cachedPreparedNarration(for key: NarrationAudioCacheKey, chunk: NarrationChunk) -> NarrationPreparedAudio? {
        if let prepared = cachedPreparedNarration(for: key) {
            return prepared
        }

        guard let prepared = diskPreparedNarration(for: key, chunk: chunk) else {
            return nil
        }
        return storePreparedNarration(prepared, for: key)
    }

    private func diskPreparedNarration(for key: NarrationAudioCacheKey, chunk: NarrationChunk) -> NarrationPreparedAudio? {
        let url = Self.persistentNarrationAudioURL(for: key)
        guard FileManager.default.fileExists(atPath: url.path),
              let duration = try? Self.audioDuration(at: url) else {
            try? FileManager.default.removeItem(at: url)
            return nil
        }

        let persistedTimings = Self.persistedNarrationTimings(for: key)
        let alignedChunk = Self.narrationChunk(
            chunk,
            alignedToAudioDuration: duration,
            wordTimings: persistedTimings
        )
        return NarrationPreparedAudio(
            chunk: alignedChunk,
            audio: KokoroRenderedAudio(url: url, duration: duration, wordTimings: persistedTimings),
            cacheKey: key
        )
    }

    @discardableResult
    private func storePreparedNarration(_ prepared: NarrationPreparedAudio, for key: NarrationAudioCacheKey) -> NarrationPreparedAudio {
        let stored = persistPreparedNarration(prepared, for: key)
        if let existing = narrationAudioCache[key],
           existing.audio.url != stored.audio.url,
           narrationCurrentAudioCacheKey != key {
            removeTransientNarrationAudio(at: existing.audio.url)
        }

        narrationAudioCache[key] = stored
        touchCachedNarration(for: key)
        trimNarrationAudioCache()
        return stored
    }

    private func persistPreparedNarration(_ prepared: NarrationPreparedAudio, for key: NarrationAudioCacheKey) -> NarrationPreparedAudio {
        let destinationURL = Self.persistentNarrationAudioURL(for: key)
        if prepared.audio.url == destinationURL {
            Self.touchPersistentNarrationAudio(at: destinationURL)
            Self.persistNarrationTimings(from: prepared.chunk, for: key)
            return prepared
        }

        do {
            try FileManager.default.createDirectory(
                at: destinationURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if FileManager.default.fileExists(atPath: destinationURL.path) {
                removeTransientNarrationAudio(at: prepared.audio.url)
                let duration = (try? Self.audioDuration(at: destinationURL)) ?? prepared.audio.duration
                Self.touchPersistentNarrationAudio(at: destinationURL)
                Self.persistNarrationTimings(from: prepared.chunk, for: key)
                return NarrationPreparedAudio(
                    chunk: Self.narrationChunk(prepared.chunk, alignedToAudioDuration: duration, wordTimings: Self.persistedNarrationTimings(for: key)),
                    audio: KokoroRenderedAudio(url: destinationURL, duration: duration, wordTimings: prepared.audio.wordTimings),
                    cacheKey: key
                )
            }

            do {
                try FileManager.default.moveItem(at: prepared.audio.url, to: destinationURL)
            } catch {
                try FileManager.default.copyItem(at: prepared.audio.url, to: destinationURL)
                removeTransientNarrationAudio(at: prepared.audio.url)
            }
            Self.touchPersistentNarrationAudio(at: destinationURL)
            Self.persistNarrationTimings(from: prepared.chunk, for: key)
            trimPersistentNarrationAudioCache()
            return NarrationPreparedAudio(
                chunk: prepared.chunk,
                audio: KokoroRenderedAudio(url: destinationURL, duration: prepared.audio.duration, wordTimings: prepared.audio.wordTimings),
                cacheKey: key
            )
        } catch {
            return prepared
        }
    }

    private func touchCachedNarration(for key: NarrationAudioCacheKey) {
        narrationAudioCacheOrder.removeAll { $0 == key }
        narrationAudioCacheOrder.append(key)
    }

    private func trimNarrationAudioCache() {
        while narrationAudioCache.count > narrationAudioCacheLimit,
              let key = narrationAudioCacheOrder.first(where: { $0 != narrationCurrentAudioCacheKey }) {
            removeCachedNarration(for: key)
        }
    }

    private func removeCachedNarration(for key: NarrationAudioCacheKey) {
        guard narrationCurrentAudioCacheKey != key else { return }
        narrationAudioCacheOrder.removeAll { $0 == key }
        guard let prepared = narrationAudioCache.removeValue(forKey: key) else { return }
        removeTransientNarrationAudio(at: prepared.audio.url)
    }

    private func clearNarrationAudioCache() {
        let cached = narrationAudioCache
        narrationAudioCache.removeAll()
        narrationAudioCacheOrder.removeAll()
        for prepared in cached.values {
            removeTransientNarrationAudio(at: prepared.audio.url)
        }
    }

    private func discardPreparedNarration(_ prepared: NarrationPreparedAudio) {
        if let key = prepared.cacheKey,
           narrationAudioCache[key]?.audio.url == prepared.audio.url {
            return
        }
        removeTransientNarrationAudio(at: prepared.audio.url)
    }

    private func isCachedNarrationAudioURL(_ url: URL) -> Bool {
        narrationAudioCache.values.contains { $0.audio.url == url }
    }

    private func removeTransientNarrationAudio(at url: URL) {
        guard !Self.isPersistentNarrationAudioURL(url) else { return }
        try? FileManager.default.removeItem(at: url)
    }

    private func trimPersistentNarrationAudioCache() {
        let directory = Self.persistentNarrationAudioCacheDirectory()
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ), urls.count > persistentNarrationAudioCacheLimit else { return }

        let removable = urls
            .filter { $0.pathExtension.lowercased() == "wav" && !isCachedNarrationAudioURL($0) && narrationAudioURL != $0 }
            .sorted {
                let left = ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate) ?? .distantPast
                let right = ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate) ?? .distantPast
                return left < right
            }
        for url in removable.prefix(max(0, urls.count - persistentNarrationAudioCacheLimit)) {
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: Self.persistentNarrationTimingsURL(forAudioURL: url))
        }
    }

    private func stopPlayback(keepNarrationState: Bool) {
        if let audioTimeObserver {
            audioPlayer?.removeTimeObserver(audioTimeObserver)
            self.audioTimeObserver = nil
        }
        audioTimeTimer?.invalidate()
        audioTimeTimer = nil
        if let audioEndObserver {
            NotificationCenter.default.removeObserver(audioEndObserver)
            self.audioEndObserver = nil
        }
        if let audioFailedObserver {
            NotificationCenter.default.removeObserver(audioFailedObserver)
            self.audioFailedObserver = nil
        }
        audioStatusObserver?.invalidate()
        audioStatusObserver = nil
        audioPlayer?.pause()
        audioPlayer = nil
        streamingAudioPlayer?.stop()
        streamingAudioPlayer = nil
        if !keepNarrationState {
            clearNowPlayingArtwork()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
        if let narrationAudioURL {
            if !isCachedNarrationAudioURL(narrationAudioURL) {
                try? FileManager.default.removeItem(at: narrationAudioURL)
            }
            self.narrationAudioURL = nil
        }
        narrationCurrentAudioCacheKey = nil
        if !keepNarrationState {
            narration = NarrationState()
        }
    }

    private func installNarrationTimeObserver(for player: AVPlayer) {
        guard narration.isPlaying,
              !narrationWordMarkers.isEmpty else { return }

        if let audioTimeObserver {
            audioPlayer?.removeTimeObserver(audioTimeObserver)
            self.audioTimeObserver = nil
        }
        audioTimeTimer?.invalidate()
        audioTimeTimer = nil

        audioTimeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.025, preferredTimescale: 600),
            queue: .main
        ) { [weak self] time in
            Task { @MainActor in
                guard let self else { return }
                self.updateNarrationHighlight(at: time.seconds + 0.025)
                self.updateNowPlayingElapsedTime(time.seconds)
            }
        }
    }

    private func installStreamingNarrationTimeObserver() {
        guard narration.isPlaying,
              streamingAudioPlayer != nil,
              !narrationWordMarkers.isEmpty else { return }

        if let audioTimeObserver {
            audioPlayer?.removeTimeObserver(audioTimeObserver)
            self.audioTimeObserver = nil
        }
        audioTimeTimer?.invalidate()
        audioTimeTimer = Timer.scheduledTimer(withTimeInterval: 0.025, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let seconds = self.currentNarrationPlaybackSeconds
                self.updateNarrationHighlight(at: seconds + 0.025)
                self.updateNowPlayingElapsedTime(seconds)
            }
        }
    }

    private func configureRemoteNarrationCommandsIfNeeded() {
        guard !hasConfiguredRemoteCommands else { return }
        hasConfiguredRemoteCommands = true

        let commandCenter = MPRemoteCommandCenter.shared()
        commandCenter.playCommand.isEnabled = true
        commandCenter.pauseCommand.isEnabled = true
        commandCenter.togglePlayPauseCommand.isEnabled = true
        commandCenter.stopCommand.isEnabled = true

        remoteCommandTargets.append(commandCenter.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.resumeNarration()
            }
            return .success
        })
        remoteCommandTargets.append(commandCenter.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.pauseNarration()
            }
            return .success
        })
        remoteCommandTargets.append(commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                if self.narration.isPlaying {
                    self.pauseNarration()
                } else {
                    self.resumeNarration()
                }
            }
            return .success
        })
        remoteCommandTargets.append(commandCenter.stopCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                self?.stopSpeaking()
            }
            return .success
        })
    }

    private func updateNowPlayingInfo(duration: Double?) {
        guard let book = activeBook else { return }

        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPMediaItemPropertyTitle] = book.title
        if !book.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            info[MPMediaItemPropertyArtist] = book.author
        }
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
        if let duration, duration.isFinite, duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentNarrationPlaybackSeconds
        info[MPNowPlayingInfoPropertyPlaybackRate] = narration.isPlaying ? currentNarrationPlaybackRate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        updateNowPlayingArtwork(from: book.coverUrl, title: book.title)
    }

    private func updateNowPlayingPlaybackState(isPlaying: Bool) {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentNarrationPlaybackSeconds
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? currentNarrationPlaybackRate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    private func updateNowPlayingElapsedTime(_ seconds: Double) {
        guard seconds.isFinite,
              var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = seconds
        info[MPNowPlayingInfoPropertyPlaybackRate] = narration.isPlaying ? currentNarrationPlaybackRate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private var currentNarrationPlaybackSeconds: Double {
        if let audioPlayer {
            return audioPlayer.currentTime().seconds
        }
        return streamingAudioPlayer?.playbackSeconds ?? 0
    }

    private func updateNowPlayingArtwork(from coverUrl: String?, title: String) {
        let source = coverUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
        let artworkSource = source?.isEmpty == false ? source : nil

        if nowPlayingArtworkSource == artworkSource,
           let nowPlayingArtworkImage {
            applyNowPlayingArtwork(nowPlayingArtworkImage)
            return
        }

        nowPlayingArtworkTask?.cancel()
        nowPlayingArtworkSource = artworkSource

        if let artworkSource,
           let image = Self.dataURLImage(from: artworkSource) {
            nowPlayingArtworkImage = image
            applyNowPlayingArtwork(image)
            return
        }

        let placeholder = Self.placeholderArtworkImage(title: title)
        nowPlayingArtworkImage = placeholder
        applyNowPlayingArtwork(placeholder)

        guard let artworkSource else { return }

        nowPlayingArtworkTask = Task {
            guard let image = await Self.nowPlayingArtworkImage(from: artworkSource),
                  !Task.isCancelled else { return }
            await MainActor.run {
                guard !Task.isCancelled,
                      self.nowPlayingArtworkSource == artworkSource else { return }
                self.nowPlayingArtworkImage = image
                self.applyNowPlayingArtwork(image)
            }
        }
    }

    private func applyNowPlayingArtwork(_ image: UIImage) {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { requestedSize in
            Self.resizedArtworkImage(image, requestedSize: requestedSize)
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func clearNowPlayingArtwork() {
        nowPlayingArtworkTask?.cancel()
        nowPlayingArtworkTask = nil
        nowPlayingArtworkSource = nil
        nowPlayingArtworkImage = nil
    }

    nonisolated private static func nowPlayingArtworkImage(from coverUrl: String) async -> UIImage? {
        if let image = dataURLImage(from: coverUrl) {
            return image
        }
        guard let url = URL(string: coverUrl) else { return nil }
        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            if let httpResponse = response as? HTTPURLResponse,
               !(200..<300).contains(httpResponse.statusCode) {
                return nil
            }
            return UIImage(data: data)
        } catch {
            return nil
        }
    }

    nonisolated private static func dataURLImage(from source: String) -> UIImage? {
        guard let commaIndex = source.firstIndex(of: ","),
              source[..<commaIndex].lowercased().contains(";base64") else {
            return nil
        }
        let base64 = String(source[source.index(after: commaIndex)...])
        guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            return nil
        }
        return UIImage(data: data)
    }

    nonisolated private static func resizedArtworkImage(_ image: UIImage, requestedSize: CGSize) -> UIImage {
        guard requestedSize.width > 0,
              requestedSize.height > 0,
              image.size != requestedSize else {
            return image
        }

        let renderer = UIGraphicsImageRenderer(size: requestedSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: requestedSize))
        }
    }

    nonisolated private static func placeholderArtworkImage(title: String) -> UIImage {
        let size = CGSize(width: 900, height: 900)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { context in
            let rect = CGRect(origin: .zero, size: size)
            UIColor(red: 0.07, green: 0.08, blue: 0.1, alpha: 1).setFill()
            context.fill(rect)

            let accentRect = CGRect(x: 0, y: size.height * 0.62, width: size.width, height: size.height * 0.38)
            UIColor(red: 0.82, green: 0.33, blue: 0.28, alpha: 1).setFill()
            context.fill(accentRect)

            let initial = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1)).uppercased()
            let paragraphStyle = NSMutableParagraphStyle()
            paragraphStyle.alignment = .center
            let attributes: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 360, weight: .black),
                .foregroundColor: UIColor.white.withAlphaComponent(0.92),
                .paragraphStyle: paragraphStyle
            ]
            let textRect = CGRect(x: 0, y: 220, width: size.width, height: 430)
            initial.draw(in: textRect, withAttributes: attributes)
        }
    }

    private func updateNarrationHighlight(at playbackSeconds: Double) {
        guard narration.isPlaying,
              !narrationWordMarkers.isEmpty else { return }

        guard playbackSeconds.isFinite else { return }
        if let alignedIndex = Self.narrationWordIndex(in: narrationWordMarkers, atPlaybackTime: playbackSeconds) {
            activateNarrationWord(at: alignedIndex)
            return
        }

        let currentTime = currentNarrationPlaybackSeconds + 0.03
        guard currentTime.isFinite else { return }
        let estimatedWeight = (currentTime * narrationRateSnapshot) / 0.28
        activateNarrationWord(at: Self.narrationWordIndex(in: narrationWordMarkers, at: estimatedWeight))
    }

    private func activateNarrationWord(at index: Int) {
        guard narration.isPlaying,
              let book = activeBook,
              !narrationWordMarkers.isEmpty else { return }

        let targetIndex = min(narrationWordMarkers.count - 1, max(0, index))
        guard targetIndex != narrationWordIndex || narration.wordRange == nil else { return }

        narrationWordIndex = targetIndex
        let marker = narrationWordMarkers[targetIndex]
        guard book.paragraphs.indices.contains(marker.paragraphIndex) else { return }
        let paragraph = book.paragraphs[marker.paragraphIndex]
        narrationParagraphIndex = marker.paragraphIndex
        narration = NarrationState(
            isPlaying: true,
            paragraphID: paragraph.id,
            wordRange: marker.range,
            sectionParagraphID: narrationCurrentChunk?.firstParagraphID,
            sectionWordStart: narrationCurrentChunk?.startWordStart
        )
    }

    private func continueNarrationAfterCurrentParagraph() {
        guard let book = activeBook,
              let currentChunk = currentNarrationChunk,
              let nextStart = Self.nextNarrationStart(in: book, after: currentChunk) else {
            narration = NarrationState()
            return
        }

        guard let nextChunk = Self.narrationChunk(in: book, from: nextStart.paragraphIndex, wordStart: nextStart.wordStart) else {
            speak(book: book, paragraphIndex: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
            return
        }

        applyNarrationState(for: nextChunk, in: book, isPlaying: false, isPreparing: true)
        let voice = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        let key = narrationAudioCacheKey(
            for: nextChunk,
            bookID: activeBookRow?.id,
            voiceID: voice.id,
            rate: narrationRateSnapshot
        )

        if let cached = cachedPreparedNarration(for: key, chunk: nextChunk) {
            playPreparedNarration(cached, in: book)
        } else if let prefetchTask = narrationPrefetchTasks.removeValue(forKey: key) {
            narrationTask = Task {
                let prepared = await prefetchTask.value
                guard !Task.isCancelled else {
                    if let prepared {
                        discardPreparedNarration(prepared)
                    }
                    return
                }
                guard let prepared,
                      prepared.chunk.startParagraphIndex == nextStart.paragraphIndex,
                      prepared.chunk.startWordStart == nextStart.wordStart else {
                    if let prepared {
                        discardPreparedNarration(prepared)
                    }
                    await renderAndPlayPreparedNarration(book: book, paragraphIndex: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
                    return
                }
                let stored = storePreparedNarration(prepared, for: key)
                playPreparedNarration(stored, in: book)
            }
        } else {
            narrationTask = Task {
                await renderAndPlayPreparedNarration(book: book, paragraphIndex: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
            }
        }
    }

    private var currentNarrationChunk: NarrationChunk? {
        narrationCurrentChunk
    }

    private func renderAndPlayPreparedNarration(book: ReaderBook, paragraphIndex: Int, wordStart: Int) async {
        guard let chunk = Self.narrationChunk(in: book, from: paragraphIndex, wordStart: wordStart) else { return }

        narrationRateSnapshot = narrationKokoroGenerationRate
        let narrationVoiceSnapshot = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        applyNarrationState(for: chunk, in: book, isPlaying: false, isPreparing: true)

        do {
            let key = narrationAudioCacheKey(
                for: chunk,
                bookID: activeBookRow?.id,
                voiceID: narrationVoiceSnapshot.id,
                rate: narrationRateSnapshot
            )
            if let prepared = await preparedNarrationAudioIfAvailable(for: key, chunk: chunk) {
                guard !Task.isCancelled else {
                    discardPreparedNarration(prepared)
                    return
                }
                playPreparedNarration(prepared, in: book)
                return
            }

            let prepared = try await preparedNarrationAudio(
                for: chunk,
                bookID: activeBookRow?.id,
                voice: narrationVoiceSnapshot,
                rate: narrationRateSnapshot
            )
            guard !Task.isCancelled else {
                discardPreparedNarration(prepared)
                return
            }
            playPreparedNarration(prepared, in: book)
        } catch {
            guard !Task.isCancelled else { return }
            stopSpeaking()
            notice = error.localizedDescription.isEmpty ? "Kokoro TTS could not play this paragraph." : error.localizedDescription
        }
    }

    private func playPreparedNarration(_ prepared: NarrationPreparedAudio, in book: ReaderBook) {
        guard (narration.isPlaying || narration.isPreparing),
              FileManager.default.fileExists(atPath: prepared.audio.url.path) else {
            discardPreparedNarration(prepared)
            return
        }

        applyNarrationState(for: prepared.chunk, in: book, isPlaying: false, isPreparing: true)
        do {
            try playNarrationAudio(at: prepared.audio.url, cacheKey: prepared.cacheKey)
            let voice = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
            prefetchNarrationChunks(
                in: book,
                after: prepared.chunk,
                voice: voice,
                rate: narrationRateSnapshot
            )
        } catch {
            stopSpeaking()
            notice = error.localizedDescription.isEmpty ? "Kokoro TTS could not play this paragraph." : error.localizedDescription
        }
    }

    private func finishCurrentNarrationItem() {
        stopPlayback(keepNarrationState: true)
        continueNarrationAfterCurrentParagraph()
    }

    nonisolated static func wordRanges(in text: String) -> [NSRange] {
        let nsText = text as NSString
        let pattern = #"\S+"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [] }
        return regex.matches(in: text, range: NSRange(location: 0, length: nsText.length)).map(\.range)
    }

    nonisolated private static func substring(_ text: String, fromUTF16Offset offset: Int) -> String {
        let safeOffset = max(0, min(offset, text.utf16.count))
        let index = String.Index(utf16Offset: safeOffset, in: text)
        return String(text[index...])
    }

    private func applyNarrationState(
        for chunk: NarrationChunk,
        in book: ReaderBook,
        isPlaying: Bool = true,
        isPreparing: Bool = false
    ) {
        narrationParagraphIndex = chunk.startParagraphIndex
        narrationChunkEndParagraphIndex = chunk.endParagraphIndex
        narrationContinuationParagraphIndex = chunk.continuationParagraphIndex
        narrationContinuationWordStart = chunk.continuationWordStart
        narrationCurrentChunk = chunk
        narrationWordMarkers = chunk.wordMarkers
        narrationWordIndex = 0

        if let firstMarker = narrationWordMarkers.first,
           book.paragraphs.indices.contains(firstMarker.paragraphIndex) {
            narration = NarrationState(
                isPlaying: isPlaying,
                isPreparing: isPreparing,
                paragraphID: book.paragraphs[firstMarker.paragraphIndex].id,
                wordRange: firstMarker.range,
                sectionParagraphID: chunk.firstParagraphID,
                sectionWordStart: chunk.startWordStart
            )
        } else {
            narration = NarrationState(
                isPlaying: isPlaying,
                isPreparing: isPreparing,
                paragraphID: chunk.firstParagraphID,
                wordRange: nil,
                sectionParagraphID: chunk.firstParagraphID,
                sectionWordStart: chunk.startWordStart
            )
        }
    }

    nonisolated private static func narrationChunk(in book: ReaderBook, from paragraphIndex: Int, wordStart: Int) -> NarrationChunk? {
        guard book.paragraphs.indices.contains(paragraphIndex) else { return nil }

        let startParagraph = book.paragraphs[paragraphIndex]
        let startWordRanges = wordRanges(in: startParagraph.text)
        let safeWordStart = startWordRanges.contains { $0.location == wordStart }
            ? wordStart
            : startWordRanges.first?.location ?? 0

        var pieces: [String] = []
        var wordMarkers: [NarrationWordMarker] = []
        var characterCount = 0
        var paragraphCount = 0
        var endParagraphIndex = paragraphIndex
        var continuationParagraphIndex: Int?
        var continuationWordStart: Int?

        for index in book.paragraphs.indices.dropFirst(paragraphIndex) {
            let paragraph = book.paragraphs[index]
            let text = index == paragraphIndex
                ? substring(paragraph.text, fromUTF16Offset: safeWordStart)
                : paragraph.text
            let trimmedText = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedText.isEmpty else { continue }

            let wouldExceedMaximum = !pieces.isEmpty && characterCount + trimmedText.count > narrationChunkMaximumCharacters
            let hasEnoughText = characterCount >= narrationChunkMinimumCharacters
            let hasEnoughParagraphs = paragraphCount >= narrationChunkMaximumParagraphs
            if hasEnoughParagraphs || (wouldExceedMaximum && hasEnoughText) {
                break
            }

            let paragraphWordRanges = wordRanges(in: text)
            let remainingCharacters = max(1, narrationChunkMaximumCharacters - characterCount)
            let remainingHardCharacters = max(remainingCharacters, narrationChunkHardMaximumCharacters - characterCount)
            let piece = limitedNarrationText(
                trimmedText,
                maxCharacters: remainingCharacters,
                hardMaxCharacters: remainingHardCharacters
            )
            let includedWordCount = wordRanges(in: piece).count
            guard !piece.isEmpty, includedWordCount > 0 else { continue }

            pieces.append(piece)
            characterCount += piece.count
            paragraphCount += 1
            endParagraphIndex = index

            let localOffset = index == paragraphIndex ? safeWordStart : 0
            for range in paragraphWordRanges.prefix(includedWordCount) {
                let actualRange = NSRange(location: localOffset + range.location, length: range.length)
                let word = (paragraph.text as NSString).substring(with: actualRange)
                wordMarkers.append(
                    NarrationWordMarker(
                        paragraphIndex: index,
                        range: actualRange,
                        weight: narrationWordWeight(word),
                        speechTokenCount: narrationSpeechTokenCount(forWord: word),
                        startSeconds: nil,
                        endSeconds: nil
                    )
                )
            }
            if includedWordCount < paragraphWordRanges.count {
                continuationParagraphIndex = index
                continuationWordStart = localOffset + paragraphWordRanges[includedWordCount].location
                break
            }

            if characterCount >= narrationChunkMaximumCharacters {
                break
            }
        }

        guard !pieces.isEmpty else { return nil }
        return NarrationChunk(
            startParagraphIndex: paragraphIndex,
            startWordStart: safeWordStart,
            text: pieces.joined(separator: " "),
            firstParagraphID: book.paragraphs[paragraphIndex].id,
            endParagraphIndex: endParagraphIndex,
            continuationParagraphIndex: continuationParagraphIndex,
            continuationWordStart: continuationWordStart,
            wordMarkers: wordMarkers
        )
    }

    nonisolated private static func narrationChunk(
        _ chunk: NarrationChunk,
        alignedToAudioDuration duration: Double,
        wordTimings: [KokoroWordTiming] = []
    ) -> NarrationChunk {
        let alignedMarkers = narrationWordMarkers(
            chunk.wordMarkers,
            alignedToAudioDuration: duration,
            wordTimings: wordTimings
        )
        return NarrationChunk(
            startParagraphIndex: chunk.startParagraphIndex,
            startWordStart: chunk.startWordStart,
            text: chunk.text,
            firstParagraphID: chunk.firstParagraphID,
            endParagraphIndex: chunk.endParagraphIndex,
            continuationParagraphIndex: chunk.continuationParagraphIndex,
            continuationWordStart: chunk.continuationWordStart,
            wordMarkers: alignedMarkers
        )
    }

    nonisolated private static func narrationWordMarkers(
        _ markers: [NarrationWordMarker],
        alignedToAudioDuration duration: Double,
        wordTimings: [KokoroWordTiming] = []
    ) -> [NarrationWordMarker] {
        guard duration.isFinite, duration > 0, !markers.isEmpty else { return markers }

        if let timedMarkers = narrationWordMarkers(markers, alignedToWordTimings: wordTimings) {
            return timedMarkers
        }

        let totalWeight = totalNarrationWeight(in: markers)
        guard totalWeight > 0 else { return markers }

        var runningWeight = 0.0
        return markers.map { marker in
            let start = duration * min(0.995, max(0, runningWeight / totalWeight))
            runningWeight += marker.weight
            let end = duration * min(0.998, max(0, runningWeight / totalWeight))
            return marker.aligned(startSeconds: start, endSeconds: max(start + 0.015, end))
        }
    }

    nonisolated private static func narrationWordMarkers(
        _ markers: [NarrationWordMarker],
        alignedToWordTimings wordTimings: [KokoroWordTiming]
    ) -> [NarrationWordMarker]? {
        let timings = wordTimings.filter {
            $0.start.isFinite &&
            $0.end.isFinite &&
            $0.end > $0.start &&
            $0.text.rangeOfCharacter(from: CharacterSet.alphanumerics) != nil
        }
        guard !markers.isEmpty, !timings.isEmpty else { return nil }

        if timings.count == markers.count {
            return zip(markers, timings).map { marker, timing in
                marker.aligned(startSeconds: timing.start, endSeconds: timing.end)
            }
        }

        var timingIndex = 0
        var aligned: [NarrationWordMarker] = []
        aligned.reserveCapacity(markers.count)

        for marker in markers {
            let speechTokenCount = max(1, marker.speechTokenCount)
            guard timingIndex < timings.count else { return nil }
            let endIndex = min(timings.count - 1, timingIndex + speechTokenCount - 1)
            let start = timings[timingIndex].start
            let end = timings[endIndex].end
            guard end > start else { return nil }
            aligned.append(marker.aligned(startSeconds: start, endSeconds: end))
            timingIndex = endIndex + 1
        }

        return aligned
    }

    nonisolated private static func narrationSpeechTokenCount(forWord word: String) -> Int {
        max(1, wordRanges(in: narrationTextForSpeech(word)).count)
    }

    nonisolated private static func nextNarrationStart(
        in book: ReaderBook,
        after chunk: NarrationChunk
    ) -> (paragraphIndex: Int, wordStart: Int)? {
        if let paragraphIndex = chunk.continuationParagraphIndex,
           let wordStart = chunk.continuationWordStart {
            return (paragraphIndex, wordStart)
        }

        guard book.paragraphs.indices.contains(chunk.endParagraphIndex) else { return nil }
        guard let nextIndex = book.paragraphs.indices.dropFirst(chunk.endParagraphIndex + 1).first(where: {
            !book.paragraphs[$0].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }) else { return nil }

        return (nextIndex, 0)
    }

    nonisolated private static func limitedNarrationText(
        _ text: String,
        maxCharacters: Int,
        hardMaxCharacters: Int
    ) -> String {
        guard text.count > maxCharacters else { return text }

        let limitIndex = text.index(text.startIndex, offsetBy: maxCharacters)
        let hardLimit = min(text.count, max(maxCharacters, hardMaxCharacters))
        let hardLimitIndex = text.index(text.startIndex, offsetBy: hardLimit)
        let hardPrefix = String(text[..<hardLimitIndex])

        if let boundaryEnd = narrationBoundaryEnds(in: hardPrefix).first(where: {
            hardPrefix.distance(from: hardPrefix.startIndex, to: $0) >= maxCharacters
        }) {
            return String(hardPrefix[..<boundaryEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        let prefix = String(text[..<limitIndex])
        let minimum = min(narrationChunkPreferredSentenceMinimumCharacters, prefix.count)
        if let boundaryEnd = narrationBoundaryEnds(in: prefix).last(where: {
            prefix.distance(from: prefix.startIndex, to: $0) >= minimum
        }) {
            return String(prefix[..<boundaryEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let whitespace = prefix.lastIndex(where: \.isWhitespace),
           prefix.distance(from: prefix.startIndex, to: whitespace) >= narrationChunkPreferredSentenceMinimumCharacters {
            return String(prefix[..<whitespace]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return prefix.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated private static func narrationBoundaryEnds(in text: String) -> [String.Index] {
        var boundaries: [String.Index] = []

        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            if ".!?;".contains(character) {
                let next = text.index(after: index)
                if (next == text.endIndex || text[next].isWhitespace),
                   !isNonTerminalSentencePeriod(in: text, at: index) {
                    boundaries.append(next)
                }
            }
            index = text.index(after: index)
        }

        return boundaries
    }

    nonisolated private static func isNonTerminalSentencePeriod(in text: String, at periodIndex: String.Index) -> Bool {
        guard text[periodIndex] == "." else { return false }

        let throughPeriod = String(text[...periodIndex]).lowercased()
        if narrationMultiPeriodAbbreviations.contains(where: { throughPeriod.hasSuffix($0) }) {
            return true
        }

        var tokenStart = periodIndex
        while tokenStart > text.startIndex {
            let previous = text.index(before: tokenStart)
            guard text[previous].isLetter else { break }
            tokenStart = previous
        }

        let token = String(text[tokenStart..<periodIndex]).lowercased()
        if token.count == 1 {
            return true
        }

        if narrationNonTerminalAbbreviations.contains(token) {
            return true
        }

        let next = nextNonWhitespaceCharacter(in: text, after: periodIndex)
        if narrationNumberedReferenceAbbreviations.contains(token) {
            return next?.isNumber == true
        }
        if narrationLowercaseContinuationAbbreviations.contains(token) {
            return next?.isLowercase == true
        }

        return false
    }

    nonisolated private static func nextNonWhitespaceCharacter(in text: String, after index: String.Index) -> Character? {
        var next = text.index(after: index)
        while next < text.endIndex {
            let character = text[next]
            if !character.isWhitespace {
                return character
            }
            next = text.index(after: next)
        }

        return nil
    }

    nonisolated private static func narrationTextForSpeech(_ text: String) -> String {
        let text = narrationTextRemovingFalseSentencePeriods(text)
        var result = ""
        var index = text.startIndex

        while index < text.endIndex {
            if text[index].isNumber,
               let end = fourDigitNumberEnd(in: text, from: index),
               let year = Int(text[index..<end]),
               let yearText = spokenYear(year),
               isStandaloneNumber(in: text, start: index, end: end) {
                result += yearText
                index = end
            } else {
                result.append(text[index])
                index = text.index(after: index)
            }
        }

        return result
    }

    nonisolated private static func narrationTextRemovingFalseSentencePeriods(_ text: String) -> String {
        var text = text
        for replacement in narrationSpeechMultiPeriodReplacements {
            text = text.replacingOccurrences(
                of: replacement.pattern,
                with: replacement.replacement,
                options: [.regularExpression, .caseInsensitive]
            )
        }

        var result = ""
        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            if character == ".",
               isNonTerminalSentencePeriod(in: text, at: index) {
                index = text.index(after: index)
                continue
            }

            result.append(character)
            index = text.index(after: index)
        }

        return result
    }

    nonisolated private static func fourDigitNumberEnd(in text: String, from start: String.Index) -> String.Index? {
        var index = start
        var count = 0

        while index < text.endIndex, text[index].isNumber {
            count += 1
            guard count <= 4 else { return nil }
            index = text.index(after: index)
        }

        return count == 4 ? index : nil
    }

    nonisolated private static func isStandaloneNumber(in text: String, start: String.Index, end: String.Index) -> Bool {
        if start > text.startIndex {
            let previous = text.index(before: start)
            if text[previous].isLetter || text[previous].isNumber || text[previous] == "." || text[previous] == "," {
                return false
            }
        }

        if end < text.endIndex {
            let next = text[end]
            if next.isLetter || next.isNumber || next == "." || next == "," {
                return false
            }
        }

        return true
    }

    nonisolated private static func spokenYear(_ year: Int) -> String? {
        guard (1000...2099).contains(year) else { return nil }

        if year == 2000 {
            return "two thousand"
        }

        if (2001...2009).contains(year),
           let yearSuffix = spokenNumberUnder100(year - 2000) {
            return "two thousand \(yearSuffix)"
        }

        if (2010...2099).contains(year),
           let yearSuffix = spokenNumberUnder100(year - 2000) {
            return "twenty \(yearSuffix)"
        }

        let leading = year / 100
        let trailing = year % 100
        guard let leadingText = spokenNumberUnder100(leading) else { return nil }

        if trailing == 0 {
            return "\(leadingText) hundred"
        }

        if trailing < 10 {
            return "\(leadingText) oh \(spokenNumberUnder100(trailing) ?? "")"
        }

        guard let trailingText = spokenNumberUnder100(trailing) else { return nil }
        return "\(leadingText) \(trailingText)"
    }

    nonisolated private static func spokenNumberUnder100(_ number: Int) -> String? {
        let smallNumbers = [
            "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
            "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
            "sixteen", "seventeen", "eighteen", "nineteen"
        ]
        let tens = [
            2: "twenty",
            3: "thirty",
            4: "forty",
            5: "fifty",
            6: "sixty",
            7: "seventy",
            8: "eighty",
            9: "ninety"
        ]

        if (0..<smallNumbers.count).contains(number) {
            return smallNumbers[number]
        }

        let tensValue = number / 10
        let onesValue = number % 10
        guard let tensText = tens[tensValue] else { return nil }

        if onesValue == 0 {
            return tensText
        }

        return "\(tensText) \(smallNumbers[onesValue])"
    }

    nonisolated private static func narrationWordIndex(in markers: [NarrationWordMarker], at targetWeight: Double) -> Int {
        guard !markers.isEmpty else { return 0 }

        let clampedTarget = max(0, targetWeight)
        var runningWeight = 0.0
        for (index, marker) in markers.enumerated() {
            runningWeight += marker.weight
            if clampedTarget <= runningWeight {
                return index
            }
        }

        return markers.count - 1
    }

    nonisolated private static func narrationWordIndex(
        in markers: [NarrationWordMarker],
        atPlaybackTime playbackSeconds: Double
    ) -> Int? {
        guard playbackSeconds.isFinite,
              markers.contains(where: { $0.startSeconds != nil && $0.endSeconds != nil }) else {
            return nil
        }

        let clampedTime = max(0, playbackSeconds)
        for (index, marker) in markers.enumerated() {
            guard let start = marker.startSeconds,
                  let end = marker.endSeconds else { continue }
            if clampedTime < start {
                return max(0, index - 1)
            }
            if clampedTime >= start && clampedTime < end {
                return index
            }
        }

        return markers.count - 1
    }

    nonisolated private static func totalNarrationWeight(in markers: [NarrationWordMarker]) -> Double {
        markers.reduce(0) { $0 + $1.weight }
    }

    nonisolated private static func narrationWordWeight(_ word: String) -> Double {
        let letterCount = word.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) }.count
        let lengthWeight = min(2.4, max(0.72, Double(letterCount) / 4.8))
        let punctuationWeight: Double
        if word.rangeOfCharacter(from: CharacterSet(charactersIn: ".!?")) != nil {
            punctuationWeight = 0.82
        } else if word.rangeOfCharacter(from: CharacterSet(charactersIn: ";:")) != nil {
            punctuationWeight = 0.54
        } else if word.rangeOfCharacter(from: CharacterSet(charactersIn: ",")) != nil {
            punctuationWeight = 0.34
        } else {
            punctuationWeight = 0
        }

        return lengthWeight + punctuationWeight
    }

    private static func kokoroSpeechRate(from value: Double) -> Double {
        min(2.0, max(0.7, value))
    }

    func generateImage(text: String, chunkIndex: Int, startWord: Int, endWord: Int) async {
        guard let row = activeBookRow, let accessToken = session?.accessToken else { return }
        if readerImageChunkIndex == chunkIndex,
           readerImageStyle == readerSettings.imageStyle,
           readerImagePhase == .checking || readerImagePhase == .generating || readerImagePhase == .ready {
            return
        }
        let bookTitle = activeBook?.title ?? row.title
        let author = activeBook?.author ?? row.author
        let style = readerSettings.imageStyle
        let prefetchKey = ReaderImagePrefetchKey(bookID: row.id, chunkIndex: chunkIndex, style: style)
        if let prefetchTask = readerImagePrefetchTasks[prefetchKey] {
            readerImageChunkIndex = chunkIndex
            readerImageStyle = style
            readerImageResponse = nil
            readerImagePhase = .generating
            let prefetchedResponse = await prefetchTask.value
            readerImagePrefetchTasks[prefetchKey] = nil
            guard activeBookRow?.id == row.id,
                  readerImageChunkIndex == chunkIndex,
                  readerImageStyle == style,
                  !Task.isCancelled else { return }
            if let prefetchedResponse {
                readerImageResponse = prefetchedResponse
                applyReaderImageCount(prefetchedResponse.imageCount, plan: prefetchedResponse.plan)
                if prefetchedResponse.imageUrl != nil {
                    await preloadReaderImageIfNeeded(prefetchedResponse.imageUrl)
                    readerImagePhase = .ready
                } else if prefetchedResponse.limitReached == true {
                    handleReaderImageLimitReached(prefetchedResponse)
                } else {
                    readerImagePhase = .error
                }
                return
            }
        }
        await runReaderImageTask { [self] in
            readerImageChunkIndex = chunkIndex
            readerImageStyle = style
            readerImagePhase = .checking
            let checkResponse = try await backend.invokeReaderImage(
                ReaderImageFunctionRequest(
                    author: author,
                    bookId: row.id,
                    bookTitle: bookTitle,
                    checkOnly: true,
                    chunkIndex: chunkIndex,
                    startWord: startWord,
                    endWord: endWord,
                    imageStyle: style,
                    text: text,
                    style: style
                ),
                accessToken: accessToken
            )

            applyReaderImageCount(checkResponse.imageCount, plan: checkResponse.plan)
            if checkResponse.imageUrl != nil {
                readerImageResponse = checkResponse
                await preloadReaderImageIfNeeded(checkResponse.imageUrl)
                readerImagePhase = .ready
                return
            }
            if checkResponse.limitReached == true || !canRequestNewReaderImage {
                handleReaderImageLimitReached(checkResponse)
                return
            }

            readerImagePhase = .generating
            let generationResponse = try await backend.invokeReaderImage(
                ReaderImageFunctionRequest(
                    author: author,
                    bookId: row.id,
                    bookTitle: bookTitle,
                    checkOnly: nil,
                    chunkIndex: chunkIndex,
                    startWord: startWord,
                    endWord: endWord,
                    imageStyle: style,
                    text: text,
                    style: style
                ),
                accessToken: accessToken
            )
            readerImageResponse = generationResponse
            readerImageChunkIndex = chunkIndex
            readerImageStyle = style
            applyReaderImageCount(generationResponse.imageCount, plan: generationResponse.plan)
            if generationResponse.imageUrl != nil {
                await preloadReaderImageIfNeeded(generationResponse.imageUrl)
                readerImagePhase = .ready
            } else if generationResponse.limitReached == true {
                readerImagePhase = .error
            }
            if generationResponse.imageCount == nil {
                await reload()
            }
        }
    }

    func prefetchImage(text: String, chunkIndex: Int, startWord: Int, endWord: Int) {
        guard let row = activeBookRow,
              let book = activeBook,
              let accessToken = session?.accessToken else { return }
        let style = readerSettings.imageStyle
        let key = ReaderImagePrefetchKey(bookID: row.id, chunkIndex: chunkIndex, style: style)
        guard readerImagePrefetchTasks[key] == nil else { return }
        if readerImageChunkIndex == chunkIndex,
           readerImageStyle == style,
           readerImagePhase == .checking || readerImagePhase == .generating || readerImagePhase == .ready {
            return
        }
        guard canRequestNewReaderImage else { return }

        let request = ReaderImageFunctionRequest(
            author: book.author,
            bookId: row.id,
            bookTitle: book.title,
            checkOnly: nil,
            chunkIndex: chunkIndex,
            startWord: startWord,
            endWord: endWord,
            imageStyle: style,
            text: text,
            style: style
        )
        let task = Task { [backend] in
            try? await backend.invokeReaderImage(request, accessToken: accessToken)
        }
        readerImagePrefetchTasks[key] = task

        Task { [weak self] in
            let response = await task.value
            guard let self else { return }
            if response == nil, self.readerImagePrefetchTasks[key] != nil {
                self.readerImagePrefetchTasks[key] = nil
            }
            guard let response else { return }
            self.applyReaderImageCount(response.imageCount, plan: response.plan)
            await self.preloadReaderImageIfNeeded(response.imageUrl)
            if response.imageCount == nil,
               let usage = try? await self.backend.loadReaderImageUsage(accessToken: accessToken) {
                self.readerImageUsage = usage
            }
        }
    }

    func cancelReaderImagePrefetching() {
        cancelReaderImagePrefetchTasks()
    }

    private func cancelReaderImagePrefetchTasks() {
        readerImagePrefetchTasks.values.forEach { $0.cancel() }
        readerImagePrefetchTasks.removeAll()
    }

    private func prepareReaderImageForOpening(
        book: ReaderBook,
        row: BookRow,
        accessToken: String
    ) async -> PendingReaderImageGeneration? {
        guard let chunk = Self.readerImageChunk(in: book, currentIndex: row.currentIndex) else { return nil }
        let style = readerSettings.imageStyle
        let request = ReaderImageFunctionRequest(
            author: book.author,
            bookId: row.id,
            bookTitle: book.title,
            checkOnly: true,
            chunkIndex: chunk.index,
            startWord: chunk.startWord,
            endWord: chunk.endWord,
            imageStyle: style,
            text: chunk.text,
            style: style
        )

        var pendingGeneration: PendingReaderImageGeneration?
        await runReaderImageTask { [self] in
            readerImageChunkIndex = chunk.index
            readerImageStyle = style
            readerImagePhase = .checking
            let checkResponse = try await backend.invokeReaderImage(request, accessToken: accessToken)
            applyReaderImageCount(checkResponse.imageCount, plan: checkResponse.plan)

            if checkResponse.imageUrl != nil {
                readerImageResponse = checkResponse
                readerImagePhase = .ready
                return
            }
            if checkResponse.limitReached == true || !canRequestNewReaderImage {
                handleReaderImageLimitReached(checkResponse)
                return
            }

            readerImageResponse = nil
            readerImagePhase = .generating
            pendingGeneration = PendingReaderImageGeneration(chunk: chunk, style: style)
        }
        return pendingGeneration
    }

    private func startReaderImageGeneration(
        book: ReaderBook,
        row: BookRow,
        chunk: ReaderImageRequestChunk,
        accessToken: String,
        style: ReaderImageStyle
    ) {
        readerImageGenerationTask?.cancel()
        readerImageGenerationTask = Task { [weak self] in
            guard let self else { return }
            await self.finishReaderImageGeneration(
                book: book,
                row: row,
                chunk: chunk,
                accessToken: accessToken,
                style: style
            )
        }
    }

    private func finishReaderImageGeneration(
        book: ReaderBook,
        row: BookRow,
        chunk: ReaderImageRequestChunk,
        accessToken: String,
        style: ReaderImageStyle
    ) async {
        await runReaderImageTask { [self] in
            guard canRequestNewReaderImage else {
                showReaderImageLimitPrompt()
                return
            }
            let generationResponse = try await backend.invokeReaderImage(
                ReaderImageFunctionRequest(
                    author: book.author,
                    bookId: row.id,
                    bookTitle: book.title,
                    checkOnly: nil,
                    chunkIndex: chunk.index,
                    startWord: chunk.startWord,
                    endWord: chunk.endWord,
                    imageStyle: style,
                    text: chunk.text,
                    style: style
                ),
                accessToken: accessToken
            )
            guard activeBookRow?.id == row.id,
                  readerImageChunkIndex == chunk.index,
                  readerImageStyle == style,
                  !Task.isCancelled else { return }

            readerImageResponse = generationResponse
            applyReaderImageCount(generationResponse.imageCount, plan: generationResponse.plan)
            if generationResponse.imageUrl != nil {
                readerImagePhase = .ready
            } else if generationResponse.limitReached == true {
                readerImagePhase = .error
            } else {
                readerImagePhase = .generating
            }
            if generationResponse.imageCount == nil {
                await reload()
            }
        }
    }

    private func preloadReaderImageIfNeeded(_ imageUrl: String?) async {
        guard let imageUrl,
              !imageUrl.lowercased().hasPrefix("data:image/"),
              let url = URL(string: imageUrl) else { return }

        _ = try? await withThrowingTaskGroup(of: Data?.self) { group in
            group.addTask {
                let (data, _) = try await URLSession.shared.data(from: url)
                return data
            }
            group.addTask {
                try await Task.sleep(for: .seconds(6))
                return nil
            }
            let data = try await group.next() ?? nil
            group.cancelAll()
            return data
        }
    }

    private struct ReaderImageRequestChunk: Sendable {
        let endWord: Int
        let index: Int
        let startWord: Int
        let text: String
    }

    private struct MeaningfulStart: Sendable {
        let index: Int
        let page: Int
    }

    nonisolated private static let startTitlePatterns: [String] = [
        #"(?i)\bintroduction\b"#,
        #"(?i)\bpreface\b"#,
        #"(?i)\bforeword\b"#,
        #"(?i)\bprologue\b"#,
        #"(?i)\bchapter\s*(?:1|one|i)\b"#,
        #"(?i)^i$"#,
        #"(?i)^(?:1|one|i)[\s.:;-]+"#
    ]

    nonisolated private static let frontMatterTitlePatterns: [String] = [
        #"(?i)\bcover\b"#,
        #"(?i)\btitle\s+page\b"#,
        #"(?i)\bcopyright\b"#,
        #"(?i)\bcontents\b"#,
        #"(?i)\btable\s+of\s+contents\b"#,
        #"(?i)\bdedication\b"#,
        #"(?i)\bepigraph\b"#,
        #"(?i)\backnowledg"#,
        #"(?i)\babout\s+the\s+(?:author|book)\b"#,
        #"(?i)\balso\s+by\b"#
    ]

    nonisolated private static func resolveMeaningfulStart(
        in book: ReaderBook,
        requestedIndex: Int,
        savedIndex: Int,
        savedPage: Int
    ) -> MeaningfulStart {
        let safeSavedPage = max(1, savedPage)
        let fallbackIndex = book.paragraphs.isEmpty ? 0 : min(max(requestedIndex, 0), book.paragraphs.count - 1)
        let fallbackPage = clampedPage(safeSavedPage, in: book)
        let hasSavedProgress = savedIndex > 0 || safeSavedPage > 1 || requestedIndex > 0
        if hasSavedProgress {
            return MeaningfulStart(index: fallbackIndex, page: fallbackPage)
        }

        if let preferredChapterIndex = book.chapters.firstIndex(where: { isPreferredStartTitle($0, bookTitle: book.title) }) {
            let page = book.chapterPageNumbers.indices.contains(preferredChapterIndex) ? book.chapterPageNumbers[preferredChapterIndex] : 1
            let index = firstParagraphIndex(forChapter: preferredChapterIndex, in: book)
            return MeaningfulStart(index: index ?? fallbackIndex, page: clampedPage(page, in: book))
        }

        if let preferredHeadingIndex = book.paragraphs.firstIndex(where: { $0.kind == .heading && isPreferredStartTitle($0.text, bookTitle: book.title) }) {
            let page = book.paragraphs[preferredHeadingIndex].pageNumber ?? 1
            return MeaningfulStart(index: preferredHeadingIndex, page: clampedPage(page, in: book))
        }

        if let firstContentChapterIndex = book.chapters.firstIndex(where: { !isFrontMatterTitle($0, bookTitle: book.title) }) {
            let page = book.chapterPageNumbers.indices.contains(firstContentChapterIndex) ? book.chapterPageNumbers[firstContentChapterIndex] : 1
            let index = firstParagraphIndex(forChapter: firstContentChapterIndex, in: book)
            return MeaningfulStart(index: index ?? fallbackIndex, page: clampedPage(page, in: book))
        }

        if let firstContentParagraphIndex = book.paragraphs.firstIndex(where: { !isFrontMatterTitle($0.chapterTitle, bookTitle: book.title) }) {
            let page = book.paragraphs[firstContentParagraphIndex].pageNumber ?? 1
            return MeaningfulStart(index: firstContentParagraphIndex, page: clampedPage(page, in: book))
        }

        return MeaningfulStart(index: fallbackIndex, page: fallbackPage)
    }

    nonisolated private static func firstParagraphIndex(forChapter chapterIndex: Int, in book: ReaderBook) -> Int? {
        book.paragraphs.firstIndex { $0.chapterIndex == chapterIndex }
    }

    nonisolated private static func isPreferredStartTitle(_ title: String, bookTitle: String) -> Bool {
        let normalised = normaliseStartTitle(title)
        guard !normalised.isEmpty,
              normaliseStartTitle(bookTitle).lowercased() != normalised.lowercased() else { return false }
        return titleMatches(normalised, patterns: startTitlePatterns)
    }

    nonisolated private static func isFrontMatterTitle(_ title: String, bookTitle: String) -> Bool {
        let normalised = normaliseStartTitle(title)
        if normalised.isEmpty { return true }
        if normaliseStartTitle(bookTitle).lowercased() == normalised.lowercased() { return true }
        return titleMatches(normalised, patterns: frontMatterTitlePatterns)
    }

    nonisolated private static func normaliseStartTitle(_ title: String) -> String {
        title.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated private static func titleMatches(_ title: String, patterns: [String]) -> Bool {
        guard !title.isEmpty else { return false }
        return patterns.contains { title.range(of: $0, options: .regularExpression) != nil }
    }

    nonisolated private static func clampedPage(_ page: Int, in book: ReaderBook) -> Int {
        max(1, min(page, book.pageCount ?? page))
    }

    nonisolated static func meaningfulContentStartIndex(in book: ReaderBook) -> Int {
        resolveMeaningfulStart(in: book, requestedIndex: 0, savedIndex: 0, savedPage: 1).index
    }

    nonisolated private static func readerImageChunk(in book: ReaderBook, currentIndex: Int) -> ReaderImageRequestChunk? {
        guard !book.paragraphs.isEmpty else { return nil }

        var chunks: [ReaderImageRequestChunk] = []
        var chunkWords: [String] = []
        var chunkStartWord = 1
        var totalWords = 0
        let contentStart = meaningfulContentStartIndex(in: book)
        let target = min(max(currentIndex, contentStart), book.paragraphs.count - 1)
        var targetWordStart = 0

        for (index, paragraph) in book.paragraphs.enumerated() {
            if index == target {
                targetWordStart = totalWords
            }
            guard paragraph.kind != .heading else { continue }

            let words = paragraph.text.split(whereSeparator: \.isWhitespace).map(String.init)
            guard index >= contentStart else {
                totalWords += words.count
                chunkStartWord += words.count
                continue
            }
            for word in words {
                if chunkWords.count == readerImageRequestChunkWords {
                    let chunkIndex = chunks.count
                    chunks.append(
                        ReaderImageRequestChunk(
                            endWord: chunkStartWord + chunkWords.count - 1,
                            index: chunkIndex,
                            startWord: chunkStartWord,
                            text: chunkWords.joined(separator: " ")
                        )
                    )
                    chunkStartWord += chunkWords.count
                    chunkWords.removeAll(keepingCapacity: true)
                }
                chunkWords.append(word)
                totalWords += 1
            }
        }

        if !chunkWords.isEmpty {
            let chunkIndex = chunks.count
            chunks.append(
                ReaderImageRequestChunk(
                    endWord: chunkStartWord + chunkWords.count - 1,
                    index: chunkIndex,
                    startWord: chunkStartWord,
                    text: chunkWords.joined(separator: " ")
                )
            )
        }

        let targetWordNumber = max(1, targetWordStart + 1)
        return chunks.last(where: { $0.startWord <= targetWordNumber }) ?? chunks.first
    }

    private func preGenerateReaderImage(
        for row: BookRow,
        book: ReaderBook,
        chunk: ReaderImageRequestChunk,
        accessToken: String
    ) async throws {
        guard canRequestNewReaderImage else {
            showReaderImageLimitPrompt()
            return
        }
        let response = try await backend.invokeReaderImage(
            ReaderImageFunctionRequest(
                author: book.author,
                bookId: row.id,
                bookTitle: book.title,
                checkOnly: nil,
                chunkIndex: chunk.index,
                startWord: chunk.startWord,
                endWord: chunk.endWord,
                imageStyle: readerSettings.imageStyle,
                text: chunk.text,
                style: readerSettings.imageStyle
            ),
            accessToken: accessToken
        )
        applyReaderImageCount(response.imageCount, plan: response.plan)
        if response.imageCount == nil {
            let usage = try? await backend.loadReaderImageUsage(accessToken: accessToken)
            let loadedIsPro = BillingAccess.hasProAccess(profile: billingProfile) || billing.hasActiveProEntitlement
            let imageRows = try? await backend.countReaderImages(
                accessToken: accessToken,
                since: loadedIsPro ? Self.currentMonthStartUTC() : nil
            )
            readerImageUsage = usage
            readerImageRowCount = imageRows ?? readerImageRowCount
        }
    }

    func purchasePro() async {
        guard let accessToken = session?.accessToken else { return }
        await runBusy { [self] in
            try await billing.purchase(accessToken: accessToken)
            await reload()
        }
    }

    func restorePro() async {
        guard let accessToken = session?.accessToken else { return }
        await runBusy { [self] in
            try await billing.restore(accessToken: accessToken)
            await reload()
        }
    }

    private func runBusy(_ operation: @escaping () async throws -> Void) async {
        isLoading = true
        notice = ""
        do {
            try await operation()
        } catch {
            notice = error.localizedDescription
        }
        isLoading = false
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }
        if let urlError = error as? URLError, urlError.code == .cancelled {
            return true
        }
        return (error as NSError).code == NSUserCancelledError
    }

    private func runReaderImageTask(_ operation: @escaping () async throws -> Void) async {
        notice = ""
        do {
            try await operation()
        } catch {
            readerImagePhase = .error
            notice = error.localizedDescription
        }
    }

    private func runImporting(_ operation: @escaping () async throws -> Void) async {
        isImporting = true
        notice = ""
        do {
            try await operation()
        } catch {
            notice = error.localizedDescription
        }
        isImporting = false
    }

    private func addPendingImport(id: String, fileName: String) {
        pendingBookImports.append(
            PendingBookImport(
                id: id,
                title: fileName,
                author: "",
                coverUrl: nil,
                fileName: fileName,
                progress: 0,
                statusText: "Uploading"
            )
        )
    }

    private func updatePendingImport(
        id: String,
        author: String? = nil,
        coverUrl: String? = nil,
        progress: Int? = nil,
        statusText: String? = nil,
        title: String? = nil
    ) {
        guard let index = pendingBookImports.firstIndex(where: { $0.id == id }) else { return }
        if let author {
            pendingBookImports[index].author = author
        }
        if let coverUrl {
            pendingBookImports[index].coverUrl = coverUrl
        }
        if let progress {
            pendingBookImports[index].progress = min(100, max(0, progress))
        }
        if let statusText {
            pendingBookImports[index].statusText = statusText
        }
        if let title {
            pendingBookImports[index].title = title
        }
    }

    private func removePendingImport(id: String) {
        pendingBookImports.removeAll { $0.id == id }
    }

    private func clearUploadedBookNotice() {
        uploadedBookNoticeTask?.cancel()
        uploadedBookNoticeTask = nil
        withAnimation(IllumeTheme.blurLoadIn) {
            uploadedBookNotice = nil
        }
    }

    private func startPendingImportProgressAnimation(id: String, from start: Int, through limit: Int) -> Task<Void, Never> {
        Task { @MainActor [weak self] in
            var progress = start
            while !Task.isCancelled && progress < limit {
                try? await Task.sleep(for: .milliseconds(560))
                guard !Task.isCancelled, let self else { return }
                guard let current = self.pendingBookImports.first(where: { $0.id == id })?.progress else { return }
                progress = min(limit, max(progress + 1, current + 1))
                withAnimation(IllumeTheme.blurLoadIn) {
                    self.updatePendingImport(id: id, progress: progress)
                }
            }
        }
    }

    private func showUploadedBookNotice(_ title: String) {
        uploadedBookNoticeTask?.cancel()
        withAnimation(IllumeTheme.blurLoadIn) {
            uploadedBookNotice = title
        }
        uploadedBookNoticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4.2))
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard self?.uploadedBookNotice == title else { return }
                withAnimation(IllumeTheme.blurLoadIn) {
                    self?.uploadedBookNotice = nil
                }
                self?.uploadedBookNoticeTask = nil
            }
        }
    }

    private static func dataLooksLikeEpub(_ data: Data) -> Bool {
        data.count >= 4
            && data[0] == 0x50
            && data[1] == 0x4B
            && data[2] == 0x03
            && data[3] == 0x04
    }

    private static func normalizedTitle(_ title: String) -> String {
        let folded = title
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return folded.unicodeScalars
            .filter { CharacterSet.alphanumerics.contains($0) }
            .map(String.init)
            .joined()
    }

    private func runOpening(_ row: BookRow, _ operation: @escaping () async throws -> Void) async {
        openingBook = row
        notice = ""
        do {
            try await operation()
        } catch {
            notice = error.localizedDescription
        }
        openingBook = nil
    }

    private func apply(session next: AuthSession) {
        session = next
        KeychainStore.save(session: next)
    }

    private func applyReaderImageCount(_ count: Int?, plan: String?) {
        guard let count else { return }
        let usageIsPro = plan?.lowercased() == "pro" || isPro
        var usage = readerImageUsage ?? ReaderImageUsage(userId: session?.user.id)
        if usageIsPro {
            usage.monthlyGeneratedCount = count
            usage.monthlyPeriodStart = Self.currentMonthStartUTC()
        } else {
            usage.generatedCount = count
        }
        readerImageUsage = usage
        readerImageRowCount = max(readerImageRowCount, count)
    }

    private var canRequestNewReaderImage: Bool {
        imageUsageCount < imageLimit
    }

    private func handleReaderImageLimitReached(_ response: ReaderImageFunctionResponse) {
        readerImageResponse = response
        readerImagePhase = .limitReached
        showReaderImageLimitPrompt()
    }

    private func showReaderImageLimitPrompt() {
        readerImagePhase = .limitReached
        proUpgradePrompt = ProUpgradePrompt(
            used: imageUsageCount,
            limit: imageLimit,
            isPro: isPro
        )
    }

    private static func currentMonthStartUTC(now: Date = Date()) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        let components = calendar.dateComponents([.year, .month], from: now)
        return calendar.date(from: components) ?? now
    }

    nonisolated private static func cachedParsedReaderBook(for row: BookRow) -> ReaderBook? {
        let url = parsedReaderBookCacheURL(for: row.id)
        guard FileManager.default.fileExists(atPath: url.path),
              let data = try? Data(contentsOf: url),
              let cached = try? IllumeJSON.decoder().decode(CachedReaderBook.self, from: data),
              cached.schemaVersion == 1,
              cached.bookID == row.id,
              cached.documentType == row.documentType,
              cached.storagePath == row.storagePath,
              cached.fileSize == row.fileSize,
              cached.pageCount == row.pageCount,
              cached.paragraphCount == row.paragraphCount,
              cached.chapterCount == row.chapterCount,
              !cached.book.paragraphs.isEmpty else {
            return nil
        }
        return cached.book
    }

    nonisolated private static func storeParsedReaderBook(_ book: ReaderBook, for row: BookRow) {
        guard !book.paragraphs.isEmpty else { return }
        let cached = CachedReaderBook(
            schemaVersion: 1,
            bookID: row.id,
            documentType: row.documentType,
            storagePath: row.storagePath,
            fileSize: row.fileSize,
            pageCount: row.pageCount,
            paragraphCount: row.paragraphCount,
            chapterCount: row.chapterCount,
            book: book
        )
        do {
            let directory = parsedReaderBookCacheDirectory()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try IllumeJSON.encoder().encode(cached)
            try data.write(to: parsedReaderBookCacheURL(for: row.id), options: [.atomic])
        } catch {
            print("Could not store parsed reader book cache: \(error)")
        }
    }

    nonisolated private static func applyLibraryMetadata(from row: BookRow, to book: inout ReaderBook) {
        book.title = row.title
        if !row.author.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            book.author = row.author
        }
        book.fileName = row.fileName
        book.coverUrl = row.coverUrl
    }

    nonisolated private static func parsedReaderBookCacheURL(for bookID: UUID) -> URL {
        parsedReaderBookCacheDirectory()
            .appendingPathComponent(bookID.uuidString.lowercased())
            .appendingPathExtension("json")
    }

    nonisolated private static func parsedReaderBookCacheDirectory() -> URL {
        let base = (try? FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )) ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("Illume", isDirectory: true)
            .appendingPathComponent("ParsedBooks", isDirectory: true)
    }

    private func documentType(for url: URL) -> DocumentType {
        if url.pathExtension.lowercased() == "pdf" { return .pdf }
        return .epub
    }

    private func performAppleSignIn() async throws -> AuthSession {
        let nonce = randomNonce()
        appleNonce = nonce
        return try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email]
            request.nonce = sha256(nonce)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            controller.performRequests()
        }
    }

    private func performGoogleSignIn() async throws -> AuthSession {
        let callbackScheme = "com.illumereader.ios"
        let callbackURL = "\(callbackScheme)://auth-callback"
        guard var components = URLComponents(url: SupabaseConfig().url.appending(path: "/auth/v1/authorize"), resolvingAgainstBaseURL: false) else {
            throw AuthSetupError.googleAuthorizeURLInvalid
        }
        components.queryItems = [
            URLQueryItem(name: "provider", value: "google"),
            URLQueryItem(name: "redirect_to", value: callbackURL)
        ]
        guard let authorizeURL = components.url else {
            throw AuthSetupError.googleAuthorizeURLInvalid
        }

        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: authorizeURL, callbackURLScheme: callbackScheme) { url, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let url else {
                    continuation.resume(throwing: AuthSetupError.googleCallbackMissing)
                    return
                }
                continuation.resume(returning: url)
            }
            session.presentationContextProvider = self
            googleWebAuthSession = session
            if !session.start() {
                continuation.resume(throwing: AuthSetupError.googleSessionStartFailed)
            }
        }
        googleWebAuthSession = nil

        let params = oauthParameters(from: callback)
        if let errorDescription = params["error_description"] ?? params["error"] {
            throw AuthSetupError.googleOAuthFailed(errorDescription)
        }
        guard let accessToken = params["access_token"] else {
            throw AuthSetupError.googleAccessTokenMissing
        }
        let user = try await backend.loadUser(accessToken: accessToken)
        return AuthSession(
            accessToken: accessToken,
            refreshToken: params["refresh_token"],
            expiresIn: params["expires_in"].flatMap(Int.init),
            tokenType: params["token_type"],
            user: user
        )
    }

    private func oauthParameters(from url: URL) -> [String: String] {
        var params: [String: String] = [:]
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.forEach {
            params[$0.name] = $0.value
        }
        if let fragment = url.fragment,
           let fragmentItems = URLComponents(string: "?\(fragment)")?.queryItems {
            fragmentItems.forEach { params[$0.name] = $0.value }
        }
        return params
    }

    private func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remainingLength = length
        while remainingLength > 0 {
            var random: UInt8 = 0
            _ = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
            if random < charset.count {
                result.append(charset[Int(random)])
                remainingLength -= 1
            }
        }
        return result
    }

    private func sha256(_ input: String) -> String {
        let data = Data(input.utf8)
        let digest = SHA256.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

private enum AuthSetupError: LocalizedError {
    case googleAccessTokenMissing
    case googleAuthorizeURLInvalid
    case googleCallbackMissing
    case googleOAuthFailed(String)
    case googleSessionStartFailed

    var errorDescription: String? {
        switch self {
        case .googleAccessTokenMissing:
            return "Google sign in did not return an access token."
        case .googleAuthorizeURLInvalid:
            return "Google sign in could not build the Supabase authorization URL."
        case .googleCallbackMissing:
            return "Google sign in did not return to the app."
        case .googleOAuthFailed(let message):
            return message
        case .googleSessionStartFailed:
            return "Google sign in could not start."
        }
    }
}

extension IllumeAppModel: ASAuthorizationControllerDelegate {
    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        Task { @MainActor in
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                appleContinuation?.resume(throwing: ASAuthorizationError(.failed))
                appleContinuation = nil
                return
            }
            do {
                let session = try await backend.exchangeIdToken(provider: "apple", token: token, nonce: appleNonce)
                appleContinuation?.resume(returning: session)
            } catch {
                appleContinuation?.resume(throwing: error)
            }
            appleContinuation = nil
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        Task { @MainActor in
            appleContinuation?.resume(throwing: error)
            appleContinuation = nil
        }
    }
}

extension IllumeAppModel: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        UIApplication.shared.illumeKeyWindow
    }
}

extension IllumeAppModel: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.illumeKeyWindow
    }
}

private extension UIApplication {
    var illumeKeyWindow: UIWindow {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}

struct ReaderSettings: Equatable {
    var textScale: Double = 1.0
    var lineHeight: Double = 1.42
    var lineWidth: Double = 39
    var fontFamily: ReaderFontFamily = .serif
    var narrationRate: Double = 1.0
    var narrationVoice: String = KokoroNarrationVoice.bella.id
    var imageStyle: ReaderImageStyle = .cartoon
}

enum ReaderFontFamily: String, CaseIterable, Identifiable, Sendable {
    case serif
    case sansSerif

    var id: String { rawValue }

    var label: String {
        switch self {
        case .serif:
            return "Serif"
        case .sansSerif:
            return "Sans Serif"
        }
    }

    var sample: String {
        switch self {
        case .serif:
            return "Ag"
        case .sansSerif:
            return "Aa"
        }
    }
}

struct PendingBookImport: Identifiable, Equatable {
    let id: String
    var title: String
    var author: String
    var coverUrl: String?
    var fileName: String
    var progress: Int
    var statusText: String
}

struct ProUpgradePrompt: Identifiable, Equatable {
    let id = UUID()
    let used: Int
    let limit: Int
    let isPro: Bool
}

enum KokoroNarrationVoice: String, CaseIterable, Identifiable, Sendable {
    case af = "kokoro-af"
    case alloy = "kokoro-af-alloy"
    case aoede = "kokoro-af-aoede"
    case bella = "kokoro-af-bella"
    case heart = "kokoro-af-heart"
    case jessica = "kokoro-af-jessica"
    case kore = "kokoro-af-kore"
    case nicole = "kokoro-af-nicole"
    case nova = "kokoro-af-nova"
    case river = "kokoro-af-river"
    case sarah = "kokoro-af-sarah"
    case sky = "kokoro-af-sky"
    case adam = "kokoro-am-adam"
    case echo = "kokoro-am-echo"
    case eric = "kokoro-am-eric"
    case fenrir = "kokoro-am-fenrir"
    case liam = "kokoro-am-liam"
    case michael = "kokoro-am-michael"
    case onyx = "kokoro-am-onyx"
    case puck = "kokoro-am-puck"
    case santa = "kokoro-am-santa"
    case alice = "kokoro-bf-alice"
    case emma = "kokoro-bf-emma"
    case isabella = "kokoro-bf-isabella"
    case lily = "kokoro-bf-lily"
    case daniel = "kokoro-bm-daniel"
    case fable = "kokoro-bm-fable"
    case george = "kokoro-bm-george"
    case lewis = "kokoro-bm-lewis"

    static let allCases: [KokoroNarrationVoice] = [
        .heart,
        .bella,
        .nicole,
        .aoede,
        .kore,
        .sarah,
        .alloy,
        .nova,
        .sky,
        .michael,
        .fenrir,
        .puck,
        .emma,
        .isabella,
        .fable,
        .george
    ]

    var id: String { rawValue }

    var label: String {
        switch self {
        case .af: "Heart"
        case .alloy: "Alloy"
        case .aoede: "Aoede"
        case .bella: "Bella"
        case .heart: "Heart"
        case .jessica: "Jessica"
        case .kore: "Kore"
        case .nicole: "Nicole"
        case .nova: "Nova"
        case .river: "River"
        case .sarah: "Sarah"
        case .sky: "Sky"
        case .adam: "Adam"
        case .echo: "Echo"
        case .eric: "Eric"
        case .fenrir: "Fenrir"
        case .liam: "Liam"
        case .michael: "Michael"
        case .onyx: "Onyx"
        case .puck: "Puck"
        case .santa: "Santa"
        case .alice: "Alice"
        case .emma: "Emma"
        case .isabella: "Isabella"
        case .lily: "Lily"
        case .daniel: "Daniel"
        case .fable: "Fable"
        case .george: "George"
        case .lewis: "Lewis"
        }
    }

    var displayName: String {
        "\(countryFlag) \(label)"
    }

    var countryFlag: String {
        switch self {
        case .af, .alloy, .aoede, .bella, .heart, .jessica, .kore, .nicole, .nova, .river, .sarah, .sky,
             .adam, .echo, .eric, .fenrir, .liam, .michael, .onyx, .puck, .santa:
            "🇺🇸"
        case .alice, .emma, .isabella, .lily, .daniel, .fable, .george, .lewis:
            "🇬🇧"
        }
    }

    var grade: String {
        switch self {
        case .af, .heart: "A"
        case .bella: "A-"
        case .nicole, .emma: "B-"
        case .aoede, .kore, .sarah, .fenrir, .michael, .puck: "C+"
        case .alloy, .nova, .isabella, .fable, .george: "C"
        case .sky: "C-"
        case .lewis: "D+"
        case .jessica, .river, .echo, .eric, .liam, .onyx, .alice, .lily, .daniel: "D"
        case .santa: "D-"
        case .adam: "F+"
        }
    }

    var symbol: String {
        switch self {
        case .af: "H"
        case .alloy: "AL"
        case .aoede: "AO"
        case .bella: "B"
        case .heart: "H"
        case .jessica: "J"
        case .kore: "K"
        case .nicole: "N"
        case .nova: "NV"
        case .river: "R"
        case .sarah: "S"
        case .sky: "SK"
        case .adam: "A"
        case .echo: "EC"
        case .eric: "ER"
        case .fenrir: "F"
        case .liam: "LI"
        case .michael: "M"
        case .onyx: "O"
        case .puck: "P"
        case .santa: "SA"
        case .alice: "AL"
        case .emma: "E"
        case .isabella: "I"
        case .lily: "LY"
        case .daniel: "D"
        case .fable: "F"
        case .george: "G"
        case .lewis: "L"
        }
    }

    var speakerID: Int32 {
        switch self {
        case .alloy: 0
        case .aoede: 1
        case .bella: 2
        case .af, .heart: 3
        case .jessica: 4
        case .kore: 5
        case .nicole: 6
        case .nova: 7
        case .river: 8
        case .sarah: 9
        case .sky: 10
        case .adam: 11
        case .echo: 12
        case .eric: 13
        case .fenrir: 14
        case .liam: 15
        case .michael: 16
        case .onyx: 17
        case .puck: 18
        case .santa: 19
        case .alice: 20
        case .emma: 21
        case .isabella: 22
        case .lily: 23
        case .daniel: 24
        case .fable: 25
        case .george: 26
        case .lewis: 27
        }
    }

    var deepInfraPresetVoice: String {
        switch self {
        case .af: "af_heart"
        case .alloy: "af_alloy"
        case .aoede: "af_aoede"
        case .bella: "af_bella"
        case .heart: "af_heart"
        case .jessica: "af_jessica"
        case .kore: "af_kore"
        case .nicole: "af_nicole"
        case .nova: "af_nova"
        case .river: "af_river"
        case .sarah: "af_sarah"
        case .sky: "af_sky"
        case .adam: "am_adam"
        case .echo: "am_echo"
        case .eric: "am_eric"
        case .fenrir: "am_fenrir"
        case .liam: "am_liam"
        case .michael: "am_michael"
        case .onyx: "am_onyx"
        case .puck: "am_puck"
        case .santa: "am_santa"
        case .alice: "bf_alice"
        case .emma: "bf_emma"
        case .isabella: "bf_isabella"
        case .lily: "bf_lily"
        case .daniel: "bm_daniel"
        case .fable: "bm_fable"
        case .george: "bm_george"
        case .lewis: "bm_lewis"
        }
    }

    static func symbol(for id: String) -> String {
        availableVoice(for: id).symbol
    }

    static func availableVoice(for id: String) -> KokoroNarrationVoice {
        guard let voice = Self(rawValue: id),
              allCases.contains(voice) else {
            return .bella
        }

        return voice
    }
}

enum ReaderImagePhase: Equatable {
    case idle
    case checking
    case generating
    case ready
    case limitReached
    case error
}

struct NarrationState: Equatable {
    var isPlaying = false
    var isPreparing = false
    var paragraphID: String?
    var wordRange: NSRange?
    var sectionParagraphID: String?
    var sectionWordStart: Int?
}

private enum NarrationPlaybackError: LocalizedError {
    case emptyAudio
    case kokoroTimedOut
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .emptyAudio:
            return "Kokoro TTS returned no audio."
        case .kokoroTimedOut:
            return "Kokoro TTS took too long to start."
        case .notSignedIn:
            return "Sign in to use narration."
        }
    }
}

@MainActor
private final class NarrationStreamingAudioPlayer {
    private let engine = AVAudioEngine()
    private let playerNode = AVAudioPlayerNode()
    private let rateUnit = AVAudioUnitTimePitch()
    private let format: AVAudioFormat
    private var queuedBufferCount = 0
    private var streamFinished = false
    private var didFinish = false
    private var shouldPlay = true
    private var onFinish: (() -> Void)?

    var rate: Float {
        didSet {
            rateUnit.rate = rate
        }
    }

    var playbackSeconds: Double {
        guard let nodeTime = playerNode.lastRenderTime,
              let playerTime = playerNode.playerTime(forNodeTime: nodeTime) else {
            return 0
        }
        return Double(playerTime.sampleTime) / playerTime.sampleRate
    }

    init(sampleRate: Double, rate: Float, onFinish: @escaping () -> Void) throws {
        guard let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        ) else {
            throw NarrationPlaybackError.emptyAudio
        }

        self.format = format
        self.rate = rate
        self.onFinish = onFinish

        engine.attach(playerNode)
        engine.attach(rateUnit)
        engine.connect(playerNode, to: rateUnit, format: format)
        engine.connect(rateUnit, to: engine.mainMixerNode, format: format)
        rateUnit.rate = rate
        engine.prepare()
        try engine.start()
    }

    func schedule(samples: [Float]) throws {
        guard !samples.isEmpty,
              let buffer = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(samples.count)
              ) else {
            return
        }

        buffer.frameLength = AVAudioFrameCount(samples.count)
        guard let channel = buffer.floatChannelData?[0] else {
            throw NarrationPlaybackError.emptyAudio
        }
        samples.withUnsafeBufferPointer { pointer in
            channel.update(from: pointer.baseAddress!, count: samples.count)
        }

        queuedBufferCount += 1
        playerNode.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            Task { @MainActor in
                self?.bufferDidFinish()
            }
        }
    }

    func pause() {
        shouldPlay = false
        playerNode.pause()
    }

    func resume() {
        shouldPlay = true
        playerNode.play()
    }

    func stop() {
        onFinish = nil
        didFinish = true
        shouldPlay = false
        playerNode.stop()
        engine.stop()
    }

    func markStreamFinished() {
        streamFinished = true
        finishIfReady()
    }

    private func bufferDidFinish() {
        queuedBufferCount = max(0, queuedBufferCount - 1)
        finishIfReady()
    }

    private func finishIfReady() {
        guard streamFinished, queuedBufferCount == 0, !didFinish else { return }
        didFinish = true
        playerNode.stop()
        engine.stop()
        onFinish?()
        onFinish = nil
    }
}

#endif
