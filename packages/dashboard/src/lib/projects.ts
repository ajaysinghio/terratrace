import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EnrichedFinding } from "@terratrace/core";
import { computeStats, type DashboardStats } from "./stats";

export interface ProjectMeta {
  id: string;
  name: string;
  repoUrl?: string;
  scannedAt?: string;
}

export interface ProjectData {
  project: ProjectMeta;
  findings: EnrichedFinding[];
}

export interface ProjectSummary {
  project: ProjectMeta;
  stats: DashboardStats;
}

// Each `pnpm scan` run (one per repo) writes ./scan-output/<project-id>.json
// at the workspace root: { project: {...}, findings: EnrichedFinding[] }.
// A company running this against 100s of repos would have CI push one file
// per repo here (or into whatever store replaces this directory read).
const SCAN_OUTPUT_DIR = path.join(process.cwd(), "..", "..", "scan-output");

async function readProjectFile(filePath: string): Promise<ProjectData | null> {
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as ProjectData;
    if (!parsed.project || !Array.isArray(parsed.findings)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function loadAllProjects(): Promise<ProjectData[]> {
  let entries: string[];
  try {
    entries = await readdir(SCAN_OUTPUT_DIR);
  } catch {
    return [];
  }

  const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));
  const projects = await Promise.all(jsonFiles.map((file) => readProjectFile(path.join(SCAN_OUTPUT_DIR, file))));
  return projects.filter((p): p is ProjectData => p !== null);
}

export async function loadProjectSummaries(): Promise<ProjectSummary[]> {
  const projects = await loadAllProjects();
  return projects
    .map((p) => ({ project: p.project, stats: computeStats(p.findings) }))
    .sort((a, b) => b.stats.total - a.stats.total);
}

export async function loadProject(projectId: string): Promise<ProjectData | null> {
  const filePath = path.join(SCAN_OUTPUT_DIR, `${projectId}.json`);
  return readProjectFile(filePath);
}
