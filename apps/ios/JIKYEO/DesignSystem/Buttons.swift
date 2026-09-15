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
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
                    .minimumScaleFactor(0.75)
                    .padding(.horizontal, DS.Space.sm)
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
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .minimumScaleFactor(0.75)
                .padding(.horizontal, DS.Space.sm)
                .foregroundStyle(DS.Color.text)
                .frame(maxWidth: .infinity, minHeight: 56)
                .background(ControlChrome())
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
        .frame(minHeight: 44)
    }
}

/// Toolbar back / close. Gray icon in a circled chip — readable on white,
/// never the jet-black system glyph.
public struct NavBarButton: View {
    private let systemName: String
    private let action: () -> Void

    public init(_ systemName: String, action: @escaping () -> Void) {
        self.systemName = systemName
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(DS.Color.icon)
                .symbolRenderingMode(.monochrome)
                .frame(width: 32, height: 32)
                .background(
                    Circle()
                        .fill(DS.Color.surface)
                        .overlay(Circle().strokeBorder(DS.Color.border, lineWidth: 1))
                )
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

struct ErrorRetryBanner: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text(message)
                    .font(Typo.body)
                    .foregroundStyle(DS.Color.text)
                    .fixedSize(horizontal: false, vertical: true)
                SecondaryButton(Copy.Errors.retryCTA, action: retry)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
