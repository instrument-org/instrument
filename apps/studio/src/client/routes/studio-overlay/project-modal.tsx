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
import { safe } from "@orpc/client";
import { PlusIcon, XIcon } from "@phosphor-icons/react";
import { useForm } from "@tanstack/react-form";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/studio-overlay/project-modal")({
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
    rpcClient.workspace.project.create.mutationOptions({
      onError: (error) => {
        toast.error("Failed to create project", { description: error.message });
      },
    }),
  );
  const { isPending: isUpdating, mutateAsync: updateProject } = useMutation(
    rpcClient.workspace.project.update.mutationOptions({
      onError: (error) => {
        toast.error("Failed to save project", { description: error.message });
      },
    }),
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
    onSubmit: async ({ value }) => {
      if (editProject) {
        await updateProject({
          description: value.description.trim(),
          id: editProject.id,
          name: value.name.trim(),
        });
        void rpcClient.studioOverlay.resolve.call();
        return;
      }

      const project = await createProject({
        description: value.description.trim() || undefined,
        folders: folders.length > 0 ? folders : undefined,
        instructions: value.instructions.trim() || undefined,
        name: value.name.trim(),
      });

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
        <DialogTitle className="text-center font-serif text-2xl font-normal">
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
        <div className="grid gap-4 py-4">
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
                  <FieldLabel htmlFor={field.name}>Instructions</FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Add details about this project for Instrument to remember
                    for each task.
                  </p>
                  <Textarea
                    className="min-h-24"
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
            <div className="flex flex-col gap-2 overflow-hidden">
              <button
                className={cn(
                  "flex items-center justify-between rounded-xl border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  isDragging && "border-ring bg-accent text-foreground",
                )}
                onClick={() => void handlePickFolder()}
                type="button"
              >
                <span>
                  {isDragging ? "Drop folders to attach" : "Attach folders"}
                </span>
                <PlusIcon className="size-4" />
              </button>
              {folders.map((path) => (
                <div
                  className="flex min-w-0 items-center gap-x-2 overflow-hidden rounded-md border p-2"
                  key={path}
                >
                  <MacFolderIcon className="size-5 shrink-0" />
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
