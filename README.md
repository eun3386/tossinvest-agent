# 토스증권 투자 에이전트

토스증권 Open API와 로컬 `codex exec`를 이용해 계좌/시장 상태를 주기적으로 분석하고, 사용자가 제공한 행동지침에 따라 `BUY`, `SELL`, `HOLD` 판단을 화면에 표시하는 Next.js 애플리케이션입니다.

이 프로젝트는 분석과 주문 실행을 분리합니다. Codex 에이전트는 조회와 분석만 수행하고, 실제 주문은 사용자가 화면에서 `BUY` 또는 `SELL` 버튼을 누를 때만 서버 API가 토스증권 주문 endpoint를 호출합니다.

## 주요 기능

- 토스증권 API Key / Secret Key 입력
- 관심 종목 입력 (쉼표로 구분, 세션에 저장되어 호출 전 프롬프트에 주입됨 — 토스증권 API 자체에는 관심종목 조회 기능이 없어 코드가 별도로 관리)
- 사용자 행동지침 입력
- 시작 버튼 이후 일정 간격으로 Codex 분석 실행
- `codex exec --yolo --ephemeral --output-schema` 기반 독립 분석
- 토스증권 Open API 문서 `tossinvest_apidocs.json`을 Codex 프롬프트에 첨부
- 분석 결과를 `BUY`, `SELL`, `HOLD` 형태로 표시
- 권장 수량, 지정가, 통화 표시 및 수정
- `BUY` / `SELL` 버튼으로 실제 지정가 주문 요청
- 분석/주문 이력을 `./history/*.json`에 저장
- History Log 클릭 시 모달에서 보기 좋은 형태로 전체 내용 확인
- confidence/체크리스트/포지션 한도 등 숫자 기준은 코드가 강제하며, LLM 판단이 기준을 벗어나면 자동으로 HOLD/SELL로 override하고 그 이력을 기록

## 주의 사항

- 이 앱은 라이브 토스증권 API를 사용합니다.
- `BUY` 또는 `SELL` 버튼을 누르면 실제 주문 요청이 발생할 수 있습니다.
- Codex가 생성한 판단은 투자 조언 자동화 실험용 결과이며, 손실 가능성이 있습니다.
- 이 앱의 사용으로 인해 생길 수 있는 모든 위험과 문제에 대한 책임은 사용자 본인이 부담합니다.
- API Key와 Secret Key는 서버 메모리에만 저장하며 파일에 저장하지 않습니다.
- 채팅, 로그, 화면 공유 등에 Secret Key가 노출되면 즉시 재발급하는 것을 권장합니다.
- Codex 분석 프롬프트에는 실제 주문 생성/정정/취소 endpoint 호출 금지 지침이 포함되어 있습니다.

## 요구 사항

- Node.js 24 이상 권장
- npm
- 로컬 Codex 실행 파일
- 토스증권 Open API 문서: `./tossinvest_apidocs.json`
- 토스증권 Open API Key / Secret Key

현재 구현은 Codex 실행 파일 경로를 기본값으로 `/Applications/Codex.app/Contents/Resources/codex`를 사용하며, `CODEX_BIN` 환경변수로 덮어쓸 수 있습니다. 사용자 환경에서 Codex가 다른 위치에 있다면 `CODEX_BIN`을 설정하거나 [lib/codex-agent.ts](lib/codex-agent.ts)의 `codexBin` 값을 직접 수정하세요.

예:

```bash
export CODEX_BIN=/absolute/path/to/codex
```

Codex 실행 파일 경로를 지정한 뒤, 해당 실행 파일이 다음 옵션을 지원하는지 확인합니다.

```bash
~/codex exec --help
```

앱에서 사용하는 주요 옵션:

- `--yolo`
- `--ephemeral`
- `--skip-git-repo-check`
- `--output-schema`
- `--output-last-message`
- `-C`

## 설치

```bash
npm install
```

## Codex 경로 설정

이 앱은 백엔드에서 로컬 Codex CLI를 직접 실행합니다. 따라서 서버가 접근할 수 있는 정확한 Codex 실행 파일 경로가 필요합니다.

기본값:

```text
/Applications/Codex.app/Contents/Resources/codex
```

다른 경로를 사용하려면 `CODEX_BIN` 환경변수를 설정하거나 [lib/codex-agent.ts](lib/codex-agent.ts)의 `codexBin`을 직접 수정하세요.

