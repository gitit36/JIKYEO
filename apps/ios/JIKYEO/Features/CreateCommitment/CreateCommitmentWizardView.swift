import SwiftUI

/// The full commitment wizard. Steps adapt to the chosen `EnforcementMode`.
///
/// Flow:
///   Goal → Schedule → Verification → Proof Rule → **Enforcement**
///     ├─ SELF   → Review → Signature → Done
///     ├─ SOCIAL → Observer → Review → Signature → Done
///     └─ MONEY  → Stake → Review → (mock) Payment → Signature → Done
struct CreateCommitmentWizardView: View {
    let debugStage: String?
    init(debugStage: String? = nil) { self.debugStage = debugStage }
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var container: AppContainer
    @StateObject private var model = CreateCommitmentModel()

    var body: some View {
        NavigationStack {
            Group {
                switch model.step {
                case .goal:
                    GoalStep(model: model, onNext: { model.step = .schedule })
                case .schedule:
                    ScheduleStep(model: model, onNext: { model.step = .verification })
                case .verification:
                    VerificationStep(model: model, onNext: { model.step = .proofRule })
                case .proofRule:
                    ProofRuleStep(model: model, onNext: { model.step = .enforcement })
                case .enforcement:
                    EnforcementStep(model: model, container: container, onNext: {
                        // Money → stake screen. Social → observer picker.
                        // Self → straight to Review with server safety check.
                        switch model.enforcementMode {
                        case .money:  model.step = .stake
                        case .social: model.step = .observer
                        case .self:
                            model.step = .review
                            Task { await model.refreshQuote(container: container) }
                        }
                    })
                case .stake:
                    StakeStep(model: model, onNext: {
                        model.step = .review
                        Task { await model.refreshQuote(container: container) }
                    })
                case .observer:
                    ObserverStep(model: model, onNext: {
                        model.step = .review
                        Task { await model.refreshQuote(container: container) }
                    })
                case .review:
                    ReviewStep(model: model, onNext: {
                        model.step = model.enforcementMode == .money ? .payment : .signature
                    })
                case .payment:
                    PaymentStep(model: model, container: container)
                case .signature:
                    SignatureStep(model: model, container: container)
                case .done:
                    DoneStep(model: model, onHome: { dismiss() })
                }
            }
            .onAppear {
                #if DEBUG
                let t = CommitmentTemplates.all.first(where: { $0.id == "workout" })!
                model.adoptTemplate(t)
                // Debug launches into specific stages
                if debugStage == "wizard-schedule"     { model.step = .schedule }
                if debugStage == "wizard-verification" { model.step = .verification }
                if debugStage == "wizard-proof"        { model.step = .proofRule }
                if debugStage == "wizard-enforcement"  { model.step = .enforcement }
                if debugStage == "wizard-stake"        {
                    model.enforcementMode = .money
                    model.step = .stake
                    model.stakePolicy = StakePolicyResponse(
                        currentTier: .tier_1,
                        maxPerOccurrenceKrw: 30_000,
                        maxPerCommitmentKrw: 150_000,
                        rollingMonthlyLossCapKrw: 300_000,
                        rollingMonthlyLossRemainingKrw: 300_000,
                        suggestedAmountsKrw: [3_000, 5_000, 10_000, 30_000]
                    )
                }
                if debugStage == "wizard-observer"     {
                    model.enforcementMode = .social
                    model.step = .observer
                }
                if debugStage == "wizard-review-money" {
                    model.enforcementMode = .money
                    model.stakePerOccurrenceKrw = 10_000
                    model.step = .review
                    model.quote = QuoteResponse(quoteId: "qt_demo", occurrenceCount: 3,
                        stakePerOccurrence: "10000", maxLoss: "30000",
                        currency: "KRW", quoteExpiresAt: Date().addingTimeInterval(600))
                    model.safety = SafetyResponse(decision: "safe", reasonCode: "OK", userMessage: "")
                }
                if debugStage == "wizard-review-self" {
                    let study = CommitmentTemplates.all.first(where: { $0.id == "study" })!
                    model.adoptTemplate(study)
                    model.enforcementMode = .self
                    model.step = .review
                    model.safety = SafetyResponse(decision: "safe", reasonCode: "OK", userMessage: "")
                }
                if debugStage == "wizard-payment" || debugStage == "wizard-payment-failed" {
                    model.enforcementMode = .money
                    model.stakePerOccurrenceKrw = 5_000
                    model.step = .payment
                    model.quote = QuoteResponse(quoteId: "qt_demo", occurrenceCount: 3,
                        stakePerOccurrence: "5000", maxLoss: "15000",
                        currency: "KRW", quoteExpiresAt: Date().addingTimeInterval(600))
                    if debugStage == "wizard-payment-failed" {
                        model.paymentState = .failed(message: "결제가 완료되지 않았어요. 카드 정보를 확인하고 다시 시도해주세요.")
                        model.lastPayment = PaymentView(paymentId: "pay_demo", commitmentId: "c_demo", type: "charge",
                            status: "failed", amountKrw: "15000", provider: "mock", failureCode: "MOCK_CARD_DECLINED", attempt: 1)
                    }
                }
                if debugStage == "wizard-payment-live" || debugStage == "wizard-payment-live-fail" {
                    // Real round-trip against the running API with a real token
                    // (-jikyeoDebugAccessToken): quote → create (payment_pending)
                    // → MockPaymentProvider charge → signature step.
                    model.enforcementMode = .money
                    model.verificationMethod = .self
                    model.stakePerOccurrenceKrw = 5_000
                    model.scheduleType = .specific_days
                    model.days = [.MON, .WED, .FRI]
                    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: model.timezone)
                    model.startDate = f.date(from: "2026-09-07")!
                    model.endDate = f.date(from: "2026-09-13")!
                    model.debugSimulatePaymentFailure = debugStage == "wizard-payment-live-fail"
                    model.step = .payment
                    Task {
                        await model.refreshQuote(container: container)
                        await model.createAndPay(container: container)
                    }
                }
                if debugStage == "wizard-signature"    {
                    model.enforcementMode = .money
                    model.stakePerOccurrenceKrw = 5_000
                    model.step = .signature
                    model.paymentState = .succeeded
                    model.quote = QuoteResponse(quoteId: "qt_demo", occurrenceCount: 3,
                        stakePerOccurrence: "5000", maxLoss: "15000",
                        currency: "KRW", quoteExpiresAt: Date().addingTimeInterval(600))
                    model.moneyView = MoneyView(status: .funded, label: "약속금 걸림", perOccurrenceKrw: "5000", upfrontKrw: "15000",
                        refundableKrw: "0", forfeitedKrw: "0", refundPaidKrw: "0", depositKrw: "15000")
                }
                if debugStage == "wizard-done-money"   {
                    model.enforcementMode = .money
                    model.createdEnforcementMode = .money
                    model.createdMaxLossKrw = 15_000
                    model.moneyView = MoneyView(status: .funded, label: "약속금 걸림", perOccurrenceKrw: "5000", upfrontKrw: "15000",
                        refundableKrw: "0", forfeitedKrw: "0", refundPaidKrw: "0", depositKrw: "15000")
                    model.step = .done
                }
                if debugStage == "wizard-done-self"    {
                    model.enforcementMode = .self
                    model.createdEnforcementMode = .self
                    model.step = .done
                }
                #endif
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .toolbar {
                if model.step != .done {
                    if model.canGoBack {
                        ToolbarItem(placement: .topBarLeading) {
                            Button {
                                if model.step == .goal { dismiss() } else { model.goBack() }
                            } label: {
                                Image(systemName: model.step == .goal ? "xmark" : "chevron.left")
                                    .foregroundStyle(DS.Color.text)
                            }
                        }
                    }
                    ToolbarItem(placement: .principal) {
                        WizardProgress(current: model.step.rawValue, total: WizardStep.allCases.count - 1)
                    }
                }
            }
        }
    }
}

