import { countTodayBuyOrders, getTodayBuyOrdersSummaryKrw } from "@/lib/history";
import {
  fetchHeldSymbols,
  fetchPositionLossPct,
  fetchPositionSizingSnapshot,
  fetchUniverseSnapshot,
} from "@/lib/market-data";
import { verifyReferences } from "@/lib/reference-check";
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

// 프리필터/포지션비중/물타기/하드손절/일일한도 독립 검증은 모두 KR 시장에만 적용한다.
// 시가총액(원화)·관리종목 같은 개념이 KR 특화라 US까지 억지로 확장하지 않음 —
// confidence/checklist/circuit breaker처럼 시장 무관 판단은 LLM 자기보고를 그대로 쓴다.
// 다만 "신규 종목 승인 게이트"(보유·관심종목 여부)는 시장과 무관하게 항상 확인한다.
export async function finalizeRecommendation(
  rec: AgentRecommendation,
  session: SessionState,
): Promise<FinalizedRecommendation> {
  const ctx: ValidationContext = {};
  let apiError = false;

  // references 검증은 시장/판단 종류와 무관하게 항상 돌리고, 위 독립 검증과 병렬로 진행한다.
  const referencesPromise = verifyReferences(rec.references);

  // 하드 손절선(KR)과 신규 종목 승인 게이트(시장 무관)를 확인하려면 토큰/계좌가 필요하므로,
  // BUY이거나 KR 시장이면 항상 발급한다.
  if (rec.decision.action === "BUY" || rec.market === "KR") {
    try {
      const token = await issueAccessToken(session.apiKey, session.secretKey);
      const [account] = await getAccounts(token);
      if (!account) throw new Error("no account returned");

      let lossPct: number | null = null;
      if (rec.market === "KR") {
        lossPct = await fetchPositionLossPct(rec.symbol, token, account.accountSeq);
        ctx.verifiedHardStop = { lossPct };
        console.log(
          `[decision-pipeline] ${rec.symbol} 하드 손절선 독립 검증(API로 직접 재계산) 완료`,
          ctx.verifiedHardStop,
        );
      }

      if (rec.decision.action === "BUY") {
        // 신규 종목은 LLM의 isNewCandidate 자기보고를 신뢰하지 않고, 코드가 실제
        // 보유 종목(API)과 사용자가 등록한 관심 종목(세션)을 직접 조회해서 판정한다.
        const held = await fetchHeldSymbols(token, account.accountSeq);
        const approvedUniverse = new Set([
          ...held.map((h) => h.symbol),
          ...session.watchlist,
        ]);
        ctx.isApprovedUniverse = approvedUniverse.has(rec.symbol);
        console.log(
          `[decision-pipeline] ${rec.symbol} 승인 유니버스(보유+관심종목) 독립 검증 완료`,
          { isApprovedUniverse: ctx.isApprovedUniverse },
        );

        if (rec.market === "KR" && rec.order) {
          const proposedAmountKrw = rec.order.quantity * rec.order.limitPrice;
          ctx.verifiedPositionSizing = await fetchPositionSizingSnapshot(
            rec.symbol,
            proposedAmountKrw,
            token,
            account.accountSeq,
          );
          console.log(
            `[decision-pipeline] ${rec.symbol} 포지션 비중 독립 검증(API로 직접 재계산) 완료`,
            ctx.verifiedPositionSizing,
          );

          const dailySummary = await getTodayBuyOrdersSummaryKrw();
          const portfolioTotalValueKrw = ctx.verifiedPositionSizing.portfolioTotalValueKrw;
          ctx.verifiedDailyBuyCap = {
            countAfterThisBuy: dailySummary.count + 1,
            pctOfPortfolioAfterThisBuy:
              portfolioTotalValueKrw > 0
                ? ((dailySummary.totalAmountKrw + proposedAmountKrw) / portfolioTotalValueKrw) * 100
                : 100,
          };
          console.log(
            `[decision-pipeline] 종목 무관 일일 매수 한도 독립 검증(history 재계산) 완료`,
            ctx.verifiedDailyBuyCap,
          );
        }

        if (rec.market === "KR" && rec.universeCheck.isNewCandidate) {
          ctx.verifiedUniverse = await fetchUniverseSnapshot(rec.symbol, token);
          console.log(
            `[decision-pipeline] ${rec.symbol} 신규 후보 프리필터 독립 검증(API로 직접 재계산) 완료`,
            ctx.verifiedUniverse,
          );
        }

        if (rec.market === "KR" && rec.checklist.isAveragingDown) {
          const addOnCountToday = await countTodayBuyOrders(rec.symbol);
          ctx.verifiedAveragingDown = { lossPct, addOnCountToday };
          console.log(
            `[decision-pipeline] ${rec.symbol} 물타기 조건 독립 검증(API+history 재계산) 완료`,
            ctx.verifiedAveragingDown,
          );
        }
      }
    } catch (error) {
      console.warn("[decision-pipeline] independent verification failed", error);
      apiError = true;
    }
  }

  const verifiedReferences = await referencesPromise;

  const recForValidation: AgentRecommendation = {
    ...rec,
    references: verifiedReferences,
    ...(apiError
      ? { dataIntegrity: { ...rec.dataIntegrity, apiError: true } }
      : {}),
  };

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
