import { projectModalAtom } from "@/client/atoms/project-modal";
import {
  DEFAULT_FOLDER_ACCESS,
  type FolderAccess,
  FolderAccessSelect,
  FolderAccessWarning,
} from "@/client/components/folder-access-list";
import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import { Spinner } from "@/client/components/ui/spinner";
import { Textarea } from "@/client/components/ui/textarea";
import { useBlockTabNavigation } from "@/client/hooks/use-block-tab-navigation";
import { useDeferredModalState } from "@/client/hooks/use-deferred-modal-state";
import { useTabsController } from "@/client/hooks/use-tabs-controller";
import { displayPath, folderNameFromPath } from "@/client/lib/path-utils";
import { useWindowFileDrop } from "@/client/lib/use-window-file-drop";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type Project,
  type ProjectId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { isDefinedError, type ORPCError, safe } from "@orpc/client";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useRef, useState } from "react";
import { toast } from "sonner";

/**
 * App-wide new/edit-project modal, mounted once at the app-chrome root. Reads
 * `projectModalAtom` (opened via `openCreateProject` / `openEditProject`); traps
 * tab navigation while open.
 */
export function ProjectModal() {
  const [state, setState] = useAtom(projectModalAtom);
  const isOpen = state !== null;
  // Deferred so `DialogContent` stays mounted (and its close animation can
  // play) for a moment after `state` clears to null, instead of unmounting
  // the instant the dialog starts closing.
  const { content, onExitComplete, openKey } = useDeferredModalState(state);
  const close = () => {
    setState(null);
  };

  useBlockTabNavigation(isOpen);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      open={isOpen}
    >
      {content !== null && (
        <ProjectModalContent
          close={close}
          key={openKey}
          onExitComplete={onExitComplete}
          projectId={content.projectId}
          taskId={content.taskId}
        />
      )}
    </Dialog>
  );
}

function ProjectModalContent({
  close,
  onExitComplete,
  projectId,
  taskId,
}: {
  close: () => void;
  onExitComplete: () => void;
  projectId?: ProjectId;
  taskId?: TaskId;
}) {
  const { data: editProject, isLoading } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({
      input: projectId ? { id: projectId } : skipToken,
    }),
  );

  if (projectId && isLoading) {
    return (
      <DialogContent className="max-w-lg" onExitComplete={onExitComplete}>
        <DialogTitle className="sr-only">Edit project</DialogTitle>
        <DialogDescription className="sr-only">
          Loading project
        </DialogDescription>
        <div className="flex items-center justify-center py-12">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      </DialogContent>
    );
  }

  if (projectId && !editProject) {
    return (
      <DialogContent className="max-w-lg" onExitComplete={onExitComplete}>
        <DialogHeader>
          <DialogTitle className="text-center font-serif text-2xl font-medium">
            Project not found
          </DialogTitle>
          <DialogDescription className="sr-only">
            This project could not be loaded.
          </DialogDescription>
        </DialogHeader>
        <p className="py-4 text-center text-sm text-muted-foreground">
          This project could not be loaded. It may have been deleted.
        </p>
        <DialogFooter>
          <Button
            onClick={() => {
              close();
            }}
            type="button"
            variant="outline"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <ProjectModalForm
      close={close}
      editProject={projectId ? editProject : undefined}
      key={editProject?.id ?? "new"}
      onExitComplete={onExitComplete}
      taskId={taskId}
    />
  );
}

