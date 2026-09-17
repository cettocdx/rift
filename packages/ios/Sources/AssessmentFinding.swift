import Foundation
struct AssessmentFinding: Identifiable, Equatable {
    var id: String { severity + ":" + title.lowercased() }
    let severity: String
    let title: String
    let evidence: String
    static func extract(_ text: String) -> [Self] {
        guard let regex = try? NSRegularExpression(pattern: #"\[(critical|high|medium|low)\]\s*(.+)"#, options: [.caseInsensitive]) else { return [] }
        var result: [Self] = []
        let lines = text.components(separatedBy: .newlines)
        for (index, line) in lines.enumerated() {
            let ns = line as NSString
            guard let match = regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { continue }
            let severity = ns.substring(with: match.range(at: 1)).lowercased()
            let title = ns.substring(with: match.range(at: 2)).trimmingCharacters(in: .whitespaces)
            var evidence = [line]
            for following in lines.dropFirst(index + 1) {
                let trimmed = following.trimmingCharacters(in: .whitespaces)
                guard ["evidence:", "remediation:", "cvss:"].contains(where: { trimmed.lowercased().hasPrefix($0) }) else { break }
                evidence.append(following)
            }
            let finding = Self(severity: severity, title: title, evidence: evidence.joined(separator: "\n"))
            if !result.contains(where: { $0.id == finding.id }) { result.append(finding) }
        }
        return result
    }
}
