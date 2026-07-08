import { type TaskFileViewerFile } from "@/client/atoms/task-file-viewer";
import { useOpenTaskFileWith } from "@/client/hooks/use-open-task-file";
import { useTaskFileOpenCandidates } from "@/client/hooks/use-task-file-open-target";
import { AppWindowIcon } from "@phosphor-icons/react";

import { type MenuComponents } from "./ui/menu-components";
import { Spinner } from "./ui/spinner";

type FileRef = Pick<TaskFileViewerFile, "filePath" | "taskId">;

// "Open with" submenu listing every app that can open the file. Candidates are
// fetched lazily: the query only runs once the submenu content mounts (opens).
export function OpenWithMenu({
  file,
  menuComponents,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
}) {
  const { Sub, SubContent, SubTrigger } = menuComponents;

  return (
    <Sub>
      <SubTrigger>
        <AppWindowIcon className="size-4" />
        <span>Open with</span>
      </SubTrigger>
      <SubContent className="max-h-80 min-w-52 overflow-y-auto">
        <OpenWithCandidates file={file} menuComponents={menuComponents} />
      </SubContent>
    </Sub>
  );
}

function OpenWithCandidates({
  file,
  menuComponents,
}: {
  file: FileRef;
  menuComponents: MenuComponents;
}) {
  const { Item } = menuComponents;
  const { apps, isPending } = useTaskFileOpenCandidates(file, {
    enabled: true,
  });
  const openWith = useOpenTaskFileWith();

  if (isPending) {
    return (
      <Item disabled>
        <Spinner className="size-4" />
        <span>Loading apps…</span>
      </Item>
    );
  }

  if (apps.length === 0) {
    return (
      <Item disabled>
        <span>No apps available</span>
      </Item>
    );
  }

  return (
    <>
      {apps.map((candidate) => (
        <Item
          key={candidate.appPath}
          onClick={() => {
            openWith(file, candidate.appPath);
          }}
        >
          {candidate.iconDataUrl ? (
            <img
              alt=""
              className="size-4"
              draggable={false}
              src={candidate.iconDataUrl}
            />
          ) : (
            <AppWindowIcon className="size-4" />
          )}
          <span className="truncate">{candidate.appName}</span>
        </Item>
      ))}
    </>
  );
}