예:

```bash
export CODEX_BIN=/absolute/path/to/codex
```

경로 수정 후 다음 명령으로 확인합니다.

```bash
/absolute/path/to/codex exec --help
```

## 개발 서버 실행

```bash
npm run dev
```

기본 주소:

```text
http://localhost:3000
```

## 사용 방법

1. 브라우저에서 `http://localhost:3000`을 엽니다.
2. 토스증권 `API Key`와 `Secret Key`를 입력합니다.
3. 관심 종목을 쉼표로 구분해 입력합니다(선택 사항).
4. 분석 간격을 초 단위로 입력합니다. 최소값은 30초입니다.
5. 행동지침을 입력합니다.
6. `시작` 버튼을 누릅니다.
7. Codex가 토스증권 Open API 문서와 현재 history를 참고하여 분석합니다. 이때 보유 종목·관심 종목 목록은 코드가 API 호출 전에 직접 조회/전달합니다.
8. 결과가 화면에 표시됩니다.
9. 필요하면 수량, 지정가, 통화를 수정합니다.
10. 실제 주문을 원할 때만 `BUY` 또는 `SELL` 버튼을 누릅니다.

사용자가 1분 또는 설정한 분석 간격 동안 아무 조작을 하지 않으면 다음 분석 턴으로 넘어갑니다.

## 분석 결과 형식

Codex의 최종 응답은 JSON Schema로 구조를 제한합니다.

스키마 파일:

```text
schemas/investment-agent-output.schema.json
```

기본 형태:

```json
{
  "symbol": "005930",
  "market": "KR",
  "decision": {
    "action": "BUY",
    "confidence": 0.87,
    "reason": "거래량 증가와 추세 돌파가 확인되었습니다."
  },
  "order": { "quantity": 2, "limitPrice": 81000, "currency": "KRW" },
  "references": [
    { "title": "관련 뉴스 제목", "url": "https://example.com", "reason": "판단 근거", "publishedAt": "2026-07-05T09:00:00+09:00" }
  ],
  "checklist": {
    "priceSeriesFavorable": true,
    "newsDisclosureFavorable": true,
    "earningsDeteriorated": false,
    "negativeNewsDisclosure": false,
    "trendBroken": false,
    "volumeWeakening": false,
    "recentSpikeCooling": false,
    "isAveragingDown": false,
    "averagingDownAllowed": false
  },
  "checklistScore": { "buySeriesCount": 2, "sellConditionCount": 0 },
  "universeCheck": {
    "isNewCandidate": false,
    "marketCapKrw": null,
    "avgTradeValue20dKrw": null,
    "return20dPct": null,
    "return5dPct": null
  },
  "positionSizing": { "proposedAmountKrw": 162000, "isAddOnPurchase": false, "addOnCountToday": 0 },
  "hardStopTriggered": false,
  "marketCircuitBreaker": { "indexCrash": false, "viTriggered": false, "newBuySuspended": false },
  "dataIntegrity": { "apiError": false, "dataMissingFields": [], "newsDisclosureConflict": false },
  "riskFlags": []
}
```

추가 런타임 검증 (`lib/codex-agent.ts`의 `assertRecommendation`):

- `HOLD`이면 `order`/`positionSizing`은 반드시 `null`
- `BUY` 또는 `SELL`이면 `order` 필수, `BUY`면 `positionSizing`도 필수
- `confidence`는 0 이상 1 이하
- 주문 수량과 지정가는 0보다 커야 함
- 참고 링크 URL은 `http://` 또는 `https://`로 시작해야 하고, `publishedAt`은 유효한 날짜여야 함
- `checklist`/`checklistScore`/`universeCheck`/`hardStopTriggered`/`marketCircuitBreaker`/`dataIntegrity`/`riskFlags` 타입 검증

이 구조 검증은 "LLM이 스키마에 맞는 값을 냈는가"만 확인합니다. 그 값이 실제 매매 기준을 충족하는지는 아래 검증 레이어가 별도로 재확인합니다.

## 검증 레이어 (숫자 기준 코드화 + override)

숫자로 판단 가능한 기준(confidence 임계값, BUY 금액/포지션 비중 한도, 신규 발굴 종목 사전 필터, sell 조건 개수 등)은 프롬프트 텍스트가 아니라 코드에 있습니다.

