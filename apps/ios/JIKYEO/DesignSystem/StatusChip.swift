import SwiftUI

/// Status chip for an occurrence. Colors mirror `DS.Color.status*`.
public struct StatusChip: View {
    public enum Kind {
        case scheduled       // 예정
        case inProgress      // 진행 중
        case needsProof      // 증명 필요
        case reviewing       // 검토 중
        case pass            // 지켰어요
        case uncertain       // 한 번 더 확인
        case fail            // 놓쳤어요
        case appealing       // 다시 확인 중
        case refunding       // 환불 처리 중
        case void            // 취소됨

        var label: String {
            switch self {
            case .scheduled:  return "예정"
            case .inProgress: return "진행 중"
            case .needsProof: return "증명 필요"
            case .reviewing:  return "검토 중"
            case .pass:       return "지켰어요"
            case .uncertain:  return "한 번 더 확인"
            case .fail:       return "놓쳤어요"
            case .appealing:  return "다시 확인 중"
            case .refunding:  return "환불 처리 중"
            case .void:       return "취소됨"
            }
        }

        var color: Color {
            switch self {
            case .scheduled:  return DS.Color.statusScheduled
            case .inProgress: return DS.Color.primary
            case .needsProof: return DS.Color.statusUncertain
            case .reviewing:  return DS.Color.statusReviewing
            case .pass:       return DS.Color.statusPass
            case .uncertain:  return DS.Color.statusUncertain
            case .fail:       return DS.Color.statusFail
            case .appealing:  return DS.Color.statusReviewing
            case .refunding:  return DS.Color.primary
            case .void:       return DS.Color.textMuted
            }
        }
    }

    private let kind: Kind

    public init(_ kind: Kind) { self.kind = kind }

    public var body: some View {
        Text(kind.label)
            .font(Typo.caption)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .foregroundStyle(kind.color)
            .background(
                Capsule().fill(kind.color.opacity(0.12))
            )
            .accessibilityLabel(kind.label)
    }
}
