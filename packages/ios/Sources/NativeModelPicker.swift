import SwiftUI

struct ProviderLogo: View {
    let choice: ModelChoice
    var size: CGFloat = 20
    private var monochrome: Bool { ["provider-openai", "provider-grok", "provider-flux", "provider-runway"].contains(choice.logo ?? "") }
    var body: some View {
        if let logo = choice.logo {
            Image(logo).renderingMode(monochrome ? .template : .original)
                .resizable().scaledToFit().frame(width: size, height: size)
                .foregroundStyle(.primary).accessibilityHidden(true)
        } else {
            Image(systemName: "cpu").frame(width: size, height: size).foregroundStyle(.secondary).accessibilityHidden(true)
        }
    }
}

struct NativeModelPicker: View {
    @Environment(RIFTStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var mediaKind = "image"
    var body: some View {
        @Bindable var store = store
        NavigationStack {
            VStack(spacing: 12) {
                if store.workspace == .studio {
                    Picker("Media type", selection: $mediaKind) {
                        Text("Image").tag("image")
                        Text("Video").tag("video")
                    }.pickerStyle(.segmented).padding(.horizontal, 16)
                }
                ScrollView {
                    LazyVStack(spacing: 2) {
                    ForEach(store.availableModels.filter { store.workspace != .studio || $0.id.hasPrefix(mediaKind + "-") }) { choice in
                        Button {
                            store.selectedModel = choice.id
                            dismiss()
                        } label: {
                            HStack(spacing: 12) {
                                ProviderLogo(choice: choice)
                                Text(choice.title).font(.system(size: 15)).foregroundStyle(.primary)
                                Spacer()
                                if store.selectedModel == choice.id { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(.primary) }
                            }.padding(.horizontal, 12).frame(minHeight: 44)
                                .background(store.selectedModel == choice.id ? Color.primary.opacity(0.06) : .clear, in: .rect(cornerRadius: 12))
                        }.buttonStyle(.plain)
                    }

                    }.padding(.horizontal, 16).padding(.bottom, 20)
                }
            }.navigationTitle("Model").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.foregroundStyle(.primary) } }
        }.onAppear { mediaKind = store.selectedModel.hasPrefix("video-") ? "video" : "image" }
        .presentationDetents([.fraction(0.65)])
        .presentationBackground(Color(uiColor: .systemBackground))
        .presentationContentInteraction(.scrolls)
        .presentationDragIndicator(.visible)
    }
}

struct NativeStudioTemplate: Identifiable {
    let id: String
    let title: String
    let subtitle: String
    let prompt: String
    let video: Bool
    static let all: [Self] = [
        .init(id: "film", title: "Film", subtitle: "A cinematic sequence", prompt: "Create a cinematic film concept. Help me define the subject, mood and duration, then develop a shot sequence and generate the available scenes.", video: true),
        .init(id: "short", title: "Short film", subtitle: "One idea, a complete story", prompt: "Create a short film with a clear beginning, turning point and ending. Ask for the subject and duration, then prepare the shot list and available video scenes.", video: true),
        .init(id: "ads", title: "Ads", subtitle: "Make the product the story", prompt: "Create a product advertisement. Ask for the product, audience and format. Develop a strong visual hook and generate the scenes without inventing product claims.", video: true),
        .init(id: "ugc", title: "UGC", subtitle: "A creator-led product story", prompt: "Create a UGC-style product video concept. Ask for the product and key benefit, then develop a natural creator script and available video scenes. Do not invent testimonials.", video: true),
        .init(id: "photo", title: "Photo edit", subtitle: "Reimagine an uploaded image", prompt: "Help me edit a photo. Ask me to attach the image and describe the change. Preserve details I have not asked to change.", video: false),
        .init(id: "product", title: "Product photos", subtitle: "A cohesive visual collection", prompt: "Create a cohesive product photography collection. Ask me to attach the product reference and choose the setting. Keep the product's real appearance consistent.", video: false)
    ]
}

struct NativeStudioGallery: View {
    @Environment(RIFTStore.self) private var store
    @State private var selected: NativeStudioTemplate?
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Create with Studio").font(.title2.weight(.semibold))
            Text("Start with an idea or explore a direction.").font(.subheadline).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                ForEach(NativeStudioTemplate.all) { template in
                    Button { selected = template } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            GeometryReader { geometry in
                                Image("studio-" + template.id).resizable().scaledToFill()
                                    .frame(width: geometry.size.width, height: 116).clipped()
                            }.frame(height: 116)
                            Text(template.title).font(.subheadline.weight(.semibold)).padding(.horizontal, 10)
                            Text(template.subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2).frame(height: 32, alignment: .topLeading).padding(.horizontal, 10).padding(.bottom, 12)
                        }.frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 16)).clipShape(.rect(cornerRadius: 16))
                    }.buttonStyle(.plain).foregroundStyle(.primary).accessibilityIdentifier("studio-template-" + template.id)
                }
            }
            Text("Visual references · Results depend on your prompt and selected model.").font(.caption2).foregroundStyle(.secondary)
        }.sheet(item: $selected) { template in
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Image("studio-" + template.id).resizable().scaledToFit().clipShape(.rect(cornerRadius: 18))
                        Text(template.subtitle).font(.title3.weight(.semibold))
                        Text(template.prompt).font(.body).foregroundStyle(.secondary)
                        Text("This prepares your message. Generation starts when you send it.").font(.footnote).foregroundStyle(.secondary)
                    }.padding(20)
                }.navigationTitle(template.title).navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { selected = nil } } }
                    .safeAreaInset(edge: .bottom) {
                        Button("Use template") {
                            store.draft = template.prompt
                            let prefix = template.video ? "video-" : "image-"
                            if !store.selectedModel.hasPrefix(prefix), let choice = store.availableModels.first(where: { $0.id.hasPrefix(prefix) }) { store.selectedModel = choice.id }
                            selected = nil
                        }.buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground)).controlSize(.large).frame(maxWidth: .infinity).padding(16)
                    }
            }.presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }
}
