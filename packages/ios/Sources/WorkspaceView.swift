import SwiftUI
import UniformTypeIdentifiers

struct RiftMark: Shape {
    func path(in rect: CGRect) -> Path {
        var half = Path()
        half.move(to: CGPoint(x: 55, y: 7))
        half.addCurve(to: CGPoint(x: 91, y: 39), control1: CGPoint(x: 70, y: 16), control2: CGPoint(x: 85, y: 27))
        half.addQuadCurve(to: CGPoint(x: 81, y: 47), control: CGPoint(x: 95, y: 47))
        half.addLine(to: CGPoint(x: 9, y: 47))
        half.addCurve(to: CGPoint(x: 60, y: 27), control1: CGPoint(x: 40, y: 43), control2: CGPoint(x: 57, y: 37))
        half.addCurve(to: CGPoint(x: 55, y: 7), control1: CGPoint(x: 62, y: 20), control2: CGPoint(x: 59, y: 12))
        half.closeSubpath()
        var mark = half
        mark.addPath(half, transform: CGAffineTransform(translationX: 100, y: 100).scaledBy(x: -1, y: -1))
        let scale = min(rect.width, rect.height) / 124
        return mark.applying(CGAffineTransform(translationX: rect.midX - 50 * scale, y: rect.midY - 50 * scale).scaledBy(x: scale, y: scale))
    }
}

