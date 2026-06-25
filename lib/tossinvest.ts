import type { Currency, Market } from "@/lib/types";

const baseUrl = "https://openapi.tossinvest.com";

type ApiResult<T> = {
  result: T;
};

type Account = {
  accountNo: string;
  accountSeq: number;
  accountType: string;
};

export class TossinvestError extends Error {
  status: number | null;
  body: unknown;

  constructor(message: string, status: number | null, body: unknown) {
    super(message);
    this.name = "TossinvestError";
    this.status = status;
    this.body = body;
  }
}

async function tossFetch<T>(
  path: string,
  init: RequestInit & { token?: string; accountSeq?: number } = {},
) {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.accountSeq != null) {
    headers.set("X-Tossinvest-Account", String(init.accountSeq));
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as T) : null;

  if (!response.ok) {
    throw new TossinvestError("Tossinvest API request failed", response.status, body);
  }

  return body as T;
}

export async function issueAccessToken(apiKey: string, secretKey: string) {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: apiKey,
    client_secret: secretKey,
  });

  const response = await tossFetch<{
    access_token: string;
    token_type: "Bearer";
    expires_in: number;
  }>("/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return response.access_token;
}

export async function getAccounts(token: string) {
  const response = await tossFetch<ApiResult<Account[]>>("/api/v1/accounts", {
    token,
  });
  return response.result;
}

export async function createLimitOrder(input: {
  apiKey: string;
  secretKey: string;
  symbol: string;
  market: Market;
  side: "BUY" | "SELL";
  quantity: string;
  limitPrice: string;
  currency: Currency;
}) {
  const token = await issueAccessToken(input.apiKey, input.secretKey);
  const accounts = await getAccounts(token);
  const account = accounts[0];

  if (!account) {
    throw new TossinvestError("No account returned by Tossinvest API", 404, {
      error: "account-not-found",
    });
  }

  const clientOrderId = `agent-${Date.now().toString(36)}`.slice(0, 36);
  const body = {
    clientOrderId,
    symbol: input.symbol,
    side: input.side,
    orderType: "LIMIT",
    quantity: input.quantity,
    price: input.limitPrice,
    confirmHighValueOrder: false,
  };

  const response = await tossFetch<ApiResult<{ orderId: string }>>("/api/v1/orders", {
    method: "POST",
    token,
    accountSeq: account.accountSeq,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    accountSeq: account.accountSeq,
    order: response.result,
    submitted: {
      clientOrderId,
      symbol: input.symbol,
      market: input.market,
      side: input.side,
      orderType: "LIMIT",
      quantity: input.quantity,
      price: input.limitPrice,
      currency: input.currency,
    },
  };
}
