import SwiftUI

struct NativeQuestionOption: Decodable { let label: String; var detail: String?; var recommended: Bool? }
struct NativeQuestion: Decodable { var id: String?; let question: String; var multi: Bool?; var allowOther: Bool?; var placeholder: String?; let options: [NativeQuestionOption] }
struct NativeQuestionPayload: Decodable { let questions: [NativeQuestion] }
struct NativeAnswerSegment: Identifiable {
    let id: Int
    var text: String = ""
    var questions: [NativeQuestion] = []
}

enum NativeQuestionParser {
    static func parse(_ text: String) -> [NativeAnswerSegment] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        // Some responses omit the fence. Recognize only the dedicated payload,
        // leaving ordinary JSON examples untouched.
        if trimmed.hasPrefix("{") && trimmed.range(of: #"^\{\s*"questions"\s*:"#, options: .regularExpression) != nil {
            if let data = trimmed.data(using: .utf8), let payload = try? JSONDecoder().decode(NativeQuestionPayload.self, from: data), !payload.questions.isEmpty {
                return [.init(id: 0, questions: payload.questions)]
            }
            return []
        }
        var result: [NativeAnswerSegment] = []
        var remaining = text[...]
        var plain = ""
        func flush() { if !plain.isEmpty { result.append(.init(id: result.count, text: plain)); plain = "" } }
        while let opening = remaining.range(of: "```") {
            plain += remaining[..<opening.lowerBound]
            let tail = remaining[opening.upperBound...]
            guard let newline = tail.firstIndex(of: "\n") else {
                let partial = tail.trimmingCharacters(in: .whitespaces).lowercased()
                if !["rift-questions", "riftquestions", "questions"].contains(where: { $0.hasPrefix(partial) }) {
                    plain += remaining[opening.lowerBound...]
                }
                remaining = ""; break
            }
            let language = tail[..<newline].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let body = tail[tail.index(after: newline)...]
            let closing = body.range(of: "```")
            let candidate = ["rift-questions", "riftquestions", "questions", "rift", "json", ""].contains(language)
            let json = closing.map { String(body[..<$0.lowerBound]) } ?? String(body)
            if candidate, let data = json.data(using: .utf8), let payload = try? JSONDecoder().decode(NativeQuestionPayload.self, from: data), !payload.questions.isEmpty {
                flush(); result.append(.init(id: result.count, questions: payload.questions))
            } else if candidate && (language == "rift-questions" || json.contains("\"questions\"")) {
                flush()
                if closing != nil { result.append(.init(id: result.count, text: "The question could not be displayed. Ask RIFT to rephrase it.")) }
            } else {
                plain += "```" + String(tail[..<tail.index(after: newline)]) + json
                if closing != nil { plain += "```" }
            }
            guard let closing else { remaining = ""; break }
            remaining = body[closing.upperBound...]
        }
        plain += remaining; flush()
        return result
    }
}

enum NativeMarkdown {
    static func inline(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
    }

    struct Block: Identifiable {
        let id: Int
        let text: String
        let isCode: Bool
    }

    static func blocks(_ text: String) -> [Block] {
        var blocks: [Block] = []
        var lines: [String] = []
        var fence: String?
        func flush() {
            if !lines.isEmpty {
                blocks.append(Block(id: blocks.count, text: lines.joined(separator: "\n"), isCode: fence != nil))
                lines.removeAll(keepingCapacity: true)
            }
        }
        for line in text.components(separatedBy: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let active = fence {
                if trimmed.count >= active.count && trimmed.allSatisfy({ $0 == active.first! }) {
                    flush(); fence = nil
                } else { lines.append(line) }
            } else if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                let candidate = String(trimmed.prefix(while: { $0 == trimmed.first! }))
                // A same-line backtick span is inline code, not a fenced block.
                if trimmed.first == "`" && trimmed.dropFirst(candidate.count).contains("`") {
                    lines.append(line)
                } else { flush(); fence = candidate }
            } else { lines.append(line) }
        }
        flush()
        return blocks
    }
}

struct NativeMarkdownText: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(NativeMarkdown.blocks(text)) { block in
                if block.isCode {
                    ScrollView(.horizontal) {
                        Text(block.text).font(.system(.callout, design: .monospaced))
                            .textSelection(.enabled).padding(12)
                    }.background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 12))
                } else {
                    Text(NativeMarkdown.inline(block.text)).font(.body).textSelection(.enabled)
                }
            }
        }
    }
}

struct NativeAssistantText: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(NativeQuestionParser.parse(text)) { segment in
                if segment.questions.isEmpty { NativeMarkdownText(text: segment.text) }
                else { NativeQuestionsCard(questions: segment.questions) }
            }
        }
    }
}

struct NativeQuestionsCard: View {
    @Environment(RIFTStore.self) private var store
    let questions: [NativeQuestion]
    @State private var selections: [Int: Set<Int>] = [:]
    @State private var custom: [Int: String] = [:]
    @State private var submitted = false
    private var ready: Bool { questions.indices.allSatisfy { !(selections[$0] ?? []).isEmpty || !(custom[$0] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            ForEach(questions.indices, id: \.self) { index in
                let question = questions[index]
                VStack(alignment: .leading, spacing: 8) {
                    Text(question.question).font(.subheadline.weight(.semibold)).fixedSize(horizontal: false, vertical: true)
                    ForEach(question.options.indices, id: \.self) { optionIndex in
                        let option = question.options[optionIndex]
                        let selected = selections[index]?.contains(optionIndex) == true
                        Button {
                            if question.multi == true {
                                var values = selections[index] ?? []
                                if selected { values.remove(optionIndex) } else { values.insert(optionIndex) }
                                selections[index] = values
                            } else { selections[index] = selected ? [] : [optionIndex] }
                        } label: {
                            HStack(alignment: .top, spacing: 10) {
                                Image(systemName: selected ? "checkmark.circle.fill" : "circle").font(.body).padding(.top, 1)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(option.label).font(.subheadline)
                                    if let detail = option.detail { Text(detail).font(.caption).foregroundStyle(.secondary) }
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }.foregroundStyle(.primary).padding(12)
                                .background(Color.primary.opacity(selected ? 0.12 : 0.04), in: .rect(cornerRadius: 12))
                        }.buttonStyle(.plain).accessibilityAddTraits(selected ? .isSelected : []).disabled(submitted)
                    }
                    if question.allowOther != false {
                        TextField(question.placeholder ?? "Or write your answer", text: Binding(get: { custom[index] ?? "" }, set: { custom[index] = $0 }), axis: .vertical)
                            .font(.subheadline).padding(12).background(Color.primary.opacity(0.04), in: .rect(cornerRadius: 12)).disabled(submitted)
                    }
                }
            }
            Button(submitted ? "Answer sent" : "Send answer") {
                let reply = questions.indices.map { index in
                    let answers = (selections[index] ?? []).sorted().map { questions[index].options[$0].label }
                    let other = (custom[index] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    return questions[index].question + "\n" + (answers + (other.isEmpty ? [] : [other])).joined(separator: "; ")
                }.joined(separator: "\n\n")
                store.draft = reply + (store.draft.isEmpty ? "" : "\n\n" + store.draft)
                store.send(); submitted = true
            }.buttonStyle(.borderedProminent).foregroundStyle(Color(uiColor: .systemBackground)).disabled(!ready || store.working || store.loading || store.uploading || !store.signedIn || submitted)
        }.padding(16).background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20))
    }
}
