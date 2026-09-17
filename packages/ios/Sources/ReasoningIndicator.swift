import SwiftUI

/// Same 16-point geometry and ten stepped frames as the desktop sidebar.
struct ReasoningIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let frames: [[Int]] = [
        [0,1,3], [0,3,4], [0,3,4,5], [3,4,5], [2,3,4,5],
        [2,4,5], [1,2,5], [0,1,2,5], [0,1,2], [0,1,2,3],
    ]
    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1, paused: reduceMotion)) { context in
            let frame = reduceMotion ? 0 : Int(context.date.timeIntervalSinceReferenceDate * 10) % 10
            Canvas { canvas, _ in
                for dot in frames[frame] {
                    let x = dot < 3 ? 5.5 : 10.5
                    let y = Double(dot % 3) * 4 + 4
                    canvas.fill(Path(ellipseIn: CGRect(x: x - 1.15, y: y - 1.15, width: 2.3, height: 2.3)), with: .foreground)
                }
            }
        }.frame(width: 16, height: 16).accessibilityHidden(true)
    }
}