fileprivate extension CreateCommitmentModel {
    /// Skip past mode-conditional steps when the user taps the back button.
    func goBack() {
        switch step {
        case .goal, .schedule, .verification, .proofRule, .enforcement:
            step = WizardStep(rawValue: step.rawValue - 1) ?? .goal
        case .stake, .observer:
            step = .enforcement
        case .review:
            switch enforcementMode {
            case .self:   step = .enforcement
            case .social: step = .observer
            case .money:  step = .stake
            }
        case .payment:
            // Leaving an unpaid MONEY commitment behind: drop the client handle
            // so a re-entry creates a fresh one (server keeps the old row in
            // payment_pending; it never has money attached).
            if paymentState != .succeeded { createdCommitmentId = nil; paymentState = .idle }
            step = .review
        case .signature:
            // MONEY: money is already charged and the commitment is active —
            // there is nothing to go back to. SELF: back to review.
            if enforcementMode != .money { step = .review }
        case .done:
            break
        }
    }

    var canGoBack: Bool {
        switch step {
        case .done: return false
        case .signature: return enforcementMode != .money
        default: return true
        }
    }
}

private struct WizardProgress: View {
    let current: Int; let total: Int
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<total, id: \.self) { i in
                Capsule()
                    .fill(i < current ? DS.Color.primary : DS.Color.divider)
                    .frame(width: i == current ? 24 : 16, height: 4)
            }
        }
    }
}

// MARK: - Step · Goal
private struct GoalStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    @State private var selectedId = CommitmentTemplates.all[0].id
    var body: some View {
        WizardContainer(title: Copy.Wizard.step1Title, primaryTitle: Copy.Onboarding.goalNext, primaryEnabled: true, onPrimary: onNext) {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: DS.Space.sm), GridItem(.flexible(), spacing: DS.Space.sm)], spacing: DS.Space.sm) {
                ForEach(CommitmentTemplates.all) { t in
                    Button {
                        selectedId = t.id
                        model.adoptTemplate(t)
                    } label: {
                        VStack(alignment: .leading, spacing: DS.Space.sm) {
                            Image(systemName: t.symbol)
                                .font(.system(size: 24, weight: .semibold))
                                .foregroundStyle(DS.Color.primary)
                            Text(t.title).font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                            Text(t.pitch)
                                .font(Typo.caption)
                                .foregroundStyle(DS.Color.textSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                        .padding(DS.Space.md)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: DS.Radius.md)
                                .stroke(selectedId == t.id ? DS.Color.primary : DS.Color.divider, lineWidth: selectedId == t.id ? 2 : 1)
                                .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
                        )
                    }
                    .buttonStyle(.plain)
                }
            }
            if model.template.id == "custom" {
                InputField("약속 이름", text: $model.customTitle)
            }
        }
        .onAppear { model.adoptTemplate(model.template) }
    }
}

