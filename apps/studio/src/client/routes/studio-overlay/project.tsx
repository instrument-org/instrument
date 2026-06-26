import { MacFolderIcon } from "@/client/components/icons/mac-folder";
import { Button } from "@/client/components/ui/button";
import {
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
import { folderNameFromPath } from "@/client/lib/path-utils";
import { useWindowFileDrop } from "@/client/lib/use-window-file-drop";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { StudioOverlayNewProjectSearchSchema } from "@/shared/studio-overlay";
import { type StudioPath } from "@/shared/studio-path";
import {
  type Project,
  ProjectIdSchema,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { isDefinedError, type ORPCError, safe } from "@orpc/client";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/studio-overlay/project")({
  component: NewProjectModal,
  validateSearch: StudioOverlayNewProjectSearchSchema,
});

function NewProjectModal() {
  const { projectId, taskId } = Route.useSearch();

  const { data: editProject, isLoading } = useQuery(
    rpcClient.workspace.project.byId.queryOptions({
      input: projectId ? { id: ProjectIdSchema.parse(projectId) } : skipToken,
    }),
  );

  if (projectId && isLoading) {
    return (
      <DialogContent className="max-w-lg">
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
      <DialogContent className="max-w-lg">
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
              void rpcClient.studioOverlay.dismiss.call();
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
      editProject={projectId ? editProject : undefined}
      key={editProject?.id ?? "new"}
      taskId={taskId}
    />
  );
}

function ProjectModalForm({
  editProject,
  taskId,
}: {
  editProject?: Project;
  taskId?: string;
}) {
  const isEditing = editProject !== undefined;
  const [folders, setFolders] = useState<string[]>([]);

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
    setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
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
          void rpcClient.studioOverlay.resolve.call();
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
            taskId: TaskIdSchema.parse(taskId),
          });
        }

        void rpcClient.tabs.add.call({
          appPath: `/projects/${project.id}` as StudioPath,
          select: true,
        });
        void rpcClient.studioOverlay.resolve.call();
        return;
      },
    },
  });

  return (
    <DialogContent className="max-w-lg" showCloseButton={false}>
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
                    autoFocus
                    disabled={isPending}
                    id={field.name}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                    }}
                    placeholder="Project name"
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
              <Button
                className={cn(
                  "w-full justify-between",
                  isDragging && "bg-accent text-foreground",
                )}
                onClick={() => void handlePickFolder()}
                type="button"
              >
                <span>
                  {isDragging ? "Drop folders to attach" : "Attach folders"}
                </span>
                <PlusIcon className="size-4" />
              </Button>
              {folders.map((path) => (
                <div
                  className="flex min-w-0 items-center gap-x-2 overflow-hidden rounded-md border px-4 py-2"
                  key={path}
                >
                  <MacFolderIcon className="size-7 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">
                      {folderNameFromPath(path)}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {path}
                    </span>
                  </div>
                  <button
                    aria-label="Remove folder"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setFolders((prev) => prev.filter((f) => f !== path));
                    }}
                    type="button"
                  >
                    <XIcon className="size-4" />
                  </button>
                </div>
              ))}
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
              void rpcClient.studioOverlay.dismiss.call();
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
