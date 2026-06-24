import { Button } from "@/client/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/client/components/ui/field";
import { Input } from "@/client/components/ui/input";
import { Textarea } from "@/client/components/ui/textarea";
import { rpcClient } from "@/client/rpc/client";
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/studio-overlay/new-project")({
  component: NewProjectModal,
});

function NewProjectModal() {
  const { isPending, mutateAsync: createProject } = useMutation(
    rpcClient.workspace.project.create.mutationOptions({
      onError: (error) => {
        toast.error("Failed to create project", {
          description: error.message,
        });
      },
    }),
  );

  const form = useForm({
    defaultValues: {
      description: "",
      instructions: "",
      name: "",
    },
    onSubmit: async ({ value }) => {
      await createProject({
        description: value.description.trim() || undefined,
        instructions: value.instructions.trim() || undefined,
        name: value.name.trim(),
      });
      void rpcClient.studioOverlay.resolve.call();
    },
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle className="text-center">New project</DialogTitle>
        <DialogDescription className="sr-only">
          Create a project to group tasks and share instructions across them.
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

          <form.Field name="instructions">
            {(field) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Instructions</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Add details about this project for Instrument to remember for
                  each task.
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
                Create
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
