import type {
  AgentRecommendation,
  ChecklistFlags,
  RiskFlag,
  TradeAction,
  ValidationOverride,
  ValidationResult,
} from "@/lib/types";

// 운용 기준에 맞게 조정 필요.
export const TRADING_THRESHOLDS = {
  MIN_CONFIDENCE: 0.65,
  MIN_SELL_CONDITION_COUNT: 2,
  MAX_BUY_PCT_OF_AVAILABLE_CASH: 10,
  MAX_POSITION_PCT_OF_PORTFOLIO: 15,
  // 아래 4개는 "신규 발굴 종목" 사전 필터 기준 (KR 시장에만 적용).
  PREFILTER_MIN_MARKET_CAP_KRW: 500_000_000_000,
  PREFILTER_MIN_AVG_TRADE_VALUE_20D_KRW: 3_000_000_000,
  PREFILTER_MAX_RETURN_20D_PCT: 30,
  PREFILTER_MAX_RETURN_5D_PCT: 20,
  PREFILTER_MIN_MONTHS_LISTED: 6,
  // 물타기(손실 중 추가매수) 허용 기준 (KR 시장에만 적용). 손실이 이 값보다 깊어지면
  // (더 음수면) 반등 근거와 무관하게 무조건 차단, 그보다 얕은 손실 구간에서는 LLM의
  // 반등 근거 판단(checklist.averagingDownAllowed)을 참고한다.
  AVERAGING_DOWN_MAX_LOSS_PCT: -10,
  AVERAGING_DOWN_MAX_ADD_ONS_PER_DAY: 1,
  // 하드 손절선(KR 시장에만 적용) — LLM 자기보고(hardStopTriggered)를 신뢰하지 않고
  // 코드가 보유 손실률을 직접 계산해서 이 값 이하면 무조건 SELL 강제. 기본값 — 조정 필요.
  HARD_STOP_MAX_LOSS_PCT: -20,
  MAX_REFERENCE_AGE_DAYS: 3,
  // 종목 무관 일일 총 매수 한도 (KR 시장에만 적용). 기본값 — 조정 필요.
  DAILY_MAX_BUY_COUNT: 3,
  DAILY_MAX_BUY_PCT_OF_PORTFOLIO: 20,
} as const;

export function describeThresholdsForPrompt(): string {
  const t = TRADING_THRESHOLDS;
  return `- confidence는 ${t.MIN_CONFIDENCE} 이상만 BUY/SELL 후보로 인정한다.
- SELL은 실적/뉴스/추세/거래량 중 ${t.MIN_SELL_CONDITION_COUNT}개 이상 충족해야 검토 가능하다.
- BUY 제안 금액은 주문 가능 금액의 ${t.MAX_BUY_PCT_OF_AVAILABLE_CASH}% 이하, 매수 후 종목 누적 비중은 포트폴리오의 ${t.MAX_POSITION_PCT_OF_PORTFOLIO}% 이하여야 한다.
- 신규 발굴 종목(KR)은 시가총액 ${t.PREFILTER_MIN_MARKET_CAP_KRW.toLocaleString("ko-KR")}원 이상, 20일 평균 거래대금 ${t.PREFILTER_MIN_AVG_TRADE_VALUE_20D_KRW.toLocaleString("ko-KR")}원 이상, 20일 급등률 ${t.PREFILTER_MAX_RETURN_20D_PCT}% 이하, 5일 급등률 ${t.PREFILTER_MAX_RETURN_5D_PCT}% 이하, 상장 후 ${t.PREFILTER_MIN_MONTHS_LISTED}개월 이상, 보통주(우선주 제외), 스팩 제외를 만족해야 한다.
- 물타기(KR)는 손실률이 ${t.AVERAGING_DOWN_MAX_LOSS_PCT}%보다 깊어지면 반등 근거와 무관하게 금지고, 당일 추가매수 횟수가 ${t.AVERAGING_DOWN_MAX_ADD_ONS_PER_DAY}회 이상이면 금지다.
- 하드 손절선(KR)은 손실률 ${t.HARD_STOP_MAX_LOSS_PCT}% 이하 도달 시 판단과 무관하게 코드가 SELL을 강제한다.
- references는 발행/게시 시각(publishedAt) 기준 ${t.MAX_REFERENCE_AGE_DAYS}일보다 오래된 자료면 판단 근거로 인정하지 않는다.
- 종목과 무관하게 하루 총 매수는 ${t.DAILY_MAX_BUY_COUNT}회 이하, 하루 매수 총액은 포트폴리오의 ${t.DAILY_MAX_BUY_PCT_OF_PORTFOLIO}% 이하여야 한다.`;
}

