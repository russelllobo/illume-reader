#if os(iOS)
import AuthenticationServices
import AVFoundation
import CryptoKit
import Foundation
import IllumeCore
import Security
import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor
final class IllumeAppModel: NSObject, ObservableObject {
    @Published var session: AuthSession?
    @Published var books: [BookRow] = []
    @Published var activeBookRow: BookRow?
    @Published var activeBook: ReaderBook?
    @Published var openingBook: BookRow?
    @Published var billingProfile: BillingProfile?
    @Published var readerImageUsage: ReaderImageUsage?
    @Published var readerImageRowCount = 0
    @Published var isLoading = false
    @Published var isImporting = false
    @Published var authMode: AuthMode = .signIn
    @Published var notice = ""
    @Published var readerSettings = ReaderSettings()
    @Published var readerImageResponse: ReaderImageFunctionResponse?
    @Published var narration = NarrationState()

    let backend = SupabaseBackend()
    lazy var billing = BillingService(backend: backend)
    private let synthesizer = AVSpeechSynthesizer()
    private var audioPlayer: AVPlayer?
    private var audioEndObserver: NSObjectProtocol?
    private var audioFailedObserver: NSObjectProtocol?
    private var audioStatusObserver: NSKeyValueObservation?
    private var audioTimeObserver: Any?
    private var narrationAudioURL: URL?
    private var narrationTask: Task<Void, Never>?
    private var narrationParagraphIndex: Int?
    private var narrationTextStartOffset = 0
    private var currentNarrationText = ""
    private var narrationWordRanges: [NSRange] = []
    private var narrationWordIndex = 0
    private var narrationRateSnapshot = 1.0
    private var isUsingSystemNarration = false
    private var progressTask: Task<Void, Never>?
    private var appleContinuation: CheckedContinuation<AuthSession, Error>?
    private var googleWebAuthSession: ASWebAuthenticationSession?
    private var appleNonce = ""

    enum AuthMode {
        case signIn
        case signUp
    }

    var isSignedIn: Bool {
        session != nil
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

    func bootstrap() async {
        synthesizer.delegate = self
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
        await reload()
        await billing.loadProducts()
    }

    func authenticate(email: String, password: String) async {
        await runBusy { [self] in
            let next = authMode == .signIn
                ? try await backend.signIn(email: email, password: password)
                : try await backend.signUp(email: email, password: password)
            apply(session: next)
            await reload()
        }
    }

    func signInWithApple() async {
        do {
            let next = try await performAppleSignIn()
            apply(session: next)
            await reload()
        } catch {
            notice = "Apple sign in was cancelled."
        }
    }

    func signInWithGoogle() async {
        do {
            let next = try await performGoogleSignIn()
            apply(session: next)
            await reload()
        } catch {
            notice = error.localizedDescription
        }
    }

    func signOut() {
        stopSpeaking()
        googleWebAuthSession?.cancel()
        googleWebAuthSession = nil
        KeychainStore.deleteSession()
        session = nil
        books = []
        activeBook = nil
        activeBookRow = nil
        openingBook = nil
        billingProfile = nil
        readerImageUsage = nil
        readerImageRowCount = 0
    }

    func reload() async {
        guard let accessToken = session?.accessToken else { return }
        await runBusy { [self] in
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
        }
    }

    func importDocument(from url: URL) async {
        guard let session else { return }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer {
            if didAccess { url.stopAccessingSecurityScopedResource() }
        }

        await runImporting { [self] in
            let data = try Data(contentsOf: url)
            let type = documentType(for: url)
            guard storageUsed + data.count <= storageQuotaBytes else {
                throw NSError(domain: "Illume", code: 413, userInfo: [NSLocalizedDescriptionKey: "This upload would exceed your library storage limit."])
            }

            let parsed = try DocumentParser.parse(data: data, fileName: url.lastPathComponent, type: type)
            let bookId = UUID()
            let storagePath = StoragePath.documentPath(
                userId: session.user.id,
                bookId: bookId,
                originalFileName: url.lastPathComponent,
                type: type
            )
            let mimeType = type == .pdf ? "application/pdf" : "application/epub+zip"
            try await backend.uploadDocument(data: data, storagePath: storagePath, mimeType: mimeType, accessToken: session.accessToken)

            do {
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
                    currentPage: 1,
                    lastOpenedAt: Date()
                )
                let inserted = try await backend.insertBook(row, accessToken: session.accessToken)
                books = LibrarySort.byRecentActivity([inserted] + books)
                activeBookRow = inserted
                activeBook = parsed.book
                if type == .pdf {
                    try? await backend.queuePdfProcessing(bookId: inserted.id, accessToken: session.accessToken)
                }
            } catch {
                try? await backend.deleteBook(bookId: bookId, accessToken: session.accessToken)
                throw error
            }
        }
    }

    func open(_ row: BookRow) async {
        guard let accessToken = session?.accessToken else { return }
        await runOpening(row) { [self] in
            let data = try await backend.downloadDocument(storagePath: row.storagePath, accessToken: accessToken)
            let pages = row.documentType == .pdf ? try await backend.loadBookPages(bookId: row.id, accessToken: accessToken) : []
            let parsed: ReaderBook
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
            activeBookRow = row
            activeBook = parsed
            try await backend.saveProgress(
                bookId: row.id,
                progress: ReadingProgress(currentIndex: row.currentIndex, currentPage: row.currentPage ?? 1),
                accessToken: accessToken
            )
        }
    }

