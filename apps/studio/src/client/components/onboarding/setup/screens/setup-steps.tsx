import { PlaceholderPage } from "@/client/components/onboarding/setup/screens/placeholder";

/** F5: apps to save an import-memories prompt for. */
export function MemoriesPage() {
  return <PlaceholderPage next="folder" title="Bring your memories with you" />;
}

/** F6, F7: where the Instrument folder lives. */
export function FolderPage() {
  return (
    <PlaceholderPage
      next="notifications"
      title="Where should your Instrument folder live?"
    />
  );
}

/** F8, F9: notifications. */
export function NotificationsPage() {
  return <PlaceholderPage next="week" title="Allow Instrument to notify you" />;
}

/** F10, F11: the kinds of work that fill their week. */
export function WeekPage() {
  return <PlaceholderPage next="look" title="What fills your week?" />;
}

/** F12: light, dark, or automatic. */
export function LookPage() {
  return <PlaceholderPage next="tasks" title="Choose your look" />;
}
