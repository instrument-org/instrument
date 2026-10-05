// swift-tools-version: 5.9
import PackageDescription

// Calendar and Reminders through EventKit, for the agent's `calendar`
// command: one query instead of a script walking every item. Bundled with
// the app and run as its child, so macOS asks on Instrument's behalf.
let package = Package(
  name: "instrument-eventkit",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "instrument-eventkit", path: "Sources")
  ]
)
