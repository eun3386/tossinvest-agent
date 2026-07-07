import { NextResponse } from "next/server";
import { addToWatchlist } from "@/lib/session-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId?: string; symbol?: string };
  const symbol = body.symbol?.trim();

  if (!body.sessionId || !symbol) {
    return NextResponse.json(
      { error: "sessionId와 symbol이 필요합니다." },
      { status: 400 },
    );
  }

  const session = addToWatchlist(body.sessionId, symbol);
  if (!session) {
    return NextResponse.json({ error: "활성 세션이 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ session });
}
