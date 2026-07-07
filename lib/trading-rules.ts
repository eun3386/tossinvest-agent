import type {
  AgentRecommendation,
  ChecklistFlags,
  ChecklistScore,
  RiskFlag,
  TradeAction,
  ValidationOverride,
  ValidationResult,
} from "@/lib/types";

// 운용 기준에 맞게 조정 필요. 사용자 지침 원문에는 구체적 숫자가 없었던 항목은
// 보수적인 기본값을 넣어뒀다 (시총/거래대금 하한, 급등률 상한).
export const TRADING_THRESHOLDS = {
  MIN_CONFIDENCE: 0.65,
  MIN_SELL_CONDITION_COUNT: 2,
  MAX_BUY_PCT_OF_AVAILABLE_CASH: 10,
  MAX_POSITION_PCT_OF_PORTFOLIO: 15,
  // 아래 4개는 "신규 발굴 종목" 사전 필터 기준 (KR 시장에만 적용). 기본값 — 조정 필요.
  PREFILTER_MIN_MARKET_CAP_KRW: 300_000_000_000,
  PREFILTER_MIN_AVG_TRADE_VALUE_20D_KRW: 3_000_000_000,
  PREFILTER_MAX_RETURN_20D_PCT: 60,
  PREFILTER_MAX_RETURN_5D_PCT: 30,
} as const;

export function describeThresholdsForPrompt(): string {
  const t = TRADING_THRESHOLDS;
  return `- confidence는 ${t.MIN_CONFIDENCE} 이상만 BUY/SELL 후보로 인정한다.
- SELL은 실적/뉴스/추세/거래량 중 ${t.MIN_SELL_CONDITION_COUNT}개 이상 충족해야 검토 가능하다.
- BUY 제안 금액은 주문 가능 금액의 ${t.MAX_BUY_PCT_OF_AVAILABLE_CASH}% 이하, 매수 후 종목 누적 비중은 포트폴리오의 ${t.MAX_POSITION_PCT_OF_PORTFOLIO}% 이하여야 한다.
- 신규 발굴 종목(KR)은 시가총액 ${t.PREFILTER_MIN_MARKET_CAP_KRW.toLocaleString("ko-KR")}원 이상, 20일 평균 거래대금 ${t.PREFILTER_MIN_AVG_TRADE_VALUE_20D_KRW.toLocaleString("ko-KR")}원 이상, 20일 급등률 ${t.PREFILTER_MAX_RETURN_20D_PCT}% 이하, 5일 급등률 ${t.PREFILTER_MAX_RETURN_5D_PCT}% 이하를 만족해야 한다.`;
}

export type VerifiedUniverseSnapshot = {
  marketCapKrw: number;
  avgTradeValue20dKrw: number;
  return20dPct: number;
  return5dPct: number;
  hasActiveWarning: boolean;
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

  return { passed: reasons.length === 0, reasons };
}

export function evaluateChecklistThreshold(
  action: TradeAction,
  checklist: ChecklistFlags,
  checklistScore: ChecklistScore,
): boolean {
  if (action === "BUY") {
    return (
      checklist.priceSeriesFavorable &&
      checklist.newsDisclosureFavorable &&
      checklistScore.buySeriesCount >= 2
    );
  }
  if (action === "SELL") {
    return checklistScore.sellConditionCount >= TRADING_THRESHOLDS.MIN_SELL_CONDITION_COUNT;
  }
  return true;
}

export type VerifiedPositionSizing = {
  pctOfAvailableCash: number;
  resultingPositionPctOfPortfolio: number;
};

export type ValidationContext = {
  verifiedUniverse?: VerifiedUniverseSnapshot | null;
  verifiedPositionSizing?: VerifiedPositionSizing | null;
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

  if (rec.hardStopTriggered) {
    if (action !== "SELL") {
      action = "SELL";
      addOverride(overrides, "HARD_STOP_OVERRIDE", "하드 손절선 도달 — SELL 강제");
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

    if (
      action !== "HOLD" &&
      !evaluateChecklistThreshold(action, rec.checklist, rec.checklistScore)
    ) {
      forceHold("CHECKLIST_INSUFFICIENT", "체크리스트 임계치 미충족");
    }

    if (action === "BUY" && rec.checklist.recentSpikeCooling) {
      forceHold("CHASE_BUY_BLOCKED", "단기 급등 후 거래량 감소 — 추격매수 금지");
    }

    if (
      action === "BUY" &&
      rec.checklist.isAveragingDown &&
      !rec.checklist.averagingDownAllowed
    ) {
      forceHold("AVERAGING_DOWN_BLOCKED", "손실 중 추가매수 조건 미충족");
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
