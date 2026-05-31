#if os(iOS)
import AuthenticationServices
import AVFoundation
import CryptoKit
import Foundation
import IllumeCore
import MediaPlayer
import Security
import SherpaOnnxSupport
import SwiftUI
import UIKit
import UniformTypeIdentifiers

private let readerImageRequestChunkWords = 750
private let narrationChunkMinimumCharacters = 80
private let narrationChunkMaximumCharacters = 220
private let narrationChunkMaximumParagraphs = 1
private let narrationChunkPreferredSentenceMinimumCharacters = 60

@MainActor
final class IllumeAppModel: NSObject, ObservableObject {
    @Published var session: AuthSession?
    @Published var books: [BookRow] = []
    @Published var activeBookRow: BookRow?
    @Published var activeBook: ReaderBook?
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
    @Published var narration = NarrationState()

    let backend = SupabaseBackend()
    lazy var billing = BillingService(backend: backend)
    private let kokoroTTS = KokoroTTSService()
    private var audioPlayer: AVPlayer?
    private var audioEndObserver: NSObjectProtocol?
    private var audioFailedObserver: NSObjectProtocol?
    private var audioStatusObserver: NSKeyValueObservation?
    private var audioTimeObserver: Any?
    private var narrationAudioURL: URL?
    private var nowPlayingArtworkTask: Task<Void, Never>?
    private var nowPlayingArtworkSource: String?
    private var nowPlayingArtworkImage: UIImage?
    private var remoteCommandTargets: [Any] = []
    private var hasConfiguredRemoteCommands = false
    private var narrationTask: Task<Void, Never>?
    private var narrationPrefetchTask: Task<NarrationPreparedAudio?, Never>?
    private var kokoroWarmupTask: Task<Void, Never>?
    private var readerImageGenerationTask: Task<Void, Never>?
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

    enum AuthMode {
        case signIn
        case signUp
    }

    private struct NarrationWordMarker: Sendable {
        let paragraphIndex: Int
        let range: NSRange
        let weight: Double
        let startSeconds: Double?
        let endSeconds: Double?

        func aligned(startSeconds: Double, endSeconds: Double) -> NarrationWordMarker {
            NarrationWordMarker(
                paragraphIndex: paragraphIndex,
                range: range,
                weight: weight,
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

    private struct NarrationPreparedAudio: Sendable {
        let chunk: NarrationChunk
        let audio: KokoroRenderedAudio
    }

    var isSignedIn: Bool {
        session != nil
    }

    var canLaunch: Bool {
        hasBootstrapped && (!isSignedIn || isLibraryLoaded)
    }

    var isPro: Bool {
        BillingAccess.hasProAccess(profile: billingProfile)
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
        openingBook = nil
        closingBook = nil
        bookTransitionSourceFrame = nil
        billingProfile = nil
        readerImageUsage = nil
        readerImageRowCount = 0
        readerImageResponse = nil
        readerImageChunkIndex = nil
        readerImageStyle = nil
        readerImagePhase = .idle
        pendingBookImports = []
        uploadedBookNotice = nil
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
            async let library = backend.loadLibrary(accessToken: accessToken)
            async let profile = backend.loadBillingProfile(accessToken: accessToken)
            async let usage = backend.loadReaderImageUsage(accessToken: accessToken)

            books = try await library

            let loadedProfile = try? await profile
            let loadedUsage = try? await usage
            let loadedIsPro = BillingAccess.hasProAccess(profile: loadedProfile)
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
            guard storageUsed + data.count <= storageQuotaBytes else {
                throw NSError(domain: "Illume", code: 413, userInfo: [NSLocalizedDescriptionKey: "This upload would exceed your library storage limit."])
            }

            updatePendingImport(id: pendingImportID, progress: 12)
            let parsed = try DocumentParser.parse(data: data, fileName: url.lastPathComponent, type: type)
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
                originalFileName: url.lastPathComponent,
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
                    fileName: url.lastPathComponent,
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
            } catch {
                try? await backend.deleteBook(bookId: bookId, accessToken: session.accessToken)
                throw error
            }
        }
        removePendingImport(id: pendingImportID)
    }