// MARK: - Step · Schedule
private struct ScheduleStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    var body: some View {
        WizardContainer(title: Copy.Wizard.step2Title, primaryTitle: Copy.Wizard.next, primaryEnabled: true, onPrimary: onNext) {
            SegmentedControl(
                model.template.supportedScheduleTypes.map { t in
                    SegmentedControl<ScheduleType>.Option(t, label: label(for: t))
                },
                selection: $model.scheduleType
            )
            if model.scheduleType == .specific_days {
                DaysPicker(selection: $model.days)
            }
            if model.scheduleType == .x_per_week {
                Stepper(value: $model.timesPerWeek, in: 1...7) {
                    Text(Copy.Wizard.timesPerWeek(model.timesPerWeek))
                        .font(Typo.bodyStrong)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    DateRow(label: "시작", date: $model.startDate)
                    Divider()
                    DateRow(label: "종료", date: $model.endDate)
                }
            }

            Card {
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    TimeRow(label: Copy.Wizard.windowStartLabel, hhmm: $model.windowStartLocalTime)
                    Divider()
                    TimeRow(label: Copy.Wizard.deadlineLabel, hhmm: $model.deadlineLocalTime)
                }
            }
        }
    }
    private func label(for t: ScheduleType) -> String {
        switch t {
        case .one_time: return Copy.Wizard.scheduleOneTime
        case .daily: return Copy.Wizard.scheduleDaily
        case .specific_days: return Copy.Wizard.scheduleSpecificDays
        case .x_per_week: return Copy.Wizard.scheduleXPerWeek
        case .custom: return "직접"
        }
    }
}

private struct DaysPicker: View {
    @Binding var selection: Set<Weekday>
    var body: some View {
        HStack(spacing: DS.Space.xxs) {
            ForEach(Weekday.allCases) { d in
                Button {
                    if selection.contains(d) { selection.remove(d) } else { selection.insert(d) }
                } label: {
                    Text(d.short)
                        .font(Typo.bodyStrong)
                        .foregroundStyle(selection.contains(d) ? .white : DS.Color.text)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .background(
                            RoundedRectangle(cornerRadius: DS.Radius.sm)
                                .fill(selection.contains(d) ? DS.Color.primary : DS.Color.surfaceMuted)
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct DateRow: View {
    let label: String
    @Binding var date: Date
    var body: some View {
        HStack {
            Text(label).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            Spacer()
            DatePicker("", selection: $date, displayedComponents: .date)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "ko_KR"))
        }
    }
}

private struct TimeRow: View {
    let label: String
    @Binding var hhmm: String
    var body: some View {
        HStack {
            Text(label).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            Spacer()
            DatePicker("", selection: Binding(
                get: { Self.parse(hhmm) },
                set: { hhmm = Self.format($0) }
            ), displayedComponents: .hourAndMinute)
                .labelsHidden()
                .environment(\.locale, Locale(identifier: "ko_KR"))
        }
    }
    static func parse(_ s: String) -> Date {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.date(from: s) ?? Date()
    }
    static func format(_ d: Date) -> String {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: d)
    }
}

// MARK: - Step · Verification method
private struct VerificationStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    var body: some View {
        WizardContainer(title: Copy.Wizard.step3Title, primaryTitle: Copy.Wizard.next, primaryEnabled: true, onPrimary: onNext) {
            VStack(spacing: DS.Space.sm) {
                ForEach(orderedMethods, id: \.self) { m in
                    MethodRow(
                        method: m,
                        isSelected: model.verificationMethod == m,
                        isRecommended: m == model.template.recommendedVerification.first,
                        isComingSoon: Self.isComingSoon(m)
                    ) {
                        guard !Self.isComingSoon(m) else { return }
                        model.verificationMethod = m
                    }
                }
            }
        }
    }
    private var orderedMethods: [VerificationMethod] {
        var all = model.template.recommendedVerification
        for m in [VerificationMethod.photo, .gps, .timer, .self, .friend] {
            if !all.contains(m) { all.append(m) }
        }
        return all
    }
    /// `friend` is not shipped in Phase 3 in Release; DEBUG allows it so we
    /// can render the flow. GPS is now fully wired in both configurations.
    static func isComingSoon(_ m: VerificationMethod) -> Bool {
        #if DEBUG
        return false
        #else
        return m == .friend
        #endif
    }
}

private struct MethodRow: View {
    let method: VerificationMethod
    let isSelected: Bool
    let isRecommended: Bool
    let isComingSoon: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: symbol)
                    .font(.system(size: 20))
                    .foregroundStyle(isSelected ? .white : (isComingSoon ? DS.Color.textMuted : DS.Color.text))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(isSelected ? DS.Color.primary : DS.Color.surfaceMuted))
                VStack(alignment: .leading, spacing: 2) {
                    Text(method.label)
                        .font(Typo.bodyStrong)
                        .foregroundStyle(isComingSoon ? DS.Color.textMuted : DS.Color.text)
                    if isComingSoon {
                        Text(Copy.Wizard.comingSoon)
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.textMuted)
                    } else if isRecommended {
                        Text(Copy.Wizard.step3Recommended)
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.primary)
                    }
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark").foregroundStyle(DS.Color.primary)
                }
            }
            .padding(DS.Space.md)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .stroke(isSelected ? DS.Color.primary : DS.Color.divider, lineWidth: isSelected ? 2 : 1)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
            )
        }
        .buttonStyle(.plain)
        .disabled(isComingSoon)
    }
    private var symbol: String {
        switch method {
        case .photo: return "camera.fill"
        case .gps: return "location.fill"
        case .timer: return "hourglass"
        case .self: return "hand.thumbsup.fill"
        case .friend: return "person.2.fill"
        case .health: return "heart.fill"
        case .screen_time: return "iphone"
        case .timelapse: return "video.fill"
        }
    }
}

