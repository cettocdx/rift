import SwiftUI

/// A narrow highlight travels across the letters without moving their layout.
struct WorkingLabel: View {
    let title: String
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private var label: some View {
        Text(title).font(.subheadline).lineLimit(2).multilineTextAlignment(.leading)
    }

    var body: some View {
        label.foregroundStyle(.secondary)
            .overlay {
                if active && !reduceMotion && scenePhase == .active {
                    GeometryReader { geometry in
                        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { context in
                            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
                            LinearGradient(
                                colors: [.clear, .primary.opacity(0.95), .clear],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                            .frame(width: max(40, geometry.size.width * 0.6))
                            .offset(x: geometry.size.width * (phase * 2.2 - 0.7))
                        }
                    }
                    .mask(alignment: .leading) { label }
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                }
            }
    }
}
