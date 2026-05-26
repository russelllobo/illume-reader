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

    let backend = SupabaseBackend()
    lazy var billing = BillingService(backend: backend)
    private let synthesizer = AVSpeechSynthesizer()
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
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .word)
            return
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.rate = Float(readerSettings.narrationRate)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB") ?? AVSpeechSynthesisVoice(language: "en-US")
        synthesizer.speak(utterance)
    }

    func stopSpeaking() {
        synthesizer.stopSpeaking(at: .immediate)
    }

    func generateImage(for paragraph: ReaderParagraph) async {
        guard let row = activeBookRow, let accessToken = session?.accessToken else { return }
        let words = paragraph.text.split(separator: " ")
        let endWord = max(1, min(words.count, 130))
        await runBusy { [self] in
            let response = try await backend.invokeReaderImage(
                ReaderImageFunctionRequest(
                    bookId: row.id,
                    startWord: 1,
                    endWord: endWord,
                    text: String(words.prefix(endWord).joined(separator: " ")),
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

extension IllumeAppModel: AVSpeechSynthesizerDelegate {}

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
    var narrationRate: Double = 0.52
    var imageStyle: ReaderImageStyle = .cartoon
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
