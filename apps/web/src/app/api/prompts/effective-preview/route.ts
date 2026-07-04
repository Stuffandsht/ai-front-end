import { compileEffectivePolicy } from "@agent-platform/policy";
import { compilePromptStack, loadPromptFragmentSources, renderCompiledPrompt } from "@agent-platform/prompts";
import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function GET() {
  return authorizedJson("prompt:read_effective", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const policy = compileEffectivePolicy(
      {
        deploymentMode: runtime.config.deploymentMode,
        tenantId: runtime.tenant.id,
        userId: user.id,
        groupIds: []
      },
      runtime.policyDocuments,
      runtime.inventory
    );
    const fragments = runtime.db.getPromptFragments(policy.promptFragmentIds);
    const sources = await loadPromptFragmentSources(fragments, (fragment) => runtime.db.readPromptFragmentContent(fragment));
    const prompt = compilePromptStack(sources);
    return {
      compiledHash: prompt.compiledHash,
      fragmentIds: prompt.fragmentIds,
      preview: policy.retentionMode === "ephemeral" ? null : renderCompiledPrompt(prompt)
    };
  });
}
