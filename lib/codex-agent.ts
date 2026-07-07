import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchHeldSymbols } from "@/lib/market-data";
import { describeThresholdsForPrompt } from "@/lib/trading-rules";
import { getAccounts, issueAccessToken } from "@/lib/tossinvest";
import type { AgentRecommendation, SessionState } from "@/lib/types";

const codexBin =
  process.env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex";
const apiDocsPath = path.join(process.cwd(), "tossinvest_apidocs.json");
const outputSchemaPath = path.join(
  process.cwd(),
  "schemas",
  "investment-agent-output.schema.json",
);
const historyPath = path.join(process.cwd(), "history");
const runTimeoutMs = 10 * 60 * 1000;

type CodexRunResult = {
  recommendation: AgentRecommendation;
  rawAssistantMessage: string;
  diagnostics: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
  };
};

function trimForHistory(value: string) {
  const maxLength = 40000;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n[truncated ${value.length - maxLength} chars]`;
}

function redact(value: string, session: SessionState) {
  return value
    .replaceAll(session.apiKey, "[REDACTED_TOSSINVEST_API_KEY]")
    .replaceAll(session.secretKey, "[REDACTED_TOSSINVEST_SECRET_KEY]");
}

function stripJsonEnvelope(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1].trim() : trimmed;
}

function assertRecommendation(value: unknown): AgentRecommendation {
  if (!value || typeof value !== "object") {
    throw new Error("Codex output is not a JSON object");
  }

  const candidate = value as AgentRecommendation;
  if (!candidate.symbol || !candidate.market || !candidate.decision) {
    throw new Error("Codex output is missing required decision fields");
  }
  if (typeof candidate.symbol !== "string" || !candidate.symbol.trim()) {
    throw new Error("Codex output has invalid symbol");
  }
  if (!["KR", "US"].includes(candidate.market)) {
    throw new Error("Codex output has invalid market");
  }
  if (!["BUY", "SELL", "HOLD"].includes(candidate.decision.action)) {
    throw new Error("Codex output has invalid decision.action");
  }
  if (
    typeof candidate.decision.confidence !== "number" ||
    candidate.decision.confidence < 0 ||
    candidate.decision.confidence > 1
  ) {
    throw new Error("Codex output has invalid decision.confidence");
  }
  if (
    typeof candidate.decision.reason !== "string" ||
    !candidate.decision.reason.trim()
  ) {
    throw new Error("Codex output has invalid decision.reason");
  }
  if (candidate.order !== null && typeof candidate.order !== "object") {
    throw new Error("Codex output has invalid order");
  }
  if (candidate.decision.action === "HOLD" && candidate.order !== null) {
    throw new Error("Codex output must set order to null for HOLD");
  }
  if (
    (candidate.decision.action === "BUY" || candidate.decision.action === "SELL") &&
    candidate.order === null
  ) {
    throw new Error("Codex output must include order for BUY or SELL");
  }
  if (candidate.order) {
    if (
      typeof candidate.order.quantity !== "number" ||
      candidate.order.quantity <= 0 ||
      typeof candidate.order.limitPrice !== "number" ||
      candidate.order.limitPrice <= 0 ||
      !["KRW", "USD"].includes(candidate.order.currency)
    ) {
      throw new Error("Codex output has invalid order values");
    }
  }
  if (!Array.isArray(candidate.references)) {
    throw new Error("Codex output has invalid references");
  }
  for (const reference of candidate.references) {
    if (
      !reference ||
      typeof reference.title !== "string" ||
      !reference.title.trim() ||
      typeof reference.url !== "string" ||
      !/^https?:\/\//.test(reference.url) ||
      typeof reference.reason !== "string" ||
      !reference.reason.trim() ||
      typeof reference.publishedAt !== "string" ||
      Number.isNaN(new Date(reference.publishedAt).getTime())
    ) {
      throw new Error("Codex output has invalid reference");
    }
  }

  const checklist = candidate.checklist;
  if (!checklist || typeof checklist !== "object") {
    throw new Error("Codex output is missing checklist");
  }
  for (const key of [
    "priceSeriesFavorable",
    "newsDisclosureFavorable",
    "earningsDeteriorated",
    "negativeNewsDisclosure",
    "trendBroken",
    "volumeWeakening",
    "recentSpikeCooling",
    "isAveragingDown",
    "averagingDownAllowed",
  ] as const) {
    if (typeof checklist[key] !== "boolean") {
      throw new Error(`Codex output has invalid checklist.${key}`);
    }
  }

  const checklistScore = candidate.checklistScore;
  if (
    !checklistScore ||
    typeof checklistScore.buySeriesCount !== "number" ||
    typeof checklistScore.sellConditionCount !== "number"
  ) {
    throw new Error("Codex output has invalid checklistScore");
  }

  const universeCheck = candidate.universeCheck;
  if (!universeCheck || typeof universeCheck.isNewCandidate !== "boolean") {
    throw new Error("Codex output has invalid universeCheck");
  }

  if (candidate.decision.action === "BUY" && candidate.positionSizing === null) {
    throw new Error("Codex output must include positionSizing for BUY");
  }
  if (candidate.decision.action !== "BUY" && candidate.positionSizing !== null) {
    throw new Error("Codex output must set positionSizing to null outside of BUY");
  }
  if (candidate.positionSizing) {
    if (
      typeof candidate.positionSizing.proposedAmountKrw !== "number" ||
      typeof candidate.positionSizing.isAddOnPurchase !== "boolean" ||
      typeof candidate.positionSizing.addOnCountToday !== "number"
    ) {
      throw new Error("Codex output has invalid positionSizing");
    }
  }

  if (typeof candidate.hardStopTriggered !== "boolean") {
    throw new Error("Codex output has invalid hardStopTriggered");
  }

  const circuitBreaker = candidate.marketCircuitBreaker;
  if (
    !circuitBreaker ||
    typeof circuitBreaker.indexCrash !== "boolean" ||
    typeof circuitBreaker.viTriggered !== "boolean" ||
    typeof circuitBreaker.newBuySuspended !== "boolean"
  ) {
    throw new Error("Codex output has invalid marketCircuitBreaker");
  }

  const dataIntegrity = candidate.dataIntegrity;
  if (
    !dataIntegrity ||
    typeof dataIntegrity.apiError !== "boolean" ||
    !Array.isArray(dataIntegrity.dataMissingFields) ||
    typeof dataIntegrity.newsDisclosureConflict !== "boolean"
  ) {
    throw new Error("Codex output has invalid dataIntegrity");
  }

  if (!Array.isArray(candidate.riskFlags)) {
    throw new Error("Codex output has invalid riskFlags");
  }

  return candidate;
}

function buildPrompt(
  session: SessionState,
  heldSymbols: { symbol: string; quantity: string }[],
) {
  const heldSymbolsText = heldSymbols.length
    ? heldSymbols.map((h) => `- ${h.symbol} (수량 ${h.quantity})`).join("\n")
    : "(현재 보유 종목 없음)";

  const watchlistText = session.watchlist.length
    ? session.watchlist.map((symbol) => `- ${symbol}`).join("\n")
    : "(사용자가 등록한 관심 종목 없음)";

  return `
[SYSTEM PROMPT]
너는 토스증권 Open API와 최신 공개 정보를 함께 확인하는 투자 상태 분석 에이전트다.
목표는 사용자가 미리 제공한 행동지침을 적용하여 현재 사야 하는지, 팔아야 하는지, 관망해야 하는지 하나의 JSON 판단으로 답하는 것이다.

중요한 안전 규칙:
- 너는 분석만 수행한다. 실제 주문 생성, 주문 정정, 주문 취소 endpoint는 절대 호출하지 마라.
- 매매 실행은 사용자가 화면에서 BUY 또는 SELL 버튼을 누른 뒤 백엔드가 별도로 처리한다.
- API key, secret key, access token, 계좌번호 원문은 출력하지 말고 파일에도 저장하지 마라.
- 확실한 근거가 부족하거나 API 데이터와 최신 뉴스가 충돌하면 HOLD를 우선한다.
- API 데이터만으로 단정하지 말고, 가능한 경우 최신 공개 뉴스/공시/리포트 성격의 자료도 확인한다.
- 반대로 뉴스 하나만으로 단정하지 말고, 현재가/호가/체결/차트/보유자산/주문가능 정보 등 객관적 상태와 함께 판단한다.
- 외부 자료를 찾지 못했거나 관련성이 낮으면 references는 []로 둔다.
- 결과는 반드시 JSON Schema와 일치하는 JSON 객체 하나만 출력한다.

코드가 확인한 실제 보유 종목 (사전 조회, 우선 검토 대상):
${heldSymbolsText}
위 목록은 시스템이 API로 직접 조회한 것이라 신뢰할 수 있다.

사용자가 등록한 관심 종목 (세션에 저장된 값, 우선 검토 대상):
${watchlistText}

보유 종목과 관심 종목을 우선 검토하고, 위 두 목록에 없는 종목을 신규로 제안할 때는 universeCheck.isNewCandidate를 true로 표시한다. 위 두 목록에 없는 종목은 사용자가 관심 종목으로 승인하기 전까지 시스템이 BUY를 강제로 HOLD로 바꾼다 — 그래도 근거가 충분하면 후보로 제안하고 이유를 설명하되, 실제 매수는 사용자 승인 이후에만 가능하다는 점을 판단 근거에 반영한다.

참고용 정량 기준 (아래 숫자를 스스로 pass/fail 판단하지 말고, checklist/checklistScore/universeCheck/positionSizing/riskFlags에 사실 그대로의 수치·boolean만 정직하게 보고한다. 기준 충족 여부와 최종 override는 시스템 코드가 별도로 재검증한다):
${describeThresholdsForPrompt()}

토스증권 Open API 사용 정보:
- OpenAPI 문서 경로: ${apiDocsPath}
- API base URL: https://openapi.tossinvest.com
- API Key 환경변수: TOSSINVEST_API_KEY
- Secret Key 환경변수: TOSSINVEST_SECRET_KEY
- 계좌가 필요한 조회 API는 GET /api/v1/accounts의 accountSeq를 X-Tossinvest-Account 헤더에 넣는다.
- 조회에 필요한 endpoint만 사용한다. 특히 POST /api/v1/orders, /modify, /cancel은 호출 금지다.

history 폴더 정보:
- 경로: ${historyPath}
- 파일명은 기본적으로 조사/거래 시각의 epoch seconds를 사용한 JSON 파일이다. 같은 초에 여러 기록이 생기면 "-2" 같은 suffix가 붙을 수 있다.
- analysis 기록 형식: { "kind": "analysis", "epochSeconds": number, "createdAt": ISO string, "sessionId": string, "recommendation": AgentRecommendation(코드 검증 후 최종), "llmRecommendation": AgentRecommendation(LLM 원본), "validation": {...}, "rawAssistantMessage": string, "diagnostics": {...} }
- order 기록 형식: { "kind": "order", "epochSeconds": number, "createdAt": ISO string, "sessionId": string, "request": {...}, "response": {...} }
- 최근 history를 읽고 기존 판단, 체결 시도, 반복되는 리스크를 참고하되, 오래된 판단보다 최신 API/뉴스 데이터를 우선한다.

사용자 행동지침:
${session.instructions.trim() || "(사용자 행동지침이 비어 있다. 보수적으로 판단하고 명확한 근거가 없으면 HOLD한다.)"}

출력 규칙:
- symbol: 국내 주식은 종목코드, 미국 주식은 티커.
- market: KR 또는 US.
- decision.action: BUY, SELL, HOLD 중 하나. 아래 정량 기준의 최종 적용은 시스템이 하므로, 여기서는 정성적 판단(체크리스트가 시사하는 방향)만 반영한다.
- decision.confidence: 0.0 이상 1.0 이하.
- decision.reason: 핵심 근거를 한국어로 간결하게 설명.
- order: BUY 또는 SELL이면 권장 지정가 주문 정보를 넣고, HOLD면 null.
- references: 근거 자료가 있으면 title/url/reason/publishedAt(ISO 8601 발행·게시 시각, 정확히 모르면 확인한 시각을 최대한 가깝게 추정)을 넣고, 없으면 []. 오래된 자료는 시스템이 별도로 걸러내니 발행 시각은 사실대로 적는다.
- checklist: 시세/뉴스/실적/추세/거래량 등 각 항목이 실제로 확인됐는지 boolean으로 정직하게 보고 (판단이 아니라 사실 확인).
- checklistScore: buySeriesCount(시세+정보 계열 중 충족한 계열 수, 0~2), sellConditionCount(실적/뉴스/추세/거래량 중 충족 개수, 0~4).
- universeCheck: isNewCandidate가 true면 marketCapKrw/avgTradeValue20dKrw/return20dPct/return5dPct를 실제 조회한 수치로 채운다 (조회 실패 시 dataIntegrity에 반영). 보유/관심 종목이면 모두 null로 두고 isNewCandidate는 false.
- positionSizing: BUY면 proposedAmountKrw(주문 수량*지정가)/isAddOnPurchase/addOnCountToday를 채우고, 아니면 null.
- hardStopTriggered: 사용자 행동지침의 하드 손절선에 도달했다고 판단하면 true. 참고용 신호일 뿐이며, 실제 발동 여부는 시스템이 보유 손실률을 독립적으로 계산해서 결정한다.
- marketCircuitBreaker: 지수 급락/VI 발동/신규매수 정지 상황이면 각각 true.
- dataIntegrity: API 오류, 누락 필드, 뉴스-공시 상충 여부를 사실대로 보고.
- riskFlags: 위 항목들에서 스스로 인지한 리스크를 enum 값으로 나열 (최종 목록은 시스템이 override 사유를 추가해 재구성할 수 있음).
`.trim();
}

export async function runCodexInvestmentAgent(
  session: SessionState,
): Promise<CodexRunResult> {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "tossinvest-agent-"));
  const outputFile = path.join(outputDir, "last-message.json");

  let heldSymbols: { symbol: string; quantity: string }[] = [];
  try {
    const token = await issueAccessToken(session.apiKey, session.secretKey);
    const [account] = await getAccounts(token);
    if (account) {
      heldSymbols = await fetchHeldSymbols(token, account.accountSeq);
      console.log(
        `[codex-agent] pre-call 보유 종목 조회 성공: ${heldSymbols.length}건`,
        heldSymbols.map((h) => h.symbol),
      );
    }
  } catch (error) {
    // 보유 종목 사전 조회 실패는 치명적이지 않다 — LLM이 API를 직접 조회해 보완한다.
    console.warn("[codex-agent] pre-call 보유 종목 조회 실패, 빈 목록으로 진행", error);
    heldSymbols = [];
  }

  const prompt = buildPrompt(session, heldSymbols);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--yolo",
    "--color",
    "never",
    "-c",
    "shell_environment_policy.inherit=all",
    "--output-schema",
    outputSchemaPath,
    "--output-last-message",
    outputFile,
    "-C",
    process.cwd(),
    "-",
  ];

  const child = spawn(codexBin, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TOSSINVEST_API_KEY: session.apiKey,
      TOSSINVEST_SECRET_KEY: session.secretKey,
      TOSSINVEST_APIDOCS_PATH: apiDocsPath,
      TOSSINVEST_HISTORY_DIR: historyPath,
      TOSSINVEST_BASE_URL: "https://openapi.tossinvest.com",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.stdin.write(prompt);
  child.stdin.end();

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
      reject(new Error("Codex exec timed out"));
    }, runTimeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  const safeStdout = trimForHistory(redact(stdout, session));
  const safeStderr = trimForHistory(redact(stderr, session));

  let rawAssistantMessage = "";
  try {
    rawAssistantMessage = await fs.readFile(outputFile, "utf8");
  } catch {
    rawAssistantMessage = stdout;
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }

  const safeRawAssistantMessage = redact(rawAssistantMessage, session);

  if (exitCode !== 0) {
    throw new Error(
      `Codex exec failed with exit code ${exitCode}\n${safeStderr || safeStdout}`,
    );
  }

  const parsed = JSON.parse(stripJsonEnvelope(safeRawAssistantMessage));
  const recommendation = assertRecommendation(parsed);

  return {
    recommendation,
    rawAssistantMessage: safeRawAssistantMessage,
    diagnostics: {
      exitCode,
      stdout: safeStdout,
      stderr: safeStderr,
    },
  };
}