// MARK: - Step · Proof rule detail
private struct ProofRuleStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    @State private var isPickingLocation = false
    var body: some View {
        WizardContainer(
            title: Copy.Wizard.step4Title,
            primaryTitle: Copy.Wizard.next,
            primaryEnabled: model.verificationMethod != .gps || (model.gpsTarget?.userSelected == true),
            onPrimary: onNext
        ) {
            Card {
                Text(explanation)
                    .font(Typo.heading)
                    .foregroundStyle(DS.Color.text)
                    .lineSpacing(6)
                    .multilineTextAlignment(.leading)
            }
            if model.verificationMethod == .timer {
                VStack(alignment: .leading, spacing: DS.Space.xs) {
                    Text("몇 분 동안 집중할까요?")
                        .font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                    Stepper(value: $model.timerMinutes, in: 10...240, step: 10) {
                        Text("\(model.timerMinutes)분").font(Typo.moneyBody)
                    }
                }
            }
            if model.verificationMethod == .gps {
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Text("도착 반경").font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                    Stepper(value: $model.gpsRadiusM, in: 50...500, step: 50) {
                        Text("\(model.gpsRadiusM)m").font(Typo.moneyBody)
                    }
                    .onChange(of: model.gpsRadiusM) { _, newValue in
                        if var t = model.gpsTarget { t.radiusM = newValue; model.gpsTarget = t }
                    }
                    GpsTargetRow(model: model, onPickLocation: { isPickingLocation = true })
                }
            }
        }
        .sheet(isPresented: $isPickingLocation) {
            GpsTargetPickerView(initial: model.gpsTarget, radiusM: model.gpsRadiusM) { picked in
                model.gpsTarget = picked
            }
        }
    }
    private var explanation: String {
        model.template.defaultProofExplanationTemplate
            .replacingOccurrences(of: "{windowStart}", with: model.windowStartLocalTime)
            .replacingOccurrences(of: "{deadline}", with: model.deadlineLocalTime)
            .replacingOccurrences(of: "{minutes}", with: "\(model.timerMinutes)")
            .replacingOccurrences(of: "{radius}", with: "\(model.gpsRadiusM)")
    }
}

private struct GpsTargetRow: View {
    @ObservedObject var model: CreateCommitmentModel
    let onPickLocation: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text("장소").font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
            if let t = model.gpsTarget, t.userSelected {
                HStack {
                    Image(systemName: "mappin.and.ellipse").foregroundStyle(DS.Color.primary)
                    Text(t.label ?? String(format: "%.4f, %.4f", t.lat, t.lng))
                        .font(Typo.body).foregroundStyle(DS.Color.text)
                    Spacer()
                    Button("변경") { onPickLocation() }
                        .font(Typo.caption).foregroundStyle(DS.Color.primary)
                }
                .padding(DS.Space.sm)
                .background(RoundedRectangle(cornerRadius: DS.Radius.sm).fill(DS.Color.surfaceMuted))
            } else {
                Text(Copy.Wizard.gpsPickPlaceholder)
                    .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                SecondaryButton(Copy.Wizard.gpsPickCTA) { onPickLocation() }
                #if DEBUG
                TertiaryButton(Copy.Wizard.gpsDebugMock) {
                    model.applyDebugMockGps()
                }
                #endif
            }
        }
    }
}

