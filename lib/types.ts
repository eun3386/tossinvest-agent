export type Market = "KR" | "US";
export type TradeAction = "BUY" | "SELL" | "HOLD";
export type Currency = "KRW" | "USD";

export type AgentReference = {
  title: string;
  url: string;
  reason: string;
  publishedAt: string; // ISO date-time, 발행/게시 시각
};

export type AgentOrder = {
  quantity: number;
  limitPrice: number;
  currency: Currency;
};

export type ChecklistFlags = {
  priceSeriesFavorable: boolean;
  newsDisclosureFavorable: boolean;
  earningsDeteriorated: boolean;
  negativeNewsDisclosure: boolean;
  trendBroken: boolean;
  volumeWeakening: boolean;
  recentSpikeCooling: boolean;
  isAveragingDown: boolean;
  averagingDownAllowed: boolean;
};

export type ChecklistScore = {
  buySeriesCount: number;
  sellConditionCount: number;
};

export type UniverseCheck = {
  isNewCandidate: boolean;
  marketCapKrw: number | null;
  avgTradeValue20dKrw: number | null;
  return20dPct: number | null;
  return5dPct: number | null;
};

export type PositionSizingClaim = {
  proposedAmountKrw: number;
  isAddOnPurchase: boolean;
  addOnCountToday: number;
};

export type MarketCircuitBreaker = {
  indexCrash: boolean;
  viTriggered: boolean;
  newBuySuspended: boolean;
};

export type DataIntegrity = {
  apiError: boolean;
  dataMissingFields: string[];
  newsDisclosureConflict: boolean;
};

export type RiskFlag =
  | "STALE_NEWS"
  | "NEWS_DISCLOSURE_CONFLICT"
  | "PREFILTER_FAILED"
  | "LOW_CONFIDENCE"
  | "CHECKLIST_INSUFFICIENT"
  | "AVERAGING_DOWN_BLOCKED"
  | "CHASE_BUY_BLOCKED"
  | "CIRCUIT_BREAKER_ACTIVE"
  | "DATA_MISSING"
  | "HARD_STOP_OVERRIDE"
  | "POSITION_LIMIT_EXCEEDED"
  | "DAILY_BUY_LIMIT_EXCEEDED"
  | "NEW_CANDIDATE_PENDING_APPROVAL";

export type ValidationOverride = {
  code: RiskFlag;
  message: string;
};

export type ValidationResult = {
  decision: AgentRecommendation;
  overridden: boolean;
  overrides: ValidationOverride[];
};

export type AgentRecommendation = {
  symbol: string;
  market: Market;
  decision: {
    action: TradeAction;
    confidence: number;
    reason: string;
  };
  order: AgentOrder | null;
  references: AgentReference[];
  checklist: ChecklistFlags;
  checklistScore: ChecklistScore;
  universeCheck: UniverseCheck;
  positionSizing: PositionSizingClaim | null;
  hardStopTriggered: boolean;
  marketCircuitBreaker: MarketCircuitBreaker;
  dataIntegrity: DataIntegrity;
  riskFlags: RiskFlag[];
};

export type SessionState = {
  id: string;
  createdAt: string;
  apiKey: string;
  secretKey: string;
  instructions: string;
  watchlist: string[];
  intervalSeconds: number;
  latestRecommendation: AgentRecommendation | null;
  latestHistoryFile: string | null;
};

export type AnalysisHistoryRecord = {
  kind: "analysis";
  epochSeconds: number;
  createdAt: string;
  sessionId: string;
  recommendation: AgentRecommendation;
  llmRecommendation: AgentRecommendation;
  validation: {
    overridden: boolean;
    overrides: ValidationOverride[];
  };
  rawAssistantMessage: string;
  diagnostics: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
  };
};

export type OrderHistoryRecord = {
  kind: "order";
  epochSeconds: number;
  createdAt: string;
  sessionId: string;
  request: {
    symbol: string;
    market: Market;
    side: "BUY" | "SELL";
    quantity: string;
    limitPrice: string;
    currency: Currency;
  };
  response: unknown;
};

export type HistoryRecord = AnalysisHistoryRecord | OrderHistoryRecord;
