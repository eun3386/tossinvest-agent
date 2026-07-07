"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  KeyRound,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type {
  AgentRecommendation,
  Currency,
  HistoryRecord,
  TradeAction,
  ValidationOverride,
} from "@/lib/types";
import { formatPercent } from "@/lib/utils";

type SessionView = {
  id: string;
  createdAt: string;
  instructions: string;
  watchlist: string[];
  intervalSeconds: number;
  latestRecommendation: AgentRecommendation | null;
  latestHistoryFile: string | null;
};

type HistoryEntry = {
  file: string;
  record: HistoryRecord;
};

const defaultInstructions = `- 투자 대상은 보유 종목과 (아래 "관심 종목" 입력란에 등록한) 관심 종목을 우선한다. 신규 종목을 임의로 발굴할 경우 시가총액, 거래대금, 최근 급등 여부, 관리/투자경고 지정 여부를 확인해서 checklist/universeCheck에 사실대로 보고한다. 기준 충족 여부는 시스템이 코드로 재검증한다.
- 판단 전 내부 체크리스트를 먼저 채운다. BUY는 시세 계열(현재가/호가/체결/차트/거래량)과 정보 계열(뉴스/공시/리포트) 양쪽에서 우호적 근거가 동시에 확인될 때만 검토한다.
- SELL은 손실률만으로 판단하지 않는다. 실적 악화, 악재성 뉴스/공시, 추세 훼손, 거래량 약화 등 여러 근거가 함께 확인될 때만 검토한다.
- 근거가 약하거나 체크리스트가 불충분하면 BUY/SELL 대신 HOLD한다. 구체적인 confidence·체크리스트 수치 기준은 시스템이 자동으로 강제한다.
- 데이터 오류, 필수 데이터 누락, 뉴스와 공시의 충돌이 있으면 공시를 우선하고 보수적으로 HOLD한다.
- 단기 급등 후 거래량이 식으면 추격 매수를 금지한다.
- 손실 중인 종목의 추가 매수는 명확한 반등 근거가 있고 당일 추가매수 횟수와 기존 비중이 과도하지 않을 때만 허용한다.
- BUY 제안 금액과 매수 후 종목 누적 비중의 구체적인 한도는 시스템이 자동으로 강제하므로, 여기서는 보수적으로 제안한다.
- 시장 급락, VI 발동, 명확한 시스템 리스크가 있으면 신규 매수를 중단하고 HOLD를 우선한다.
- references에는 실제 조회에 성공했고 판단에 사용한 뉴스, 공시, 리포트, 시장 데이터만 포함한다. 오래된 뉴스나 확인 실패 링크는 제외한다.`;

// Temporary safety switch while live order submission is paused.
const orderButtonsEnabled = false;

function actionVariant(action: TradeAction) {
  if (action === "BUY") return "buy";
  if (action === "SELL") return "sell";
  return "hold";
}

function actionLabel(action: TradeAction) {
  if (action === "BUY") return "BUY";
  if (action === "SELL") return "SELL";
  return "HOLD";
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function getRecordTitle(entry: HistoryEntry) {
  if (entry.record.kind === "analysis") {
    const rec = entry.record.recommendation;
    return `${rec.symbol} ${rec.decision.action}`;
  }
  return `${entry.record.request.symbol} ${entry.record.request.side} 주문`;
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-b-0 sm:grid-cols-[150px_1fr]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0 break-words text-sm">{value}</div>
    </div>
  );
}

