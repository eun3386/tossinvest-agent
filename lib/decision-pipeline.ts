import { fetchPositionSizingSnapshot, fetchUniverseSnapshot } from "@/lib/market-data";
import { getAccounts, issueAccessToken } from "@/lib/tossinvest";
import { validateDecision } from "@/lib/trading-rules";
import type {
  AgentRecommendation,
  SessionState,
  ValidationOverride,
} from "@/lib/types";
import type { ValidationContext } from "@/lib/trading-rules";

export type FinalizedRecommendation = {
  recommendation: AgentRecommendation;
  llmRecommendation: AgentRecommendation;
  overridden: boolean;
  overrides: ValidationOverride[];
};

// 프리필터/포지션비중 독립 검증은 KR 시장에만 적용한다. 시가총액(원화)·관리종목 같은
// 개념이 KR 특화라 US까지 억지로 확장하지 않음 — confidence/checklist/circuit
// breaker/hard-stop 검증은 시장 구분 없이 그대로 적용된다.
export async function finalizeRecommendation(
  rec: AgentRecommendation,
  session: SessionState,
): Promise<FinalizedRecommendation> {
  const ctx: ValidationContext = {};
  let apiError = false;

  if (rec.decision.action === "BUY" && rec.market === "KR") {
    try {
      const token = await issueAccessToken(session.apiKey, session.secretKey);
      const [account] = await getAccounts(token);
      if (!account) throw new Error("no account returned");

      if (rec.order) {
        const proposedAmountKrw = rec.order.quantity * rec.order.limitPrice;
        ctx.verifiedPositionSizing = await fetchPositionSizingSnapshot(
          rec.symbol,
          proposedAmountKrw,
          token,
          account.accountSeq,
        );
      }

      if (rec.universeCheck.isNewCandidate) {
        ctx.verifiedUniverse = await fetchUniverseSnapshot(rec.symbol, token);
      }
    } catch (error) {
      console.warn("[decision-pipeline] independent verification failed", error);
      apiError = true;
    }
  }

  const recForValidation = apiError
    ? { ...rec, dataIntegrity: { ...rec.dataIntegrity, apiError: true } }
    : rec;

  const result = validateDecision(recForValidation, ctx);

  if (result.overridden) {
    console.warn("[decision-override]", {
      symbol: rec.symbol,
      market: rec.market,
      llmAction: rec.decision.action,
      finalAction: result.decision.decision.action,
      overrides: result.overrides,
    });
  }

  return {
    recommendation: result.decision,
    llmRecommendation: rec,
    overridden: result.overridden,
    overrides: result.overrides,
  };
}
