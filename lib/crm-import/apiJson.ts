import { NextResponse } from "next/server";

export function jsonError(message: string, status = 500): NextResponse {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export function jsonOk<T extends Record<string, unknown>>(body: T, status = 200): NextResponse {
  return NextResponse.json({ ok: true, ...body }, { status });
}

export async function parseRequestJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
