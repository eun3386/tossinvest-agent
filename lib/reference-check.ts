import { TRADING_THRESHOLDS } from "@/lib/trading-rules";
import type { AgentReference } from "@/lib/types";

const FETCH_TIMEOUT_MS = 5000;

function isFresh(reference: AgentReference, now: Date): boolean {
  const publishedAt = new Date(reference.publishedAt);
  if (Number.isNaN(publishedAt.getTime())) return false;

  const ageDays = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60 * 24);
  return ageDays <= TRADING_THRESHOLDS.MAX_REFERENCE_AGE_DAYS;
}

async function isReachable(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (tossinvest-agent reference check)" },
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// LLM이 "실제로 조회 성공한 근거만 포함한다"고 자기보고한 references를 그대로 믿지 않고,
// 코드가 직접 fetch해서 살아있는 링크만 통과시키고, 발행 시각도 기준일 이내인지 재확인한다.
// 실패/제외된 항목은 조용히 버리지 않고 로그를 남긴다.
export async function verifyReferences(
  references: AgentReference[],
): Promise<AgentReference[]> {
  if (references.length === 0) return references;

  const now = new Date();
  const results = await Promise.all(
    references.map(async (reference) => ({
      reference,
      reachable: await isReachable(reference.url),
      fresh: isFresh(reference, now),
    })),
  );

  const staleDropped = results
    .filter((r) => r.reachable && !r.fresh)
    .map((r) => `${r.reference.url} (published ${r.reference.publishedAt})`);
  if (staleDropped.length > 0) {
    console.warn(
      `[reference-check] ${TRADING_THRESHOLDS.MAX_REFERENCE_AGE_DAYS}일 초과로 제외된 references`,
      staleDropped,
    );
  }

  const unreachableDropped = results.filter((r) => !r.reachable).map((r) => r.reference.url);
  if (unreachableDropped.length > 0) {
    console.warn("[reference-check] fetch 실패로 제외된 references", unreachableDropped);
  }

  return results.filter((r) => r.reachable && r.fresh).map((r) => r.reference);
}
