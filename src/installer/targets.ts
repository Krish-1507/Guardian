import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

export interface InstallTarget {
  path: string;
  tool: string;
  level: "project" | "home";
  transform?: "skill";
  note?: string;
}

/** Absolute project-level targets, relative to the given repo/cwd. */
export function projectTargets(cwd: string): InstallTarget[] {
  const p = (...parts: string[]) => path.resolve(cwd, ...parts);
  return [
    { path: p(".claude", "commands", "guardian.md"), tool: "Claude Code (project)", level: "project" },
    {
      path: p(".claude", "skills", "guardian", "SKILL.md"),
      tool: "Claude Code Skill",
      level: "project",
      transform: "skill",
    },
    { path: p(".cursor", "commands", "guardian.md"), tool: "Cursor (project)", level: "project" },
    { path: p(".opencode", "commands", "guardian.md"), tool: "OpenCode (project)", level: "project" },
    {
      path: p(".opencode", "command", "guardian.md"),
      tool: "OpenCode (project, legacy)",
      level: "project",
    },
    { path: p(".kilocode", "workflows", "guardian.md"), tool: "Kilo Code (project)", level: "project" },
    { path: p(".kilo", "commands", "guardian.md"), tool: "Kilo (project, legacy)", level: "project" },
  ];
}

/** Absolute user-level (home) targets. */
export function homeTargets(): InstallTarget[] {
  const h = (...parts: string[]) => path.join(os.homedir(), ...parts);
  return [
    {
      path: h(".codex", "prompts", "guardian.md"),
      tool: "Codex (user)",
      level: "home",
      note: "Codex supports prompts only at user level",
    },
    { path: h(".claude", "commands", "guardian.md"), tool: "Claude Code (user)", level: "home" },
    { path: h(".cursor", "commands", "guardian.md"), tool: "Cursor (user)", level: "home" },
    { path: h(".opencode", "commands", "guardian.md"), tool: "OpenCode (user)", level: "home" },
    { path: h(".kilocode", "workflows", "guardian.md"), tool: "Kilo Code (user)", level: "home" },
  ];
}

export function getTargets(cwd: string): InstallTarget[] {
  return [...projectTargets(cwd), ...homeTargets()];
}

/** Locate templates/guardian.prompt.md relative to this module or cwd. */
export function resolveTemplatePath(): string {
  const fromModule = fileURLToPath(
    new URL("../../templates/guardian.prompt.md", import.meta.url),
  );
  if (fs.existsSync(fromModule)) return fromModule;
  const fromCwd = path.resolve(process.cwd(), "templates", "guardian.prompt.md");
  if (fs.existsSync(fromCwd)) return fromCwd;
  throw new Error("could not locate templates/guardian.prompt.md");
}

/**
 * Render the file content for a target. The Claude Code skill variant rewrites
 * the frontmatter to { name, description } as skills require.
 */
export function renderContent(target: InstallTarget, templateText: string): string {
  if (target.transform !== "skill") return templateText;
  const m = templateText.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return templateText;
  const fm = m[1];
  const body = m[2];
  const descMatch = fm.match(/description:\s*(.+?)\s*$/m);
  const description = descMatch ? descMatch[1].trim() : "";
  return `---\nname: guardian\ndescription: ${description}\n---\n\n${body}`;
}
