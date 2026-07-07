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
    const body = contentType.includes("application/json") ? await request.json() as Record<string, unknown> : await formBody(request);
    const chatRequest: ChatRequest = {
      message: String(body["message"] ?? ""),
      enabledToolIds: stringList(body["enabledToolIds"], ["mock.read_context"])
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
    const confirmedToolIds = stringList(body["confirmedToolIds"], []);
    if (confirmedToolIds.length > 0) {
      chatRequest.confirmedToolIds = confirmedToolIds;
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

async function formBody(request: Request): Promise<Record<string, unknown>> {
  const formData = await request.formData();
  const body = Object.fromEntries(formData.entries()) as Record<string, unknown>;
  const enabledToolIds = formData.getAll("enabledToolIds").flatMap((value) => (typeof value === "string" ? [value] : []));
  const confirmedToolIds = formData.getAll("confirmedToolIds").flatMap((value) => (typeof value === "string" ? [value] : []));
  if (enabledToolIds.length > 0) {
    body["enabledToolIds"] = enabledToolIds;
  }
  if (confirmedToolIds.length > 0) {
    body["confirmedToolIds"] = confirmedToolIds;
  }
  return body;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value)) {
    const values = value.flatMap((item) => (typeof item === "string" && item.length > 0 ? [item] : []));
    return values.length > 0 ? values : fallback;
  }
  if (typeof value === "string" && value.length > 0) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return fallback;
}
