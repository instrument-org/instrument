import {
  closeFileViewerAtom,
  setTaskFileViewerIndexAtom,
  taskFileViewerAtom,
} from "@/client/atoms/task-file-viewer";
import { useAppZoomStyle } from "@/client/hooks/use-app-zoom";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRouter } from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect } from "react";

import { FilePreviewListItem } from "../file-preview-list-item";
import { FileViewer } from "../file-viewer";
import { Button } from "../ui/button";

// Left, right and bottom breathing room. Small enough that the viewer still
// reads as filling the window, big enough to show the shell behind it.
const GUTTER = 12;

// A viewer that mounts a browser guest puts it on `document.body`, outside this
// dialog's portal, so the overlay and content (both `z-50`) would cover it. It
// has to clear them to be seen at all -- the one case where a raised level is
// earned rather than inherited, per docs/findings/leaking-z-index-stacks.md.
const GUEST_Z_INDEX = 51;

export function TaskFileViewerModal() {
  const state = useAtomValue(taskFileViewerAtom);
  const collapseViewer = useSetAtom(closeFileViewerAtom);
  const setCurrentIndex = useSetAtom(setTaskFileViewerIndexAtom);
  const router = useRouter();
  const zoomStyle = useAppZoomStyle({
    paddingBottom: GUTTER,
    paddingLeft: GUTTER,
    paddingRight: GUTTER,
    paddingTop: TOOLBAR_HEIGHT,
  });

  const currentFile = state.files[state.currentIndex];
  const hasMultipleFiles = state.files.length > 1;

  const goToPrevious = useCallback(() => {
    const newIndex =
      state.currentIndex === 0
        ? state.files.length - 1
        : state.currentIndex - 1;
    setCurrentIndex(newIndex);
  }, [state.currentIndex, state.files.length, setCurrentIndex]);

  const goToNext = useCallback(() => {
    const newIndex = (state.currentIndex + 1) % state.files.length;
    setCurrentIndex(newIndex);
  }, [state.currentIndex, state.files.length, setCurrentIndex]);

  useEffect(() => {
    const unsubscribe = router.subscribe("onBeforeLoad", () => {
      if (state.isModalOpen) {
        collapseViewer();
      }
    });

    return () => {
      unsubscribe();
    };
  }, [router, state.isModalOpen, collapseViewer]);

  useEffect(() => {
    if (!state.isModalOpen || !hasMultipleFiles) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPrevious();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    state.isModalOpen,
    hasMultipleFiles,
    state.files.length,
    state.currentIndex,
    setCurrentIndex,
    goToPrevious,
    goToNext,
  ]);

  useEffect(() => {
    if (!state.isModalOpen || !hasMultipleFiles) {
      return;
    }

    const thumbnail = document.querySelector(
      `#thumbnail-${state.currentIndex}`,
    );
    if (thumbnail) {
      thumbnail.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [state.currentIndex, state.isModalOpen, hasMultipleFiles]);

  if (!currentFile) {
    return null;
  }

  return (
    <DialogPrimitive.Root
      onOpenChange={(open) => {
        if (!open) {
          collapseViewer();
        }
      }}
      open={state.isModalOpen}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/*
          `inset-0` is zero on all four sides, and zero is zero at any scale
          factor, so the self-applied zoom leaves this box covering exactly the
          real viewport while its contents scale with the rest of the app.
          Percentage sizing inside resolves in the element's own zoomed units
          and needs no compensation; `vw`/`vh` would (they are not rescaled by
          an element's own zoom), which is why nothing here uses them.

          The padding is what keeps the window's own controls usable: the top
          inset clears the toolbar, so the macOS traffic lights and the Windows
          caption buttons stay visible and clickable rather than sitting on top
          of the viewer's filename and close button. It is the plain constant
          rather than one divided by the zoom because this element carries the
          same zoom factor the app root does, so `TOOLBAR_HEIGHT` here scales to
          exactly the toolbar's on-screen height at every level.
        */}
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex items-center justify-center data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
          onClick={(event) => {
            // Only the gutter itself, never a click that bubbled out of the
            // viewer.
            if (event.target === event.currentTarget) {
              collapseViewer();
            }
          }}
          style={zoomStyle}
        >
          <DialogPrimitive.Title className="sr-only">
            {currentFile.filename}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            File viewer
          </DialogPrimitive.Description>
          <div className="relative flex size-full flex-col">
            <div className="relative flex min-h-0 flex-1">
              {hasMultipleFiles && (
                <>
                  <Button
                    className="absolute top-1/2 left-3 z-10 -translate-y-1/2"
                    onClick={goToPrevious}
                    size="icon"
                    variant="ghost-overlay"
                  >
                    <CaretLeftIcon className="size-6" />
                  </Button>
                  <Button
                    className="absolute top-1/2 right-3 z-10 -translate-y-1/2"
                    onClick={goToNext}
                    size="icon"
                    variant="ghost-overlay"
                  >
                    <CaretRightIcon className="size-6" />
                  </Button>
                </>
              )}
              <div className="flex min-h-0 flex-1" key={currentFile.url}>
                <FileViewer
                  file={currentFile}
                  guestZIndex={GUEST_Z_INDEX}
                  onClose={collapseViewer}
                />
              </div>
            </div>

            {hasMultipleFiles && (
              <div className="dark flex shrink-0 justify-center px-4 pb-4 text-foreground">
                <div className="flex gap-x-2 overflow-x-auto px-1 py-2">
                  {state.files.map((file, index) => (
                    <div
                      className="max-w-48 shrink-0"
                      id={`thumbnail-${index}`}
                      key={index}
                    >
                      <FilePreviewListItem
                        file={file}
                        isSelected={index === state.currentIndex}
                        onClick={() => {
                          setCurrentIndex(index);
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
