/**
 * Plan Mode — Read-only planning before execution.
 *
 * When activated (/plan command), the agent:
 *   1. Analyzes the request using read-only tools (file_read, grep, glob)
 *   2. Generates a step-by-step implementation plan as markdown
 *   3. Presents the plan for user review
 *   4. User can approve, edit, or reject before execution
 *
 * The plan is stored as a structured object so it can be:
 *   - Displayed as an interactive checklist in VS Code
 *   - Edited by the user before approval
 *   - Executed step-by-step with progress tracking
 *
 * Learning note: Plan mode is a form of "chain of thought" for the AI.
 * By forcing the agent to plan before acting, it produces better results
 * and gives the user a chance to course-correct before any files change.
 */

export { PlanManager, type Plan, type PlanStep, type PlanStatus } from "./manager";