struct WorkspaceView: View {
    @Environment(RIFTStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var menuOpen = false
    @State private var settingsOpen = false
    @State private var signInOpen = false
    @State private var filePickerOpen = false
    @State private var modelPickerOpen = false
    @State private var search = ""
    @State private var workspacePanel: NativeWorkspacePanel?
    @State private var historyLimit = 6
    @FocusState private var composerFocused: Bool
    @GestureState private var drag: CGFloat = 0
    private var background: Color { scheme == .dark ? .black : Color(uiColor: .systemBackground) }
    private var motion: Animation? { reduceMotion ? nil : .spring(response: 0.36, dampingFraction: 0.86) }

    var body: some View {
        @Bindable var store = store
        GeometryReader { geometry in
            let width = min(geometry.size.width - 64, 360)
            let offset = min(width, max(0, (menuOpen ? width : 0) + drag))
            ZStack(alignment: .leading) {
                background.ignoresSafeArea()
                if offset > 0 {
                    drawer.frame(width: width).zIndex(2)
                }
                NavigationStack {
                    VStack(spacing: 0) {
                        if store.workspace == .hack { NativeHackHeader() }
                        transcript
                        if let error = store.error {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(error).font(.footnote).foregroundStyle(.secondary)
                                if store.reconnectAvailable {
                                    Button("Reconnect to task") { store.error = nil; store.resume() }
                                }
                            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal).padding(.vertical, 8)
                        }
                    }
                    .background(background)
                    .navigationTitle(store.selectedTitle == "RIFT" ? "" : store.selectedTitle)
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarLeading) {
                            Button { composerFocused = false; withAnimation(motion) { menuOpen.toggle() } } label: { Image(systemName: "line.3.horizontal").font(.system(size: 16, weight: .medium)).frame(width: 44, height: 44).contentShape(Rectangle()) }
                                .accessibilityLabel("Open menu").accessibilityIdentifier("open-menu")
                        }.riftCompactBackground()
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { composerFocused = false; workspacePanel = .activity } label: { Image(systemName: "list.bullet.rectangle").font(.system(size: 16, weight: .medium)).frame(width: 44, height: 44).contentShape(Rectangle()) }
                                .accessibilityLabel("Activity").accessibilityIdentifier("open-activity")
                        }.riftCompactBackground()
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { composerFocused = false; workspacePanel = .preview } label: { Image(systemName: "globe").font(.system(size: 16, weight: .medium)).frame(width: 44, height: 44).contentShape(Rectangle()) }
                                .accessibilityLabel("Preview").accessibilityIdentifier("open-preview")
                        }.riftCompactBackground()
                        ToolbarItem(placement: .topBarTrailing) {
                            Button { store.newChat(); composerFocused = true } label: { Image(systemName: "square.and.pencil").font(.system(size: 16, weight: .medium)).frame(width: 44, height: 44).contentShape(Rectangle()) }.accessibilityLabel("New chat")
                        }.riftCompactBackground()
                    }
                    .safeAreaInset(edge: .bottom, spacing: 0) { composer }
                }
                .allowsHitTesting(!menuOpen)
                .clipShape(.rect(cornerRadius: offset > 0 ? 28 : 0))
                .overlay {
                    if menuOpen {
                        Color.black.opacity(0.26).contentShape(Rectangle())
                            .onTapGesture { withAnimation(motion) { menuOpen = false } }
                            .gesture(drawerGesture(width: width))
                            .accessibilityLabel("Close menu").accessibilityAddTraits(.isButton)
                    }
                }
                .offset(x: offset)
                .accessibilityHidden(menuOpen)
                if !menuOpen {
                    Color.clear.frame(width: 18).contentShape(Rectangle())
                        .gesture(drawerGesture(width: width)).accessibilityHidden(true)
                }
            }
            .clipped()
        }
        .background(background)
        .sheet(isPresented: $modelPickerOpen) { NativeModelPicker() }
        .sheet(item: $workspacePanel) { panel in NativeWorkspacePanelView(selection: panel) }
        .sheet(isPresented: $settingsOpen) { NativeSettingsView(signInOpen: $signInOpen) }
        .sheet(isPresented: $signInOpen) { NativeSignInView() }
        .onChange(of: store.signedIn) { _, signedIn in if signedIn { signInOpen = false } }
    }
    private func drawerGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .updating($drag) { value, state, _ in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                state = value.translation.width
            }
            .onEnded { value in
                let target = (menuOpen ? width : 0) + value.predictedEndTranslation.width
                composerFocused = false
                withAnimation(motion) { menuOpen = target > width * 0.5 }
            }
    }
    private var filteredHistory: [Conversation] {
        store.conversations.filter { search.isEmpty || $0.title.localizedCaseInsensitiveContains(search) }.sorted { $0.updatedAt > $1.updatedAt }
    }
    private var drawer: some View {
        @Bindable var store = store
        return VStack(spacing: 0) {
            HStack {
                RiftMark().frame(width: 34, height: 34).accessibilityLabel("RIFT")
                Spacer()
            }.padding(.horizontal, 20).padding(.top, 16).padding(.bottom, 18)
            TextField("Search conversations", text: $search)
                .textFieldStyle(.roundedBorder).padding(.horizontal, 20).padding(.bottom, 12)
                .accessibilityIdentifier("history-search")
                .onChange(of: search) { _, _ in historyLimit = 6 }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 2) {
                    ForEach(NativeWorkspace.allCases) { section in
                        Button {
                            store.selectWorkspace(section)
                            withAnimation(motion) { menuOpen = false }
                        } label: {
                            Label(section.title, systemImage: section.symbol)
                                .font(.body.weight(.medium)).foregroundStyle(.primary)
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("workspace-" + section.rawValue)
                    }
                    Divider().padding(.vertical, 12)
                    if store.conversations.isEmpty {
                        Text(store.signedIn ? "Your conversations will appear here." : "Sign in to see your conversations.")
                            .font(.subheadline).foregroundStyle(.secondary).padding(.vertical)
                    }
                    ForEach(ConversationHistory.groups(Array(filteredHistory.prefix(historyLimit))), id: \.title) { group in
                        Text(group.title).font(.footnote.weight(.medium)).foregroundStyle(.secondary).padding(.top, 12)
                        ForEach(group.chats) { chat in
                        Button {
                            withAnimation(motion) { menuOpen = false }
                            Task { await store.open(chat) }
                        } label: {
                            HStack(spacing: 8) {
                                if store.working && store.selectedID == chat.id { ReasoningIndicator() }
                                Text(chat.title).font(.system(size: 15)).foregroundStyle(.primary).lineLimit(1)
                            }
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .padding(.horizontal, 10)
                                .background(store.selectedID == chat.id ? Color(uiColor: .secondarySystemBackground) : .clear, in: .rect(cornerRadius: 12))
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain).accessibilityIdentifier("conversation-" + chat.id)
                        }
                    }
                    if filteredHistory.count > historyLimit || !store.historyDone {
                        Button("Show more") {
                            historyLimit += 6
                            if historyLimit > filteredHistory.count { Task { await store.moreHistory() } }
                        }.font(.subheadline).foregroundStyle(.secondary).frame(minHeight: 44).disabled(store.loading)
                    }
                }.padding(.horizontal, 20).padding(.bottom, 24)
            }.scrollDismissesKeyboard(.interactively)
            HStack {
                Button {
                    store.newChat(); withAnimation(motion) { menuOpen = false }; composerFocused = true
                } label: { Label("New chat", systemImage: "square.and.pencil").font(.headline).padding(.vertical, 7) }
                    .buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground)).buttonBorderShape(.capsule)
                Spacer()
                Button { settingsOpen = true } label: { Image(systemName: "gearshape").font(.title3).frame(width: 30, height: 36) }
                    .buttonStyle(.bordered).buttonBorderShape(.circle).tint(.primary)
                    .accessibilityLabel("Settings").accessibilityIdentifier("open-settings")

            }.padding(.horizontal, 20).padding(.vertical, 12)
        }
    }
    private var transcript: some View {
        ScrollViewReader { scroll in
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if !store.messagesDone {
                    Button {
                        let anchor = store.messages.first?.id
                        Task {
                            await store.loadOlderMessages()
                            if let anchor { scroll.scrollTo(anchor, anchor: .top) }
                        }
                    } label: {
                        HStack {
                            if store.loadingOlderMessages { ProgressView().tint(.secondary) }
                            Text(store.loadingOlderMessages ? "Loading earlier messages…" : "Show earlier messages")
                        }.font(.footnote).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 44)
                    }.buttonStyle(.plain).disabled(store.loadingOlderMessages)
                        .accessibilityIdentifier("load-earlier-messages")
                }
                if let error = store.historyLoadError { Text(error).font(.footnote).foregroundStyle(.secondary) }
                if store.messages.isEmpty && store.workspace == .studio {
                    NativeStudioGallery()
                } else if store.messages.isEmpty {
                    VStack(spacing: 16) {
                        RiftMark().frame(width: 74, height: 74)
                        Text(store.workspace == .hack ? "What would you like to assess?" : "What would you like to create?").font(.title2.weight(.semibold)).multilineTextAlignment(.center)
                    }.frame(maxWidth: .infinity).padding(.top, 100).padding(.bottom, 60)
                }
                ForEach(Array(store.messages.enumerated()), id: \.element.id) { index, message in
                    if index == store.activityAnchor && (store.working || !store.agentActivity.steps.isEmpty || !store.agentActivity.reasoning.isEmpty) {
                        AgentActivityView(activity: store.agentActivity, working: store.working)
                    }
                    if let historical = message.savedActivity {
                        // Live replay owns matching tool IDs; don't display the same call twice.
                        let liveIDs = Set(store.agentActivity.steps.map(\.id))
                        let saved = historical.excluding(liveIDs)
                        if !saved.steps.isEmpty || !saved.reasoning.isEmpty { AgentActivityView(activity: saved, working: false).id(message.id) }
                    } else {
                    HStack(alignment: .top) {
                        if message.role == "user" { Spacer(minLength: 40) }
                        if let fileID = message.fileID { NativeArtifactView(fileID: fileID, name: message.text, mediaType: message.mediaType ?? "") }
                        else { VStack(alignment: .leading) {
                            if message.role == "assistant" { NativeAssistantText(text: message.text) }
                            else { Text(message.text).font(.body).textSelection(.enabled) }
                        }
                            .padding(message.role == "user" ? 14 : 0)
                            .background(message.role == "user" ? Color(uiColor: .secondarySystemBackground) : .clear, in: .rect(cornerRadius: 22))
                        }
                        if message.role != "user" { Spacer(minLength: 0) }
                    }.id(message.id)
                    }
                }
                ForEach(store.approvals) { approval in
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Review action", systemImage: "hand.raised").font(.headline)
                        Text(approval.toolName).font(.subheadline.bold())
                        Text(approval.preview).font(.footnote).textSelection(.enabled)
                        HStack {
                            Button("Decline", role: .destructive) { Task { await store.decide(approval, allow: false) } }.buttonStyle(.bordered)
                            Button("Allow") { Task { await store.decide(approval, allow: true) } }.buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground))
                        }
                    }.padding(16).background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 18))
                }
                if store.activityAnchor >= store.messages.count && (store.working || !store.agentActivity.steps.isEmpty || !store.agentActivity.reasoning.isEmpty) {
                    AgentActivityView(activity: store.agentActivity, working: store.working)
                }
            }.padding(20)
        }.defaultScrollAnchor(store.messages.isEmpty ? .top : .bottom, for: .sizeChanges).scrollDismissesKeyboard(.interactively)
            .contentShape(Rectangle())
            .simultaneousGesture(TapGesture().onEnded { composerFocused = false })
            .accessibilityIdentifier("chat-transcript")
        }
    }
    private var composer: some View {
        @Bindable var store = store
        return VStack(spacing: 10) {
            HStack {
                Button { composerFocused = false; modelPickerOpen = true } label: {
                    HStack(spacing: 6) {
                        if let choice = store.availableModels.first(where: { $0.id == store.selectedModel }) { ProviderLogo(choice: choice, size: 16) }
                        Text(store.loading ? "Loading models…" : store.availableModels.first { $0.id == store.selectedModel }?.title ?? "Choose model")
                            .font(.system(size: 13, weight: .medium)).lineLimit(1)
                        Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(.secondary)
                    }.foregroundStyle(.primary).frame(minHeight: 44)
                }.buttonStyle(.plain).disabled(!store.signedIn || store.working)
                    .accessibilityIdentifier("choose-model")
                Spacer(minLength: 8)
                if store.workspace != .studio, !(store.efforts[store.selectedModel] ?? []).isEmpty {
                    Menu {
                        Picker("Reasoning", selection: $store.selectedReasoningEffort) {
                            ForEach(store.efforts[store.selectedModel] ?? [], id: \.self) { Text($0.capitalized).tag($0) }
                        }
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "slider.horizontal.3")
                            Text(store.selectedReasoningEffort.capitalized)
                        }.font(.system(size: 13)).foregroundStyle(.primary).frame(minHeight: 44)
                    }.accessibilityLabel("Reasoning effort").disabled(store.working)
                }
            }
            if store.uploading { ProgressView("Uploading file…").font(.caption) }
            ForEach(store.attachments) { file in
                HStack { Label(file.name, systemImage: "doc").font(.caption).lineLimit(1); Spacer(); Button("Remove") { store.attachments.removeAll { $0.id == file.id } }.font(.caption) }
            }
            HStack(alignment: .bottom, spacing: 12) {
                Button { filePickerOpen = true } label: { Image(systemName: "plus").frame(width: 32, height: 44) }.accessibilityLabel("Attach file").disabled(!store.signedIn || store.working || store.uploading)
                    .fileImporter(isPresented: $filePickerOpen, allowedContentTypes: [.item]) { result in
                        switch result { case .success(let url): Task { await store.attach(url) }; case .failure(let error): store.error = error.localizedDescription }
                    }
                TextField("Message RIFT", text: $store.draft, axis: .vertical)
                    .lineLimit(1...6).font(.body).focused($composerFocused)
                    .frame(minHeight: 44).contentShape(Rectangle())
                    .onTapGesture { composerFocused = true }
                    .accessibilityIdentifier("message-input")
                Button {
                    if !store.signedIn { composerFocused = false; signInOpen = true }
                    else if store.working { Task { await store.stop() } }
                    else { composerFocused = false; store.send() }
                } label: {
                    Image(systemName: store.working ? "stop.fill" : "arrow.up")
                        .font(.headline).frame(width: 28, height: 32)
                }.buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground)).buttonBorderShape(.circle)
                    .disabled(store.signedIn && !store.working && !store.canSend)
                    .accessibilityLabel(store.working ? "Stop task" : "Send message")
            }.padding(14).background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 26))
        }.padding(.horizontal, 16).padding(.vertical, 10).background(background)
    }
}

private extension ToolbarContent {
    @ToolbarContentBuilder
    func riftCompactBackground() -> some ToolbarContent {
        if #available(iOS 26.0, *) {
            self.sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
    }
}
