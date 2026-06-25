# 토스증권 투자 에이전트

토스증권 Open API와 로컬 `codex exec`를 이용해 계좌/시장 상태를 주기적으로 분석하고, 사용자가 제공한 행동지침에 따라 `BUY`, `SELL`, `HOLD` 판단을 화면에 표시하는 Next.js 애플리케이션입니다.

이 프로젝트는 분석과 주문 실행을 분리합니다. Codex 에이전트는 조회와 분석만 수행하고, 실제 주문은 사용자가 화면에서 `BUY` 또는 `SELL` 버튼을 누를 때만 서버 API가 토스증권 주문 endpoint를 호출합니다.

## 주요 기능

- 토스증권 API Key / Secret Key 입력
- 사용자 행동지침 입력
- 시작 버튼 이후 일정 간격으로 Codex 분석 실행
- `~/codex exec --yolo --ephemeral --output-schema` 기반 독립 분석
- 토스증권 Open API 문서 `tossinvest_apidocs.json`을 Codex 프롬프트에 첨부
- 분석 결과를 `BUY`, `SELL`, `HOLD` 형태로 표시
- 권장 수량, 지정가, 통화 표시 및 수정
- `BUY` / `SELL` 버튼으로 실제 지정가 주문 요청
- 분석/주문 이력을 `./history/*.json`에 저장
- History Log 클릭 시 모달에서 보기 좋은 형태로 전체 내용 확인

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

현재 구현은 Codex 실행 파일 경로를 `~/codex`로 사용합니다. 사용자 환경에서 Codex가 다른 위치에 있다면 [lib/codex-agent.ts](/home/kst/stock/lib/codex-agent.ts)의 `codexBin` 값을 직접 수정해야 합니다.

예:

```ts
const codexBin = path.join(os.homedir(), "codex");
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
~/codex
```

다른 경로를 사용하려면 [lib/codex-agent.ts](/home/kst/stock/lib/codex-agent.ts)의 `codexBin`을 수정하세요.

예:

```ts
const codexBin = "/absolute/path/to/codex";
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
3. 분석 간격을 초 단위로 입력합니다. 최소값은 30초입니다.
4. 행동지침을 입력합니다.
5. `시작` 버튼을 누릅니다.
6. Codex가 토스증권 Open API 문서와 현재 history를 참고하여 분석합니다.
7. 결과가 화면에 표시됩니다.
8. 필요하면 수량, 지정가, 통화를 수정합니다.
9. 실제 주문을 원할 때만 `BUY` 또는 `SELL` 버튼을 누릅니다.

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
  "order": {
    "quantity": 2,
    "limitPrice": 81000,
    "currency": "KRW"
  },
  "references": [
    {
      "title": "관련 뉴스 제목",
      "url": "https://example.com",
      "reason": "판단 근거"
    }
  ]
}
```

추가 런타임 검증:

- `HOLD`이면 `order`는 반드시 `null`
- `BUY` 또는 `SELL`이면 `order` 필수
- `confidence`는 0 이상 1 이하
- 주문 수량과 지정가는 0보다 커야 함
- 참고 링크 URL은 `http://` 또는 `https://`로 시작해야 함

## History

모든 분석과 주문 결과는 `./history` 폴더에 JSON 파일로 저장됩니다.

파일명은 epoch seconds 기준입니다.

```text
history/1782410715.json
```

같은 초에 여러 기록이 생기면 `-2`, `-3` 같은 suffix가 붙을 수 있습니다.

기록 종류:

- `analysis`: Codex 분석 결과
- `order`: 사용자가 누른 주문 요청 결과

화면 오른쪽 `History Log`에서 항목을 클릭하면 모달로 상세 내용을 볼 수 있습니다.

## 주요 파일 구조

```text
app/page.tsx                         # 메인 화면
app/api/session/route.ts             # API Key/Secret 세션 생성
app/api/agent/run/route.ts           # Codex 분석 실행
app/api/order/route.ts               # Toss 주문 요청
app/api/history/route.ts             # history 목록 조회
lib/codex-agent.ts                   # codex exec 실행 래퍼
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

Codex 프롬프트에는 다음 지침이 포함됩니다.

- 토스증권 Open API 문서 경로 확인
- 계좌 조회 후 필요한 API에는 `X-Tossinvest-Account` 사용
- 실제 주문 생성/정정/취소 endpoint 호출 금지
- API 데이터와 최신 공개 정보를 함께 참고
- 근거가 부족하면 `HOLD` 우선

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

Codex schema smoke test 예시:

```bash
~/codex exec \
  --skip-git-repo-check \
  --ephemeral \
  --yolo \
  --color never \
  --output-schema /home/kst/stock/schemas/investment-agent-output.schema.json \
  --output-last-message /tmp/tossinvest-agent-smoke.json \
  -C /home/kst/stock \
  'Return only this JSON object and do not run tools: {"symbol":"005930","market":"KR","decision":{"action":"HOLD","confidence":0.1,"reason":"smoke test"},"order":null,"references":[]}'
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
