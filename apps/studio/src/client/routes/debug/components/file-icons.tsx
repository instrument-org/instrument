import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components/file-icons")({
  beforeLoad: () => {
    throw redirect({ search: { tab: "files" }, to: "/debug/components/icons" });
  },
});