- `lib/trading-rules.ts`
  - `TRADING_THRESHOLDS`: confidence 0.65, BUY 금액 주문가능금액의 10% 이하, 포지션 비중 15% 이하, SELL 조건 2개 이상, 신규 발굴 종목(KR) 시총 5,000억 이상/거래대금 30억 이상/20일 급등률 +30%↑ 제외/5일 +20%↑ 제외/상장 6개월 이상/보통주(우선주·스팩 제외), 물타기 손실률 -10%보다 깊으면 무조건 차단(그보다 얕으면 LLM 반등 근거 참고), 하드 손절선 -20% 이하 시 코드가 무조건 SELL, references 발행 3일 이내만 인정, 종목 무관 일일 매수 3회/포트폴리오 20% 이하. 구체적 숫자가 없던 항목은 보수적 기본값을 넣어뒀으니 운용 기준에 맞게 조정하세요.
  - `describeThresholdsForPrompt()`: 위 기준을 사람이 읽는 문장으로 만들어 Codex 프롬프트에 "참고용, 준수 여부는 시스템이 재검증함"으로 삽입합니다. LLM은 숫자를 스스로 pass/fail 판단하지 않고 사실(checklist/checklistScore/universeCheck 등)만 보고합니다.
  - `passesPreFilter()` / `evaluateChecklistThreshold()` / `validateDecision()`: 순수 함수로 위 기준을 실제로 적용하고, 위반 시 `decision.action`을 강제로 `HOLD`(또는 하드 손절 시 `SELL`)로 override합니다. `evaluateChecklistThreshold()`는 LLM이 자기보고한 `checklistScore`(개수)를 신뢰하지 않고 개별 boolean에서 코드가 직접 재계산합니다.
- `lib/market-data.ts`, `lib/tossinvest.ts`, `lib/history.ts`
  - LLM이 자기 보고한 시총/거래대금/급등률/보통주 여부/상장일/포지션 비중/보유 손실률 숫자를 그대로 믿지 않고, 토스증권 API(`/api/v1/stocks`, `/api/v1/candles`, `/api/v1/stocks/{symbol}/warnings`, `/api/v1/buying-power`, `/api/v1/holdings`)로 코드가 직접 재계산합니다. 스팩 여부는 API에 전용 필드가 없어 종목명 휴리스틱(`스팩`/`기업인수목적` 포함 여부)으로 추정합니다.
  - 하드 손절선도 LLM 자기보고(`hardStopTriggered`)를 신뢰하지 않고, 코드가 보유 손실률을 독립적으로 계산해서만 발동합니다.
  - 당일 추가매수 횟수/종목 무관 일일 매수 횟수·총액은 Toss Open API가 아직 체결 주문 조회(`status=CLOSED`)를 지원하지 않아, 이 앱 자체의 `history/` 로그를 근거로 코드가 직접 집계합니다.
  - 이 독립 검증(프리필터/포지션비중/물타기/하드손절/일일한도)은 KR 시장에만 적용됩니다(시가총액/관리종목 등이 KR 특화 개념이라 US까지 확장하지 않음). US는 confidence/체크리스트/서킷브레이커 검증은 그대로 적용되지만 위 숫자 검증은 건너뜁니다.
  - `codex-agent.ts`는 Codex를 호출하기 **전에** 코드가 실제 보유 종목을 조회해 프롬프트에 주입합니다 (진짜 pre-call 필터).
- `lib/reference-check.ts`
  - LLM이 인용한 뉴스·공시 링크를 실제로 HTTP GET 요청해서 살아있는지 확인하고, 응답에 실패한 링크는 제외합니다. 또한 각 참고자료의 `publishedAt`(LLM 자기보고 발행 시각)이 3일보다 오래됐으면 판단 근거로 인정하지 않고 제외합니다. 제외된 항목은 `console.warn`으로 로그를 남깁니다.
- 신규 종목 승인 게이트 (`lib/decision-pipeline.ts`, `lib/trading-rules.ts`)
  - LLM의 `universeCheck.isNewCandidate` 자기보고를 신뢰하지 않고, 코드가 실제 보유 종목(API)과 세션의 관심 종목 목록을 직접 대조해서 "보유·관심 종목이 아닌 심볼은 BUY를 강제로 HOLD"로 막습니다(`NEW_CANDIDATE_PENDING_APPROVAL`). 화면에서 override 배너에 뜨는 "관심 종목에 추가하고 재분석" 버튼을 누르면 `POST /api/session/watchlist`로 그 종목을 관심 종목에 등록하고 바로 재분석합니다. 등록 전까지는 후보로만 제안되고 실제 매수 판단 대상이 되지 않습니다.