    func closeReader() {
        stopSpeaking()
        activeBook = nil
        activeBookRow = nil
        openingBook = nil
        readerImageResponse = nil
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
        await runBusy { [self] in
            try await backend.deleteBook(bookId: row.id, accessToken: accessToken)
            books.removeAll { $0.id == row.id }
            if activeBookRow?.id == row.id {
                closeReader()
            }
        }
    }

    func saveProgress(index: Int, page: Int) {
        guard let row = activeBookRow, let accessToken = session?.accessToken else { return }
        progressTask?.cancel()
        progressTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(450))
            guard let self else { return }
            try? await self.backend.saveProgress(
                bookId: row.id,
                progress: ReadingProgress(currentIndex: index, currentPage: page),
                accessToken: accessToken
            )
        }
    }

    func speak(_ text: String) {
        guard let book = activeBook,
              let paragraphIndex = book.paragraphs.firstIndex(where: { $0.text == text }) else { return }
        speak(book: book, paragraphIndex: paragraphIndex)
    }

    func toggleNarration(for book: ReaderBook, from index: Int) {
        if narration.isPlaying {
            stopSpeaking()
            return
        }
        speak(book: book, paragraphIndex: index, wordStart: 0)
    }

    func speak(book: ReaderBook, paragraphIndex: Int, wordStart: Int = 0) {
        narrationTask?.cancel()
        narrationTask = Task {
            await speakEdge(book: book, paragraphIndex: paragraphIndex, wordStart: wordStart)
        }
    }

    private func speakEdge(book: ReaderBook, paragraphIndex: Int, wordStart: Int = 0) async {
        guard book.paragraphs.indices.contains(paragraphIndex) else { return }
        let paragraph = book.paragraphs[paragraphIndex]
        guard !paragraph.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        let wordRanges = Self.wordRanges(in: paragraph.text)
        let safeWordStart = wordRanges.contains { $0.location == wordStart } ? wordStart : wordRanges.first?.location ?? 0
        let text = Self.substring(paragraph.text, fromUTF16Offset: safeWordStart)
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }

        stopPlayback(keepNarrationState: true)
        synthesizer.stopSpeaking(at: .immediate)
        isUsingSystemNarration = false

        narrationParagraphIndex = paragraphIndex
        narrationTextStartOffset = safeWordStart
        currentNarrationText = text
        narrationWordRanges = Self.wordRanges(in: text)
        narrationWordIndex = 0
        narrationRateSnapshot = Self.edgeSpeechRate(from: readerSettings.narrationRate)
        if let firstRange = narrationWordRanges.first {
            narration = NarrationState(
                isPlaying: true,
                paragraphID: paragraph.id,
                wordRange: NSRange(location: safeWordStart + firstRange.location, length: firstRange.length)
            )
        } else {
            narration = NarrationState(isPlaying: true, paragraphID: paragraph.id, wordRange: nil)
        }

        guard let accessToken = session?.accessToken else {
            playSystemNarration(text)
            notice = "Using device narration. Sign in for enhanced narration."
            return
        }

        do {
            let data = try await withThrowingTaskGroup(of: Data.self) { group in
                group.addTask { [backend, narrationRateSnapshot] in
                    try await backend.synthesizeSpeech(
                        EdgeTTSRequest(
                            rate: narrationRateSnapshot,
                            text: text,
                            voice: "en-US-AvaMultilingualNeural"
                        ),
                        accessToken: accessToken
                    )
                }
                group.addTask {
                    try await Task.sleep(for: .seconds(6))
                    throw NarrationPlaybackError.edgeTimedOut
                }
                guard let data = try await group.next() else {
                    throw NarrationPlaybackError.emptyAudio
                }
                group.cancelAll()
                return data
            }
            guard narration.isPlaying,
                  narration.paragraphID == paragraph.id,
                  narrationTextStartOffset == safeWordStart,
                  !Task.isCancelled else { return }
            guard !data.isEmpty else {
                throw NarrationPlaybackError.emptyAudio
            }
            try playNarrationAudio(data)
        } catch {
            guard !Task.isCancelled else { return }
            playSystemNarration(text)
            notice = "Using device narration because enhanced narration is unavailable."
        }
    }

    func stopSpeaking() {
        narrationTask?.cancel()
        narrationTask = nil
        stopPlayback(keepNarrationState: false)
        synthesizer.stopSpeaking(at: .immediate)
        isUsingSystemNarration = false
        narrationParagraphIndex = nil
        narrationTextStartOffset = 0
        currentNarrationText = ""
        narrationWordRanges = []
        narrationWordIndex = 0
        narration = NarrationState()
    }

    private func playNarrationAudio(_ data: Data) throws {
        #if os(iOS)
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try AVAudioSession.sharedInstance().setActive(true)
        #endif
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("illume-narration-\(UUID().uuidString)")
            .appendingPathExtension("mp3")
        try data.write(to: url, options: [.atomic])

        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        player.volume = 1
        audioPlayer = player
        narrationAudioURL = url
        audioStatusObserver = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            guard item.status == .failed else { return }
            let message = item.error?.localizedDescription ?? "Narration audio could not load."
            Task { @MainActor in
                guard let self else { return }
                if self.narration.isPlaying, !self.currentNarrationText.isEmpty {
                    self.playSystemNarration(self.currentNarrationText)
                    self.notice = "Using device narration because enhanced narration could not load."
                } else {
                    self.stopSpeaking()
                    self.notice = message
                }
            }
        }
        audioTimeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.05, preferredTimescale: 600),
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.updateEstimatedNarrationHighlight()
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
                if self.narration.isPlaying, !self.currentNarrationText.isEmpty {
                    self.playSystemNarration(self.currentNarrationText)
                    self.notice = "Using device narration because enhanced narration could not play."
                } else {
                    self.stopSpeaking()
                    self.notice = message
                }
            }
        }

        player.play()
    }

    private func playSystemNarration(_ text: String) {
        stopPlayback(keepNarrationState: true)
        synthesizer.stopSpeaking(at: .immediate)
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = Self.systemSpeechRate(from: readerSettings.narrationRate)
        utterance.volume = 1
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            ?? AVSpeechSynthesisVoice(language: "en-GB")
        isUsingSystemNarration = true
        synthesizer.speak(utterance)
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
        if let narrationAudioURL {
            try? FileManager.default.removeItem(at: narrationAudioURL)
            self.narrationAudioURL = nil
        }
        if !keepNarrationState {
            narration = NarrationState()
        }
    }

    private func updateEstimatedNarrationHighlight() {
        guard narration.isPlaying,
              let player = audioPlayer,
              let paragraphIndex = narrationParagraphIndex,
              let book = activeBook,
              book.paragraphs.indices.contains(paragraphIndex),
              !narrationWordRanges.isEmpty else { return }
        let paragraph = book.paragraphs[paragraphIndex]

        let currentTime = player.currentTime().seconds + 0.03
        guard currentTime.isFinite else { return }
        let targetIndex = min(narrationWordRanges.count - 1, max(0, Int((currentTime * narrationRateSnapshot) / 0.31)))
        guard targetIndex != narrationWordIndex || narration.wordRange == nil else { return }

        narrationWordIndex = targetIndex
        let range = narrationWordRanges[targetIndex]
        narration = NarrationState(
            isPlaying: true,
            paragraphID: paragraph.id,
            wordRange: NSRange(location: narrationTextStartOffset + range.location, length: range.length)
        )
    }

    private func continueNarrationAfterCurrentParagraph() {
        guard let book = activeBook,
              let currentIndex = narrationParagraphIndex else {
            narration = NarrationState()
            return
        }

        let nextIndex = book.paragraphs.indices.dropFirst(currentIndex + 1).first {
            !book.paragraphs[$0].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        if let nextIndex {
            speak(book: book, paragraphIndex: nextIndex)
        } else {
            narrationParagraphIndex = nil
            narrationTextStartOffset = 0
            currentNarrationText = ""
            narration = NarrationState()
        }
    }

    private func finishCurrentNarrationItem() {
        stopPlayback(keepNarrationState: true)
        isUsingSystemNarration = false
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

    private static func edgeSpeechRate(from value: Double) -> Double {
        min(2.0, max(0.7, value))
    }

    private static func systemSpeechRate(from value: Double) -> Float {
        let clampedValue = min(2.0, max(0.7, Float(value)))
        let normalizedValue = (clampedValue - 0.7) / 1.3
        return Float(AVSpeechUtteranceMinimumSpeechRate + normalizedValue * (AVSpeechUtteranceMaximumSpeechRate - AVSpeechUtteranceMinimumSpeechRate))
    }

    func generateImage(text: String, startWord: Int, endWord: Int) async {
        guard let row = activeBookRow, let accessToken = session?.accessToken else { return }
        await runBusy { [self] in
            let response = try await backend.invokeReaderImage(
                ReaderImageFunctionRequest(
                    bookId: row.id,
                    startWord: startWord,
                    endWord: endWord,
                    text: text,
                    style: readerSettings.imageStyle
                ),
                accessToken: accessToken
            )
            readerImageResponse = response
            applyReaderImageCount(response.imageCount, plan: response.plan)
            if response.imageCount == nil {
                await reload()
            }
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

extension IllumeAppModel: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            guard isUsingSystemNarration else { return }
            finishCurrentNarrationItem()
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            isUsingSystemNarration = false
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
    var imageStyle: ReaderImageStyle = .cartoon
}

struct NarrationState: Equatable {
    var isPlaying = false
    var paragraphID: String?
    var wordRange: NSRange?
}

private enum NarrationPlaybackError: LocalizedError {
    case emptyAudio
    case edgeTimedOut

    var errorDescription: String? {
        switch self {
        case .emptyAudio:
            return "Enhanced narration returned no audio."
        case .edgeTimedOut:
            return "Enhanced narration took too long to start."
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
