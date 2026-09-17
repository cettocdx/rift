import SwiftUI

struct NativeSettingsView: View {
    @Environment(RIFTStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Binding var signInOpen: Bool
    @AppStorage("appearance") private var appearance = "dark"
    var body: some View {
        NavigationStack {
            List {
                Section("Account") {
                    Label(store.signedIn ? store.accountName : "Not signed in", systemImage: "person.crop.circle")
                    if !store.signedIn {
                        Button("Sign in") { dismiss(); signInOpen = true }
                    }
                }
                Section {
                    NavigationLink { NativeUsageView() } label: { Label("Usage & billing", systemImage: "chart.bar") }
                        .disabled(!store.signedIn).accessibilityIdentifier("usage-settings")
                } header: { Text("Subscription") }
                Section("App") {
                    Picker("Appearance", selection: $appearance) {
                        Text("Dark").tag("dark"); Text("Light").tag("light"); Text("System").tag("system")
                    }
                    LabeledContent("Version", value: "0.1.0 · Native preview")
                }
                if store.signedIn { Section { Button("Sign out", role: .destructive) { Task { await store.signOut() } } } }
            }.navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
struct NativeUsageView: View {
    @Environment(RIFTStore.self) private var store
    var body: some View {
        List {
            Section("This month") {
                if store.usage.isEmpty { Text("Usage has not loaded yet.").foregroundStyle(.secondary) }
                else {
                    LabeledContent("Requests", value: (store.usage["requestCount"] ?? 0).formatted(.number.precision(.fractionLength(0))))
                    LabeledContent("Tokens", value: (store.usage["totalTokens"] ?? 0).formatted(.number.notation(.compactName)))
                }
            }
            if let error = store.error { Section { Text(error).foregroundStyle(.secondary); Button("Try again") { Task { await store.loadUsage() } } } }
        }.navigationTitle("Monthly usage").task { await store.loadUsage() }
    }
}
struct NativeSignInView: View {
    @Environment(RIFTStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var password = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(spacing: 12) {
                        RiftMark().frame(width: 70, height: 70)
                        Text("Welcome to RIFT").font(.title2.bold())
                    }.frame(maxWidth: .infinity).padding(.vertical, 24)
                }.listRowBackground(Color.clear)
                Section("Your RIFT account") {
                    TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(.password)
                }
                Section {
                    Button { Task { await store.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password) } } label: {
                        HStack { Text("Sign in"); Spacer(); if store.loading { ProgressView() } }
                    }.disabled(email.isEmpty || password.isEmpty || store.loading)
                }
                if let error = store.error { Section { Text(error).font(.subheadline).foregroundStyle(.secondary) } }
            }.scrollContentBackground(.hidden)
                .background(Color.black.ignoresSafeArea())
                .navigationTitle("Sign in").navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(Color.black, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
                .onChange(of: store.signedIn) { _, signedIn in if signedIn { password = ""; dismiss() } }
        }.preferredColorScheme(.dark)
            .presentationBackground(Color.black)
    }
}
