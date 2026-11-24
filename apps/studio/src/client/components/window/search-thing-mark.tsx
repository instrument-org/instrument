import { FileTypeIcon } from "@/client/components/extend/file-system";
import { PageFavicon } from "@/client/components/favicon";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";

import { useAppsBySlug } from "./apps-by-slug";
import { FolderMark } from "./folder-mark";
import { ProjectMark } from "./project-mark";
import { screenPresentation } from "./screen-presentation";
import { type SearchThing } from "./search-sources";
import { useShell } from "./shell-context";

/** The mark a row wears for something a search found by name, at 16px. */
export function SearchThingMark({ thing }: { thing: SearchThing }) {
  const appsBySlug = useAppsBySlug();
  const { chatTitles } = useShell();
  switch (thing.kind) {
    case "chat": {
      return <ChatCircleIcon className="size-4 text-muted-foreground" />;
    }
    case "file": {
      return <FileTypeIcon className="size-4" fileName={thing.file.name} />;
    }
    case "folder": {
      return <FolderMark path={thing.folder.path} />;
    }
    case "page": {
      return (
        <PageFavicon
          className="size-4"
          favicon={thing.page.favicon}
          hasTooltip={false}
          url={thing.page.url}
        />
      );
    }
    case "project": {
      return <ProjectMark project={thing.project} />;
    }
    case "tab": {
      return thing.tab.kind === "page" ? (
        <PageFavicon
          className="size-4"
          favicon={thing.tab.favicon}
          hasTooltip={false}
          url={thing.tab.url ?? thing.tab.openedUrl ?? ""}
        />
      ) : (
        <span className="contents [&_svg]:size-4 [&_svg]:text-muted-foreground">
          {screenPresentation(thing.tab.href, { appsBySlug, chatTitles }).icon}
        </span>
      );
    }
  }
}