    func open(_ row: BookRow, sourceFrame: CGRect? = nil) async {
        guard let accessToken = session?.accessToken else { return }
        bookTransitionSourceFrame = sourceFrame
        await runOpening(row) { [self] in
            let data = try await backend.downloadDocument(storagePath: row.storagePath, accessToken: accessToken)
            let pages = row.documentType == .pdf ? try await backend.loadBookPages(bookId: row.id, accessToken: accessToken) : []
            var parsed: ReaderBook
            if row.documentType == .pdf, !pages.isEmpty {
                parsed = PdfTextMapper.readerBook(
                    title: row.title,
                    author: row.author,
                    fileName: row.fileName,
                    pageCount: row.pageCount ?? pages.count,
                    toc: row.pdfToc,
                    pages: pages
                )
            } else {
                parsed = try DocumentParser.parse(data: data, fileName: row.fileName, type: row.documentType).book
            }
            let start = Self.resolveMeaningfulStart(
                in: parsed,
                requestedIndex: row.currentIndex,
                savedIndex: row.currentIndex,
                savedPage: row.currentPage ?? 1
            )
            var openingRow = row
            openingRow.currentIndex = start.index
            openingRow.currentPage = start.page
            parsed.coverUrl = row.coverUrl
            readerImageGenerationTask?.cancel()
            readerImageGenerationTask = nil
            readerImageResponse = nil
            readerImageChunkIndex = nil
            readerImageStyle = nil
            readerImagePhase = .idle
            await prepareReaderImageForOpening(book: parsed, row: openingRow, accessToken: accessToken)
            activeBookRow = openingRow
            activeBook = parsed
            openingBook = nil
            warmKokoroTTSIfNeeded()
            speak(book: parsed, paragraphIndex: start.index)
            updateLocalProgress(
                bookId: row.id,
                index: start.index,
                page: start.page,
                lastOpenedAt: Date()
            )
            try await backend.saveProgress(
                bookId: row.id,
                progress: ReadingProgress(currentIndex: start.index, currentPage: start.page),
                accessToken: accessToken
            )
        }
    }

    func closeReader() {
        let row = activeBookRow
        stopSpeaking()
        readerImageGenerationTask?.cancel()
        readerImageGenerationTask = nil
        closingBook = row
        activeBook = nil
        activeBookRow = nil
        openingBook = nil
        readerImageResponse = nil
        readerImageChunkIndex = nil
        readerImageStyle = nil
        readerImagePhase = .idle

        guard let row else { return }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(460))
            guard self?.closingBook?.id == row.id else { return }
            self?.closingBook = nil
            self?.bookTransitionSourceFrame = nil
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
            deletingBookIDs.insert(row.id)
        }

