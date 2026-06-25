import { NextResponse } from "next/server";
import { runCodexInvestmentAgent } from "@/lib/codex-agent";
import { writeHistory } from "@/lib/history";
import { getSession, updateLatestRecommendation } from "@/lib/session-store";
import type { AnalysisHistoryRecord } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  const body = (await request.json()) as { sessionId?: string };
  const session = getSession(body.sessionId);

  if (!session) {
    return NextResponse.json({ error: "활성 세션이 없습니다." }, { status: 404 });
  }

  try {
    const result = await runCodexInvestmentAgent(session);
    const epochSeconds = Math.floor(Date.now() / 1000);
    const record: AnalysisHistoryRecord = {
      kind: "analysis",
      epochSeconds,
      createdAt: new Date(epochSeconds * 1000).toISOString(),
      sessionId: session.id,
      recommendation: result.recommendation,
      rawAssistantMessage: result.rawAssistantMessage,
      diagnostics: result.diagnostics,
    };
    const historyFile = await writeHistory(record);
    const redactedSession = updateLatestRecommendation(
      session.id,
      result.recommendation,
      historyFile,
    );

    return NextResponse.json({
      recommendation: result.recommendation,
      historyFile,
      session: redactedSession,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Codex 실행에 실패했습니다.",
      },
      { status: 500 },
    );
  }
}
