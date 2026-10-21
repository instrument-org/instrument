/**
 * The pane of Privacy & Security where the app is let into a Mac app, by
 * the app's name: Calendar, Contacts and Reminders have panes for their
 * data, and any other app is controlled under Automation.
 */
export function privacyPaneForApp(
  name: string,
): "Automation" | "Calendars" | "Contacts" | "Reminders" {
  switch (name.trim().toLowerCase()) {
    case "calendar":
      return "Calendars";
    case "contacts":
      return "Contacts";
    case "reminders":
      return "Reminders";
    default:
      return "Automation";
  }
}
