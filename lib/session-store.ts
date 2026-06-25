import crypto from "node:crypto";
import type { AgentRecommendation, SessionState } from "@/lib/types";

declare global {
  var __tossinvestAgentSession: SessionState | undefined;
}

export function createSession(input: {
  apiKey: string;
  secretKey: string;
  instructions: string;
  intervalSeconds: number;
}) {
  const session: SessionState = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    apiKey: input.apiKey,
    secretKey: input.secretKey,
    instructions: input.instructions,
    intervalSeconds: input.intervalSeconds,
    latestRecommendation: null,
    latestHistoryFile: null,
  };
  globalThis.__tossinvestAgentSession = session;
  return redactSession(session);
}

export function getSession(sessionId?: string) {
  const session = globalThis.__tossinvestAgentSession;
  if (!session) return null;
  if (sessionId && session.id !== sessionId) return null;
  return session;
}

export function updateLatestRecommendation(
  sessionId: string,
  recommendation: AgentRecommendation,
  historyFile: string,
) {
  const session = getSession(sessionId);
  if (!session) return null;
  session.latestRecommendation = recommendation;
  session.latestHistoryFile = historyFile;
  return redactSession(session);
}

export function redactSession(session: SessionState) {
  return {
    id: session.id,
    createdAt: session.createdAt,
    instructions: session.instructions,
    intervalSeconds: session.intervalSeconds,
    latestRecommendation: session.latestRecommendation,
    latestHistoryFile: session.latestHistoryFile,
  };
}
