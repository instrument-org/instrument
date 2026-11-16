import { type ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";

/**
 * Router-free shell shared by {@link ErrorCard} (router-caught) and
 * {@link AppErrorFallback} (shell crashes, rendered outside any router), and
 * the page for an address no screen answers: the card chrome around what went
 * wrong (`children`). Recovery affordances differ per caller, so they pass
 * their own footer `actions`, a report among them. The words are selectable,
 * since someone reading them may copy them into a report or a search.
 */
export function ErrorCardShell({
  actions,
  children,
  description,
  title = "Something went wrong",
}: {
  actions: ReactNode;
  children: ReactNode;
  description: string;
  title?: string;
}) {
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="select-text">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
      <CardFooter className="flex items-center justify-end">
        {actions}
      </CardFooter>
    </Card>
  );
}