        do {
            try await backend.deleteBook(bookId: row.id, accessToken: accessToken)
            if activeBookRow?.id == row.id {
                closeReader()
            }
            try? await Task.sleep(for: .milliseconds(220))
            withAnimation(IllumeTheme.blurLoadIn) {
                books.removeAll { $0.id == row.id }
                deletingBookIDs.remove(row.id)
            }
        } catch {
            withAnimation(IllumeTheme.blurLoadIn) {
                deletingBookIDs.remove(row.id)
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

    func speak(_ text: String) {
        guard let book = activeBook,
              let paragraphIndex = book.paragraphs.firstIndex(where: { $0.text == text }) else { return }
        speak(book: book, paragraphIndex: paragraphIndex)
    }

    func toggleNarration(for book: ReaderBook, from index: Int) {
        if narration.isPreparing {
            stopSpeaking()
            return
        }
        if narration.isPlaying {
            pauseNarration()
            return
        }
        if audioPlayer != nil {
            resumeNarration()
            return
        }
        if narrationParagraphIndex != nil {
            stopSpeaking()
            return
        }
        speak(book: book, paragraphIndex: index, wordStart: 0)
    }

    func setNarrationRate(_ value: Double) {
        let rate = Self.kokoroSpeechRate(from: value)
        guard abs(readerSettings.narrationRate - rate) > 0.001 else { return }

        readerSettings.narrationRate = rate
        clearPrefetchedNarration()
        applyCurrentNarrationPlaybackRate()
    }

    func setNarrationVoice(_ id: String) {
        let voice = KokoroNarrationVoice.availableVoice(for: id)
        guard readerSettings.narrationVoice != voice.id else { return }

        readerSettings.narrationVoice = voice.id
        clearPrefetchedNarration()
    }

    private func pauseNarration() {
        guard audioPlayer != nil else {
            stopSpeaking()
            return
        }
        audioPlayer?.pause()
        narration.isPlaying = false
        narration.isPreparing = false
        updateNowPlayingPlaybackState(isPlaying: false)
    }

    private func resumeNarration() {
        guard let player = audioPlayer else { return }
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        narration.isPlaying = true
        narration.isPreparing = false
        updateNowPlayingPlaybackState(isPlaying: true)
        player.playImmediately(atRate: currentNarrationPlaybackRate)
    }

    func speak(book: ReaderBook, paragraphIndex: Int, wordStart: Int = 0) {
        narrationTask?.cancel()
        narrationTask = Task {
            await speakKokoro(book: book, paragraphIndex: paragraphIndex, wordStart: wordStart)
        }
    }

    private func warmKokoroTTSIfNeeded() {
        guard kokoroWarmupTask == nil,
              let modelDirectory = Self.kokoroModelDirectoryURL else { return }

        kokoroWarmupTask = Task(priority: .utility) { [kokoroTTS] in
            try? await kokoroTTS.prepare(modelDirectory: modelDirectory)
        }
    }

    private func speakKokoro(book: ReaderBook, paragraphIndex: Int, wordStart: Int = 0) async {
        clearPrefetchedNarration()
        guard let chunk = Self.narrationChunk(in: book, from: paragraphIndex, wordStart: wordStart) else { return }

        stopPlayback(keepNarrationState: true)

        narrationRateSnapshot = Self.kokoroSpeechRate(from: readerSettings.narrationRate)
        let narrationVoiceSnapshot = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        applyNarrationState(for: chunk, in: book, isPlaying: false, isPreparing: true)

        guard let modelDirectory = Self.kokoroModelDirectoryURL else {
            stopSpeaking()
            notice = "Kokoro TTS model files are missing."
            return
        }

        do {
            let renderedAudio = try await renderNarrationAudio(
                for: chunk,
                modelDirectory: modelDirectory,
                speakerID: narrationVoiceSnapshot.speakerID,
                rate: narrationRateSnapshot
            )
            guard (narration.isPlaying || narration.isPreparing),
                  narrationParagraphIndex == chunk.startParagraphIndex,
                  narrationChunkEndParagraphIndex == chunk.endParagraphIndex,
                  narrationContinuationParagraphIndex == chunk.continuationParagraphIndex,
                  narrationContinuationWordStart == chunk.continuationWordStart,
                  !Task.isCancelled else {
                try? FileManager.default.removeItem(at: renderedAudio.url)
                return
            }
            guard FileManager.default.fileExists(atPath: renderedAudio.url.path) else {
                throw NarrationPlaybackError.emptyAudio
            }
            let alignedChunk = Self.narrationChunk(chunk, alignedToAudioDuration: renderedAudio.duration)
            applyNarrationState(for: alignedChunk, in: book)
            try playNarrationAudio(at: renderedAudio.url)
            prefetchNextNarrationChunk(
                in: book,
                after: alignedChunk,
                modelDirectory: modelDirectory,
                speakerID: narrationVoiceSnapshot.speakerID,
                rate: narrationRateSnapshot
            )
        } catch {
            guard !Task.isCancelled else { return }
            stopSpeaking()
            notice = error.localizedDescription.isEmpty ? "Kokoro TTS could not play this paragraph." : error.localizedDescription
        }
    }

    func stopSpeaking() {
        narrationTask?.cancel()
        narrationTask = nil
        clearPrefetchedNarration()
        stopPlayback(keepNarrationState: false)
        narrationParagraphIndex = nil
        narrationChunkEndParagraphIndex = nil
        narrationContinuationParagraphIndex = nil
        narrationContinuationWordStart = nil
        narrationCurrentChunk = nil
        narrationWordMarkers = []
        narrationWordIndex = 0
        narration = NarrationState()
    }

    private func playNarrationAudio(at url: URL) throws {
        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.volume = 1
        audioPlayer = player
        narrationAudioURL = url
        configureRemoteNarrationCommandsIfNeeded()
        updateNowPlayingInfo(duration: item.asset.duration.seconds)
        audioStatusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            Task { @MainActor in
                guard let self else { return }
                switch item.status {
                case .readyToPlay:
                    self.updateNowPlayingInfo(duration: item.duration.seconds)
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

        narration.isPlaying = true
        narration.isPreparing = false
        updateNarrationHighlight(at: 0)
        installNarrationTimeObserver(for: player)
        updateNowPlayingPlaybackState(isPlaying: true)
        player.playImmediately(atRate: currentNarrationPlaybackRate)
    }

    private var currentNarrationPlaybackRate: Float {
        let desiredRate = Self.kokoroSpeechRate(from: readerSettings.narrationRate)
        let generatedRate = max(0.1, narrationRateSnapshot)
        return Float(desiredRate / generatedRate)
    }

    private func applyCurrentNarrationPlaybackRate() {
        guard narration.isPlaying,
              let audioPlayer else { return }
        audioPlayer.rate = currentNarrationPlaybackRate
        updateNowPlayingPlaybackState(isPlaying: true)
    }

    private func renderNarrationAudio(
        for chunk: NarrationChunk,
        modelDirectory: URL,
        speakerID: Int32,
        rate: Double
    ) async throws -> KokoroRenderedAudio {
        try await withThrowingTaskGroup(of: KokoroRenderedAudio.self) { group in
            group.addTask { [kokoroTTS] in
                try await kokoroTTS.render(
                    text: chunk.text,
                    modelDirectory: modelDirectory,
                    speakerID: speakerID,
                    rate: rate
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

    private func prefetchNextNarrationChunk(
        in book: ReaderBook,
        after chunk: NarrationChunk,
        modelDirectory: URL,
        speakerID: Int32,
        rate: Double
    ) {
        clearPrefetchedNarration()
        guard let start = Self.nextNarrationStart(in: book, after: chunk),
              let nextChunk = Self.narrationChunk(in: book, from: start.paragraphIndex, wordStart: start.wordStart) else { return }

        narrationPrefetchTask = Task(priority: .userInitiated) { [kokoroTTS] in
            do {
                let renderedAudio = try await withThrowingTaskGroup(of: KokoroRenderedAudio.self) { group in
                    group.addTask {
                        try await kokoroTTS.render(
                            text: nextChunk.text,
                            modelDirectory: modelDirectory,
                            speakerID: speakerID,
                            rate: rate
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
                let alignedChunk = Self.narrationChunk(nextChunk, alignedToAudioDuration: renderedAudio.duration)
                return NarrationPreparedAudio(chunk: alignedChunk, audio: renderedAudio)
            } catch {
                return nil
            }
        }
    }

    private func clearPrefetchedNarration() {
        guard let task = narrationPrefetchTask else { return }
        narrationPrefetchTask = nil
        task.cancel()
        Task {
            if let prepared = await task.value {
                try? FileManager.default.removeItem(at: prepared.audio.url)
            }
        }
    }

    private func stopPlayback(keepNarrationState: Bool) {
        if let audioTimeObserver {
            audioPlayer?.removeTimeObserver(audioTimeObserver)
            self.audioTimeObserver = nil
        }
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
        if !keepNarrationState {
            clearNowPlayingArtwork()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
        }
        if let narrationAudioURL {
            try? FileManager.default.removeItem(at: narrationAudioURL)
            self.narrationAudioURL = nil
        }
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
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = audioPlayer?.currentTime().seconds ?? 0
        info[MPNowPlayingInfoPropertyPlaybackRate] = narration.isPlaying ? currentNarrationPlaybackRate : 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info

        updateNowPlayingArtwork(from: book.coverUrl, title: book.title)
    }

    private func updateNowPlayingPlaybackState(isPlaying: Bool) {
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = audioPlayer?.currentTime().seconds ?? 0
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

        guard let player = audioPlayer else { return }
        let currentTime = player.currentTime().seconds + 0.03
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
            wordRange: marker.range
        )
    }

    private func continueNarrationAfterCurrentParagraph() {
        guard let book = activeBook,
              let currentChunk = currentNarrationChunk,
              let nextStart = Self.nextNarrationStart(in: book, after: currentChunk) else {
            narration = NarrationState()
            return
        }

        let nextChunk = Self.narrationChunk(in: book, from: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
        if let nextChunk {
            applyNarrationState(for: nextChunk, in: book, isPlaying: false, isPreparing: true)
        }

        if let prefetchTask = narrationPrefetchTask {
            narrationTask = Task {
                let prepared = await prefetchTask.value
                guard !Task.isCancelled else {
                    if let prepared {
                        try? FileManager.default.removeItem(at: prepared.audio.url)
                    }
                    return
                }
                narrationPrefetchTask = nil
                guard let prepared,
                      prepared.chunk.startParagraphIndex == nextStart.paragraphIndex,
                      prepared.chunk.startWordStart == nextStart.wordStart else {
                    if let prepared {
                        try? FileManager.default.removeItem(at: prepared.audio.url)
                    }
                    if nextChunk != nil {
                        await renderAndPlayPreparedNarration(book: book, paragraphIndex: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
                    } else {
                        await speakKokoro(book: book, paragraphIndex: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
                    }
                    return
                }
                playPreparedNarration(prepared, in: book)
            }
        } else {
            speak(book: book, paragraphIndex: nextStart.paragraphIndex, wordStart: nextStart.wordStart)
        }
    }

    private var currentNarrationChunk: NarrationChunk? {
        narrationCurrentChunk
    }

    private func renderAndPlayPreparedNarration(book: ReaderBook, paragraphIndex: Int, wordStart: Int) async {
        guard let chunk = Self.narrationChunk(in: book, from: paragraphIndex, wordStart: wordStart) else { return }

        narrationRateSnapshot = Self.kokoroSpeechRate(from: readerSettings.narrationRate)
        let narrationVoiceSnapshot = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
        applyNarrationState(for: chunk, in: book, isPlaying: false, isPreparing: true)

        guard let modelDirectory = Self.kokoroModelDirectoryURL else {
            stopSpeaking()
            notice = "Kokoro TTS model files are missing."
            return
        }

        do {
            let renderedAudio = try await renderNarrationAudio(
                for: chunk,
                modelDirectory: modelDirectory,
                speakerID: narrationVoiceSnapshot.speakerID,
                rate: narrationRateSnapshot
            )
            guard !Task.isCancelled else {
                try? FileManager.default.removeItem(at: renderedAudio.url)
                return
            }
            let alignedChunk = Self.narrationChunk(chunk, alignedToAudioDuration: renderedAudio.duration)
            playPreparedNarration(NarrationPreparedAudio(chunk: alignedChunk, audio: renderedAudio), in: book)
        } catch {
            guard !Task.isCancelled else { return }
            stopSpeaking()
            notice = error.localizedDescription.isEmpty ? "Kokoro TTS could not play this paragraph." : error.localizedDescription
        }
    }

    private func playPreparedNarration(_ prepared: NarrationPreparedAudio, in book: ReaderBook) {
        guard (narration.isPlaying || narration.isPreparing),
              FileManager.default.fileExists(atPath: prepared.audio.url.path) else {
            try? FileManager.default.removeItem(at: prepared.audio.url)
            return
        }

        applyNarrationState(for: prepared.chunk, in: book)
        do {
            try playNarrationAudio(at: prepared.audio.url)
            guard let modelDirectory = Self.kokoroModelDirectoryURL else { return }
            let voice = KokoroNarrationVoice.availableVoice(for: readerSettings.narrationVoice)
            prefetchNextNarrationChunk(
                in: book,
                after: prepared.chunk,
                modelDirectory: modelDirectory,
                speakerID: voice.speakerID,
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
                wordRange: firstMarker.range
            )
        } else {
            narration = NarrationState(
                isPlaying: isPlaying,
                isPreparing: isPreparing,
                paragraphID: chunk.firstParagraphID,
                wordRange: nil
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
            let piece = limitedNarrationText(trimmedText, maxCharacters: remainingCharacters)
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
        alignedToAudioDuration duration: Double
    ) -> NarrationChunk {
        let alignedMarkers = narrationWordMarkers(chunk.wordMarkers, alignedToAudioDuration: duration)
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
        alignedToAudioDuration duration: Double
    ) -> [NarrationWordMarker] {
        guard duration.isFinite, duration > 0, !markers.isEmpty else { return markers }

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

    nonisolated private static func limitedNarrationText(_ text: String, maxCharacters: Int) -> String {
        guard text.count > maxCharacters else { return text }

        let limitIndex = text.index(text.startIndex, offsetBy: maxCharacters)
        let prefix = String(text[..<limitIndex])

        if let sentenceEnd = preferredSentenceEnd(in: prefix) {
            return String(prefix[..<sentenceEnd]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        if let whitespace = prefix.lastIndex(where: \.isWhitespace),
           prefix.distance(from: prefix.startIndex, to: whitespace) >= narrationChunkPreferredSentenceMinimumCharacters {
            return String(prefix[..<whitespace]).trimmingCharacters(in: .whitespacesAndNewlines)
        }

        return prefix.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    nonisolated private static func preferredSentenceEnd(in text: String) -> String.Index? {
        let minimum = min(narrationChunkPreferredSentenceMinimumCharacters, text.count)
        var bestEnd: String.Index?

        var index = text.startIndex
        while index < text.endIndex {
            let character = text[index]
            if ".!?".contains(character) {
                let next = text.index(after: index)
                if next == text.endIndex || text[next].isWhitespace {
                    let distance = text.distance(from: text.startIndex, to: next)
                    if distance >= minimum {
                        bestEnd = next
                    }
                }
            }
            index = text.index(after: index)
        }

        return bestEnd
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

    private static var kokoroModelDirectoryURL: URL? {
        if let bundledModelFile = Bundle.module.url(
            forResource: "model",
            withExtension: "onnx",
            subdirectory: "KokoroTTS/kokoro-multi-lang-v1_0"
        ) {
            return bundledModelFile.deletingLastPathComponent()
        }

        if let bundledModelFile = Bundle.module.url(forResource: "model", withExtension: "onnx") {
            return bundledModelFile.deletingLastPathComponent()
        }

        let nestedDirectory = Bundle.module.resourceURL?
            .appendingPathComponent("KokoroTTS", isDirectory: true)
            .appendingPathComponent("kokoro-multi-lang-v1_0", isDirectory: true)
        guard let nestedDirectory else { return nil }
        let nestedModelFile = nestedDirectory.appendingPathComponent("model.onnx")
        return FileManager.default.fileExists(atPath: nestedModelFile.path) ? nestedDirectory : nil
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
                readerImagePhase = .ready
            } else if generationResponse.limitReached == true {
                readerImagePhase = .error
            }
            if generationResponse.imageCount == nil {
                await reload()
            }
        }
    }

    private func prepareReaderImageForOpening(book: ReaderBook, row: BookRow, accessToken: String) async {
        guard let chunk = Self.readerImageChunk(in: book, currentIndex: row.currentIndex) else { return }
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

        await runReaderImageTask { [self] in
            readerImageChunkIndex = chunk.index
            readerImageStyle = style
            readerImagePhase = .checking
            let checkResponse = try await backend.invokeReaderImage(request, accessToken: accessToken)
            applyReaderImageCount(checkResponse.imageCount, plan: checkResponse.plan)

            if checkResponse.imageUrl != nil {
                readerImageResponse = checkResponse
                await preloadReaderImageIfNeeded(checkResponse.imageUrl)
                readerImagePhase = .ready
                return
            }

            readerImageResponse = nil
            readerImagePhase = .generating
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
            readerImageResponse = generationResponse
            readerImageChunkIndex = chunk.index
            readerImageStyle = style
            applyReaderImageCount(generationResponse.imageCount, plan: generationResponse.plan)
            if generationResponse.imageUrl != nil {
                await preloadReaderImageIfNeeded(generationResponse.imageUrl)
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

    nonisolated private static func readerImageChunk(in book: ReaderBook, currentIndex: Int) -> ReaderImageRequestChunk? {
        guard !book.paragraphs.isEmpty else { return nil }

        var chunks: [ReaderImageRequestChunk] = []
        var chunkWords: [String] = []
        var chunkStartWord = 1
        var totalWords = 0
        let target = min(max(currentIndex, 0), book.paragraphs.count - 1)
        var targetWordStart = 0

        for (index, paragraph) in book.paragraphs.enumerated() {
            if index == target {
                targetWordStart = totalWords
            }
            guard paragraph.kind != .heading else { continue }

            let words = paragraph.text.split(whereSeparator: \.isWhitespace).map(String.init)
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

        let chunkIndex = targetWordStart / readerImageRequestChunkWords
        guard chunks.indices.contains(chunkIndex) else { return nil }
        return chunks[chunkIndex]
    }

    private func preGenerateReaderImage(
        for row: BookRow,
        book: ReaderBook,
        chunk: ReaderImageRequestChunk,
        accessToken: String
    ) async throws {
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
            let loadedIsPro = BillingAccess.hasProAccess(profile: billingProfile)
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
        let usageIsPro = plan == "pro" || isPro
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

    private static func currentMonthStartUTC(now: Date = Date()) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .gmt
        let components = calendar.dateComponents([.year, .month], from: now)
        return calendar.date(from: components) ?? now
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
    var theme: ReaderThemeChoice = .paper
    var textScale: Double = 1.05
    var lineHeight: Double = 1.55
    var lineWidth: Double = 42
    var narrationRate: Double = 1.0
    var narrationVoice: String = KokoroNarrationVoice.heart.id
    var imageStyle: ReaderImageStyle = .cartoon
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

enum KokoroNarrationVoice: String, CaseIterable, Identifiable {
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
        .heart, .michael, .emma, .george
    ]

    var id: String { rawValue }

    var label: String {
        switch self {
        case .af: "Heart"
        case .alloy: "Alloy"
        case .aoede: "Aoede"
        case .bella: "Bella"
        case .heart: "USA Woman"
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
        case .michael: "USA Man"
        case .onyx: "Onyx"
        case .puck: "Puck"
        case .santa: "Santa"
        case .alice: "Alice"
        case .emma: "UK Woman"
        case .isabella: "Isabella"
        case .lily: "Lily"
        case .daniel: "Daniel"
        case .fable: "Fable"
        case .george: "UK Man"
        case .lewis: "Lewis"
        }
    }

    var symbol: String {
        switch self {
        case .af: "H"
        case .alloy: "AL"
        case .aoede: "AO"
        case .bella: "B"
        case .heart: "🇺🇸 W"
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
        case .michael: "🇺🇸 M"
        case .onyx: "O"
        case .puck: "P"
        case .santa: "SA"
        case .alice: "AL"
        case .emma: "🇬🇧 W"
        case .isabella: "I"
        case .lily: "LY"
        case .daniel: "D"
        case .fable: "F"
        case .george: "🇬🇧 M"
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

    static func symbol(for id: String) -> String {
        availableVoice(for: id).symbol
    }

    static func availableVoice(for id: String) -> KokoroNarrationVoice {
        guard let voice = Self(rawValue: id),
              allCases.contains(voice) else {
            return .heart
        }

        return voice
    }
}

enum ReaderImagePhase: Equatable {
    case idle
    case checking
    case generating
    case ready
    case error
}

struct NarrationState: Equatable {
    var isPlaying = false
    var isPreparing = false
    var paragraphID: String?
    var wordRange: NSRange?
}

private enum NarrationPlaybackError: LocalizedError {
    case emptyAudio
    case kokoroTimedOut

    var errorDescription: String? {
        switch self {
        case .emptyAudio:
            return "Kokoro TTS returned no audio."
        case .kokoroTimedOut:
            return "Kokoro TTS took too long to start."
        }
    }
}

enum ReaderThemeChoice: String, CaseIterable {
    case paper = "Paper"
    case night = "Night"
    case warm = "Warm"

    var background: Color {
        switch self {
        case .paper: IllumeTheme.paper
        case .night: Color(red: 0.055, green: 0.06, blue: 0.07)
        case .warm: Color(red: 1.0, green: 0.972, blue: 0.914)
        }
    }

    var foreground: Color {
        switch self {
        case .paper, .warm: IllumeTheme.ink
        case .night: Color(red: 0.92, green: 0.91, blue: 0.86)
        }
    }
}
#endif
