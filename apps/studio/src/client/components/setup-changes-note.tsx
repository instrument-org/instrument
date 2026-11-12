import { openProjectDetails } from "@/client/atoms/project-details-modal";
import { rpcClient } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  setupChangeSentence,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { type ChangesCard, ProjectChangesCard } from "./project-changes-card";
import { MemoryChangesCard, SkillChangesCard } from "./setup-change-cards";
import { ProjectPill } from "./window/chat-row";

type SetupChange =
  SessionMessageDataPart.SetupChangesDataPart["changes"][number];

/**
 * What a turn did to the person's projects, memories and skills: a card
 * for each kind, in that order, each with Undo where its changes can be
 * taken back. An app gets no card: the sign-in card and the reply already
 * say what happened to it. Only the turn's own writes are here, so each row is
 * something this chat did. A project whose file was only written to, with
 * nothing recorded of what changed, keeps a line of its own above them.
 */
export function SetupChangesNote({
  card,
  changes,
  memoryUndone = false,
  undone = false,
}: {
  /** Where the card is, for its Undo to mark it undone. */
  card?: ChangesCard;
  changes: SetupChange[];
  /** The memories card undone already, by this device or another. */
  memoryUndone?: boolean;
  /** The projects card undone already, by this device or another. */
  undone?: boolean;
}) {
  const onProjectCard = (change: SetupChange) =>
    change.kind === "project" &&
    (change.fields !== undefined ||
      (change.change === "added" && change.project !== undefined));
  const projects = changes.filter(onProjectCard).map((change) => ({
    fields: change.fields ?? [],
    name: change.name,
    ...(change.project ? { project: change.project } : {}),
  }));
  const lines = changes.filter(
    (change) => change.kind === "project" && !onProjectCard(change),
  );
  const of = (kind: SetupChange["kind"]) =>
    changes.filter((change) => change.kind === kind);
  const memories = of("memory");
  const skills = of("skill");
  return (
    <>
      {lines.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {lines.map((change) => (
            <p
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
              key={change.name}
            >
              <span className="min-w-0">
                <ProjectSentence change={change} />
              </span>
            </p>
          ))}
        </div>
      )}
      {projects.length > 0 && (
        <ProjectChangesCard
          changes={projects}
          {...(card && { card })}
          undone={undone}
        />
      )}
      {memories.length > 0 && (
        <MemoryChangesCard
          changes={memories}
          {...(card && { card })}
          undone={memoryUndone}
        />
      )}
      {skills.length > 0 && <SkillChangesCard changes={skills} />}
    </>
  );
}

/**
 * The line `setupChangeSentence` words, with the item's name drawn by
 * `link` while the item is still there.
 */
function Sentence({
  change,
  label,
  link,
}: {
  change: SetupChange;
  label?: string;
  link?: (label: ReactNode) => ReactNode;
}) {
  const sentence = setupChangeSentence(change, label ? { label } : {});
  return (
    <>
      {sentence.before}
      {link && change.change !== "removed"
        ? link(sentence.label)
        : sentence.label}
      {sentence.after}
    </>
  );
}

function ProjectSentence({ change }: { change: SetupChange }) {
  const { data: projects = [] } = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  // The line names the project's folder, which is its name.
  const project = projects.find(
    (each) => each.name === change.name && !each.retired,
  );
  return (
    <Sentence
      change={change}
      {...(project && {
        link: () => (
          <button
            className="inline-flex align-middle"
            onClick={() => {
              openProjectDetails(project.id);
            }}
            type="button"
          >
            <ProjectPill project={project} />
          </button>
        ),
      })}
    />
  );
}
