import { assetsToDataUrls, importAssetDataUrls } from "./assets";
import { PROJECT_VERSION, type Element, type Project } from "./types";

/** `.json` project file: the project plus every uploaded image it uses, embedded as data URLs. */
export interface ProjectFile {
  format: "joyofit-studio-project";
  project: Project;
  assets: Record<string, { name: string; dataUrl: string }>;
}

export function assetIdsOf(project: Project): string[] {
  const ids = new Set<string>();
  for (const el of project.elements) {
    if (el.type === "image" || el.type === "hand") {
      if (el.assetId) ids.add(el.assetId);
    } else if (el.type === "background" && el.fill.kind === "image" && el.fill.assetId) {
      ids.add(el.fill.assetId);
    }
  }
  return [...ids];
}

export async function serializeProject(project: Project): Promise<string> {
  const file: ProjectFile = {
    format: "joyofit-studio-project",
    project,
    assets: await assetsToDataUrls(assetIdsOf(project)),
  };
  return JSON.stringify(file);
}

const ELEMENT_TYPES = new Set(["background", "time", "date", "hand", "image", "widget", "ring"]);

function isElement(value: unknown): value is Element {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.type === "string" && ELEMENT_TYPES.has(e.type) && typeof e.x === "number" && typeof e.y === "number";
}

export class ProjectFileError extends Error {}

/** Parses and validates a project file, restores its images and returns the project. */
export async function parseProjectFile(text: string): Promise<Project> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError("This file is not valid JSON.");
  }
  const file = raw as Partial<ProjectFile>;
  if (file?.format !== "joyofit-studio-project" || typeof file.project !== "object" || file.project === null) {
    throw new ProjectFileError("This is not a JoyoFit Studio project file.");
  }
  const project = file.project;
  if (project.version !== PROJECT_VERSION) {
    throw new ProjectFileError(`Project version ${String(project.version)} is not supported (expected ${PROJECT_VERSION}).`);
  }
  if (!Array.isArray(project.elements) || !project.elements.every(isElement)) {
    throw new ProjectFileError("The project's layers are damaged.");
  }
  if (file.assets) await importAssetDataUrls(file.assets);
  return project;
}

export function downloadBlob(name: string, data: Blob | Uint8Array | string, type = "application/octet-stream"): void {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
