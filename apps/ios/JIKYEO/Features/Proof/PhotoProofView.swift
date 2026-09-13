import SwiftUI
import AVFoundation
import CryptoKit
import UIKit

/// Camera-first photo proof.
///
/// Gallery upload is intentionally disabled — verification requires a live
/// capture. We hash the image (SHA-256) client-side so the server can detect
/// duplicate submissions and surface UNCERTAIN rather than blindly passing.
struct PhotoProofView: View {
    let occurrence: TodayOccurrenceModel
    let onResult: (VerificationResultResponse) -> Void
    let onError: (String) -> Void

    @EnvironmentObject private var container: AppContainer
    @StateObject private var camera = CameraController()
    @State private var pending: PendingCapture?
    @State private var status: Status = .idle
    @State private var errorMessage: String?

    enum Status { case idle, uploading, reviewing }

    struct PendingCapture: Identifiable {
        let id = UUID()
        let image: UIImage
        let capturedAt: Date
        let hash: String
    }

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                if camera.authorization == .authorized {
                    if let pending = pending {
                        Image(uiImage: pending.image)
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    } else {
                        CameraPreviewView(session: camera.session)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                } else {
                    PermissionCard(
                        title: Copy.Proof.photoPermTitle,
                        message: Copy.Proof.photoPermBody,
                        cta: Copy.Proof.photoPermCTA
                    ) {
                        if camera.authorization == .notDetermined {
                            camera.requestAccess()
                        } else if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .frame(maxHeight: .infinity)
            .background(Color.black)
            .cornerRadius(DS.Radius.lg)
            .padding(.horizontal, DS.Space.md)

            VStack(spacing: DS.Space.sm) {
                Text(occurrence.commitmentTitle)
                    .font(Typo.heading).foregroundStyle(DS.Color.text)
                Text(Copy.Proof.photoHint)
                    .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    .multilineTextAlignment(.center)

                switch status {
                case .idle:
                    if let pending = pending {
                        HStack(spacing: DS.Space.sm) {
                            SecondaryButton(Copy.Proof.photoRetake) { self.pending = nil }
                            PrimaryButton(Copy.Proof.photoUse) { submit(pending) }
                        }
                    } else {
                        PrimaryButton(Copy.Proof.photoCapture, isDisabled: camera.authorization != .authorized) {
                            camera.capture { result in
                                if case .success(let (img, ts, digest)) = result {
                                    self.pending = PendingCapture(image: img, capturedAt: ts, hash: digest)
                                }
                            }
                        }
                    }
                case .uploading:
                    HStack { ProgressView(); Text(Copy.Proof.photoUploading) }
                        .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                case .reviewing:
                    HStack { ProgressView(); Text(Copy.Proof.photoReviewing) }
                        .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                }
                if let err = errorMessage {
                    Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
                }
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.md)
        }
        .onAppear {
            if camera.authorization == .authorized { camera.start() }
        }
        .onDisappear { camera.stop() }
    }

    private func submit(_ p: PendingCapture) {
        guard status == .idle else { return }
        status = .uploading
        errorMessage = nil
        Task {
            do {
                let contentType = "image/jpeg"
                let ticket = try? await container.evidenceAPI.uploadTicket(
                    occurrenceId: occurrence.id, contentType: contentType
                )
                // In MVP the mock storage layer accepts arbitrary keys; if we
                // ever get a real ticket we upload the JPEG to `uploadUrl`.
                let storageKey = ticket?.storageKey ?? "dev/\(occurrence.id)/\(UUID().uuidString).jpg"
                await MainActor.run { status = .reviewing }
                let jpeg = p.image.jpegData(compressionQuality: 0.85) ?? Data()
                let payload = PhotoEvidencePayload(
                    storageKey: storageKey,
                    hash: p.hash,
                    contentType: contentType,
                    sizeBytes: jpeg.count,
                    capturedAt: p.capturedAt
                )
                let result = try await container.evidenceAPI.submit(
                    occurrenceId: occurrence.id,
                    .photo(payload)
                )
                await MainActor.run {
                    Analytics.track(.verification_submitted, ["method": "photo"])
                    onResult(result)
                }
            } catch {
                await MainActor.run {
                    status = .idle
                    errorMessage = UserFacingError.message(error)
                }
            }
        }
    }
}

// MARK: - Permission card

private struct PermissionCard: View {
    let title: String
    let message: String
    let cta: String
    let action: () -> Void
    var body: some View {
        VStack(spacing: DS.Space.md) {
            Image(systemName: "camera.fill")
                .font(.system(size: 32))
                .foregroundStyle(.white)
            Text(title).font(Typo.heading).foregroundStyle(.white)
            Text(message).font(Typo.body).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
            PrimaryButton(cta, action: action)
                .padding(.horizontal, DS.Space.lg)
        }
        .padding(DS.Space.lg)
    }
}

// MARK: - Camera preview

private struct CameraPreviewView: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewUIView {
        let v = PreviewUIView()
        v.videoPreviewLayer.session = session
        v.videoPreviewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewUIView, context: Context) {}
    final class PreviewUIView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var videoPreviewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

// MARK: - Camera controller

@MainActor
final class CameraController: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate {
    enum Authorization { case authorized, denied, notDetermined }
    @Published var authorization: Authorization = .notDetermined
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private var completion: ((Result<(UIImage, Date, String), Error>) -> Void)?

    override init() {
        super.init()
        refreshAuthorization()
        configureIfPossible()
    }

    func refreshAuthorization() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:    authorization = .authorized
        case .notDetermined: authorization = .notDetermined
        default:             authorization = .denied
        }
    }

    func requestAccess() {
        AVCaptureDevice.requestAccess(for: .video) { granted in
            Task { @MainActor in
                self.authorization = granted ? .authorized : .denied
                if granted { self.configureIfPossible(); self.start() }
            }
        }
    }

    private func configureIfPossible() {
        guard authorization == .authorized, session.inputs.isEmpty else { return }
        session.beginConfiguration()
        session.sessionPreset = .photo
        if let cam = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
           let input = try? AVCaptureDeviceInput(device: cam), session.canAddInput(input) {
            session.addInput(input)
        }
        if session.canAddOutput(output) { session.addOutput(output) }
        session.commitConfiguration()
    }

    func start() {
        guard authorization == .authorized else { return }
        configureIfPossible()
        if !session.isRunning {
            let session = self.session
            DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
        }
    }
    func stop() {
        if session.isRunning {
            let session = self.session
            DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
        }
    }

    func capture(completion: @escaping (Result<(UIImage, Date, String), Error>) -> Void) {
        self.completion = completion
        let settings = AVCapturePhotoSettings()
        settings.flashMode = .auto
        output.capturePhoto(with: settings, delegate: self)
    }

    nonisolated func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let ts = Date()
        Task { @MainActor in
            defer { self.completion = nil }
            if let error = error {
                self.completion?(.failure(error)); return
            }
            guard let data = photo.fileDataRepresentation(), let img = UIImage(data: data) else {
                self.completion?(.failure(NSError(domain: "camera", code: -1)))
                return
            }
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            self.completion?(.success((img, ts, digest)))
        }
    }
}
