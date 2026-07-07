import fs from "node:fs/promises";
import path from "node:path";
import type { HistoryRecord, OrderHistoryRecord } from "@/lib/types";

export const historyDir = path.join(process.cwd(), "history");

export async function ensureHistoryDir() {
  await fs.mkdir(historyDir, { recursive: true });
}

export async function writeHistory(record: HistoryRecord) {
  await ensureHistoryDir();
  const base = `${record.epochSeconds}.json`;
  let filename = base;
  let counter = 2;

  while (true) {
    const target = path.join(historyDir, filename);
    try {
      await fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`, {
        flag: "wx",
      });
      return filename;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      filename = `${record.epochSeconds}-${counter}.json`;
      counter += 1;
    }
  }
}

function kstDateString(epochSeconds: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(epochSeconds * 1000));
}

// 오늘 이 앱을 통해 실제로 체결 요청까지 간 BUY 주문 기록. Toss Invest Open API의
// 주문 조회는 status=CLOSED(체결/거부 등)를 아직 지원하지 않아(closed-not-supported),
// 우리 자체 history 로그를 유일한 근거로 사용한다.
async function getTodayBuyOrderRecords(symbol?: string): Promise<OrderHistoryRecord[]> {
  const records = await listHistory(500);
  const today = kstDateString(Math.floor(Date.now() / 1000));

  return records
    .map(({ record }) => record)
    .filter((record): record is OrderHistoryRecord => record.kind === "order")
    .filter(
      (record) =>
        record.request.side === "BUY" &&
        kstDateString(record.epochSeconds) === today &&
        (symbol === undefined || record.request.symbol === symbol),
    );
}

export async function countTodayBuyOrders(symbol: string): Promise<number> {
  return (await getTodayBuyOrderRecords(symbol)).length;
}

// 종목 무관 일일 총 매수 한도 판정용 — 오늘 체결 요청된 KRW 매수 건수/총액.
export async function getTodayBuyOrdersSummaryKrw(): Promise<{
  count: number;
  totalAmountKrw: number;
}> {
  const records = (await getTodayBuyOrderRecords()).filter(
    (record) => record.request.currency === "KRW",
  );
  const totalAmountKrw = records.reduce(
    (sum, record) => sum + Number(record.request.quantity) * Number(record.request.limitPrice),
    0,
  );

  return { count: records.length, totalAmountKrw };
}

export async function listHistory(limit = 100) {
  await ensureHistoryDir();
  const files = await fs.readdir(historyDir);
  const jsonFiles = files
    .filter((file) => file.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b))
    .slice(-limit);

  const records = await Promise.all(
    jsonFiles.map(async (file) => {
      const raw = await fs.readFile(path.join(historyDir, file), "utf8");
      return {
        file,
        record: JSON.parse(raw) as HistoryRecord,
      };
    }),
  );

  return records;
}