// MARK: - Step · Enforcement (NEW)
private struct EnforcementStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let container: AppContainer
    let onNext: () -> Void
    var body: some View {
        WizardContainer(
            title: Copy.Wizard.enforceTitle,
            primaryTitle: Copy.Wizard.next,
            primaryEnabled: true,
            onPrimary: onNext
        ) {
            EnforcementCard(
                title: Copy.Wizard.enforceSelfTitle,
                subtitle: Copy.Wizard.enforceSelfSub,
                symbol: "person.fill.checkmark",
                isSelected: model.enforcementMode == .self,
                isComingSoon: false
            ) { model.enforcementMode = .self }

            EnforcementCard(
                title: Copy.Wizard.enforceSocialTitle,
                subtitle: Copy.Wizard.enforceSocialSub,
                symbol: "person.2.fill",
                isSelected: model.enforcementMode == .social,
                isComingSoon: Self.socialComingSoon
            ) {
                guard !Self.socialComingSoon else { return }
                model.enforcementMode = .social
            }
            if Self.socialComingSoon {
                Text(Copy.Wizard.comingSoonSocial)
                    .font(Typo.caption)
                    .foregroundStyle(DS.Color.textMuted)
                    .padding(.horizontal, DS.Space.xxs)
            }

            EnforcementCard(
                title: Copy.Wizard.enforceMoneyTitle,
                subtitle: Copy.Wizard.enforceMoneySub,
                symbol: "wonsign.circle.fill",
                isSelected: model.enforcementMode == .money,
                isComingSoon: false,
                accent: .money
            ) { model.enforcementMode = .money }
        }
        .task { await model.loadStakePolicyIfNeeded(container: container) }
    }
    /// SOCIAL is 준비 중 in Release: friend selection doesn't exist yet.
    static var socialComingSoon: Bool {
        #if DEBUG
        return false
        #else
        return true
        #endif
    }
}

private struct EnforcementCard: View {
    enum Accent { case neutral, money }
    let title: String
    let subtitle: String
    let symbol: String
    let isSelected: Bool
    let isComingSoon: Bool
    var accent: Accent = .neutral
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: DS.Space.md) {
                Image(systemName: symbol)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(isSelected ? .white : (isComingSoon ? DS.Color.textMuted : iconTint))
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(isSelected ? iconTint : DS.Color.surfaceMuted))
                VStack(alignment: .leading, spacing: DS.Space.xxs) {
                    HStack(spacing: DS.Space.xs) {
                        Text(title)
                            .font(Typo.bodyStrong)
                            .foregroundStyle(isComingSoon ? DS.Color.textMuted : DS.Color.text)
                        if isComingSoon {
                            Text(Copy.Wizard.comingSoon)
                                .font(Typo.caption)
                                .foregroundStyle(DS.Color.textMuted)
                        }
                    }
                    Text(subtitle)
                        .font(Typo.body)
                        .foregroundStyle(DS.Color.textSecondary)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                if isSelected {
                    Image(systemName: "checkmark").foregroundStyle(iconTint)
                }
            }
            .padding(DS.Space.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.lg)
                    .stroke(isSelected ? iconTint : DS.Color.divider, lineWidth: isSelected ? 2 : 1)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.lg).fill(DS.Color.surface))
            )
        }
        .buttonStyle(.plain)
        .disabled(isComingSoon)
    }
    private var iconTint: Color {
        switch accent {
        case .neutral: return DS.Color.primary
        case .money:   return DS.Color.moneyAtRisk
        }
    }
}

// MARK: - Step · Stake (MONEY only)
private struct StakeStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    @State private var showsLargeConfirm = false
    var body: some View {
        WizardContainer(
            title: Copy.Wizard.step5Title,
            primaryTitle: Copy.Wizard.next,
            primaryEnabled: model.stakePerOccurrenceKrw > 0 && withinTier,
            onPrimary: {
                if model.isLargeMoneyCommitment {
                    showsLargeConfirm = true
                } else {
                    onNext()
                }
            }
        ) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: DS.Space.sm) {
                ForEach(suggestedAmounts, id: \.self) { amount in
                    StakeChoice(amount: amount, isSelected: model.stakePerOccurrenceKrw == amount) {
                        model.stakePerOccurrenceKrw = amount
                    }
                }
                CustomStakeChoice(
                    isActive: !suggestedAmounts.contains(model.stakePerOccurrenceKrw),
                    currentAmount: model.stakePerOccurrenceKrw,
                    maxAmount: model.stakePolicy?.maxPerOccurrenceKrw ?? 30_000
                ) { newValue in
                    model.stakePerOccurrenceKrw = newValue
                }
            }

            Card {
                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    HStack {
                        Text(Copy.Wizard.step5PerLabel)
                            .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                        Spacer()
                        MoneyText(Int64(model.stakePerOccurrenceKrw), intent: .neutral, size: .large)
                    }
                    Divider()
                    HStack(alignment: .firstTextBaseline) {
                        Text(Copy.Wizard.step5MaxPrefix)
                            .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                        Spacer()
                        MoneyText(Int64(model.stakePerOccurrenceKrw * model.estimatedOccurrences), intent: .atRisk, size: .hero)
                    }
                    Text("총 \(model.estimatedOccurrences)번 · 최대 손실 표시")
                        .font(Typo.caption).foregroundStyle(DS.Color.textMuted)
                    if let p = model.stakePolicy {
                        Divider().padding(.vertical, DS.Space.xxs)
                        HStack {
                            Text(Copy.Wizard.step5MonthlyRemaining)
                                .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                            Spacer()
                            MoneyText(Int64(p.rollingMonthlyLossRemainingKrw), intent: .neutral, size: .small)
                        }
                    }
                }
            }
            if !withinTier, let p = model.stakePolicy {
                Text("이번 티어에서는 회차당 최대 \(MoneyText.format(Int64(p.maxPerOccurrenceKrw)))까지 걸 수 있어요.")
                    .font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
            }
        }
        .confirmationDialog(
            Copy.Wizard.step5OverTierTitle,
            isPresented: $showsLargeConfirm,
            titleVisibility: .visible
        ) {
            Button(Copy.Wizard.step5OverTierConfirm) { onNext() }
            Button(Copy.Wizard.step5OverTierBack, role: .cancel) { }
        } message: {
            Text(Copy.Wizard.step5OverTierBody(Int64(model.stakePerOccurrenceKrw * model.estimatedOccurrences)))
        }
    }
    private var suggestedAmounts: [Int] {
        model.stakePolicy?.suggestedAmountsKrw ?? model.template.suggestedStakeKrw
    }
    private var withinTier: Bool {
        guard let p = model.stakePolicy else { return true }
        return model.stakePerOccurrenceKrw <= p.maxPerOccurrenceKrw
    }
}

