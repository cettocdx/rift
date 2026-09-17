import Foundation
import Security

struct RIFTFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

enum NativeRequestError {
    // A gateway failure can arrive after admission; checking the saved task is safe.
    // Validation/authentication rejections are not disconnected task streams.
    static func canReconnect(status: Int) -> Bool {
        status == 408 || status == 409 || status >= 500
    }

    static func message(status: Int, data: Data) -> String {
        if let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            // These are the API's public error fields, never its internal metadata.
            for key in ["cause", "message", "error"] {
                if let value = object[key] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return String(value.prefix(1000))
                }
            }
        }
        if status == 400, let text = String(data: data, encoding: .utf8),
           ["Invalid execution identity", "Invalid approval mode", "Invalid JSON body", "Invalid chat id"].contains(text) { return text }
        if status == 401 { return "Sign in to RIFT to continue." }
        return "RIFT could not start or resume this task (\(status)). Your message is preserved."
    }
}

/// Private in-memory cookies; only RIFT's authentication cookies are persisted in Keychain.
final class RIFTService {
    let origin: URL
    let session: URLSession
    init(origin: URL = URL(string: Bundle.main.object(forInfoDictionaryKey: "RIFTServerURL") as? String ?? "https://riftsys.app")!, configuration: URLSessionConfiguration = .ephemeral) {
        self.origin = origin
        let config = configuration
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 3600
        session = URLSession(configuration: config)
        restoreCookies()
    }
    private var keychainKey: String { "session:" + origin.absoluteString }
    func request(_ path: String, body: [String: Any]? = nil) -> URLRequest {
        var request = URLRequest(url: URL(string: path, relativeTo: origin)!.absoluteURL)
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }
    func json(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        let (data, response) = try await session.data(for: request(path, body: body))
        guard let http = response as? HTTPURLResponse else { throw RIFTFailure(message: "No response from RIFT.") }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        guard (200..<300).contains(http.statusCode) else {
            let message = object["error"] as? String ?? (http.statusCode == 401 ? "Sign in to RIFT to continue." : "RIFT could not complete this request (\(http.statusCode)). Your work is preserved.")
            throw RIFTFailure(message: message)
        }
        return object
    }
    func signIn(email: String, password: String) async throws {
        let result = try await json("/api/auth", body: ["action": "auth:signIn", "args": ["provider": "password", "params": ["flow": "signIn", "email": email, "password": password]]])
        guard result["tokens"] is [String: Any] else { throw RIFTFailure(message: "Sign-in needs email verification. Complete it in your account before continuing.") }
        try saveCookies()
    }
    func refresh() async throws {
        let result = try await json("/api/auth", body: ["action": "auth:signIn", "args": ["refreshToken": "dummy"]])
        guard result["tokens"] is [String: Any] else { clearCookies(); throw RIFTFailure(message: "Sign in to RIFT.") }
        try saveCookies()
    }
    func signOut() async throws {
        _ = try await json("/api/auth", body: ["action": "auth:signOut", "args": [:]])
        clearCookies()
    }
    var hasSession: Bool { !(session.configuration.httpCookieStorage?.cookies ?? []).isEmpty }
    private var keychainQuery: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.riftsys.ios", kSecAttrAccount as String: keychainKey] }
    func saveCookies() throws {
        let properties = (session.configuration.httpCookieStorage?.cookies ?? []).filter {
            $0.name.contains("convexAuth") && $0.domain.trimmingCharacters(in: CharacterSet(charactersIn: ".")) == origin.host
        }.compactMap { cookie in cookie.properties.map { Dictionary(uniqueKeysWithValues: $0.map { ($0.key.rawValue, $0.value) }) } }
        let data = try PropertyListSerialization.data(fromPropertyList: properties, format: .binary, options: 0)
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(keychainQuery as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(keychainQuery.merging(attributes) { _, new in new } as CFDictionary, nil) }
        guard status == errSecSuccess else { throw RIFTFailure(message: "iOS could not securely save your session (Keychain \(status)).") }
    }
    private func restoreCookies() {
        var value: CFTypeRef?
        let query = keychainQuery.merging([kSecReturnData as String: true]) { _, new in new }
        guard SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
              let data = value as? Data,
              let records = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [[String: Any]] else { return }
        for record in records {
            let properties = Dictionary(uniqueKeysWithValues: record.map { (HTTPCookiePropertyKey($0.key), $0.value) })
            if let cookie = HTTPCookie(properties: properties) { session.configuration.httpCookieStorage?.setCookie(cookie) }
        }
    }
    func clearCookies() {
        SecItemDelete(keychainQuery as CFDictionary)
        for cookie in session.configuration.httpCookieStorage?.cookies ?? [] { session.configuration.httpCookieStorage?.deleteCookie(cookie) }
    }
}
