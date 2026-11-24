import { DictationSettings } from "@/client/components/settings/dictation-settings";

/** Dictation: the microphone, the language and the sounds, or the card that asks for the microphone first. */
export function DictationSection() {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Dictation</h3>
      <DictationSettings />
    </div>
  );
}
