import Foundation
import Observation

struct NativeApproval: Identifiable { let id: String; let toolName: String; let preview: String }
enum NativeWorkspace: String, CaseIterable, Identifiable {
    case build = "app", studio = "image", hack = "security"
    var id: String { rawValue }
    var title: String { switch self { case .build: "Build"; case .studio: "Studio"; case .hack: "Hack Workbench" } }
    var symbol: String { switch self { case .build: "shippingbox"; case .studio: "photo.on.rectangle"; case .hack: "shield.lefthalf.filled" } }
}
struct Conversation: Identifiable {
    let id: String
    let title: String
    var updatedAt: Date = .distantPast
    var purpose: NativeWorkspace = .build
}
struct ConversationHistory {
    static func groups(_ chats: [Conversation], now: Date = Date(), calendar: Calendar = .current) -> [(title: String, chats: [Conversation])] {
        let sorted = chats.sorted { $0.updatedAt > $1.updatedAt }
        let today = sorted.filter { calendar.isDate($0.updatedAt, inSameDayAs: now) }
        let earlier = sorted.filter { !calendar.isDate($0.updatedAt, inSameDayAs: now) }
        return [("Today", today), ("Earlier", earlier)].filter { !$0.1.isEmpty }
    }
}
struct NativeMessage: Identifiable, Equatable { let id: String; let role: String; var text: String; var fileID: String? = nil; var mediaType: String? = nil; var savedActivity: AgentActivity? = nil }
enum NativeMessageHistory {
    static func decode(_ page: [[String: Any]]) -> [NativeMessage] {
        page.reversed().flatMap { message -> [NativeMessage] in
                let messageID = message["id"] as? String ?? UUID().uuidString
                let role = message["role"] as? String ?? "assistant"
                let details = message["fileDetails"] as? [[String: Any]] ?? []
                var emittedFiles = Set<String>()
                func fileMessage(_ file: [String: Any]) -> NativeMessage? {
                    guard let id = file["fileId"] as? String, !id.isEmpty,
                          emittedFiles.insert(id).inserted else { return nil }
                    let detail = details.first { $0["fileId"] as? String == id } ?? file
                    return NativeMessage(id: messageID + ":file:" + id, role: role,
                        text: detail["name"] as? String ?? "File", fileID: id,
                        mediaType: detail["mediaType"] as? String)
                }
                var content: [NativeMessage] = []
                for (index, part) in (message["parts"] as? [[String: Any]] ?? []).enumerated() {
                    let type = part["type"] as? String ?? ""
                    if type == "text", let text = part["text"] as? String {
                        content.append(NativeMessage(id: messageID + ":persisted:" + String(index), role: role, text: text))
                    } else if type == "file", let file = fileMessage(part) {
                        content.append(file)
                    } else if (type.hasPrefix("tool-") || type == "dynamic-tool"),
                              part["state"] as? String == "output-available",
                              let output = part["output"] as? [String: Any], output["ok"] as? Bool != false,
                              let file = fileMessage(output) {
                        content.append(file)
                    }
                }
                // Legacy metadata has no chronological position. Append only files
                // not already represented by ordered parts, never move known media.
                content += details.compactMap(fileMessage)
                var activity = AgentActivity()
                if role == "assistant" { activity.restore(parts: message["parts"] as? [[String: Any]] ?? []) }
                let activityRows = (activity.steps.isEmpty && activity.reasoning.isEmpty) ? [] : [NativeMessage(id: messageID + ":activity", role: role, text: "", savedActivity: activity)]
                return activityRows + content
            }
    }
    static func prepend(_ older: [NativeMessage], to current: [NativeMessage]) -> [NativeMessage] {
        var seen = Set(current.map(\.id))
        return older.filter { seen.insert($0.id).inserted } + current
    }
}
struct ModelChoice: Identifiable {
    let id: String
    let title: String
    var logo: String? {
        let value = (id + " " + title).lowercased()
        let brands: [(String, [String])] = [
            ("openai", ["gpt", "openai", "sora"]), ("claude", ["claude", "anthropic"]),
            ("gemini", ["gemini", "image-lite", "veo"]), ("grok", ["grok"]), ("kimi", ["kimi"]),
            ("bytedance", ["seedream", "seedance"]), ("flux", ["flux"]), ("kling", ["kling"]), ("runway", ["runway"]), ("alibaba", ["wan"]), ("hailuo", ["hailuo"]),
            ("hunyuan", ["hy4", "hunyuan"]), ("qwen", ["qwen"]), ("zai", ["glm"]),
        ]
        return brands.first { brand in brand.1.contains { value.contains($0) } }.map { "provider-" + $0.0 }
    }
}