export type VerifiedUniverseSnapshot = {
  marketCapKrw: number;
  avgTradeValue20dKrw: number;
  return20dPct: number;
  return5dPct: number;
  hasActiveWarning: boolean;
  isCommonShare: boolean;
  monthsListed: number | null; // null이면 상장일 정보 없음(체크 생략)
  isLikelySpac: boolean;
};

export function passesPreFilter(
  input: VerifiedUniverseSnapshot,
): { passed: boolean; reasons: string[] } {
  const t = TRADING_THRESHOLDS;
  const reasons: string[] = [];

  if (input.marketCapKrw < t.PREFILTER_MIN_MARKET_CAP_KRW) {
    reasons.push(
      `시가총액 ${input.marketCapKrw.toLocaleString("ko-KR")}원 < 기준 ${t.PREFILTER_MIN_MARKET_CAP_KRW.toLocaleString("ko-KR")}원`,
    );
  }
  if (input.avgTradeValue20dKrw < t.PREFILTER_MIN_AVG_TRADE_VALUE_20D_KRW) {
    reasons.push(
      `20일 평균 거래대금 ${input.avgTradeValue20dKrw.toLocaleString("ko-KR")}원 < 기준 ${t.PREFILTER_MIN_AVG_TRADE_VALUE_20D_KRW.toLocaleString("ko-KR")}원`,
    );
  }
  if (input.return20dPct > t.PREFILTER_MAX_RETURN_20D_PCT) {
    reasons.push(`20일 급등률 ${input.return20dPct}% > 기준 ${t.PREFILTER_MAX_RETURN_20D_PCT}%`);
  }
  if (input.return5dPct > t.PREFILTER_MAX_RETURN_5D_PCT) {
    reasons.push(`5일 급등률 ${input.return5dPct}% > 기준 ${t.PREFILTER_MAX_RETURN_5D_PCT}%`);
  }
  if (input.hasActiveWarning) {
    reasons.push("관리종목/투자경고/투자위험/정리매매 중 하나 이상 활성");
  }
  if (!input.isCommonShare) {
    reasons.push("보통주가 아님(우선주 등)");
  }
  if (input.isLikelySpac) {
    reasons.push("스팩(기업인수목적회사)으로 추정됨");
  }
  if (input.monthsListed !== null && input.monthsListed < t.PREFILTER_MIN_MONTHS_LISTED) {
    reasons.push(`상장 ${input.monthsListed}개월 < 기준 ${t.PREFILTER_MIN_MONTHS_LISTED}개월`);
  }

  return { passed: reasons.length === 0, reasons };
}

// checklistScore(개수)는 LLM 자기보고라 신뢰하지 않는다. 실제 개별 boolean에서
// 코드가 직접 재계산한 개수만 임계치 판정에 사용한다.
function countSellConditions(checklist: ChecklistFlags): number {
  return [
    checklist.earningsDeteriorated,
    checklist.negativeNewsDisclosure,
    checklist.trendBroken,
    checklist.volumeWeakening,
  ].filter(Boolean).length;
}

export function evaluateChecklistThreshold(
  action: TradeAction,
  checklist: ChecklistFlags,
): boolean {
  if (action === "BUY") {
    return checklist.priceSeriesFavorable && checklist.newsDisclosureFavorable;
  }
  if (action === "SELL") {
    return countSellConditions(checklist) >= TRADING_THRESHOLDS.MIN_SELL_CONDITION_COUNT;
  }
  return true;
}

export type VerifiedPositionSizing = {
  pctOfAvailableCash: number;
  resultingPositionPctOfPortfolio: number;
  portfolioTotalValueKrw: number;
};

export type VerifiedDailyBuyCap = {
  countAfterThisBuy: number;
  pctOfPortfolioAfterThisBuy: number;
};

export type VerifiedAveragingDown = {
  lossPct: number | null; // null이면 보유 포지션을 찾지 못함(신규 매수와 동일하게 취급)
  addOnCountToday: number;
};

export type VerifiedHardStop = {
  lossPct: number | null; // null이면 보유 중이 아니거나 조회 실패 — 하드 손절 미발동
};

