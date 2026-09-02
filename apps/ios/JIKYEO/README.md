# JIKYEO iOS

SwiftUI + async/await. Target: iOS 17+.

## Layout

```
apps/ios/JIKYEO/
├─ JIKYEOApp.swift              # @main
├─ DesignSystem/                # tokens, typography, buttons, money, countdown, chips
├─ Core/                        # networking, auth, config, clock, formatting
├─ Features/
│  ├─ Onboarding/
│  ├─ Home/
│  ├─ CreateCommitment/         # wizard
│  ├─ Proof/                    # photo / gps / timer / self / friend
│  ├─ Friends/
│  ├─ Appeal/
│  ├─ History/
│  └─ Settings/
└─ Resources/                   # Assets.xcassets etc.
```

## Xcode setup

The MVP ships the sources as plain files. To build in Xcode:

1. `File → New → Project → App` named `JIKYEO`, org `com.jikyeo`, SwiftUI, iOS 17+.
2. Delete the auto-generated `ContentView.swift` and default `App` file.
3. Right-click the project group → **Add Files to "JIKYEO"…** → select the sub-folders under `apps/ios/JIKYEO/` (uncheck "Copy items if needed", check "Create folder references").
4. In `Info.plist`, add:
   - `NSCameraUsageDescription` — "약속을 사진으로 증명하기 위해 카메라를 사용해요."
   - `NSPhotoLibraryAddUsageDescription` — "증명 사진 저장을 위해 사진첩을 사용해요."
   - `NSLocationWhenInUseUsageDescription` — "약속 장소에 도착했는지 확인하기 위해 위치를 사용해요."
   - `NSUserNotificationsUsageDescription` — "약속 마감 시간을 알려드릴게요."
5. Build & run on iOS 17 simulator.

## Design principles

Follows Toss-inspired UX:

- One decision per screen.
- Money and deadline are always visible when they matter.
- Short, conversational Korean copy (see `DesignSystem/Copy.swift`).
- No aggressive failure language ever.
