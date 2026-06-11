import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import IllumeCore
import Supabase

struct SupabaseConfig: Sendable {
    let url = URL(string: "https://mduemjbplprditrqolcp.supabase.co")!
    let publishableKey = "sb_publishable_rvlRgP3T8YCdMHlgh6-cbA_vNS7hJOT"
    let oauthBridgeRedirectURL = URL(string: "https://illumereader.com/auth/native-callback")!
    let oauthRedirectURL = URL(string: "com.russellsystems.illume://auth-callback")!
    let storageQuotaBytes = IllumeLimits.defaultUserStorageQuotaBytes
}

struct AuthUser: Codable, Equatable, Sendable {
    let id: UUID
    let email: String?
}

struct AuthSession: Codable, Equatable, Sendable {
    let accessToken: String
    let refreshToken: String?
    let expiresIn: Int?
    let tokenType: String?
    let user: AuthUser
}

struct EdgeFunctionError: Codable, LocalizedError {
    let error: String?
    let code: String?
    let message: String?

    var errorDescription: String? {
        message ?? error ?? code
    }
}

struct ReaderImageFunctionRequest: Codable {
    let author: String
    let bookId: UUID
    let bookTitle: String
    let checkOnly: Bool?
    let chunkIndex: Int
    let startWord: Int
    let endWord: Int
    let imageStyle: ReaderImageStyle
    let text: String
    let style: ReaderImageStyle
}

struct ReaderImageFunctionResponse: Codable, Equatable {
    let cached: Bool?
    let exists: Bool?
    let imageUrl: String?
    let prompt: String?
    let imageCount: Int?
    let imageLimit: Int?
    let limitReached: Bool?
    let plan: String?
}

struct ReaderNarrationFunctionRequest: Codable {
    let text: String
    let voice: String
    let rate: Double
}

struct ReaderNarrationFunctionWord: Codable, Equatable, Sendable {
    let text: String
    let start: Double
    let end: Double
}

struct ReaderNarrationFunctionResponse: Codable, Equatable, Sendable {
    let audio: String
    let outputFormat: String?
    let words: [ReaderNarrationFunctionWord]?
}

struct AppleSubscriptionSyncRequest: Codable {
    let signedTransactionInfo: String
    let appTransaction: String?
}

struct AppleSubscriptionSyncResponse: Codable {
    let plan: String
    let status: String
    let productId: String
    let expiresAt: Date?
}

final class SupabaseBackend: @unchecked Sendable {
    private let config: SupabaseConfig
    private let session: URLSession
    #if os(iOS)
    let client: SupabaseClient
    #endif

    init(config: SupabaseConfig = SupabaseConfig(), session: URLSession = .shared) {
        self.config = config
        self.session = session
        #if os(iOS)
        self.client = SupabaseClient(
            supabaseURL: config.url,
            supabaseKey: config.publishableKey,
            options: .init(auth: .init(redirectToURL: config.oauthRedirectURL))
        )
        #endif
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        try await authRequest(
            path: "/auth/v1/token?grant_type=password",
            body: ["email": email, "password": password]
        )
    }

    func signUp(email: String, password: String) async throws -> AuthSession {
        try await authRequest(
            path: "/auth/v1/signup",
            body: ["email": email, "password": password]
        )
    }

    func exchangeIdToken(provider: String, token: String, nonce: String? = nil) async throws -> AuthSession {
        var body: [String: String] = [
            "provider": provider,
            "id_token": token
        ]
        if let nonce {
            body["nonce"] = nonce
        }
        return try await authRequest(path: "/auth/v1/token?grant_type=id_token", body: body)
    }

    func refreshSession(refreshToken: String) async throws -> AuthSession {
        try await authRequest(
            path: "/auth/v1/token?grant_type=refresh_token",
            body: ["refresh_token": refreshToken]
        )
    }

    func loadUser(accessToken: String) async throws -> AuthUser {
        try await request(path: "/auth/v1/user", method: "GET", accessToken: accessToken)
    }

    func loadLibrary(accessToken: String) async throws -> [BookRow] {
        let path = "/rest/v1/books?select=*&order=last_opened_at.desc.nullslast,created_at.desc"
        let books: [BookRow] = try await request(path: path, method: "GET", accessToken: accessToken)
        return LibrarySort.byRecentActivity(books)
    }