function PrettyValue({ value }: { value: unknown }) {
  if (value == null) return <span className="text-muted-foreground">없음</span>;
  if (typeof value === "string" || typeof value === "number") {
    return <span>{String(value)}</span>;
  }
  if (typeof value === "boolean") {
    return <span>{value ? "true" : "false"}</span>;
  }
  return (
    <div className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-5">
      {JSON.stringify(value, null, 2)}
    </div>
  );
}

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [instructions, setInstructions] = useState(defaultInstructions);
  const [watchlist, setWatchlist] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(60);
  const [session, setSession] = useState<SessionView | null>(null);
  const [recommendation, setRecommendation] =
    useState<AgentRecommendation | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [status, setStatus] = useState("대기 중");
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [ordering, setOrdering] = useState<"BUY" | "SELL" | null>(null);
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [currency, setCurrency] = useState<Currency>("KRW");
  const [countdown, setCountdown] = useState(0);
  const [lastOrderResult, setLastOrderResult] = useState<string | null>(null);
  const [overrideInfo, setOverrideInfo] = useState<{
    overridden: boolean;
    overrides: ValidationOverride[];
  } | null>(null);
  const [selectedHistory, setSelectedHistory] = useState<HistoryEntry | null>(
    null,
  );
  const logRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef(false);
  const runAnalysisRef = useRef<(activeSession?: SessionView) => Promise<void>>(
    async () => undefined,
  );

  const canSubmitOrder = useMemo(() => {
    return (
      orderButtonsEnabled &&
      Boolean(session && recommendation) &&
      Number(quantity) > 0 &&
      Number(limitPrice) > 0 &&
      !ordering &&
      !analyzing
    );
  }, [session, recommendation, quantity, limitPrice, ordering, analyzing]);

  const refreshHistory = useCallback(async () => {
    const response = await fetch("/api/history", { cache: "no-store" });
    const body = (await response.json()) as { history: HistoryEntry[] };
    setHistory(body.history);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/history", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { history: HistoryEntry[] }) => {
        if (active) setHistory(body.history);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({
      top: logRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    timerRef.current = null;
    countdownRef.current = null;
    setCountdown(0);
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!selectedHistory) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedHistory(null);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [selectedHistory]);

  const scheduleNextRun = useCallback(
    (activeSession: SessionView) => {
      clearTimers();
      const seconds = activeSession.intervalSeconds || 60;
      setCountdown(seconds);
      countdownRef.current = setInterval(() => {
        setCountdown((current) => Math.max(0, current - 1));
      }, 1000);
      timerRef.current = setTimeout(() => {
        setCountdown(0);
        if (countdownRef.current) clearInterval(countdownRef.current);
        countdownRef.current = null;
        runAnalysisRef.current(activeSession).catch((runError) => {
          setError(runError instanceof Error ? runError.message : String(runError));
          setRunning(false);
          runningRef.current = false;
        });
      }, seconds * 1000);
    },
    [clearTimers],
  );

  const runAnalysis = useCallback(
    async (activeSession?: SessionView) => {
      const currentSession = activeSession || session;
      if (!currentSession || analyzing) return;

      clearTimers();
      setAnalyzing(true);
      setError(null);
      setLastOrderResult(null);
      setOverrideInfo(null);
      setStatus("Codex exec 분석 중");

      try {
        const response = await fetch("/api/agent/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: currentSession.id }),
        });
        const body = (await response.json()) as {
          recommendation?: AgentRecommendation;
          overridden?: boolean;
          overrides?: ValidationOverride[];
          session?: SessionView;
          historyFile?: string;
          error?: string;
        };

        if (!response.ok || !body.recommendation) {
          throw new Error(body.error || "분석 결과를 받지 못했습니다.");
        }

        const nextSession = body.session || currentSession;
        setSession(nextSession);
        setRecommendation(body.recommendation);
        setOverrideInfo({
          overridden: Boolean(body.overridden),
          overrides: body.overrides || [],
        });
        if (body.recommendation.order) {
          setQuantity(String(body.recommendation.order.quantity));
          setLimitPrice(String(body.recommendation.order.limitPrice));
          setCurrency(body.recommendation.order.currency);
        } else {
          setQuantity("");
          setLimitPrice("");
          setCurrency(body.recommendation.market === "US" ? "USD" : "KRW");
        }
        setStatus(`분석 완료: ${body.historyFile || "history 저장됨"}`);
        await refreshHistory();

        if (runningRef.current) scheduleNextRun(nextSession);
      } catch (runError) {
        setError(runError instanceof Error ? runError.message : String(runError));
        setStatus("분석 실패");
        setRunning(false);
        runningRef.current = false;
      } finally {
        setAnalyzing(false);
      }
    },
    [
      analyzing,
      clearTimers,
      refreshHistory,
      scheduleNextRun,
      session,
    ],
  );

  useEffect(() => {
    runAnalysisRef.current = runAnalysis;
  }, [runAnalysis]);

  const [promoting, setPromoting] = useState(false);

  const promoteToWatchlist = useCallback(
    async (symbol: string) => {
      if (!session) return;
      setPromoting(true);
      try {
        const response = await fetch("/api/session/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: session.id, symbol }),
        });
        const body = (await response.json()) as {
          session?: SessionView;
          error?: string;
        };
        if (!response.ok || !body.session) {
          throw new Error(body.error || "관심 종목 등록에 실패했습니다.");
        }
        setSession(body.session);
        setWatchlist(body.session.watchlist.join(", "));
        await runAnalysis(body.session);
      } catch (promoteError) {
        setError(
          promoteError instanceof Error ? promoteError.message : String(promoteError),
        );
      } finally {
        setPromoting(false);
      }
    },
    [session, runAnalysis],
  );

  const createSession = async (): Promise<SessionView | null> => {
    setError(null);
    setStatus("세션 생성 중");

    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey,
        secretKey,
        instructions,
        watchlist: watchlist
          .split(",")
          .map((symbol) => symbol.trim())
          .filter(Boolean),
        intervalSeconds,
      }),
    });
    const body = (await response.json()) as {
      session?: SessionView;
      error?: string;
    };

    if (!response.ok || !body.session) {
      setError(body.error || "세션 생성에 실패했습니다.");
      setStatus("대기 중");
      return null;
    }

    setSession(body.session);
    return body.session;
  };

  const start = async () => {
    clearTimers();
    setLastOrderResult(null);
    const newSession = await createSession();
    if (!newSession) return;

    setRunning(true);
    runningRef.current = true;
    setStatus("시작됨");
    await runAnalysis(newSession);
  };

  // "즉시 분석"은 반복 루프(running)와 무관하게 딱 1회만 실행된다. 세션이 아직
  // 없으면 새로 만들고, 있으면 재사용한다 — runningRef가 false로 유지되는 한
  // runAnalysis 내부에서 다음 자동 실행이 예약되지 않는다.
  const analyzeOnce = async () => {
    clearTimers();
    setLastOrderResult(null);
    const activeSession = session || (await createSession());
    if (!activeSession) return;
    await runAnalysis(activeSession);
  };

  const stop = () => {
    clearTimers();
    setRunning(false);
    runningRef.current = false;
    setAnalyzing(false);
    setStatus("중지됨");
  };

  const submitOrder = async (side: "BUY" | "SELL") => {
    if (!orderButtonsEnabled || !session || !recommendation) return;
    setOrdering(side);
    setError(null);
    setLastOrderResult(null);
    clearTimers();

    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.id,
          symbol: recommendation.symbol,
          market: recommendation.market,
          side,
          quantity,
          limitPrice,
          currency,
        }),
      });
      const body = (await response.json()) as {
        response?: unknown;
        historyFile?: string;
        error?: string;
        detail?: unknown;
      };

      if (!response.ok) {
        throw new Error(
          `${body.error || "주문 실패"} ${
            body.detail ? JSON.stringify(body.detail) : ""
          }`,
        );
      }

      setLastOrderResult(`${side} 주문 요청 완료: ${body.historyFile}`);
      setStatus("주문 기록 저장됨");
      await refreshHistory();
      if (runningRef.current) scheduleNextRun(session);
    } catch (orderError) {
      setError(orderError instanceof Error ? orderError.message : String(orderError));
      setStatus("주문 실패");
      await refreshHistory();
      if (runningRef.current) scheduleNextRun(session);
    } finally {
      setOrdering(null);
    }
  };

  const currentAction = recommendation?.decision.action || "HOLD";

  return (
    <>
      <main className="min-h-screen">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 lg:h-screen lg:flex-row">
        <section className="flex w-full flex-col gap-4 lg:w-[360px] lg:shrink-0">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>투자 에이전트</CardTitle>
                  <CardDescription>Codex exec 기반 주기 분석</CardDescription>
                </div>
                <Activity className="h-5 w-5 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="apiKey"
                    type="password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="secretKey">Secret Key</Label>
                <Input
                  id="secretKey"
                  type="password"
                  value={secretKey}
                  onChange={(event) => setSecretKey(event.target.value)}
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="intervalSeconds">분석 간격</Label>
                <Input
                  id="intervalSeconds"
                  type="number"
                  min={30}
                  max={3600}
                  value={intervalSeconds}
                  onChange={(event) =>
                    setIntervalSeconds(Number(event.target.value || 60))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="watchlist">관심 종목 (쉼표로 구분)</Label>
                <Input
                  id="watchlist"
                  value={watchlist}
                  onChange={(event) => setWatchlist(event.target.value)}
                  placeholder="005930, AAPL"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="instructions">행동지침</Label>
                <Textarea
                  id="instructions"
                  value={instructions}
                  onChange={(event) => setInstructions(event.target.value)}
                  className="min-h-56 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={start}
                  disabled={!apiKey || !secretKey || analyzing}
                  className="flex-1"
                >
                  {analyzing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Play className="h-4 w-4" />
                  )}
                  시작
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={stop}
                  disabled={!running && !analyzing}
                >
                  <Pause className="h-4 w-4" />
                  중지
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="flex min-w-0 flex-1 flex-col gap-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>최신 판단</CardTitle>
                  <CardDescription>{status}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {countdown > 0 ? (
                    <Badge variant="secondary">다음 분석 {countdown}s</Badge>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!apiKey || !secretKey || analyzing}
                    onClick={() => analyzeOnce()}
                  >
                    {analyzing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                    즉시 분석 (1회)
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {error ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </div>
              ) : null}
              {overrideInfo?.overridden ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-medium">
                    ⚠ 코드 검증이 LLM 판단을 override했습니다 ({overrideInfo.overrides.length}건)
                  </div>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    {overrideInfo.overrides.map((o, i) => (
                      <li key={`${o.code}-${i}`}>
                        [{o.code}] {o.message}
                      </li>
                    ))}
                  </ul>
                  {recommendation &&
                  overrideInfo.overrides.some(
                    (o) => o.code === "NEW_CANDIDATE_PENDING_APPROVAL",
                  ) ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={promoting || analyzing}
                      onClick={() => promoteToWatchlist(recommendation.symbol)}
                    >
                      {promoting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      {recommendation.symbol} 관심 종목에 추가하고 재분석
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {lastOrderResult ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  {lastOrderResult}
                </div>
              ) : null}

              {recommendation ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">종목</div>
                      <div className="mt-1 text-xl font-semibold">
                        {recommendation.symbol}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {recommendation.market}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">판단</div>
                      <Badge
                        variant={actionVariant(currentAction)}
                        className="mt-2 text-sm"
                      >
                        {actionLabel(currentAction)}
                      </Badge>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">신뢰도</div>
                      <div className="mt-1 text-xl font-semibold">
                        {formatPercent(recommendation.decision.confidence)}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">통화</div>
                      <div className="mt-1 text-xl font-semibold">{currency}</div>
                    </div>
                  </div>

                  <div className="rounded-md border bg-background p-4">
                    <div className="text-sm font-medium">판단 근거</div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {recommendation.decision.reason}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-full min-w-0 space-y-2 sm:w-40">
                      <Label htmlFor="quantity">수량</Label>
                      <Input
                        id="quantity"
                        type="number"
                        min="0"
                        step={recommendation.market === "US" ? "0.000001" : "1"}
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                        className="h-10 tabular-nums"
                      />
                    </div>
                    <div className="w-full min-w-0 space-y-2 sm:w-44">
                      <Label htmlFor="limitPrice">지정가</Label>
                      <Input
                        id="limitPrice"
                        type="number"
                        min="0"
                        step={recommendation.market === "US" ? "0.0001" : "1"}
                        value={limitPrice}
                        onChange={(event) => setLimitPrice(event.target.value)}
                        className="h-10 tabular-nums"
                      />
                    </div>
                    <div className="w-full space-y-2 sm:w-[142px]">
                      <Label>통화</Label>
                      <div className="grid h-10 grid-cols-2 rounded-md border bg-card p-1">
                        {(["KRW", "USD"] as const).map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setCurrency(value)}
                            className={`rounded-sm px-2 text-sm font-medium transition-colors ${
                              currency === value
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:bg-muted"
                            }`}
                          >
                            {value}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="buy"
                      disabled={!canSubmitOrder}
                      onClick={() => submitOrder("BUY")}
                    >
                      {ordering === "BUY" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowDownToLine className="h-4 w-4" />
                      )}
                      BUY
                    </Button>
                    <Button
                      type="button"
                      variant="sell"
                      disabled={!canSubmitOrder}
                      onClick={() => submitOrder("SELL")}
                    >
                      {ordering === "SELL" ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowUpFromLine className="h-4 w-4" />
                      )}
                      SELL
                    </Button>
                    <Badge variant={actionVariant(currentAction)} className="h-10 px-3">
                      Agent: {currentAction}
                    </Badge>
                  </div>

                  <div className="rounded-md border bg-background p-4">
                    <div className="mb-3 text-sm font-medium">References</div>
                    {recommendation.references.length ? (
                      <div className="space-y-3">
                        {recommendation.references.map((reference, index) => (
                          <a
                            key={`${reference.url}-${index}`}
                            href={reference.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded-md border bg-card p-3 transition-colors hover:bg-muted"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {reference.title}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {reference.reason}
                                </div>
                              </div>
                              <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            </div>
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        참고 링크 없음
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed bg-background text-sm text-muted-foreground">
                  API Key, Secret Key, 행동지침을 입력하고 시작하세요.
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="flex w-full flex-col lg:w-[380px] lg:shrink-0">
          <Card className="flex min-h-[500px] flex-1 flex-col lg:h-full">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle>History Log</CardTitle>
                  <CardDescription>./history JSON 기록</CardDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => refreshHistory()}
                  aria-label="history refresh"
                >
                  <RefreshCcw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="min-h-0 flex-1">
              <div
                ref={logRef}
                className="h-[420px] overflow-y-auto rounded-md border bg-background p-3 lg:h-[calc(100vh-150px)]"
              >
                {history.length ? (
                  <div className="space-y-3">
                    {history.map((entry) => (
                      <button
                        key={entry.file}
                        type="button"
                        onClick={() => setSelectedHistory(entry)}
                        className="w-full rounded-md border bg-card p-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <Badge
                            variant={
                              entry.record.kind === "analysis"
                                ? actionVariant(
                                    entry.record.recommendation.decision.action,
                                  )
                                : "secondary"
                            }
                          >
                            {entry.record.kind}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatTime(entry.record.createdAt)}
                          </span>
                        </div>
                        <div className="mt-2 font-medium">{getRecordTitle(entry)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {entry.file}
                        </div>
                        {entry.record.kind === "analysis" ? (
                          <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                            {entry.record.recommendation.decision.reason}
                          </p>
                        ) : (
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">
                            {entry.record.request.quantity} @{" "}
                            {entry.record.request.limitPrice}{" "}
                            {entry.record.request.currency}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    아직 기록이 없습니다.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          </section>
        </div>
      </main>

      {selectedHistory ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedHistory(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-dialog-title"
            className="flex max-h-[calc(100vh-32px)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border bg-card shadow-xl"
          >
            <div className="flex items-start justify-between gap-3 border-b p-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      selectedHistory.record.kind === "analysis"
                        ? actionVariant(
                            selectedHistory.record.recommendation.decision.action,
                          )
                        : "secondary"
                    }
                  >
                    {selectedHistory.record.kind}
                  </Badge>
                  <h2
                    id="history-dialog-title"
                    className="truncate text-lg font-semibold"
                  >
                    {getRecordTitle(selectedHistory)}
                  </h2>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {selectedHistory.file} · {formatTime(selectedHistory.record.createdAt)}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedHistory(null)}
                aria-label="history modal close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {selectedHistory.record.kind === "analysis" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">종목</div>
                      <div className="mt-1 font-semibold">
                        {selectedHistory.record.recommendation.symbol}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {selectedHistory.record.recommendation.market}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">판단</div>
                      <Badge
                        variant={actionVariant(
                          selectedHistory.record.recommendation.decision.action,
                        )}
                        className="mt-2"
                      >
                        {selectedHistory.record.recommendation.decision.action}
                      </Badge>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">신뢰도</div>
                      <div className="mt-1 font-semibold">
                        {formatPercent(
                          selectedHistory.record.recommendation.decision.confidence,
                        )}
                      </div>
                    </div>
                  </div>

                  <section className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">판단 근거</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {selectedHistory.record.recommendation.decision.reason}
                    </p>
                  </section>

                  {selectedHistory.record.validation ? (
                    <section className="rounded-md border bg-background p-4">
                      <h3 className="text-sm font-semibold">코드 검증</h3>
                      {selectedHistory.record.validation.overridden ? (
                        <div className="mt-2 space-y-2">
                          <div className="text-sm text-amber-800">
                            LLM 원본 판단 {selectedHistory.record.llmRecommendation.decision.action}{" "}
                            → 최종 {selectedHistory.record.recommendation.decision.action} (override됨)
                          </div>
                          <ul className="list-inside list-disc space-y-0.5 text-sm text-muted-foreground">
                            {selectedHistory.record.validation.overrides.map((o, i) => (
                              <li key={`${o.code}-${i}`}>
                                [{o.code}] {o.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-muted-foreground">
                          override 없음 — LLM 판단 그대로 적용
                        </div>
                      )}
                    </section>
                  ) : null}

                  <section className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">주문 제안</h3>
                    {selectedHistory.record.recommendation.order ? (
                      <div className="mt-2">
                        <FieldRow
                          label="수량"
                          value={selectedHistory.record.recommendation.order.quantity}
                        />
                        <FieldRow
                          label="지정가"
                          value={selectedHistory.record.recommendation.order.limitPrice}
                        />
                        <FieldRow
                          label="통화"
                          value={selectedHistory.record.recommendation.order.currency}
                        />
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-muted-foreground">
                        주문 제안 없음
                      </div>
                    )}
                  </section>

                  <section className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">참고 자료</h3>
                    {selectedHistory.record.recommendation.references.length ? (
                      <div className="mt-3 space-y-2">
                        {selectedHistory.record.recommendation.references.map(
                          (reference, index) => (
                            <a
                              key={`${reference.url}-${index}`}
                              href={reference.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block rounded-md border bg-card p-3 transition-colors hover:bg-muted"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">
                                    {reference.title}
                                  </div>
                                  <div className="mt-1 text-xs leading-5 text-muted-foreground">
                                    {reference.reason}
                                  </div>
                                </div>
                                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                              </div>
                            </a>
                          ),
                        )}
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-muted-foreground">
                        참고 자료 없음
                      </div>
                    )}
                  </section>

                  <section className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">실행 진단</h3>
                    <div className="mt-2">
                      <FieldRow
                        label="Exit code"
                        value={selectedHistory.record.diagnostics.exitCode ?? "없음"}
                      />
                      <FieldRow
                        label="Stdout"
                        value={
                          selectedHistory.record.diagnostics.stdout ? (
                            <div className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                              {selectedHistory.record.diagnostics.stdout}
                            </div>
                          ) : (
                            "없음"
                          )
                        }
                      />
                      <FieldRow
                        label="Stderr"
                        value={
                          selectedHistory.record.diagnostics.stderr ? (
                            <div className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                              {selectedHistory.record.diagnostics.stderr}
                            </div>
                          ) : (
                            "없음"
                          )
                        }
                      />
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">종목</div>
                      <div className="mt-1 font-semibold">
                        {selectedHistory.record.request.symbol}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {selectedHistory.record.request.market}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">주문</div>
                      <div className="mt-1 font-semibold">
                        {selectedHistory.record.request.side}
                      </div>
                    </div>
                    <div className="rounded-md border bg-background p-3">
                      <div className="text-xs text-muted-foreground">가격</div>
                      <div className="mt-1 font-semibold">
                        {selectedHistory.record.request.quantity} @{" "}
                        {selectedHistory.record.request.limitPrice}{" "}
                        {selectedHistory.record.request.currency}
                      </div>
                    </div>
                  </div>

                  <section className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">주문 요청</h3>
                    <div className="mt-2">
                      <FieldRow
                        label="종목"
                        value={selectedHistory.record.request.symbol}
                      />
                      <FieldRow
                        label="시장"
                        value={selectedHistory.record.request.market}
                      />
                      <FieldRow
                        label="방향"
                        value={selectedHistory.record.request.side}
                      />
                      <FieldRow
                        label="수량"
                        value={selectedHistory.record.request.quantity}
                      />
                      <FieldRow
                        label="지정가"
                        value={selectedHistory.record.request.limitPrice}
                      />
                      <FieldRow
                        label="통화"
                        value={selectedHistory.record.request.currency}
                      />
                    </div>
                  </section>

                  <section className="rounded-md border bg-background p-4">
                    <h3 className="text-sm font-semibold">주문 응답</h3>
                    <div className="mt-2">
                      <PrettyValue value={selectedHistory.record.response} />
                    </div>
                  </section>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
