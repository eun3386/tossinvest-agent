export type Market = "KR" | "US";
export type TradeAction = "BUY" | "SELL" | "HOLD";
export type Currency = "KRW" | "USD";

export type AgentReference = {
  title: string;
  url: string;
  reason: string;
};

export type AgentOrder = {
  quantity: number;
  limitPrice: number;
  currency: Currency;
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
};

export type SessionState = {
  id: string;
  createdAt: string;
  apiKey: string;
  secretKey: string;
  instructions: string;
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
