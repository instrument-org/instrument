import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useRef,
} from "react";

export interface DropHandlers {
  onFilesDropped: (files: FileList) => void;
  onFoldersDropped?: (folders: DroppedFolder[]) => void;
}

export interface DroppedFolder {
  path: string;
  type: "folder";
}

export interface DropRegistration {
  enabled: boolean;
  handlers: RefObject<DropHandlers>;
  note: string;
}

export const DropRegisterContext = createContext<
  ((registration: DropRegistration | null) => void) | null
>(null);

/**
 * Claim the enclosing `FileDropRegion`: what a drop there does, and what the
 * region says while one is in the air.
 *
 * For a descendant of the region, which the composer is. A component that draws
 * the region itself cannot use this -- it would be reading a context it
 * provides in its own JSX -- and passes the same three things to
 * `FileDropRegion` as props instead.
 *
 * The note is the only place the destination is named, so it has to be true
 * wherever its caller is mounted. The composer's is about the message rather
 * than the task, because the same composer is a task, a new tab, a project and
 * a skill page, and the file lands in the message on all four.
 */
export function useFileDropRegion({
  enabled = true,
  note,
  onFilesDropped,
  onFoldersDropped,
}: DropHandlers & {
  // Gates the region so only the active tab reacts. Every open tab stays
  // mounted in one web contents, so without this a single drop fans out to
  // every tab's composer.
  enabled?: boolean;
  note: string;
}) {
  const register = useContext(DropRegisterContext);
  // The caller rebuilds these every render -- one closes over the attachment
  // list -- so they are handed over as a ref that never changes identity.
  // Registering the functions themselves would re-register on every render, and
  // rebind the region's listeners mid-drag.
  const handlersRef = useRef<DropHandlers>({
    onFilesDropped,
    onFoldersDropped,
  });

  useEffect(() => {
    handlersRef.current = { onFilesDropped, onFoldersDropped };
  });

  useEffect(() => {
    if (!register) {
      return;
    }
    register({ enabled, handlers: handlersRef, note });
    return () => {
      register(null);
    };
  }, [enabled, note, register]);
}
