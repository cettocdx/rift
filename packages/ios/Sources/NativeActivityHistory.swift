import Foundation

extension NativeMessageHistory {
    /// Freeze the previous turn before the live activity reducer is reused.
    /// Replayed tool IDs already present in saved history remain single entries.
    static func preserveActivity(_ activity: AgentActivity, at anchor: Int, in messages: inout [NativeMessage]) {
        let savedIDs = Set(messages.flatMap { $0.savedActivity?.steps.map(\.id) ?? [] })
        let remaining = activity.excluding(savedIDs)
        guard !remaining.steps.isEmpty || !remaining.reasoning.isEmpty else { return }
        if remaining.steps.isEmpty && messages.contains(where: { $0.savedActivity?.reasoning == remaining.reasoning }) { return }
        let identity = remaining.steps.first?.id ?? "reasoning:" + UUID().uuidString
        messages.insert(
            NativeMessage(id: "live-activity:" + identity, role: "assistant", text: "", savedActivity: remaining),
            at: min(max(0, anchor), messages.count)
        )
    }
}
