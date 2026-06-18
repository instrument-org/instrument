import path from "node:path";

import { AppDirSchema } from "../../schemas/paths";
import {
  type AppSubdomain,
  type PreviewSubdomain,
  type ProjectSubdomain,
  type SandboxSubdomain,
} from "../../schemas/subdomains";
import { type WorkspaceConfig } from "../../types";
import { getSandboxesDir } from "../app-dir-utils";
import { folderNameForSubdomain } from "../folder-name-for-subdomain";
import {
  isPreviewSubdomain,
  isProjectSubdomain,
  isSandboxSubdomain,
} from "../is-app";
import { projectSubdomainForSubdomain } from "../project-subdomain-for-subdomain";
import { type AppConfig } from "./types";

export type CreateAppConfigReturn<T extends AppSubdomain> =
  T extends PreviewSubdomain
    ? PreviewConfig
    : T extends ProjectSubdomain
      ? ProjectConfig
      : T extends SandboxSubdomain
        ? SandboxConfig
        : never;
type PreviewConfig = Extract<AppConfig, { type: "preview" }>;
type ProjectConfig = Extract<AppConfig, { type: "project" }>;
type SandboxConfig = Extract<AppConfig, { type: "sandbox" }>;

export function createAppConfig<T extends AppSubdomain>({
  subdomain,
  workspaceConfig,
}: {
  subdomain: T;
  workspaceConfig: WorkspaceConfig;
}): CreateAppConfigReturn<T> {
  if (isProjectSubdomain(subdomain)) {
    return createProjectConfig(
      subdomain,
      workspaceConfig,
    ) as CreateAppConfigReturn<T>;
  }

  if (isPreviewSubdomain(subdomain)) {
    return createPreviewConfig(
      subdomain,
      workspaceConfig,
    ) as CreateAppConfigReturn<T>;
  }

  if (isSandboxSubdomain(subdomain)) {
    return createSandboxConfig(
      subdomain,
      workspaceConfig,
    ) as CreateAppConfigReturn<T>;
  }

  throw new Error(`Invalid subdomain format: ${subdomain}`);
}

function createPreviewConfig(
  subdomain: PreviewSubdomain,
  workspaceConfig: WorkspaceConfig,
): PreviewConfig {
  const folderNameResult = folderNameForSubdomain(subdomain);
  if (folderNameResult.isErr()) {
    throw new Error(`Invalid preview subdomain format: ${subdomain}`);
  }
  const folderName = folderNameResult.value;
  return {
    appDir: AppDirSchema.parse(
      path.join(workspaceConfig.previewsDir, folderName),
    ),
    folderName,
    subdomain,
    type: "preview",
    workspaceConfig,
  };
}

function createProjectConfig(
  subdomain: ProjectSubdomain,
  workspaceConfig: WorkspaceConfig,
): ProjectConfig {
  const folderNameResult = folderNameForSubdomain(subdomain);
  if (folderNameResult.isErr()) {
    throw new Error(`Invalid task subdomain format: ${subdomain}`);
  }
  const folderName = folderNameResult.value;
  return {
    appDir: AppDirSchema.parse(
      path.join(workspaceConfig.projectsDir, folderName),
    ),
    folderName,
    subdomain,
    type: "project",
    workspaceConfig,
  };
}

function createSandboxConfig(
  subdomain: SandboxSubdomain,
  workspaceConfig: WorkspaceConfig,
): SandboxConfig {
  const folderNameResult = folderNameForSubdomain(subdomain);
  if (folderNameResult.isErr()) {
    throw new Error(`Invalid sandbox subdomain format: ${subdomain}`);
  }
  const folderName = folderNameResult.value;

  const projectSubdomain = projectSubdomainForSubdomain(subdomain);

  const projectConfig = createAppConfig({
    subdomain: projectSubdomain,
    workspaceConfig,
  });

  return {
    appDir: AppDirSchema.parse(
      path.join(getSandboxesDir(projectConfig.appDir), folderName),
    ),
    folderName,
    subdomain,
    type: "sandbox",
    workspaceConfig,
  };
}
