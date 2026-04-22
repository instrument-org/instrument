import { type CheckoutVersionActorRef } from "../../logic/checkout-version";
import { type CreatePreviewActorRef } from "../../logic/create-preview";
import { type WorkspaceServerActorRef } from "../../logic/server";
import {
  type AppSubdomain,
  type PreviewSubdomain,
  type ProjectSubdomain,
  type VersionSubdomain,
} from "../../schemas/subdomains";
import { type WorkspaceConfig } from "../../types";
import { type ProjectBrowserActorRef } from "../project-browser";
import { type RuntimeActorRef } from "../runtime";
import { type SessionActorRef } from "../session";

// Declared here to avoid circular dependency
export interface WorkspaceContext {
  appsBeingTrashed: AppSubdomain[];
  checkoutVersionRefs: Map<VersionSubdomain, CheckoutVersionActorRef>;
  config: WorkspaceConfig;
  createPreviewRefs: Map<PreviewSubdomain, CreatePreviewActorRef>;
  error?: unknown;
  // Resolvers waiting for the projectBrowser at `subdomain` to reach Stopped
  // before trash-project deletes the directory. Drained when the matching
  // projectBrowser.stopped event arrives (or immediately if no machine
  // existed when prepareToTrashApp ran).
  pendingBrowserReapResolvers: Map<ProjectSubdomain, (() => void)[]>;
  // One projectBrowser actor per project subdomain that has had any view or
  // user-presence activity. Spawned lazily, reaped on projectBrowser.stopped.
  projectBrowserRefs: Map<ProjectSubdomain, ProjectBrowserActorRef>;
  runtimeRefs: Map<AppSubdomain, RuntimeActorRef>;
  sessionRefsBySubdomain: Map<AppSubdomain, SessionActorRef[]>;
  workspaceServerRef: WorkspaceServerActorRef;
}