    func loadBillingProfile(accessToken: String) async throws -> BillingProfile? {
        let rows: [BillingProfile] = try await request(
            path: "/rest/v1/billing_profiles?select=*&limit=1",
            method: "GET",
            accessToken: accessToken
        )
        return rows.first
    }

    func loadReaderImageUsage(accessToken: String) async throws -> ReaderImageUsage? {
        let rows: [ReaderImageUsage] = try await request(
            path: "/rest/v1/reader_image_usage?select=*&limit=1",
            method: "GET",
            accessToken: accessToken
        )
        return rows.first
    }

    func countReaderImages(accessToken: String, since: Date? = nil) async throws -> Int {
        var path = "/rest/v1/reader_images?select=id&limit=1"
        if let since {
            path += "&created_at=gte.\(Self.queryValue(Self.postgrestDateFormatter.string(from: since)))"
        }

        var request = baseRequest(path: path, accessToken: accessToken)
        request.httpMethod = "GET"
        request.setValue("count=exact", forHTTPHeaderField: "Prefer")
        request.setValue("0-0", forHTTPHeaderField: "Range")

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        if let count = Self.count(fromContentRange: http.value(forHTTPHeaderField: "Content-Range")) {
            return count
        }
        let rows = try IllumeJSON.decoder().decode([ReaderImageCountRow].self, from: data)
        return rows.count
    }

    func loadBookPages(bookId: UUID, accessToken: String) async throws -> [BookPage] {
        try await request(
            path: "/rest/v1/book_pages?select=*&book_id=eq.\(bookId.uuidString.lowercased())&order=page_number.asc",
            method: "GET",
            accessToken: accessToken
        )
    }

    func saveProgress(bookId: UUID, progress: ReadingProgress, accessToken: String) async throws {
        let payload = ReadingProgressPayload(progress)
        let _: EmptyResponse = try await request(
            path: "/rest/v1/books?id=eq.\(bookId.uuidString.lowercased())",
            method: "PATCH",
            accessToken: accessToken,
            body: payload,
            preferMinimal: true
        )
    }

    func renameBook(bookId: UUID, title: String, accessToken: String) async throws -> BookRow {
        let rows: [BookRow] = try await request(
            path: "/rest/v1/books?id=eq.\(bookId.uuidString.lowercased())&select=*",
            method: "PATCH",
            accessToken: accessToken,
            body: BookTitlePayload(title: title),
            preferRepresentation: true
        )
        guard let row = rows.first else {
            throw URLError(.badServerResponse)
        }
        return row
    }

    func insertBook(_ book: BookRow, accessToken: String) async throws -> BookRow {
        let rows: [BookRow] = try await request(
            path: "/rest/v1/books?select=*",
            method: "POST",
            accessToken: accessToken,
            body: book,
            preferRepresentation: true
        )
        guard let row = rows.first else {
            throw URLError(.badServerResponse)
        }
        return row
    }

    func uploadDocument(data: Data, storagePath: String, mimeType: String, accessToken: String) async throws {
        let encodedPath = storagePath.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
        var request = baseRequest(path: "/storage/v1/object/epubs/\(encodedPath)", accessToken: accessToken)
        request.httpMethod = "POST"
        request.setValue(mimeType, forHTTPHeaderField: "Content-Type")
        request.setValue("false", forHTTPHeaderField: "x-upsert")
        let (responseData, response) = try await session.upload(for: request, from: data)
        try validate(response: response, data: responseData)
    }

    func downloadDocument(storagePath: String, accessToken: String) async throws -> Data {
        let encodedPath = storagePath.split(separator: "/").map { String($0).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? String($0) }.joined(separator: "/")
        return try await rawRequest(path: "/storage/v1/object/epubs/\(encodedPath)", method: "GET", accessToken: accessToken)
    }

    func invokeReaderImage(_ payload: ReaderImageFunctionRequest, accessToken: String) async throws -> ReaderImageFunctionResponse {
        try await invoke(function: "generate-reader-image", accessToken: accessToken, body: payload)
    }