/// Replay replaces only the affected text part, keeping already visible output on screen.
struct StreamTextReducer {
    var messageID = "assistant"
    private var replayText: [String: String] = [:]
    mutating func apply(_ event: [String: Any], to messages: inout [NativeMessage]) {
        let type = event["type"] as? String
        if type == "start" {
            messageID = event["messageId"] as? String ?? messageID
            replayText.removeAll()
            return
        }
        let id = messageID + ":" + (event["id"] as? String ?? "text")
        if type == "text-end" || type == "finish" {
            let completed = type == "finish" ? Array(replayText.keys) : [id]
            for key in completed {
                if let text = replayText.removeValue(forKey: key),
                   let index = messages.firstIndex(where: { $0.id == key }) {
                    messages[index].text = text
                }
            }
            return
        }
        guard type == "text-delta", let delta = event["delta"] as? String else { return }
        let first = replayText[id] == nil
        replayText[id, default: ""] += delta
        let incoming = replayText[id] ?? ""
        if let index = messages.firstIndex(where: { $0.id == id }) {
            // A replay starts at byte zero. Keep the already-visible snapshot
            // while the matching prefix catches up; never append it twice.
            if !messages[index].text.hasPrefix(incoming) { messages[index].text = incoming }
        } else if first, let index = messages.firstIndex(where: { $0.id.hasPrefix(messageID + ":persisted:") }) {
            let visible = messages[index].text.hasPrefix(incoming) ? messages[index].text : incoming
            messages[index] = NativeMessage(id: id, role: "assistant", text: visible)
        } else { messages.append(NativeMessage(id: id, role: "assistant", text: incoming)) }
    }
}

@MainActor @Observable
final class RIFTStore {
    let service: RIFTService
    init(service: RIFTService = RIFTService()) { self.service = service }
    var signedIn = false
    var accountName = "RIFT"
    var conversations: [Conversation] = []
    var messages: [NativeMessage] = []
    var selectedID = UUID().uuidString
    var selectedTitle = "RIFT"
    var workspace: NativeWorkspace = .build
    private var dispatchID = ""
    var draft = ""
    var models: [ModelChoice] = []
    var securityModels: [ModelChoice] = []
    var mediaModels: [ModelChoice] = []
    var hackScope = ""
    private var assessmentScopes: [String: String] = [:]
    var mediaModel = "image-gemini"
    var securityModel = ""
    var availableModels: [ModelChoice] { workspace == .studio ? mediaModels : workspace == .hack ? securityModels : models }
    var selectedModel: String {
        get { workspace == .studio ? mediaModel : workspace == .hack ? (securityModel.isEmpty ? securityModels.first?.id ?? "" : securityModel) : model }
        set { if workspace == .studio { mediaModel = newValue } else if workspace == .hack { securityModel = newValue } else { model = newValue } }
    }
    var hackDurable = false
    var model = ""
    var effort = "medium"
    var efforts: [String: [String]] = [:]
    var selectedReasoningEffort: String {
        get {
            let supported = efforts[selectedModel] ?? []
            if supported.contains(effort) { return effort }
            // A qualitative setting cannot map to the first toggle option (Off).
            if supported.contains("medium") { return "medium" }
            if supported.contains("on") { return "on" }
            return supported.first ?? "medium"
        }
        set { effort = newValue }
    }
    var approvals: [NativeApproval] = []
    var working = false
    var reconnectAvailable = false
    var activity = ""
    var agentActivity = AgentActivity()
    var activityAnchor = 0
    var error: String?
    var attachments: [NativeAttachment] = []
    var uploading = false
    var loading = false
    var usage: [String: Double] = [:]
    var messageCursor: String?
    var messagesDone = true
    var loadingOlderMessages = false
    var historyLoadError: String?
    private var messagePageGeneration = UUID()
    var historyCursor: String?
    var historyDone = true
    private var awaitingAdmission = false
    private var streamTask: Task<Void, Never>?
    private var approvalsTask: Task<Void, Never>?

