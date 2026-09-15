import SwiftUI
import CoreLocation

/// GPS proof capture. The commitment's target location was selected in the
/// wizard's MapKit picker. Here we ask CoreLocation for a fresh coordinate,
/// send it to the server, and let the server calculate distance/accuracy.
/// A "mock location suspected" hint is included when the simulator or
/// developer tools are in use.
struct GpsProofView: View {
    let occurrence: TodayOccurrenceModel
    let onResult: (VerificationResultResponse) -> Void
    let onError: (String) -> Void

    @EnvironmentObject private var container: AppContainer
    @StateObject private var vm = GpsProofVM()
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            VStack(spacing: DS.Space.sm) {
                Image(systemName: "location.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(DS.Color.primary)
                    .accessibilityHidden(true)
                Text(occurrence.commitmentTitle)
                    .font(Typo.title).foregroundStyle(DS.Color.text)
                    .multilineTextAlignment(.center)
                Text(Copy.Proof.gpsTitle)
                    .font(Typo.heading).foregroundStyle(DS.Color.text)
                    .multilineTextAlignment(.center)
                if let l = vm.lastLocation {
                    let acc = Int(l.horizontalAccuracy.rounded())
                    Text("정확도 ±\(acc)m")
                        .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                }
            }
            Spacer()

            switch vm.authorization {
            case .authorizedWhenInUse, .authorizedAlways:
                PrimaryButton(
                    Copy.Proof.gpsSubmit,
                    isLoading: isSubmitting,
                    isDisabled: vm.lastLocation == nil || isSubmitting
                ) {
                    submit()
                }
                if vm.lastLocation == nil {
                    HStack { ProgressView(); Text(Copy.Proof.gpsCapturing) }
                        .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                }
            case .notDetermined:
                PrimaryButton(Copy.Proof.gpsPermAllow) { vm.request() }
                Text(Copy.Proof.gpsPermBody).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    .multilineTextAlignment(.center)
            default:
                Text(Copy.Proof.gpsPermTitle).font(Typo.heading).foregroundStyle(DS.Color.text)
                Text(Copy.Proof.gpsPermBody).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    .multilineTextAlignment(.center)
                PrimaryButton(Copy.Proof.gpsPermCTA) {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
            }

            if let err = errorMessage {
                Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.lg)
        .accessibilityIdentifier("proof.gps")
        .onAppear { vm.start() }
        .onDisappear { vm.stop() }
    }

    private func submit() {
        guard let l = vm.lastLocation, !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                #if targetEnvironment(simulator)
                let mockSuspected = true
                #else
                let mockSuspected = false
                #endif
                let payload = GpsEvidencePayload(
                    lat: l.coordinate.latitude,
                    lng: l.coordinate.longitude,
                    accuracyM: max(0, l.horizontalAccuracy),
                    capturedAt: l.timestamp,
                    mockLocationSuspected: mockSuspected
                )
                let result = try await container.evidenceAPI.submit(
                    occurrenceId: occurrence.id, .gps(payload)
                )
                await MainActor.run {
                    isSubmitting = false
                    Analytics.track(.verification_submitted, ["method": "gps"])
                    onResult(result)
                }
            } catch {
                await MainActor.run {
                    isSubmitting = false
                    errorMessage = UserFacingError.message(error)
                }
            }
        }
    }
}

@MainActor
final class GpsProofVM: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var lastLocation: CLLocation?
    @Published var authorization: CLAuthorizationStatus = .notDetermined
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        authorization = manager.authorizationStatus
    }

    func request() { manager.requestWhenInUseAuthorization() }
    func start() {
        if authorization == .authorizedWhenInUse || authorization == .authorizedAlways {
            manager.startUpdatingLocation()
        }
    }
    func stop() { manager.stopUpdatingLocation() }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            self.authorization = manager.authorizationStatus
            if manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
                manager.startUpdatingLocation()
            }
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.lastLocation = locations.last }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