private struct StakeChoice: View {
    let amount: Int
    let isSelected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(spacing: DS.Space.xxs) {
                MoneyText(Int64(amount), intent: isSelected ? .atRisk : .neutral, size: .body)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .stroke(isSelected ? DS.Color.primary : DS.Color.divider, lineWidth: isSelected ? 2 : 1)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
            )
        }
        .buttonStyle(.plain)
    }
}

private struct CustomStakeChoice: View {
    let isActive: Bool
    let currentAmount: Int
    let maxAmount: Int
    let onCommit: (Int) -> Void
    @State private var text: String = ""
    @State private var isEditing = false
    var body: some View {
        Button {
            isEditing = true
            text = isActive ? String(currentAmount) : ""
        } label: {
            VStack(spacing: DS.Space.xxs) {
                Text(isActive ? MoneyText.format(Int64(currentAmount)) : Copy.Wizard.step5CustomLabel)
                    .font(Typo.moneyBody)
                    .foregroundStyle(isActive ? DS.Color.moneyAtRisk : DS.Color.text)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .stroke(isActive ? DS.Color.primary : DS.Color.divider, lineWidth: isActive ? 2 : 1)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
            )
        }
        .buttonStyle(.plain)
        .alert(Copy.Wizard.step5CustomLabel, isPresented: $isEditing) {
            TextField(Copy.Wizard.step5CustomPlaceholder, text: $text)
                .keyboardType(.numberPad)
            Button("확인") {
                if let n = Int(text.filter { $0.isNumber }), n > 0 {
                    onCommit(min(n, maxAmount))
                }
            }
            Button("취소", role: .cancel) { }
        } message: {
            Text("최대 \(MoneyText.format(Int64(maxAmount)))까지 걸 수 있어요.")
        }
    }
}

// MARK: - Step · Observer (SOCIAL only)
private struct ObserverStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    var body: some View {
        WizardContainer(title: Copy.Wizard.step6Title, primaryTitle: Copy.Wizard.next, primaryEnabled: true, onPrimary: onNext) {
            VStack(spacing: DS.Space.sm) {
                ObserverRow(title: Copy.Wizard.step6Share, symbol: "eye.fill",
                            isSelected: model.observerMode == .share,
                            isComingSoon: false) { model.observerMode = .share }
                ObserverRow(title: Copy.Wizard.step6Verify, symbol: "checkmark.seal.fill",
                            isSelected: model.observerMode == .verify,
                            isComingSoon: false) { model.observerMode = .verify }
            }
            Text(Copy.Wizard.step6FriendHint)
                .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
        }
    }
}

private struct ObserverRow: View {
    let title: String; let symbol: String; let isSelected: Bool; let isComingSoon: Bool; let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack {
                Image(systemName: symbol)
                    .foregroundStyle(isSelected ? .white : (isComingSoon ? DS.Color.textMuted : DS.Color.text))
                    .frame(width: 40, height: 40)
                    .background(Circle().fill(isSelected ? DS.Color.primary : DS.Color.surfaceMuted))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(Typo.bodyStrong)
                        .foregroundStyle(isComingSoon ? DS.Color.textMuted : DS.Color.text)
                    if isComingSoon {
                        Text(Copy.Wizard.comingSoon)
                            .font(Typo.caption).foregroundStyle(DS.Color.textMuted)
                    }
                }
                Spacer()
                if isSelected { Image(systemName: "checkmark").foregroundStyle(DS.Color.primary) }
            }
            .padding(DS.Space.md)
            .background(
                RoundedRectangle(cornerRadius: DS.Radius.md)
                    .stroke(isSelected ? DS.Color.primary : DS.Color.divider, lineWidth: isSelected ? 2 : 1)
                    .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
            )
        }
        .buttonStyle(.plain)
        .disabled(isComingSoon)
    }
}