    /// Test-only escape hatch for scenarios that intentionally end in the
    /// reconnect backoff loop.
    func streamTaskCancelForTest() {
        streamTask?.cancel()
        approvalsTask?.cancel()
        working = false
    }

    func restore() async {
        guard service.hasSession else { return }
        loading = true
        defer { loading = false }
        do { try await service.refresh(); try await loadAccount() }
        catch { self.error = error.localizedDescription }
    }
    func signIn(email: String, password: String) async {
        loading = true; error = nil
        defer { loading = false }
        do { try await service.signIn(email: email, password: password); try await loadAccount() }
        catch { self.error = error.localizedDescription }
    }
    private func loadAccount() async throws {
        let result = try await service.json("/api/mobile/session")
        accountName = (result["user"] as? [String: Any])?["name"] as? String ?? "RIFT"
        conversations = Self.chats(result)
        historyCursor = result["continueCursor"] as? String
        historyDone = result["isDone"] as? Bool ?? true
        signedIn = true
        let config = try await service.json("/api/console/config")
        models = (config["models"] as? [[String: Any]] ?? []).compactMap {
            guard let id = $0["value"] as? String, let title = $0["label"] as? String else { return nil }
            return ModelChoice(id: id, title: title)
        }
        securityModels = (config["securityModels"] as? [[String: String]] ?? []).compactMap {
            guard let id = $0["value"], let title = $0["label"] else { return nil }
            return ModelChoice(id: id, title: title)
        }
        mediaModels = (config["mediaModels"] as? [[String: String]] ?? []).compactMap {
            guard let id = $0["value"], let title = $0["label"] else { return nil }
            return ModelChoice(id: id, title: title)
        }
        if model.isEmpty { model = config["model"] as? String ?? models.first?.id ?? "" }
        efforts = (config["modelEfforts"] as? [String: [[String: String]]] ?? [:]).mapValues { $0.compactMap { $0["value"] } }
    }
    private static func chats(_ result: [String: Any]) -> [Conversation] {
        (result["page"] as? [[String: Any]] ?? []).compactMap {
            guard let id = $0["id"] as? String else { return nil }
            return Conversation(id: id, title: $0["title"] as? String ?? "New chat", updatedAt: Date(timeIntervalSince1970: ($0["updatedAt"] as? Double ?? 0) / 1000), purpose: NativeWorkspace(rawValue: $0["purpose"] as? String ?? "app") ?? .build)
        }
    }
    func moreHistory() async {
        guard !loading, !historyDone, let cursor = historyCursor else { return }
        loading = true; defer { loading = false }
        do {
            let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
            let result = try await service.json("/api/mobile/session?cursor=" + encoded)
            let known = Set(conversations.map(\.id))
            conversations += Self.chats(result).filter { !known.contains($0.id) }
            historyCursor = result["continueCursor"] as? String
            historyDone = result["isDone"] as? Bool ?? true
        } catch { self.error = error.localizedDescription }
    }
    func selectWorkspace(_ next: NativeWorkspace) {
        newChat(); workspace = next; selectedTitle = next.title
    }
    func newChat() {
        resetMessagePagination()
        attachments = []
        assessmentScopes[selectedID] = hackScope
        hackScope = ""
        streamTask?.cancel(); approvalsTask?.cancel(); approvals = []
        agentActivity = AgentActivity(); activityAnchor = 0
        selectedID = UUID().uuidString; dispatchID = ""; selectedTitle = "RIFT"; messages = []
        working = false; reconnectAvailable = false; error = nil; draft = ""
    }
    private func resetMessagePagination() {
        messagePageGeneration = UUID()
        messageCursor = nil; messagesDone = true; loadingOlderMessages = false; historyLoadError = nil
    }
    func loadOlderMessages() async {
        guard !loadingOlderMessages, !messagesDone, let cursor = messageCursor else { return }
        let generation = messagePageGeneration
        let chatID = selectedID
        loadingOlderMessages = true; historyLoadError = nil
        defer { if generation == messagePageGeneration { loadingOlderMessages = false } }
        do {
            var query = URLComponents()
            query.queryItems = [URLQueryItem(name: "chatId", value: chatID), URLQueryItem(name: "cursor", value: cursor)]
            let result = try await service.json("/api/mobile/session?" + (query.percentEncodedQuery ?? ""))
            guard generation == messagePageGeneration, chatID == selectedID else { return }
            let merged = NativeMessageHistory.prepend(NativeMessageHistory.decode(result["page"] as? [[String: Any]] ?? []), to: messages)
            activityAnchor += merged.count - messages.count
            messages = merged
            messageCursor = result["continueCursor"] as? String
            messagesDone = result["isDone"] as? Bool ?? true
        } catch {
            if generation == messagePageGeneration { historyLoadError = error.localizedDescription }
        }
    }
    func open(_ chat: Conversation) async {
        resetMessagePagination()
        let generation = messagePageGeneration
        attachments = []
        assessmentScopes[selectedID] = hackScope
        hackScope = assessmentScopes[chat.id] ?? ""
        streamTask?.cancel(); approvalsTask?.cancel(); approvals = []
        agentActivity = AgentActivity(); activityAnchor = 0
        workspace = chat.purpose
        selectedID = chat.id; selectedTitle = chat.title; messages = []; draft = ""
        working = false; reconnectAvailable = false; error = nil
        do {
            let result = try await service.json("/api/mobile/session?chatId=" + chat.id)
            guard selectedID == chat.id, messagePageGeneration == generation else { return }
            dispatchID = (result["page"] as? [[String: Any]] ?? []).first { $0["role"] as? String == "user" }?["id"] as? String ?? ""
            messages = NativeMessageHistory.decode(result["page"] as? [[String: Any]] ?? [])
            messageCursor = result["continueCursor"] as? String
            messagesDone = result["isDone"] as? Bool ?? true
            resume()
        } catch { if selectedID == chat.id, messagePageGeneration == generation { self.error = error.localizedDescription } }
    }
    var canSend: Bool {
        signedIn && !loading && !working && !uploading &&
        availableModels.contains(where: { $0.id == selectedModel }) &&
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !attachments.isEmpty)
    }
    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        NativeMessageHistory.preserveActivity(agentActivity, at: activityAnchor, in: &messages)
        let files = attachments
        // The shared chat handler reads message parts, not the UI-only scope field.
        let prompt = workspace == .hack ? NativeHackPrompt.text(text, scope: hackScope) : text
        let parts: [[String: Any]] = (prompt.isEmpty ? [] : [["type": "text", "text": prompt]]) + files.map(\.part)
        attachments = []
        let messageID = UUID().uuidString
        dispatchID = messageID
        messages.append(NativeMessage(id: messageID, role: "user", text: text))
        for file in files { messages.append(NativeMessage(id: "file:" + file.id, role: "user", text: file.name, fileID: file.id, mediaType: file.mediaType)) }
        draft = ""; error = nil
        if !conversations.contains(where: { $0.id == selectedID }) {
            selectedTitle = String(text.prefix(70))
            conversations.insert(Conversation(id: selectedID, title: selectedTitle, updatedAt: Date(), purpose: workspace), at: 0)
        }
        let selectedEffort = selectedReasoningEffort
        begin(body: ["executionId": messageID, "chatId": selectedID, "messages": [["id": messageID, "role": "user", "parts": parts]], "selectedModel": selectedModel, "mode": workspace == .hack ? "agent" : "ask", "scope": workspace == .hack ? hackScope.trimmingCharacters(in: .whitespacesAndNewlines) : "", "reasoningEffort": selectedEffort, "approvalMode": "full", "sandboxPreference": "e2b", "purpose": workspace.rawValue])
    }
    func resume() { begin(body: nil) }
    func becameActive() {
        // Never interrupt a POST whose durable admission may still be pending.
        if signedIn && !awaitingAdmission && (working || reconnectAvailable) {
            error = nil
            resume()
        }
    }
    private func begin(body: [String: Any]?) {
        streamTask?.cancel()
        let chatID = selectedID
        if body != nil { agentActivity = AgentActivity() }
        if body != nil || agentActivity.steps.isEmpty && agentActivity.reasoning.isEmpty { activityAnchor = messages.count }
        working = true
        awaitingAdmission = body != nil
        approvalsTask?.cancel()
        approvals = []
        // Full-access sends cannot create interactive approvals. Do not poll
        // every two seconds for an impossible result. Replays may belong to an
        // older review-mode run, so retain polling when its policy is unknown.
        if body?["approvalMode"] as? String != "full" { pollApprovals(chatID: chatID) }
        reconnectAvailable = false; activity = body == nil ? "Connecting…" : "Working…"
        streamTask = Task {
            var nextBody = body
            var retryDelay: UInt64 = 1
            while !Task.isCancelled && selectedID == chatID {
            var mayReconnect = true
            do {
                let path = nextBody == nil ? "/api/mobile/stream?chatId=" + chatID + "&purpose=" + workspace.rawValue : "/api/mobile/stream?purpose=" + workspace.rawValue
                let (bytes, response) = try await service.session.bytes(for: service.request(path, body: nextBody))
                guard let http = response as? HTTPURLResponse else { throw RIFTFailure(message: "RIFT did not respond.") }
                guard selectedID == chatID, !Task.isCancelled else { return }
                awaitingAdmission = false
                if workspace == .hack, let transport = http.value(forHTTPHeaderField: "X-RIFT-Hack-Transport") { hackDurable = transport == "durable" }
                if http.statusCode == 204 {
                    // A run may have finished while this reader was detached.
                    // Only an admission this device already sent may end the
                    // task silently: a fresh send answered 204 never dispatched,
                    // so its message must surface as reconnectable, not "done".
                    if nextBody == nil {
                        // Fetch its saved result; a missing active stream is not a failure.
                        let saved = try await service.json("/api/mobile/session?chatId=" + chatID)
                        guard selectedID == chatID, !Task.isCancelled else { return }
                        let page = saved["page"] as? [[String: Any]] ?? []
                        if !page.isEmpty {
                            // The reconnect endpoint returns the newest page, not all
                            // history the user has already expanded. Replace that
                            // suffix while retaining the older rows and their cursor.
                            let pageIDs = page.compactMap { $0["id"] as? String }
                            let boundary = messages.firstIndex { message in
                                pageIDs.contains { message.id == $0 || message.id.hasPrefix($0 + ":") }
                            } ?? messages.endIndex
                            let older = Array(messages[..<boundary])
                            messages = older + NativeMessageHistory.decode(page)
                            if older.isEmpty {
                                messageCursor = saved["continueCursor"] as? String
                                messagesDone = saved["isDone"] as? Bool ?? true
                            }
                            agentActivity = AgentActivity(); activityAnchor = messages.count
                        }
                        working = false; reconnectAvailable = false; error = nil
                        approvalsTask?.cancel(); return
                    }
                    throw RIFTFailure(message: "RIFT could not confirm this task. Your message is preserved — reconnecting.")
                }
                guard (200..<300).contains(http.statusCode) else {
                    // The transport closed mid-task and server proof exists only
                    // when admission was actually confirmed. A send the server
                    // rejected (or never saw) must stay retryable — a dead
                    // worker's 4xx is not evidence of a live one.
                    mayReconnect = nextBody == nil || NativeRequestError.canReconnect(status: http.statusCode)
                    var errorData = Data()
                    for try await byte in bytes {
                        errorData.append(byte)
                        if errorData.count >= 16_384 { break }
                    }
                    throw RIFTFailure(message: NativeRequestError.message(status: http.statusCode, data: errorData))
                }
                var reducer = StreamTextReducer()
                var finished = false
                for try await line in bytes.lines {
                    try Task.checkCancellation()
                    guard selectedID == chatID else { return }
                    guard line.hasPrefix("data:") else { continue }
                    let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                    if payload == "[DONE]" { continue }
                    guard let data = payload.data(using: .utf8), let event = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
                    reducer.apply(event, to: &messages)
                    agentActivity.apply(event)
                    for file in NativeFileResult.files(from: event) where !messages.contains(where: { $0.fileID == file.fileID }) { messages.append(file) }
                    switch event["type"] as? String {
                    case "reasoning-start": activity = "Thinking…"
                    case "text-delta": activity = "Writing…"
                    case "tool-input-available": activity = "Using " + (event["toolName"] as? String ?? "a tool")
                    case "finish": finished = true
                    case "error": mayReconnect = false; throw RIFTFailure(message: event["errorText"] as? String ?? "The task needs attention.")
                    default: break
                    }
                }
                guard selectedID == chatID, !Task.isCancelled else { return }
                if finished {
                    agentActivity.settle(completed: true)
                    working = false; reconnectAvailable = false; error = nil
                    approvalsTask?.cancel(); return
                }
            } catch {
                guard selectedID == chatID, !Task.isCancelled else { return }
                if !mayReconnect {
                    awaitingAdmission = false
                    agentActivity.settle(completed: false)
                    working = false; approvalsTask?.cancel(); reconnectAvailable = false
                    self.error = error.localizedDescription; return
                }
            }
            // Reattach only: never repeat a POST or a tool after an ambiguous
            // network failure. Backoff stays bounded even during a long outage.
            awaitingAdmission = false
            nextBody = nil
            reconnectAvailable = true; activity = "Reconnecting…"; error = nil
            do { try await Task.sleep(nanoseconds: retryDelay * 1_000_000_000) }
            catch { return }
            retryDelay = min(retryDelay * 2, 30)
            }
        }
    }
    private func pollApprovals(chatID: String) {
        approvalsTask?.cancel()
        approvalsTask = Task {
            while !Task.isCancelled, working, selectedID == chatID {
                do {
                    let (data, response) = try await service.session.data(for: service.request("/api/console/approvals?chatId=" + chatID))
                    guard !Task.isCancelled, selectedID == chatID else { return }
                    if (response as? HTTPURLResponse)?.statusCode == 200,
                       let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
                        approvals = rows.compactMap { row in
                            guard let id = row["id"] as? String else { return nil }
                            return NativeApproval(id: id, toolName: row["toolName"] as? String ?? "Action", preview: row["preview"] as? String ?? "")
                        }
                    }
                    try await Task.sleep(for: .seconds(2))
                } catch {
                    if Task.isCancelled { return }
                    try? await Task.sleep(for: .seconds(4))
                }
            }
        }
    }
    func decide(_ approval: NativeApproval, allow: Bool) async {
        do {
            _ = try await service.json("/api/console/approvals", body: ["id": approval.id, "chatId": selectedID, "approve": allow])
            approvals.removeAll { $0.id == approval.id }
        } catch { self.error = error.localizedDescription }
    }
    func stop() async {
        let chatID = selectedID
        let executionID = dispatchID
        // A cancellation response belongs to the requested execution even if
        // the user navigates elsewhere while the server is confirming it.
        do {
            let result = try await service.json(workspace == .hack ? (hackDurable ? "/api/hack-long/cancel" : "/api/hack-chat/cancel") : workspace == .studio ? "/api/mobile/cancel" : "/api/agent-long/cancel", body: ["chatId": chatID, "dispatchId": executionID, "executionId": executionID])
            guard selectedID == chatID, dispatchID == executionID else { return }
            guard result["canceled"] as? Bool == true || result["reason"] as? String == "no_active_run" else {
                throw RIFTFailure(message: "Cancellation is not confirmed yet. The task may still be running.")
            }
            agentActivity.settle(completed: false)
            streamTask?.cancel(); approvalsTask?.cancel(); approvals = []; working = false; reconnectAvailable = false
        } catch {
            guard selectedID == chatID, dispatchID == executionID else { return }
            self.error = error.localizedDescription
        }
    }
    func loadUsage() async {
        do {
            let result = try await service.json("/api/usage/monthly")
            usage = result.compactMapValues { ($0 as? NSNumber)?.doubleValue }
        } catch { self.error = error.localizedDescription }
    }
    func signOut() async {
        do { try await service.signOut(); signedIn = false; conversations = []; newChat() }
        catch { self.error = error.localizedDescription }
    }
}
