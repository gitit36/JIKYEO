import SwiftUI
import MapKit
import CoreLocation

/// MapKit target picker (SRD SR-FR-006 / PRD §5 GPS).
///
/// The user MUST explicitly select a location before the wizard can proceed.
/// We deliberately do not restore any "last known target" — every commitment
/// starts from a blank picker. `userSelected: true` is only written when the
/// user taps *this* view's confirm CTA.
struct GpsTargetPickerView: View {
    let initial: GpsTargetPayload?
    let radiusM: Int
    let onSelected: (GpsTargetPayload) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var vm = LocationPickerVM()
    @State private var region: MKCoordinateRegion = MKCoordinateRegion(
        center: CLLocationCoordinate2D(latitude: 37.5665, longitude: 126.9780),
        latitudinalMeters: 2_000, longitudinalMeters: 2_000
    )
    @State private var searchText: String = ""
    @State private var searchResults: [MKMapItem] = []
    @State private var pickedCoordinate: CLLocationCoordinate2D?
    @State private var pickedLabel: String?
    @State private var radius: Int = 150

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                MapReaderProxy(region: $region, radius: radius, picked: pickedCoordinate)
                    .frame(maxWidth: .infinity)
                    .frame(height: 320)
                    .overlay(alignment: .top) {
                        SearchBar(text: $searchText, onSubmit: { Task { await searchResults = search() } })
                            .padding(.horizontal, DS.Space.md)
                            .padding(.top, DS.Space.sm)
                    }
                    .overlay(alignment: .bottomTrailing) {
                        Button {
                            vm.requestLocation()
                        } label: {
                            Image(systemName: "location.fill")
                                .padding(DS.Space.sm)
                                .background(Circle().fill(DS.Color.surface))
                                .shadow(radius: 2)
                        }
                        .padding(DS.Space.md)
                    }
                    .onChange(of: vm.lastLocation) { _, newValue in
                        if let l = newValue {
                            region.center = l.coordinate
                        }
                    }

                if !searchResults.isEmpty {
                    List(searchResults, id: \.self) { item in
                        Button {
                            let c = item.placemark.coordinate
                            region.center = c
                            pickedCoordinate = c
                            pickedLabel = item.name ?? item.placemark.title
                            searchResults = []
                        } label: {
                            VStack(alignment: .leading) {
                                Text(item.name ?? "").font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                                if let t = item.placemark.title {
                                    Text(t).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                    .frame(maxHeight: 220)
                }

                VStack(alignment: .leading, spacing: DS.Space.sm) {
                    Text(Copy.Proof.pickerRadiusLabel)
                        .font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                    Stepper(value: $radius, in: 50...500, step: 50) {
                        Text("\(radius)m").font(Typo.moneyBody)
                    }
                    if let l = pickedLabel {
                        HStack {
                            Image(systemName: "mappin.circle.fill").foregroundStyle(DS.Color.primary)
                            Text(l).font(Typo.body).foregroundStyle(DS.Color.text).lineLimit(2)
                        }
                    } else {
                        Text("지도를 이동해 장소를 선택해주세요.")
                            .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.md)

                Spacer()

                PrimaryButton(
                    Copy.Proof.pickerConfirm,
                    isDisabled: pickedCoordinate == nil && !isReasonableCenter
                ) {
                    let c = pickedCoordinate ?? region.center
                    onSelected(GpsTargetPayload(
                        lat: c.latitude,
                        lng: c.longitude,
                        radiusM: radius,
                        userSelected: true,
                        label: pickedLabel
                    ))
                    dismiss()
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.bottom, DS.Space.md)
            }
            .navigationTitle(Copy.Proof.pickerTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("취소") { dismiss() }.foregroundStyle(DS.Color.text)
                }
            }
        }
        .onAppear {
            radius = radiusM
            if let t = initial {
                region.center = CLLocationCoordinate2D(latitude: t.lat, longitude: t.lng)
                pickedCoordinate = region.center
                pickedLabel = t.label
            }
        }
    }

    private var isReasonableCenter: Bool {
        !(region.center.latitude == 0 && region.center.longitude == 0)
    }

    private func search() async -> [MKMapItem] {
        guard !searchText.trimmingCharacters(in: .whitespaces).isEmpty else { return [] }
        let req = MKLocalSearch.Request()
        req.naturalLanguageQuery = searchText
        req.region = region
        do {
            let results = try await MKLocalSearch(request: req).start()
            return results.mapItems
        } catch {
            return []
        }
    }
}

// MARK: - Map view proxy

/// SwiftUI `Map` doesn't let us render a moveable center pin with a radius
/// circle cleanly across iOS 17+ without a lot of boilerplate. We wrap
/// `MKMapView` so the pin always sits at the visible center and the radius
/// circle stays synced.
private struct MapReaderProxy: UIViewRepresentable {
    @Binding var region: MKCoordinateRegion
    let radius: Int
    let picked: CLLocationCoordinate2D?

    func makeUIView(context: Context) -> MKMapView {
        let mv = MKMapView()
        mv.showsUserLocation = true
        mv.delegate = context.coordinator
        mv.setRegion(region, animated: false)
        return mv
    }
    func updateUIView(_ mv: MKMapView, context: Context) {
        // Sync region if it has meaningfully changed.
        let c = mv.region.center
        if abs(c.latitude - region.center.latitude) > 0.0001 || abs(c.longitude - region.center.longitude) > 0.0001 {
            mv.setRegion(region, animated: true)
        }
        // Redraw circle at center.
        mv.removeOverlays(mv.overlays)
        let center = picked ?? region.center
        let circle = MKCircle(center: center, radius: CLLocationDistance(radius))
        mv.addOverlay(circle)
    }
    func makeCoordinator() -> Coord { Coord(region: $region) }
    final class Coord: NSObject, MKMapViewDelegate {
        var region: Binding<MKCoordinateRegion>
        init(region: Binding<MKCoordinateRegion>) { self.region = region }
        func mapView(_ mapView: MKMapView, regionDidChangeAnimated animated: Bool) {
            region.wrappedValue = mapView.region
        }
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let c = overlay as? MKCircle {
                let r = MKCircleRenderer(circle: c)
                r.fillColor = UIColor(red: 0.06, green: 0.56, blue: 0.36, alpha: 0.20)
                r.strokeColor = UIColor(red: 0.06, green: 0.56, blue: 0.36, alpha: 0.90)
                r.lineWidth = 2
                return r
            }
            return MKOverlayRenderer(overlay: overlay)
        }
    }
}

private struct SearchBar: View {
    @Binding var text: String
    let onSubmit: () -> Void
    var body: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(DS.Color.textSecondary)
            TextField(Copy.Proof.pickerSearchHint, text: $text)
                .onSubmit(onSubmit)
                .submitLabel(.search)
        }
        .padding(DS.Space.sm)
        .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
        .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
    }
}

// MARK: - Location VM

@MainActor
final class LocationPickerVM: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var lastLocation: CLLocation?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func requestLocation() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        default:
            break
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            if manager.authorizationStatus == .authorizedWhenInUse ||
                manager.authorizationStatus == .authorizedAlways {
                manager.requestLocation()
            }
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in self.lastLocation = locations.last }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}