    func invokeReaderNarration(_ payload: ReaderNarrationFunctionRequest, accessToken: String) async throws -> ReaderNarrationFunctionResponse {
        let data = try await rawRequest(
            path: "/functions/v1/edge-tts",
            method: "POST",
            accessToken: accessToken,
            body: payload,
            encoder: Self.edgeFunctionEncoder()
        )
        if let response = try? IllumeJSON.decoder().decode(ReaderNarrationFunctionResponse.self, from: data) {
            return response
        }
        return ReaderNarrationFunctionResponse(audio: data.base64EncodedString(), outputFormat: "wav", words: nil)
    }

    func deleteBook(bookId: UUID, accessToken: String) async throws {
        let _: EmptyResponse = try await invoke(
            function: "delete-reader-book",
            accessToken: accessToken,
            body: ["bookId": bookId.uuidString.lowercased()]
        )
    }

    func deleteAccount(accessToken: String) async throws {
        let _: EmptyResponse = try await invoke(
            function: "delete-account",
            accessToken: accessToken,
            body: EmptyRequest()
        )
    }

    func queuePdfProcessing(bookId: UUID, accessToken: String) async throws {
        let _: EmptyResponse = try await invoke(
            function: "process-reader-document",
            accessToken: accessToken,
            body: ["bookId": bookId.uuidString.lowercased()]
        )
    }

    func syncAppleSubscription(_ payload: AppleSubscriptionSyncRequest, accessToken: String) async throws -> AppleSubscriptionSyncResponse {
        try await invoke(function: "sync-apple-subscription", accessToken: accessToken, body: payload)
    }

    private func authRequest<T: Decodable, Body: Encodable>(path: String, body: Body) async throws -> T {
        try await request(path: path, method: "POST", accessToken: nil, body: body)
    }

    private func invoke<T: Decodable, Body: Encodable>(function: String, accessToken: String, body: Body) async throws -> T {
        try await request(
            path: "/functions/v1/\(function)",
            method: "POST",
            accessToken: accessToken,
            body: body,
            encoder: Self.edgeFunctionEncoder()
        )
    }

    private func request<T: Decodable>(
        path: String,
        method: String,
        accessToken: String?,
        body: (some Encodable)? = Optional<String>.none,
        encoder: JSONEncoder = IllumeJSON.encoder(),
        preferMinimal: Bool = false,
        preferRepresentation: Bool = false
    ) async throws -> T {
        var request = baseRequest(path: path, accessToken: accessToken)
        request.httpMethod = method
        if preferMinimal {
            request.setValue("return=minimal", forHTTPHeaderField: "Prefer")
        } else if preferRepresentation {
            request.setValue("return=representation", forHTTPHeaderField: "Prefer")
        }
        if let body {
            request.httpBody = try encoder.encode(AnyEncodable(body))
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        return try IllumeJSON.decoder().decode(T.self, from: data)
    }

    private func rawRequest(path: String, method: String, accessToken: String?) async throws -> Data {
        var request = baseRequest(path: path, accessToken: accessToken)
        request.httpMethod = method
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return data
    }

    private func rawRequest<Body: Encodable>(
        path: String,
        method: String,
        accessToken: String?,
        body: Body,
        encoder: JSONEncoder = IllumeJSON.encoder()
    ) async throws -> Data {
        var request = baseRequest(path: path, accessToken: accessToken)
        request.httpMethod = method
        request.httpBody = try encoder.encode(AnyEncodable(body))
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return data
    }

    private func baseRequest(path: String, accessToken: String?) -> URLRequest {
        var request = URLRequest(url: URL(string: config.url.absoluteString + path)!)
        request.setValue(config.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let accessToken {
            request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200..<300).contains(http.statusCode) else {
            if let edge = try? IllumeJSON.decoder().decode(EdgeFunctionError.self, from: data) {
                throw edge
            }
            throw URLError(.badServerResponse)
        }
    }

    private static var postgrestDateFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }

    private static func count(fromContentRange value: String?) -> Int? {
        guard let value, let slashIndex = value.lastIndex(of: "/") else {
            return nil
        }
        let total = value[value.index(after: slashIndex)...]
        return Int(total)
    }

    private static func queryValue(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    private static func edgeFunctionEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}

struct EmptyResponse: Codable {}

struct EmptyRequest: Codable {}

private struct BookTitlePayload: Encodable {
    let title: String
}

private struct ReaderImageCountRow: Codable {}

struct AnyEncodable: Encodable {
    private let encodeHandler: (Encoder) throws -> Void

    init(_ value: Encodable) {
        self.encodeHandler = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeHandler(encoder)
    }
}
