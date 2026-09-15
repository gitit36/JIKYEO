# Screenshot baseline

Standard device: iPhone 17 simulator (iOS 26).

```bash
cd apps/ios/JIKYEO
export JIKYEO_SCREENSHOT_DIR="$PWD/UITests/Screenshots"
xcodebuild test \
  -project JIKYEO.xcodeproj \
  -scheme JIKYEO \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:JIKYEOUITests/VisualRegressionQATests \
  -derivedDataPath DerivedDataUITest \
  JIKYEO_SCREENSHOT_DIR="$JIKYEO_SCREENSHOT_DIR"
```

- First run writes PNGs to `Baseline/` and `Current/`.
- Later runs overwrite `Current/` and fail only if width/height differ (antialiasing is ignored).
- Refresh the baseline by copying `Current/*.png` into `Baseline/` after an intentional UI change.
