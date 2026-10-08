import { PlaceholderPage } from "@/client/components/onboarding/setup/screens/placeholder";

/** F24: the providers most people have keys for. */
export function ProvidersPage() {
  return <PlaceholderPage next="paste-key" title="Add an API provider" />;
}

/** F25 to F27: the key, checked as it is pasted. */
export function PasteKeyPage() {
  return <PlaceholderPage next="model" title="Paste your API key" />;
}

/** F28: the main model, and whether setup may spend the key. */
export function ModelPage() {
  return <PlaceholderPage next="free-account" title="Pick your main model" />;
}
