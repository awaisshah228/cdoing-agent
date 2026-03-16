/**
 * Skill Tool — load domain-specific workflows from .cdoing/skills/.
 *
 * Skills are markdown files with optional YAML frontmatter, loaded at runtime
 * to give the agent specialized instructions for specific domains or tasks.
 */

import * as fs from "fs";
import * as path from "path";
import type { BaseTool, ToolDefinition, ToolResult } from "../types";

export class SkillTool implements BaseTool {
  definition: ToolDefinition = {
    name: "skill",
    description:
      "Load a domain-specific skill to get specialized instructions. Skills provide workflows, best practices, and context for specific tasks (e.g., database migrations, API design, testing strategies). Use this when you need expert guidance on a particular domain.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "The name of the skill to load (e.g., 'migration', 'api-design')",
        },
      },
      required: ["name"],
    },
    requiresPermission: true,
    permissionMessage: (input) => `Load skill: ${input.name}`,
  };

  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  async execute(input: Record<string, unknown>): Promise<ToolResult> {
    const name = String(input.name || "").trim();
    if (!name) {
      return { success: false, output: "", error: "No skill name provided" };
    }

    // Validate skill name (prevent path traversal)
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      return { success: false, output: "", error: "Invalid skill name" };
    }

    const skill = this.findSkill(name);
    if (!skill) {
      const available = this.listAvailableSkills();
      const suggestion = available.length > 0
        ? `\nAvailable skills: ${available.join(", ")}`
        : "\nNo skills found. Create skills in .cdoing/skills/ directory.";
      return { success: false, output: "", error: `Skill not found: ${name}${suggestion}` };
    }

    try {
      const content = fs.readFileSync(skill.path, "utf-8");
      const { frontmatter, body } = parseFrontmatter(content);

      // List files in skill directory (if it's a directory-based skill)
      const skillDir = path.dirname(skill.path);
      const files = this.listSkillFiles(skillDir, skill.path);

      const output = [
        `<skill_content name="${name}">`,
        `# Skill: ${name}`,
        "",
        body.trim(),
        "",
        `Base directory: ${skillDir}`,
      ];

      if (files.length > 0) {
        output.push("", "<skill_files>");
        for (const f of files) {
          output.push(`<file>${f}</file>`);
        }
        output.push("</skill_files>");
      }

      output.push("</skill_content>");

      return { success: true, output: output.join("\n") };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: "", error: `Failed to load skill: ${message}` };
    }
  }

  private findSkill(name: string): { path: string } | null {
    const skillDirs = this.getSkillDirs();
    for (const dir of skillDirs) {
      // Check <name>.md directly
      const mdPath = path.join(dir, `${name}.md`);
      if (fs.existsSync(mdPath)) return { path: mdPath };

      // Check <name>/SKILL.md
      const dirSkillPath = path.join(dir, name, "SKILL.md");
      if (fs.existsSync(dirSkillPath)) return { path: dirSkillPath };

      // Check <name>/index.md
      const indexPath = path.join(dir, name, "index.md");
      if (fs.existsSync(indexPath)) return { path: indexPath };
    }
    return null;
  }

  private listAvailableSkills(): string[] {
    const skills: string[] = [];
    for (const dir of this.getSkillDirs()) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          skills.push(entry.name.replace(/\.md$/, ""));
        } else if (entry.isDirectory()) {
          const sub = path.join(dir, entry.name);
          if (
            fs.existsSync(path.join(sub, "SKILL.md")) ||
            fs.existsSync(path.join(sub, "index.md"))
          ) {
            skills.push(entry.name);
          }
        }
      }
    }
    return [...new Set(skills)];
  }

  private getSkillDirs(): string[] {
    return [
      path.join(this.workingDir, ".cdoing", "skills"),
      path.join(this.workingDir, ".claude", "skills"),
    ];
  }

  private listSkillFiles(skillDir: string, mainFile: string): string[] {
    const files: string[] = [];
    const MAX_FILES = 10;
    try {
      if (!fs.existsSync(skillDir)) return [];
      const entries = fs.readdirSync(skillDir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= MAX_FILES) break;
        const fullPath = path.join(skillDir, entry.name);
        if (fullPath === mainFile) continue; // skip the skill file itself
        if (entry.isFile()) {
          files.push(entry.name);
        }
      }
    } catch { /* ignore */ }
    return files;
  }
}

/** Parse YAML frontmatter from markdown content */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, string> = {};
  const yamlLines = match[1].split("\n");
  for (const line of yamlLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.substring(0, colonIdx).trim();
      const value = line.substring(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}
