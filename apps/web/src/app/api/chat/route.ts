import { NextResponse } from "next/server";
import type { RetentionMode } from "@agent-platform/retention";
import type { ChatRequest } from "@agent-platform/runtime";
import { authorizedJson } from "@/lib/api";
import { getRuntime, requireCurrentUser } from "@/lib/runtime";

export async function POST(request: Request) {
  return authorizedJson("provider:use", async () => {
    const runtime = await getRuntime();
    const user = await requireCurrentUser();
    const contentType = request.headers.get("content-type") ?? "";
    const body = contentType.includes("application/json") ? await request.json() as Record<string, unknown> : Object.fromEntries((await request.formData()).entries());
    const chatRequest: ChatRequest = {
      message: String(body["message"] ?? ""),
      enabledToolIds: body["enabledToolIds"] ? String(body["enabledToolIds"]).split(",").filter(Boolean) : ["mock.read_context"]
    };
    const requestedProviderId = optionalString(body["requestedProviderId"]);
    const requestedModelId = optionalString(body["requestedModelId"]);
    const requestedRetentionMode = optionalString(body["requestedRetentionMode"]);
    if (requestedProviderId) {
      chatRequest.requestedProviderId = requestedProviderId;
    }
    if (requestedModelId) {
      chatRequest.requestedModelId = requestedModelId;
    }
    if (requestedRetentionMode) {
      chatRequest.requestedRetentionMode = requestedRetentionMode as RetentionMode;
    }
    const result = await runtime.runtime.runChat(user, chatRequest);
    return {
      requestId: result.requestId,
      conversationId: result.conversation?.id ?? null,
      policy: result.policy.id,
      events: result.events
    };
  });
}

export async function GET() {
  return NextResponse.json({ error: "Use POST /api/chat" }, { status: 405 });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