// MARK: - Step · Review
private struct ReviewStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onNext: () -> Void
    var body: some View {
        WizardContainer(
            title: Copy.Wizard.step7Title,
            primaryTitle: model.enforcementMode == .money
                ? Copy.Wizard.step7MoneyCTA(MoneyText.format(model.upfrontKrw))
                : Copy.Wizard.step7CTA,
            primaryEnabled: model.enforcementMode != .money || (model.quote != nil && !model.isLoadingQuote),
            onPrimary: onNext
        ) {
            if model.safety?.decision == "blocked", let err = model.errorMessage {
                UnsafeGoalCard(message: err)
            }
            Card {
                Text(headline)
                    .font(Typo.title)
                    .foregroundStyle(DS.Color.text)
                    .lineSpacing(6)
                    .multilineTextAlignment(.leading)
            }
            if model.enforcementMode == .money {
                MoneyBreakdownCard(model: model)
            }
            Text(reviewTail)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
            if model.isLoadingQuote {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
    }
    private var reviewTail: String {
        switch model.enforcementMode {
        case .money:  return Copy.Wizard.step7MoneyReviewHint
        case .self:   return Copy.Wizard.step7SelfReviewHint
        case .social: return Copy.Wizard.step7SocialReviewHint
        }
    }
    private var headline: String {
        let scheduleDesc: String = {
            switch model.scheduleType {
            case .daily: return "매일"
            case .specific_days: return Copy.weekdayShortList(model.days.map { $0.rawValue }) + "요일"
            case .x_per_week: return "주 \(model.timesPerWeek)회"
            case .one_time: return "한 번만"
            case .custom: return "직접"
            }
        }()
        let verify: String = {
            switch model.verificationMethod {
            case .gps:
                let name = model.gpsTarget?.label ?? "지정한 장소"
                return "\(name) \(model.gpsRadiusM)m 안에서\nGPS로 증명해요."
            case .photo: return "사진으로 증명해요."
            case .timer: return "집중 타이머로 \(model.timerMinutes)분을 채워요."
            case .self:  return "직접 확인해요."
            case .friend: return "친구가 확인해요."
            default: return ""
            }
        }()
        return "\(scheduleDesc) \(model.deadlineLocalTime)까지\n\(model.title).\n\n\(verify)"
    }
}

private struct UnsafeGoalCard: View {
    let message: String
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.sm) {
            Text(Copy.Wizard.unsafeTitle)
                .font(Typo.bodyStrong).foregroundStyle(DS.Color.moneyLost)
            Text(Copy.Wizard.unsafeSubtitle)
                .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            Text(message).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
        }
        .padding(DS.Space.md)
        .background(
            RoundedRectangle(cornerRadius: DS.Radius.md)
                .fill(DS.Color.moneyLost.opacity(0.08))
        )
    }
}

/// Shared MONEY breakdown: 회차당 약속금 · 총 횟수 · 최대 손실 · 지금 결제할 금액.
/// All values come from the server quote; the client estimate is only a
/// placeholder while the quote loads.
private struct MoneyBreakdownCard: View {
    @ObservedObject var model: CreateCommitmentModel
    var body: some View {
        Card {
            VStack(spacing: DS.Space.xxs) {
                CardRow(Copy.Wizard.step8RowPerOccurrence, value: MoneyText.format(Int64(model.stakePerOccurrenceKrw)))
                CardRow(Copy.Wizard.step8RowCount, value: "\(model.occurrenceCount ?? model.estimatedOccurrences)번")
                CardRow(Copy.Wizard.step8RowMaxLoss, value: MoneyText.format(model.upfrontKrw))
                Divider().padding(.vertical, DS.Space.xxs)
                HStack(alignment: .firstTextBaseline) {
                    Text(Copy.Wizard.step8RowUpfront)
                        .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    Spacer()
                    MoneyText(model.upfrontKrw, intent: .atRisk, size: .large)
                }
            }
        }
    }
}

// MARK: - Step · Payment (MONEY only) — MockPaymentProvider-backed
private struct PaymentStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let container: AppContainer
    var body: some View {
        WizardContainer(
            title: Copy.Wizard.step8Title,
            primaryTitle: primaryTitle,
            primaryEnabled: model.paymentState != .charging && model.paymentState != .succeeded,
            primaryLoading: model.paymentState == .charging,
            onPrimary: { Task { await model.createAndPay(container: container) } }
        ) {
            MoneyBreakdownCard(model: model)
            Text(Copy.Wizard.step8Explain)
                .font(Typo.body).foregroundStyle(DS.Color.textSecondary)

            switch model.paymentState {
            case .charging:
                HStack(spacing: DS.Space.sm) {
                    ProgressView()
                    Text(Copy.Wizard.step8Charging).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                }
            case .failed(let message):
                PaymentFailedCard(message: message, failureCode: model.lastPayment?.failureCode)
            case .succeeded:
                MoneyStatusChip(.funded)
            case .idle:
                EmptyView()
            }

            #if DEBUG
            Toggle(isOn: $model.debugSimulatePaymentFailure) {
                Text(Copy.Wizard.step8DebugFail).font(Typo.caption).foregroundStyle(DS.Color.textMuted)
            }
            .tint(DS.Color.primary)
            Text(Copy.Wizard.step8SubDev)
                .font(Typo.caption).foregroundStyle(DS.Color.textMuted)
            #endif
        }
    }
    private var primaryTitle: String {
        if case .failed = model.paymentState { return Copy.Wizard.step8Retry }
        return Copy.Wizard.step8CTA(MoneyText.format(model.upfrontKrw))
    }
}