- `lib/decision-pipeline.ts`
  - `finalizeRecommendation()`이 Codex 응답을 받은 뒤 위 독립 데이터를 조회해 `validateDecision()`을 호출하고, override 발생 시 `console.warn`으로 서버 로그에 남깁니다.
- `app/api/agent/run/route.ts`
  - history의 `analysis` 레코드에 `recommendation`(최종, override 반영됨)뿐 아니라 `llmRecommendation`(LLM 원본)과 `validation.overrides`(override 사유 목록)를 함께 저장합니다.
  - override가 발생하면 화면 상단에 경고 배너가 뜨고, History Log 상세 모달의 "코드 검증" 섹션에서 원본 판단과 override 사유를 볼 수 있습니다.
- `orderButtonsEnabled` (`app/page.tsx`)
  - 이 검증 레이어가 붙기 전까지는 `false`로 고정되어 있어 실제 주문 버튼이 비활성화됩니다. 운영에 반영할 준비가 되면 명시적으로 변경하세요.

## History

모든 분석과 주문 결과는 `./history` 폴더에 JSON 파일로 저장됩니다.

파일명은 epoch seconds 기준입니다.

```text
history/1782410715.json
```

같은 초에 여러 기록이 생기면 `-2`, `-3` 같은 suffix가 붙을 수 있습니다.

기록 종류:

- `analysis`: Codex 분석 결과. `recommendation`(코드 검증 후 최종), `llmRecommendation`(LLM 원본), `validation`(override 여부/사유)을 포함합니다.
- `order`: 사용자가 누른 주문 요청 결과

화면 오른쪽 `History Log`에서 항목을 클릭하면 모달로 상세 내용을 볼 수 있습니다. `analysis` 기록에는 "코드 검증" 섹션이 추가되어 override 여부와 사유를 확인할 수 있습니다(이번 검증 레이어 도입 이전 기록에는 `validation` 필드가 없어 해당 섹션이 표시되지 않습니다).

## 주요 파일 구조

```text
app/page.tsx                         # 메인 화면
app/api/session/route.ts             # API Key/Secret 세션 생성
app/api/agent/run/route.ts           # Codex 분석 실행 + 검증 파이프라인 연결
app/api/order/route.ts               # Toss 주문 요청
app/api/history/route.ts             # history 목록 조회
lib/codex-agent.ts                   # codex exec 실행 래퍼, 프롬프트 구성
lib/decision-pipeline.ts             # LLM 응답 독립 재검증 오케스트레이션
lib/trading-rules.ts                 # 숫자 기준(TRADING_THRESHOLDS) + passesPreFilter/validateDecision
lib/market-data.ts                   # 시총/거래대금/급등률/포지션비중 독립 계산
lib/tossinvest.ts                    # 토스증권 API 클라이언트
lib/history.ts                       # history 파일 저장/조회
lib/session-store.ts                 # 서버 메모리 세션 저장
schemas/investment-agent-output.schema.json
tossinvest_apidocs.json              # 토스증권 OpenAPI 문서
```

## Codex 실행 방식

분석 요청마다 새 Codex exec 프로세스를 실행합니다.

특징:

- 이전 Codex 세션을 resume하지 않습니다.
- `--ephemeral`로 세션 파일을 유지하지 않습니다.
- `--output-last-message`로 최종 응답을 임시 파일에 저장합니다.
- `--output-schema`로 최종 응답 구조를 제한합니다.
- 토스증권 키는 child process 환경변수로만 전달합니다.

환경변수 이름:

```text
TOSSINVEST_API_KEY
TOSSINVEST_SECRET_KEY
TOSSINVEST_APIDOCS_PATH
TOSSINVEST_HISTORY_DIR
TOSSINVEST_BASE_URL
```

Codex를 호출하기 전에 서버 코드가 `/api/v1/accounts` → `/api/v1/holdings`를 직접 조회해 실제 보유 종목 목록을 프롬프트에 주입합니다(신규 종목 임의 발굴보다 이 목록을 우선 검토하도록 유도).

