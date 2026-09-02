import SwiftUI

/// Primary CTA. One per screen.
/// Usage:
///   PrimaryButton("약속 시작하기") { ... }
public struct PrimaryButton: View {
    private let title: String
    private let isLoading: Bool
    private let isDisabled: Bool
    private let action: () -> Void

    public init(_ title: String, isLoading: Bool = false, isDisabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            ZStack {
                Text(title)
                    .font(Typo.button)
                    .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView().tint(.white)
                }
            }
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .fill(isDisabled ? DS.Color.textMuted : DS.Color.primary)
            )
        }
        .buttonStyle(.plain)
        .disabled(isDisabled || isLoading)
    }
}

/// Secondary CTA. Never used to compete with the primary decision on a screen.
public struct SecondaryButton: View {
    private let title: String
    private let action: () -> Void

    public init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typo.button)
                .foregroundStyle(DS.Color.text)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(
                    RoundedRectangle(cornerRadius: DS.Radius.md)
                        .fill(DS.Color.surfaceMuted)
                )
        }
        .buttonStyle(.plain)
    }
}

/// Text-only tertiary. Only for reversible/quiet actions.
public struct TertiaryButton: View {
    private let title: String
    private let action: () -> Void

    public init(_ title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(Typo.button)
                .foregroundStyle(DS.Color.primary)
                .padding(.vertical, DS.Space.sm)
        }
        .buttonStyle(.plain)
    }
}
