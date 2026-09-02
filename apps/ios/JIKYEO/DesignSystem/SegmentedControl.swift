import SwiftUI

/// Segmented picker used across the wizard (schedule type, verification method, etc.).
public struct SegmentedControl<Value: Hashable>: View {
    public struct Option: Identifiable {
        public let id = UUID()
        public let value: Value
        public let label: String
        public init(_ value: Value, label: String) {
            self.value = value
            self.label = label
        }
    }

    private let options: [Option]
    @Binding private var selection: Value

    public init(_ options: [Option], selection: Binding<Value>) {
        self.options = options
        self._selection = selection
    }

    public var body: some View {
        HStack(spacing: DS.Space.xxs) {
            ForEach(options) { opt in
                Button {
                    withAnimation(.easeInOut(duration: 0.12)) { selection = opt.value }
                } label: {
                    Text(opt.label)
                        .font(Typo.bodyStrong)
                        .foregroundStyle(opt.value == selection ? DS.Color.text : DS.Color.textSecondary)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(
                            RoundedRectangle(cornerRadius: DS.Radius.sm)
                                .fill(opt.value == selection ? DS.Color.surface : Color.clear)
                                .shadow(color: opt.value == selection ? DS.cardShadow.color : .clear,
                                        radius: DS.cardShadow.radius, x: 0, y: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(DS.Space.xxs)
        .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surfaceMuted))
    }
}
