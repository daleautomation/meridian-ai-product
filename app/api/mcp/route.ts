// Meridian AI — MCP HTTP transport.
//
// Single JSON-RPC-style endpoint that mirrors the MCP wire protocol over
// HTTP. Clients POST { method, params } and receive { ok, result | error }.
// Supported methods:
//   - tools/list           → returns tool metadata
//   - tools/call           → { name, arguments } executes a registered tool
//
// Auth: dual mode.
//   - Session cookie (existing auth flow) — for in-app UI calls.
//   - x-mcp-key header matching MCP_SECRET — for CLI / agent callers.
// If neither is present, returns 401 JSON (never redirect).

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { callTool, hasTool, listTools } from "@/lib/mcp/registry";

type RpcRequest =
  | { method: "tools/list"; params?: Record<string, unknown> }
  | { method: "tools/call"; params: { name: string; arguments?: unknown } };

async function authorize(req: NextRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = process.env.MCP_SECRET;
  if (secret) {
    const presented = req.headers.get("x-mcp-key");
    if (presented && presented === secret) return { ok: true };
  }
  const user = await getSession();
  if (user) return { ok: true };
  return { ok: false, reason: "unauthorized" };
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  return NextResponse.json({
    ok: true,
    server: "meridian-mcp",
    version: "0.1.0",
    tools: listTools(),
  });
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: RpcRequest;
  try {
    body = (await req.json()) as RpcRequest;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || !("method" in body)) {
    return NextResponse.json(
      { ok: false, error: "missing_method" },
      { status: 400 }
    );
  }

  if (body.method === "tools/list") {
    return NextResponse.json({ ok: true, result: { tools: listTools() } });
  }

  if (body.method === "tools/call") {
    const { name, arguments: args } = body.params ?? { name: "", arguments: {} };
    if (!name || !hasTool(name)) {
      return NextResponse.json(
        { ok: false, error: `unknown_tool:${name}` },
        { status: 404 }
      );
    }
    const result = await callTool(name, args ?? {});
    const status = result.error ? 200 : 200; // tool-level errors are in payload
    return NextResponse.json({ ok: true, result }, { status });
  }

  return NextResponse.json(
    { ok: false, error: `unknown_method:${(body as { method: string }).method}` },
    { status: 400 }
  );
}