function ProjectModalForm({
  close,
  editProject,
  onExitComplete,
  taskId,
}: {
  close: () => void;
  editProject?: Project;
  onExitComplete: () => void;
  taskId?: TaskId;
}) {
  const isEditing = editProject !== undefined;
  const [folders, setFolders] = useState<FolderAccess[]>([]);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Name validation runs server-side (rules vary per OS); attribute those
  // failures to the Name field, everything else stays form-level.
  const toSubmitError = (error: Error | ORPCError<string, unknown>) => {
    if (isDefinedError(error) && error.code === "PARSE_ERROR") {
      return { fields: { name: error.message } };
    }
    return (
      error.message ||
      (isEditing ? "Failed to save project." : "Failed to create project.")
    );
  };

  const addFolderPath = (path: string) => {
    setFolders((prev) =>
      prev.some((folder) => folder.path === path)
        ? prev
        : [...prev, { access: DEFAULT_FOLDER_ACCESS, path }],
    );
  };

  const { isDragging } = useWindowFileDrop({
    onFilesDropped: () => {
      toast.info("Only folders can be attached to a project");
    },
    onFoldersDropped: (dropped) => {
      for (const folder of dropped) {
        addFolderPath(folder.path);
      }
    },
  });

  const { isPending: isCreating, mutateAsync: createProject } = useMutation(
    rpcClient.workspace.project.create.mutationOptions(),
  );
  const { isPending: isUpdating, mutateAsync: updateProject } = useMutation(
    rpcClient.workspace.project.update.mutationOptions(),
  );
  const isPending = isCreating || isUpdating;

  const { addTab } = useTabsController();

  const handlePickFolder = async () => {
    const [error, result] = await safe(
      rpcClient.utils.showFolderPicker.call({}),
    );
    if (error) {
      toast.error("Failed to open folder picker");
      return;
    }
    if (result) {
      addFolderPath(result.path);
    }
  };

  const form = useForm({
    defaultValues: {
      description: editProject?.description ?? "",
      instructions: "",
      name: editProject?.name ?? "",
    },
    validators: {
      onSubmitAsync: async ({ value }) => {
        if (editProject) {
          const [error] = await safe(
            updateProject({
              description: value.description.trim(),
              id: editProject.id,
              name: value.name.trim(),
            }),
          );
          if (error) {
            return toSubmitError(error);
          }
          close();
          return;
        }

        const [error, project] = await safe(
          createProject({
            description: value.description.trim() || undefined,
            folders: folders.length > 0 ? folders : undefined,
            instructions: value.instructions.trim() || undefined,
            name: value.name.trim(),
          }),
        );
        if (error) {
          return toSubmitError(error);
        }

        if (taskId) {
          await rpcClient.workspace.project.addTask.call({
            projectId: project.id,
            taskId,
          });
        }

        addTab({ pathname: `/projects/${project.id}/`, select: true });
        close();
        return;
      },
    },
  });

  return (
    <DialogContent
      className="max-w-lg"
      onExitComplete={onExitComplete}
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        nameInputRef.current?.focus();
      }}
      showCloseButton={false}
    >
      <div className="absolute top-3 right-3 z-10">
        <DialogClose asChild>
          <Button aria-label="Close" type="button" variant="outline">
            <XIcon className="size-4" />
          </Button>
        </DialogClose>
      </div>
      <DialogHeader>
        <DialogTitle className="text-center font-serif text-2xl font-medium">
          {isEditing ? "Edit project" : "New project"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {isEditing
            ? "Edit this project's name and description."
            : "Create a project to group tasks and share instructions across them."}
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid grid-cols-1 gap-4 py-4">
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => {
                if (!value.trim()) {
                  return "Name is required.";
                }
                return;
              },
            }}
          >
            {(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                  <Input
                    aria-invalid={isInvalid}
                    disabled={isPending}
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                    }}
                    placeholder="Project name"
                    ref={nameInputRef}
                    value={field.state.value}
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          </form.Field>

          <form.Field name="description">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                <Input
                  disabled={isPending}
                  id={field.name}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                  }}
                  placeholder="Short description of your project"
                  value={field.state.value}
                />
              </Field>
            )}
          </form.Field>

          {!isEditing && (
            <form.Field name="instructions">
              {(field) => (
                <Field>
                  <div className="flex flex-col gap-0.5">
                    <FieldLabel htmlFor={field.name}>Instructions</FieldLabel>
                    <p className="text-xs text-muted-foreground">
                      Add details about this project for Instrument to remember
                      for each task
                    </p>
                  </div>
                  <Textarea
                    className="max-h-40 min-h-24 overflow-y-auto"
                    disabled={isPending}
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                    }}
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
          )}

          {!isEditing && (
            <div className="flex flex-col gap-2">
              {folders.some((folder) => folder.access === "read-write") && (
                <FolderAccessWarning
                  folderCount={
                    folders.filter((folder) => folder.access === "read-write")
                      .length
                  }
                  onUseReadOnly={() => {
                    setFolders((prev) =>
                      prev.map((folder) => ({
                        ...folder,
                        access: "read-only",
                      })),
                    );
                  }}
                />
              )}
              {/* One rounded block with rules between the folders rather than
                  a card each: at this size a stack of separate cards reads as
                  several controls instead of one list. */}
              <div className="divide-y overflow-hidden rounded-md border empty:hidden">
                {folders.map((folder) => (
                  <div
                    className="flex min-w-0 items-center gap-x-2 px-4 py-2"
                    key={folder.path}
                  >
                    <MacFolderIcon className="size-7 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">
                        {folderNameFromPath(folder.path)}
                      </span>
                      <span
                        className="truncate text-xs text-muted-foreground"
                        title={folder.path}
                      >
                        {displayPath(folder.path)}
                      </span>
                    </div>
                    <FolderAccessSelect
                      access={folder.access}
                      folderName={folderNameFromPath(folder.path)}
                      onChange={(access) => {
                        setFolders((prev) =>
                          prev.map((f) =>
                            f.path === folder.path ? { ...f, access } : f,
                          ),
                        );
                      }}
                    />
                    <button
                      aria-label="Remove folder"
                      className="-mr-1 shrink-0 rounded-sm p-1 text-muted-foreground opacity-50 hover:bg-muted/50 hover:opacity-100"
                      onClick={() => {
                        setFolders((prev) =>
                          prev.filter((f) => f.path !== folder.path),
                        );
                      }}
                      type="button"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              {/* Below the list: attaching a folder appends to what is already
                  there, so the button sits where the next row will appear. */}
              <Button
                className={cn(
                  "w-full justify-between",
                  isDragging && "bg-accent text-foreground",
                )}
                onClick={() => void handlePickFolder()}
                type="button"
                variant="secondary"
              >
                <span>
                  {isDragging ? "Drop folders to attach" : "Attach folders"}
                </span>
                <PlusIcon className="size-4" />
              </Button>
            </div>
          )}
        </div>
        <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
          {(submitError) =>
            typeof submitError === "string" ? (
              <FieldError className="pb-2" errors={[submitError]} />
            ) : null
          }
        </form.Subscribe>
        <DialogFooter>
          <Button
            disabled={isPending}
            onClick={() => {
              close();
            }}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <form.Subscribe
            selector={(state) => ({
              canSubmit: state.canSubmit,
              isSubmitting: state.isSubmitting,
            })}
          >
            {({ canSubmit, isSubmitting }) => (
              <Button
                disabled={!canSubmit || isSubmitting || isPending}
                type="submit"
              >
                {isEditing ? "Save" : "Create"}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
