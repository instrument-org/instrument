// Prints the windows of one process that macOS reports as on screen, one per
// line (id, bounds, name), so a run can prove the app under test put nothing
// on the display of the person at this Mac.
//   onscreen <pid>
import CoreGraphics
import Foundation

let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for window in list where (window[kCGWindowOwnerPID as String] as? Int) == pid {
  let bounds = window[kCGWindowBounds as String] as? [String: Any] ?? [:]
  print(
    window[kCGWindowNumber as String] ?? "",
    "layer=\(window[kCGWindowLayer as String] ?? 0)",
    bounds["X"] ?? "", bounds["Y"] ?? "", bounds["Width"] ?? "", bounds["Height"] ?? "",
    window[kCGWindowName as String] ?? "")
}
