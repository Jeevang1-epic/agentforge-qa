import type { CommandPlan, CommandResult } from "@agentforge-qa/schemas";

import { runCommandPlan, type CommandRunOptions } from "./command-runner.js";

export async function runConfiguredCommands(
  plans: readonly CommandPlan[],
  options: CommandRunOptions,
): Promise<CommandResult[]> {
  const results: CommandResult[] = [];

  for (const plan of plans) {
    results.push(await runCommandPlan(plan, options));
  }

  return results;
}
