import { NextResponse } from "next/server";
import { createSession, getSession, redactSession } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = getSession();
  return NextResponse.json({
    session: session ? redactSession(session) : null,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    apiKey?: string;
    secretKey?: string;
    instructions?: string;
    intervalSeconds?: number;
  };

  const apiKey = body.apiKey?.trim() || "";
  const secretKey = body.secretKey?.trim() || "";

  if (!apiKey || !secretKey) {
    return NextResponse.json(
      { error: "API Key와 Secret Key가 필요합니다." },
      { status: 400 },
    );
  }

  const intervalSeconds = Math.max(
    30,
    Math.min(3600, Number(body.intervalSeconds || 60)),
  );

  const session = createSession({
    apiKey,
    secretKey,
    instructions: body.instructions || "",
    intervalSeconds,
  });

  return NextResponse.json({ session });
}
