import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { EnrichedFinding } from "@terratrace/core";
import { dbLoadAllProjects, dbLoadProject, isDbConfigured } from "./db";
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
// This directory read is the fallback for local dev without DATABASE_URL
// set — once it's configured, dbLoadAllProjects()/dbLoadProject() (db.ts)
// take over so uploaded CUR data can be re-correlated without a rescan.
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

async function loadAllProjectsFromDisk(): Promise<ProjectData[]> {
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

export async function loadAllProjects(): Promise<ProjectData[]> {
  return isDbConfigured() ? dbLoadAllProjects() : loadAllProjectsFromDisk();
}

export async function loadProjectSummaries(): Promise<ProjectSummary[]> {
  const projects = await loadAllProjects();
  return projects
    .map((p) => ({ project: p.project, stats: computeStats(p.findings) }))
    .sort((a, b) => b.stats.total - a.stats.total);
}

export async function loadProject(projectId: string): Promise<ProjectData | null> {
  if (isDbConfigured()) return dbLoadProject(projectId);
  const filePath = path.join(SCAN_OUTPUT_DIR, `${projectId}.json`);
  return readProjectFile(filePath);
}
