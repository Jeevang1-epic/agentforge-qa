import {
  CommandPlanSchema,
  type ConfigCommand,
  type CommandPlan,
} from "@agentforge-qa/schemas";
import { resolve } from "node:path";

export function planCommands(
  configCommands: readonly ConfigCommand[],
  repoRoot: string,
): CommandPlan[] {
  return CommandPlanSchema.array().parse(
    configCommands.map((command) => ({
      id: command.id,
      label: command.label,
      command: command.command,
      args: command.args,
      required: command.required,
      timeoutMs: command.timeoutMs,
      cwd: resolve(repoRoot, command.cwd ?? "."),
    })),
  );
}
