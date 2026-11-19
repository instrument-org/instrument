import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/debug/components")({
  component: Outlet,
});
