import SwiftUI

/// Tab entry that presents the wizard.
struct CreateCommitmentEntry: View {
    @EnvironmentObject private var container: AppContainer
    var body: some View {
        CreateCommitmentWizardView()
            .environmentObject(container)
    }
}
