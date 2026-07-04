import { createHash } from "node:crypto";
import type { PromptFragment } from "@agent-platform/db";

export type PromptScopeType = "service" | "tenant" | "company" | "group" | "user" | "conversation";

export type PromptFragmentSource = {
  id: string;
  scopeType: PromptScopeType;
  name: string;
  content: string;
  priority: number;
  version: number;
};

export type CompiledPrompt = {
  fragmentIds: string[];
  fragmentVersions: number[];
  systemMessages: Array<{
    name: string;
    content: string;
  }>;
  compiledHash: string;
};

export async function loadPromptFragmentSources(
  fragments: PromptFragment[],
  readContent: (fragment: PromptFragment) => Promise<string>
): Promise<PromptFragmentSource[]> {
  const output: PromptFragmentSource[] = [];
  for (const fragment of fragments) {
    output.push({
      id: fragment.id,
      scopeType: fragment.scopeType === "tenant" ? "tenant" : fragment.scopeType,
      name: fragment.name,
      content: await readContent(fragment),
      priority: fragment.priority,
      version: fragment.version
    });
  }
  return output;
}

export function compilePromptStack(fragments: PromptFragmentSource[]): CompiledPrompt {
  const ordered = [...fragments].sort(
    (a, b) => b.priority - a.priority || scopeOrder(a.scopeType) - scopeOrder(b.scopeType) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  const systemMessages = ordered.map((fragment) => ({
    name: fragment.name,
    content: fragment.content
  }));
  const hashInput = ordered.map((fragment) => ({
    id: fragment.id,
    version: fragment.version,
    contentHash: createHash("sha256").update(fragment.content).digest("hex")
  }));
  return {
    fragmentIds: ordered.map((fragment) => fragment.id),
    fragmentVersions: ordered.map((fragment) => fragment.version),
    systemMessages,
    compiledHash: createHash("sha256").update(JSON.stringify(hashInput)).digest("hex")
  };
}

export function renderCompiledPrompt(prompt: CompiledPrompt): string {
  return prompt.systemMessages.map((message) => `[${message.name}]\n${message.content}`).join("\n\n");
}

function scopeOrder(scope: PromptScopeType): number {
  const order: Record<PromptScopeType, number> = {
    service: 0,
    tenant: 1,
    company: 1,
    group: 2,
    user: 3,
    conversation: 4
  };
  return order[scope];
}
