/**
 * Skills management routes.
 */
import { Router, type Request, type Response } from "express";
import type { SkillRegistry } from "../../skills/registry";

export interface SkillRouteOptions {
  getSkillRegistry: () => SkillRegistry | undefined;
}

export function skillRoutes(opts: SkillRouteOptions): Router {
  const router = Router();

  function getRegistry(res: Response): SkillRegistry | null {
    const reg = opts.getSkillRegistry();
    if (!reg) {
      res.status(503).json({ error: "Skills registry not available" });
      return null;
    }
    return reg;
  }

  // List all skills
  router.get("/api/skills", (_req: Request, res: Response) => {
    const reg = getRegistry(res);
    if (!reg) return;
    const skills = reg.getAll().map((e) => ({
      id: e.skill.id,
      name: e.skill.name,
      description: e.skill.description,
      location: e.skill.location,
      enabled: e.enabled,
      always: e.skill.always || false,
      userInvocable: e.skill.userInvocable !== false,
      loadedAt: e.loadedAt,
    }));
    res.json({ skills, total: skills.length });
  });

  // Get a single skill (with content)
  router.get("/api/skills/:id", (req: Request, res: Response) => {
    const reg = getRegistry(res);
    if (!reg) return;
    const entry = reg.get(req.params.id as string);
    if (!entry) { res.status(404).json({ error: "Skill not found" }); return; }
    res.json({
      ...entry.skill,
      enabled: entry.enabled,
      loadedAt: entry.loadedAt,
    });
  });

  // Enable a skill
  router.post("/api/skills/:id/enable", (req: Request, res: Response) => {
    const reg = getRegistry(res);
    if (!reg) return;
    const ok = reg.enable(req.params.id as string);
    res.json({ success: ok });
  });

  // Disable a skill
  router.post("/api/skills/:id/disable", (req: Request, res: Response) => {
    const reg = getRegistry(res);
    if (!reg) return;
    const ok = reg.disable(req.params.id as string);
    res.json({ success: ok });
  });

  // Invoke a skill (returns the prompt content)
  router.post("/api/skills/:id/invoke", (req: Request, res: Response) => {
    const reg = getRegistry(res);
    if (!reg) return;
    const result = reg.invoke(req.params.id as string);
    if (!result) { res.status(404).json({ error: "Skill not found or disabled" }); return; }
    res.json(result);
  });

  return router;
}
