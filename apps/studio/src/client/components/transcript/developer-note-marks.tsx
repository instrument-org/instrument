import { type DeveloperNote } from "@instrument-org/workspace/client";
import { type Icon, type IconWeight } from "@phosphor-icons/react";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/ArrowsClockwise";
import { BookOpenIcon } from "@phosphor-icons/react/BookOpen";
import { BrainIcon } from "@phosphor-icons/react/Brain";
import { BrowsersIcon } from "@phosphor-icons/react/Browsers";
import { ChatsIcon } from "@phosphor-icons/react/Chats";
import { CheckCircleIcon } from "@phosphor-icons/react/CheckCircle";
import { ClockIcon } from "@phosphor-icons/react/Clock";
import { CpuIcon } from "@phosphor-icons/react/Cpu";
import { CubeIcon } from "@phosphor-icons/react/Cube";
import { EyeIcon } from "@phosphor-icons/react/Eye";
import { FileIcon } from "@phosphor-icons/react/File";
import { FingerprintIcon } from "@phosphor-icons/react/Fingerprint";
import { FolderOpenIcon } from "@phosphor-icons/react/FolderOpen";
import { FolderSimpleIcon } from "@phosphor-icons/react/FolderSimple";
import { KeyIcon } from "@phosphor-icons/react/Key";
import { MicrophoneIcon } from "@phosphor-icons/react/Microphone";
import { MonitorIcon } from "@phosphor-icons/react/Monitor";
import { NoteIcon } from "@phosphor-icons/react/Note";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/PaperPlaneTilt";
import { PaperclipIcon } from "@phosphor-icons/react/Paperclip";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { ScissorsIcon } from "@phosphor-icons/react/Scissors";
import { SquaresFourIcon } from "@phosphor-icons/react/SquaresFour";
import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";
import { TerminalWindowIcon } from "@phosphor-icons/react/TerminalWindow";
import { WarningIcon } from "@phosphor-icons/react/Warning";

/** How thick the marks are, the app's own weight: at 12px a lighter one's sub-pixel strokes blur. Their size and colors top the layer's stylesheet. */
const MARK_WEIGHT: IconWeight = "bold";

const ICONS: Record<DeveloperNote["mark"], Icon> = {
  apps: SquaresFourIcon,
  chats: ChatsIcon,
  command: TerminalWindowIcon,
  computer: MonitorIcon,
  cut: ScissorsIcon,
  dictation: MicrophoneIcon,
  error: WarningIcon,
  file: FileIcon,
  files: PaperclipIcon,
  folder: FolderOpenIcon,
  instructions: BookOpenIcon,
  limit: StopCircleIcon,
  memory: FingerprintIcon,
  model: CpuIcon,
  note: NoteIcon,
  once: PaperPlaneTiltIcon,
  permission: KeyIcon,
  project: FolderSimpleIcon,
  question: QuestionIcon,
  replaced: ArrowsClockwiseIcon,
  screen: EyeIcon,
  skill: CubeIcon,
  tabs: BrowsersIcon,
  task: CheckCircleIcon,
  thought: BrainIcon,
  time: ClockIcon,
};

/** One note's icon. It says what kind of thing the note is, and the card says the rest. */
export function NoteMark({ note }: { note: DeveloperNote }) {
  const Mark = ICONS[note.mark];
  return <Mark data-dn="mark" weight={MARK_WEIGHT} />;
}
