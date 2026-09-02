import SwiftUI

/// Single-line text input with a big touch target and generous spacing.
public struct InputField: View {
    private let placeholder: String
    @Binding private var text: String
    private let keyboard: UIKeyboardType

    public init(_ placeholder: String, text: Binding<String>, keyboard: UIKeyboardType = .default) {
        self.placeholder = placeholder
        self._text = text
        self.keyboard = keyboard
    }

    public var body: some View {
        TextField(placeholder, text: $text)
            .font(Typo.body)
            .foregroundStyle(DS.Color.text)
            .keyboardType(keyboard)
            .padding(.horizontal, DS.Space.md)
            .frame(minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .fill(DS.Color.surfaceMuted)
            )
    }
}

/// Numeric KRW field. Displays value with a `원` suffix as user types.
public struct MoneyField: View {
    private let placeholder: String
    @Binding private var amount: Int64

    public init(_ placeholder: String, amount: Binding<Int64>) {
        self.placeholder = placeholder
        self._amount = amount
    }

    public var body: some View {
        TextField(placeholder, value: $amount, format: .number)
            .font(Typo.moneyBody)
            .foregroundStyle(DS.Color.text)
            .keyboardType(.numberPad)
            .padding(.horizontal, DS.Space.md)
            .frame(minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .fill(DS.Color.surfaceMuted)
            )
    }
}
