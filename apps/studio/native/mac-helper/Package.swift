// swift-tools-version: 5.9
import PackageDescription

// Calendar, Reminders, and Contacts through Apple's own frameworks, for the
// agent's `calendar` and `contacts` commands: one query instead of a script
// walking every item. Bundled with the app and run as its child, so macOS
// asks on Instrument's behalf.
let package = Package(
  name: "instrument-mac",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "instrument-mac", path: "Sources")
  ]
)