Codex 프롬프트에는 다음 지침이 포함됩니다.

- 토스증권 Open API 문서 경로 확인
- 계좌 조회 후 필요한 API에는 `X-Tossinvest-Account` 사용
- 실제 주문 생성/정정/취소 endpoint 호출 금지
- API 데이터와 최신 공개 정보를 함께 참고
- 근거가 부족하면 `HOLD` 우선
- `describeThresholdsForPrompt()`로 생성한 정량 기준 목록(참고용 — 최종 적용은 코드가 함)
- checklist/checklistScore/universeCheck/positionSizing/hardStopTriggered/marketCircuitBreaker/dataIntegrity/riskFlags를 사실대로 보고 (스스로 기준 충족 여부를 판단하지 않음)

## 주문 방식

현재 서버 주문 API는 지정가 주문만 생성합니다.

요청 흐름:

1. `/oauth2/token`으로 access token 발급
2. `/api/v1/accounts`로 첫 번째 계좌 조회
3. `/api/v1/orders`에 `LIMIT` 주문 생성

주문 요청 필드:

- `symbol`
- `side`: `BUY` 또는 `SELL`
- `orderType`: `LIMIT`
- `quantity`
- `price`
- `clientOrderId`

## 검증 명령

```bash
npm run lint
npm run build
npm audit --audit-level=moderate
```

Codex schema smoke test 예시 (실제 프로젝트 경로와 확장된 스키마에 맞게 수정하세요. `additionalProperties: false`이므로 checklist 등 필수 필드를 모두 포함해야 통과합니다):

```bash
"$CODEX_BIN" exec \
  --skip-git-repo-check \
  --ephemeral \
  --yolo \
  --color never \
  --output-schema "$(pwd)/schemas/investment-agent-output.schema.json" \
  --output-last-message /tmp/tossinvest-agent-smoke.json \
  -C "$(pwd)" \
  'Return only this JSON object and do not run tools: {"symbol":"005930","market":"KR","decision":{"action":"HOLD","confidence":0.1,"reason":"smoke test"},"order":null,"references":[],"checklist":{"priceSeriesFavorable":false,"newsDisclosureFavorable":false,"earningsDeteriorated":false,"negativeNewsDisclosure":false,"trendBroken":false,"volumeWeakening":false,"recentSpikeCooling":false,"isAveragingDown":false,"averagingDownAllowed":false},"checklistScore":{"buySeriesCount":0,"sellConditionCount":0},"universeCheck":{"isNewCandidate":false,"marketCapKrw":null,"avgTradeValue20dKrw":null,"return20dPct":null,"return5dPct":null},"positionSizing":null,"hardStopTriggered":false,"marketCircuitBreaker":{"indexCrash":false,"viTriggered":false,"newBuySuspended":false},"dataIntegrity":{"apiError":false,"dataMissingFields":[],"newsDisclosureConflict":false},"riskFlags":[]}'
```

## 서버 중지

개발 서버를 터미널에서 실행 중이라면 `Ctrl+C`로 중지합니다.

포트 점유 확인:

```bash
ss -ltnp | rg ':3000\\b'
```

필요 시 해당 프로세스를 종료합니다.

```bash
kill <PID>
```

## 보안 메모

- Secret Key를 저장소에 커밋하지 마세요.
- `history` 파일에는 API Key, Secret Key, access token이 저장되지 않도록 마스킹합니다.
- Codex stdout/stderr도 키 문자열을 마스킹한 뒤 history에 저장합니다.
- 실제 운영 환경에서는 추가 인증, HTTPS, 서버 재시작 시 세션 초기화 정책, 주문 전 재확인 절차를 두는 것이 좋습니다.

## 책임 고지

이 프로젝트는 투자 판단과 주문 실행을 자동화하는 실험용 도구입니다. 소프트웨어 오류, API 오류, 시장 변동, 지연된 정보, 잘못된 모델 판단, 사용자 설정 오류 등으로 인해 금전적 손실이 발생할 수 있습니다.

이 앱의 사용으로 인해 생길 수 있는 모든 위험과 모든 문제에 대한 책임은 사용자 본인이 부담합니다. 개발자 또는 배포자는 이 앱의 사용으로 인해 발생하는 어떠한 문제에 대해서도 책임지지 않습니다.

## 라이선스

MIT License. 자세한 내용은 [LICENSE](./LICENSE)를 확인하세요.
