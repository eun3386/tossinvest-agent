import { NextResponse } from "next/server";
import { writeHistory } from "@/lib/history";
import { getSession } from "@/lib/session-store";
import { createLimitOrder, TossinvestError } from "@/lib/tossinvest";
import type { Currency, Market, OrderHistoryRecord } from "@/lib/types";

type OrderSide = "BUY" | "SELL";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMarket(value: unknown): value is Market {
  return value === "KR" || value === "US";
}

function isCurrency(value: unknown): value is Currency {
  return value === "KRW" || value === "USD";
}

function isOrderSide(value: unknown): value is OrderSide {
  return value === "BUY" || value === "SELL";
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    sessionId?: string;
    symbol?: string;
    market?: string;
    side?: string;
    quantity?: string | number;
    limitPrice?: string | number;
    currency?: string;
  };
  const session = getSession(body.sessionId);

  if (!session) {
    return NextResponse.json({ error: "활성 세션이 없습니다." }, { status: 404 });
  }
  if (!body.symbol || !isMarket(body.market)) {
    return NextResponse.json({ error: "종목과 시장 값이 필요합니다." }, { status: 400 });
  }
  if (!isOrderSide(body.side)) {
    return NextResponse.json({ error: "BUY 또는 SELL만 가능합니다." }, { status: 400 });
  }
  if (!isCurrency(body.currency)) {
    return NextResponse.json({ error: "KRW 또는 USD 통화가 필요합니다." }, { status: 400 });
  }

  const quantity = String(body.quantity ?? "").trim();
  const limitPrice = String(body.limitPrice ?? "").trim();
  if (!quantity || !limitPrice || Number(quantity) <= 0 || Number(limitPrice) <= 0) {
    return NextResponse.json(
      { error: "수량과 지정가를 0보다 크게 입력해야 합니다." },
      { status: 400 },
    );
  }

  const requestPayload = {
    symbol: body.symbol.trim(),
    market: body.market,
    side: body.side,
    quantity,
    limitPrice,
    currency: body.currency,
  };

  try {
    const response = await createLimitOrder({
      apiKey: session.apiKey,
      secretKey: session.secretKey,
      ...requestPayload,
    });
    const epochSeconds = Math.floor(Date.now() / 1000);
    const record: OrderHistoryRecord = {
      kind: "order",
      epochSeconds,
      createdAt: new Date(epochSeconds * 1000).toISOString(),
      sessionId: session.id,
      request: requestPayload,
      response,
    };
    const historyFile = await writeHistory(record);

    return NextResponse.json({ response, historyFile });
  } catch (error) {
    const response =
      error instanceof TossinvestError
        ? { status: error.status, body: error.body }
        : { status: null, body: error instanceof Error ? error.message : error };
    const epochSeconds = Math.floor(Date.now() / 1000);
    const record: OrderHistoryRecord = {
      kind: "order",
      epochSeconds,
      createdAt: new Date(epochSeconds * 1000).toISOString(),
      sessionId: session.id,
      request: requestPayload,
      response: {
        ok: false,
        error: response,
      },
    };
    const historyFile = await writeHistory(record);

    return NextResponse.json(
      { error: "주문 요청에 실패했습니다.", detail: response, historyFile },
      { status: 500 },
    );
  }
}
