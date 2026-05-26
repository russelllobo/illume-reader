#if os(iOS)
import Foundation
import IllumeCore
import Security

enum KeychainStore {
    private static let service = "com.illumereader.ios.auth"
    private static let account = "supabase-session"

    static func loadSession() -> AuthSession? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else {
            return nil
        }
        return try? IllumeJSON.decoder().decode(AuthSession.self, from: data)
    }

    static func save(session: AuthSession) {
        guard let data = try? IllumeJSON.encoder().encode(session) else { return }
        deleteSession()

        var query = baseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(query as CFDictionary, nil)
    }

    static func deleteSession() {
        SecItemDelete(baseQuery() as CFDictionary)
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}
#endif
