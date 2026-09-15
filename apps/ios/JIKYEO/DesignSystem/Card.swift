import SwiftUI

/// A single content surface. Cards do not compete with each other on Home —
/// they stack quietly, and only one card should have a primary CTA.
public struct Card<Content: View>: View {
    private let content: Content
    private let padding: CGFloat

    public init(padding: CGFloat = DS.Space.md, @ViewBuilder content: () -> Content) {
        self.content = content()
        self.padding = padding
    }

    public var body: some View {
        // Wrap in a stack so padding/background apply once. A bare ViewBuilder
        // TupleView would paint a separate card behind every child.
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: DS.Radius.lg)
                .fill(DS.Color.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: DS.Radius.lg)
                        .strokeBorder(DS.Color.divider, lineWidth: 1)
                )
        )
        .shadow(color: DS.cardShadow.color, radius: DS.cardShadow.radius, x: DS.cardShadow.x, y: DS.cardShadow.y)
    }
}

/// A minimalist row inside a card (label — value).
public struct CardRow: View {
    private let label: String
    private let value: String

    public init(_ label: String, value: String) {
        self.label = label
        self.value = value
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
            Spacer(minLength: DS.Space.md)
            Text(value)
                .font(Typo.bodyStrong)
                .foregroundStyle(DS.Color.text)
                .multilineTextAlignment(.trailing)
        }
        .padding(.vertical, DS.Space.xs)
    }
}