export type ValidationContext = {
  verifiedUniverse?: VerifiedUniverseSnapshot | null;
  verifiedPositionSizing?: VerifiedPositionSizing | null;
  verifiedAveragingDown?: VerifiedAveragingDown | null;
  verifiedHardStop?: VerifiedHardStop | null;
  verifiedDailyBuyCap?: VerifiedDailyBuyCap | null;
  // 코드가 실제 보유 종목 + 세션의 관심 종목 목록에서 직접 확인한 값. LLM의
  // universeCheck.isNewCandidate 자기보고는 이 판정에 쓰지 않는다.
  isApprovedUniverse?: boolean;
};

function addOverride(
  overrides: ValidationOverride[],
  code: RiskFlag,
  message: string,
) {
  overrides.push({ code, message });
}

export function validateDecision(
  rec: AgentRecommendation,
  ctx: ValidationContext = {},
): ValidationResult {
  const overrides: ValidationOverride[] = [];
  let action: TradeAction = rec.decision.action;

  const forceHold = (code: RiskFlag, message: string) => {
    if (action !== "HOLD") {
      action = "HOLD";
      addOverride(overrides, code, message);
    }
  };

  // 하드 손절선은 LLM 자기보고(rec.hardStopTriggered)를 신뢰하지 않는다. 코드가
  // 독립적으로 계산한 손실률로만 판단하며, 독립 데이터가 없으면(예: US, 미보유) 발동하지 않는다.
  const hardStopLossPct = ctx.verifiedHardStop?.lossPct ?? null;
  const hardStopHit =
    hardStopLossPct !== null && hardStopLossPct <= TRADING_THRESHOLDS.HARD_STOP_MAX_LOSS_PCT;

  if (hardStopHit) {
    if (action !== "SELL") {
      action = "SELL";
      addOverride(
        overrides,
        "HARD_STOP_OVERRIDE",
        `손실률 ${hardStopLossPct}%가 하드 손절선 ${TRADING_THRESHOLDS.HARD_STOP_MAX_LOSS_PCT}% 이하 — 판단과 무관하게 SELL 강제`,
      );
    }
  } else {
    if (
      action === "BUY" &&
      (rec.marketCircuitBreaker.newBuySuspended ||
        rec.marketCircuitBreaker.indexCrash ||
        rec.marketCircuitBreaker.viTriggered)
    ) {
      forceHold("CIRCUIT_BREAKER_ACTIVE", "시장 서킷브레이커/VI 발동 중 — 신규 매수 중단");
    }

    if (action !== "HOLD" && rec.dataIntegrity.apiError) {
      forceHold("DATA_MISSING", "API 오류로 데이터 무결성을 확인할 수 없음");
    }
    if (action !== "HOLD" && rec.dataIntegrity.dataMissingFields.length > 0) {
      forceHold(
        "DATA_MISSING",
        `필수 데이터 누락: ${rec.dataIntegrity.dataMissingFields.join(", ")}`,
      );
    }
    if (action === "BUY" && rec.dataIntegrity.newsDisclosureConflict) {
      forceHold("NEWS_DISCLOSURE_CONFLICT", "뉴스와 공시 내용 상충 — 보수적으로 HOLD");
    }

    if (action !== "HOLD" && rec.decision.confidence < TRADING_THRESHOLDS.MIN_CONFIDENCE) {
      forceHold(
        "LOW_CONFIDENCE",
        `confidence ${rec.decision.confidence} < 기준 ${TRADING_THRESHOLDS.MIN_CONFIDENCE}`,
      );
    }

    if (action !== "HOLD" && !evaluateChecklistThreshold(action, rec.checklist)) {
      forceHold("CHECKLIST_INSUFFICIENT", "체크리스트 임계치 미충족");
    }

    if (action === "BUY" && rec.checklist.recentSpikeCooling) {
      forceHold("CHASE_BUY_BLOCKED", "단기 급등 후 거래량 감소 — 추격매수 금지");
    }

    // 보유 종목·관심 종목이 아닌 심볼은 사용자가 관심 종목으로 승인하기 전까지 매수
    // 대상이 될 수 없다. ctx.isApprovedUniverse가 없으면(계산 실패) 보수적으로 차단한다.
    if (action === "BUY" && !ctx.isApprovedUniverse) {
      forceHold(
        "NEW_CANDIDATE_PENDING_APPROVAL",
        "보유/관심 종목이 아닌 신규 발굴 후보 — 관심 종목으로 등록해 승인해야 매수 검토 가능",
      );
    }

    if (action === "BUY" && rec.checklist.isAveragingDown) {
      const verified = ctx.verifiedAveragingDown;
      const deepLoss =
        verified?.lossPct != null &&
        verified.lossPct <= TRADING_THRESHOLDS.AVERAGING_DOWN_MAX_LOSS_PCT;
      const tooManyAddOns =
        verified != null &&
        verified.addOnCountToday >= TRADING_THRESHOLDS.AVERAGING_DOWN_MAX_ADD_ONS_PER_DAY;

      if (deepLoss) {
        forceHold(
          "AVERAGING_DOWN_BLOCKED",
          `손실률 ${verified?.lossPct}%가 하한 ${TRADING_THRESHOLDS.AVERAGING_DOWN_MAX_LOSS_PCT}% 이하 — 반등 근거와 무관하게 물타기 금지`,
        );
      } else if (tooManyAddOns) {
        forceHold(
          "AVERAGING_DOWN_BLOCKED",
          `당일 추가매수 ${verified?.addOnCountToday}회로 한도(${TRADING_THRESHOLDS.AVERAGING_DOWN_MAX_ADD_ONS_PER_DAY}회) 도달`,
        );
      } else if (!rec.checklist.averagingDownAllowed) {
        // 손실이 얕은 구간(또는 독립 검증 불가한 US 시장)에서는 LLM의 반등 근거 판단을 참고한다.
        forceHold("AVERAGING_DOWN_BLOCKED", "손실 중 추가매수 조건 미충족 (반등 근거 판단 기준)");
      }
    }

    if (action === "BUY" && ctx.verifiedUniverse) {
      const result = passesPreFilter(ctx.verifiedUniverse);
      if (!result.passed) {
        forceHold("PREFILTER_FAILED", `사전 필터 미충족: ${result.reasons.join("; ")}`);
      }
    }

    if (action === "BUY" && ctx.verifiedPositionSizing) {
      const { pctOfAvailableCash, resultingPositionPctOfPortfolio } =
        ctx.verifiedPositionSizing;
      if (
        pctOfAvailableCash > TRADING_THRESHOLDS.MAX_BUY_PCT_OF_AVAILABLE_CASH ||
        resultingPositionPctOfPortfolio > TRADING_THRESHOLDS.MAX_POSITION_PCT_OF_PORTFOLIO
      ) {
        forceHold(
          "POSITION_LIMIT_EXCEEDED",
          `주문가능금액 대비 ${pctOfAvailableCash.toFixed(1)}%, 포트폴리오 비중 ${resultingPositionPctOfPortfolio.toFixed(1)}% (기준 ${TRADING_THRESHOLDS.MAX_BUY_PCT_OF_AVAILABLE_CASH}% / ${TRADING_THRESHOLDS.MAX_POSITION_PCT_OF_PORTFOLIO}%)`,
        );
      }
    }

    if (action === "BUY" && ctx.verifiedDailyBuyCap) {
      const { countAfterThisBuy, pctOfPortfolioAfterThisBuy } = ctx.verifiedDailyBuyCap;
      if (
        countAfterThisBuy > TRADING_THRESHOLDS.DAILY_MAX_BUY_COUNT ||
        pctOfPortfolioAfterThisBuy > TRADING_THRESHOLDS.DAILY_MAX_BUY_PCT_OF_PORTFOLIO
      ) {
        forceHold(
          "DAILY_BUY_LIMIT_EXCEEDED",
          `이 매수 반영 시 오늘 매수 ${countAfterThisBuy}회, 포트폴리오 대비 ${pctOfPortfolioAfterThisBuy.toFixed(1)}% (기준 ${TRADING_THRESHOLDS.DAILY_MAX_BUY_COUNT}회 / ${TRADING_THRESHOLDS.DAILY_MAX_BUY_PCT_OF_PORTFOLIO}% 이하)`,
        );
      }
    }
  }

  if (action === rec.decision.action) {
    return { decision: rec, overridden: false, overrides: [] };
  }

  const overrideNote = overrides.map((o) => o.message).join(" / ");
  const decision: AgentRecommendation = {
    ...rec,
    decision: {
      ...rec.decision,
      action,
      reason: `[코드 override: ${action}] ${overrideNote}\n\n원본 LLM 판단: ${rec.decision.reason}`,
    },
    order: action === "HOLD" ? null : rec.order,
    riskFlags: Array.from(new Set([...rec.riskFlags, ...overrides.map((o) => o.code)])),
  };

  return { decision, overridden: true, overrides };
}