private struct PaymentFailedCard: View {
    let message: String
    let failureCode: String?
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            HStack {
                Text(Copy.Wizard.step8FailedTitle).font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                Spacer()
                MoneyStatusChip(.payment_failed)
            }
            Text(message).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            Text("약속은 아직 시작되지 않았고, 결제된 금액도 없어요.")
                .font(Typo.caption).foregroundStyle(DS.Color.textMuted)
            if let code = failureCode {
                Text(code).font(Typo.caption).foregroundStyle(DS.Color.textMuted)
            }
        }
        .padding(DS.Space.md)
        .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.moneyLost.opacity(0.08)))
    }
}

// MARK: - Step · Signature
private struct SignatureStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let container: AppContainer
    @State private var strokes: [[CGPoint]] = []
    var body: some View {
        WizardContainer(
            title: Copy.Wizard.step9Title,
            primaryTitle: Copy.Wizard.step9CTA,
            primaryEnabled: hasStrokes && model.isSubmittable && !model.isSubmitting,
            primaryLoading: model.isSubmitting,
            onPrimary: {
                // MONEY: commitment already exists and is funded → just record the ritual.
                // SELF/SOCIAL: signature is the moment of creation + activation.
                Task {
                    if model.enforcementMode == .money { await model.sign(container: container) }
                    else { await model.submit(container: container) }
                }
            }
        ) {
            if model.enforcementMode == .money {
                HStack {
                    MoneyStatusChip(model.moneyView?.status ?? .funded)
                    MoneyText(model.upfrontKrw, intent: .atRisk, size: .body)
                    Spacer()
                }
            }
            Text(Copy.Wizard.step9Hint)
                .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            SignatureCanvas(strokes: $strokes)
                .frame(height: 240)
                .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
                .overlay(RoundedRectangle(cornerRadius: DS.Radius.md).stroke(DS.Color.divider))
            HStack {
                Spacer()
                Button(Copy.Wizard.step9Clear) { strokes.removeAll() }
                    .foregroundStyle(DS.Color.textSecondary)
                    .font(Typo.caption)
            }
            if let err = model.errorMessage {
                Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
            }
        }
    }
    private var hasStrokes: Bool { strokes.contains(where: { !$0.isEmpty }) }
}

private struct SignatureCanvas: View {
    @Binding var strokes: [[CGPoint]]
    var body: some View {
        Canvas { ctx, _ in
            for s in strokes {
                guard s.count > 1 else { continue }
                var path = Path(); path.move(to: s[0])
                for p in s.dropFirst() { path.addLine(to: p) }
                ctx.stroke(path, with: .color(DS.Color.text), lineWidth: 2.5)
            }
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { v in
                    if strokes.isEmpty || v.translation == .zero {
                        if strokes.last?.isEmpty ?? true { strokes.append([]) }
                        if strokes.last?.last == v.location { return }
                    }
                    if strokes.isEmpty { strokes.append([]) }
                    strokes[strokes.count - 1].append(v.location)
                }
                .onEnded { _ in strokes.append([]) }
        )
    }
}

// MARK: - Step · Done
private struct DoneStep: View {
    @ObservedObject var model: CreateCommitmentModel
    let onHome: () -> Void
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            Spacer()
            Text(Copy.Wizard.step10Title)
                .font(Typo.display).foregroundStyle(DS.Color.text)
            if model.createdEnforcementMode == .money {
                Card {
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        HStack {
                            Text(Copy.Wizard.step10SubMoney).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                            Spacer()
                            MoneyStatusChip(model.moneyView?.status ?? .funded)
                        }
                        MoneyText(model.createdMaxLossKrw, intent: .atRisk, size: .hero)
                        Text("약속이 끝나면 지킨 회차만큼 한 번에 돌려받아요.")
                            .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    }
                }
            } else {
                Card {
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        Text(Copy.Wizard.step10SubSelf)
                            .font(Typo.heading).foregroundStyle(DS.Color.text)
                        Text("내일부터 이 자리에 오늘의 약속이 뜰 거예요.")
                            .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    }
                }
            }
            Spacer()
            PrimaryButton(Copy.Wizard.step10Home, action: onHome)
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.lg)
    }
}

// MARK: - Shared step chrome
struct WizardContainer<Content: View>: View {
    let title: String
    let primaryTitle: String
    let primaryEnabled: Bool
    var primaryLoading: Bool = false
    let onPrimary: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Text(title)
                        .font(Typo.title)
                        .foregroundStyle(DS.Color.text)
                    content()
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.top, DS.Space.md)
                .padding(.bottom, DS.Space.xl)
            }
            PrimaryButton(primaryTitle, isLoading: primaryLoading, isDisabled: !primaryEnabled, action: onPrimary)
                .padding(.horizontal, DS.Space.lg)
                .padding(.bottom, DS.Space.md)
        }
    }
}
