import {
  getBuyingPower,
  getCandles,
  getHoldings,
  getStockInfo,
  getStockWarnings,
} from "@/lib/tossinvest";
import type { VerifiedPositionSizing, VerifiedUniverseSnapshot } from "@/lib/trading-rules";

const ACTIVE_WARNING_TYPES = new Set([
  "LIQUIDATION_TRADING",
  "INVESTMENT_WARNING",
  "INVESTMENT_RISK",
]);

export async function fetchUniverseSnapshot(
  symbol: string,
  token: string,
): Promise<VerifiedUniverseSnapshot> {
  const [stocks, candles, warnings] = await Promise.all([
    getStockInfo([symbol], token),
    getCandles(symbol, "1d", 25, token),
    getStockWarnings(symbol, token),
  ]);

  const stock = stocks[0];
  if (!stock) throw new Error(`stock info not found for ${symbol}`);

  const sorted = [...candles].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  if (sorted.length < 21) {
    throw new Error(`not enough candles for ${symbol} to compute 20d metrics`);
  }

  const last20 = sorted.slice(-20);
  const latest = sorted[sorted.length - 1];
  const close20dAgo = sorted[sorted.length - 21];
  const close5dAgo = sorted[sorted.length - 6];

  const latestClose = Number(latest.closePrice);
  const avgTradeValue20dKrw =
    last20.reduce((sum, c) => sum + Number(c.volume) * Number(c.closePrice), 0) / last20.length;
  const return20dPct = ((latestClose - Number(close20dAgo.closePrice)) / Number(close20dAgo.closePrice)) * 100;
  const return5dPct = ((latestClose - Number(close5dAgo.closePrice)) / Number(close5dAgo.closePrice)) * 100;

  return {
    marketCapKrw: Number(stock.sharesOutstanding) * latestClose,
    avgTradeValue20dKrw,
    return20dPct,
    return5dPct,
    hasActiveWarning: warnings.some((w) => ACTIVE_WARNING_TYPES.has(w.warningType)),
  };
}

export async function fetchPositionSizingSnapshot(
  symbol: string,
  proposedAmountKrw: number,
  token: string,
  accountSeq: number,
): Promise<VerifiedPositionSizing> {
  const [buyingPower, holdings] = await Promise.all([
    getBuyingPower(token, accountSeq, "KRW"),
    getHoldings(token, accountSeq),
  ]);

  const cashBuyingPowerKrw = Number(buyingPower.cashBuyingPower);
  const existingPosition = holdings.items.find((item) => item.symbol === symbol);
  const existingPositionValueKrw = existingPosition ? Number(existingPosition.marketValue.amount) : 0;
  const portfolioTotalValueKrw = Number(holdings.marketValue.amount.krw) + cashBuyingPowerKrw;

  const pctOfAvailableCash =
    cashBuyingPowerKrw > 0 ? (proposedAmountKrw / cashBuyingPowerKrw) * 100 : 100;
  const resultingPositionPctOfPortfolio =
    portfolioTotalValueKrw > 0
      ? ((existingPositionValueKrw + proposedAmountKrw) / portfolioTotalValueKrw) * 100
      : 100;

  return { pctOfAvailableCash, resultingPositionPctOfPortfolio };
}

export async function fetchHeldSymbols(
  token: string,
  accountSeq: number,
): Promise<{ symbol: string; quantity: string }[]> {
  const holdings = await getHoldings(token, accountSeq);
  return holdings.items.map((item) => ({ symbol: item.symbol, quantity: item.quantity }));
}
