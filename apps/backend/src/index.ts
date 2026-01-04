import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import WebSocket from "ws";
import {
  AnalysisResponse,
  Candle,
  CandlesResponse,
  DRRange,
  POILevel,
  POIState,
  StructureState,
  Timeframe,
  VCState,
  WsEvent,
} from "@shared/types";

type CacheEntry = { candles: Candle[]; updatedAt: number };

const BINANCE_REST = "https://fapi.binance.com";
const BINANCE_WS = "wss://fstream.binance.com/ws";
const SYMBOLS = ["BTCUSDT", "ETHUSDT"] as const;
const SUPPORTED_TF: Timeframe[] = ["1M", "1W", "1D", "4H", "1H"];
const CACHE_TTL_MS = 30_000;

const tfToInterval: Record<Timeframe, string> = {
  "1M": "1M",
  "1W": "1w",
  "1D": "1d",
  "4H": "4h",
  "1H": "1h",
};

const cache = new Map<string, CacheEntry>();
const lastAnalysis = new Map<string, AnalysisResponse>();

const clients = new Set<{ socket: WebSocket; symbol: string }>();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cacheKey = (symbol: string, tf: Timeframe) => `${symbol}:${tf}`;

const clampSymbol = (symbol?: string) => {
  if (!symbol) return SYMBOLS[0];
  const normalized = symbol.toUpperCase();
  return SYMBOLS.includes(normalized as (typeof SYMBOLS)[number])
    ? normalized
    : SYMBOLS[0];
};

const clampTf = (tf?: string): Timeframe => {
  if (!tf) return "1H";
  const normalized = tf.toUpperCase();
  return SUPPORTED_TF.includes(normalized as Timeframe)
    ? (normalized as Timeframe)
    : "1H";
};

const parseCandles = (raw: unknown[]): Candle[] =>
  raw.map((entry) => {
    const [time, open, high, low, close, volume] = entry as [
      number,
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      time,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    };
  });

const fetchWithBackoff = async (url: string, attempts = 3): Promise<Response> => {
  let delay = 500;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Binance error ${response.status}`);
      }
      return response;
    } catch (error) {
      if (attempt === attempts - 1) {
        throw error;
      }
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error("Unreachable");
};

const fetchCandles = async (
  symbol: string,
  tf: Timeframe,
  limit = 1000,
): Promise<Candle[]> => {
  const key = cacheKey(symbol, tf);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
    return cached.candles;
  }
  const interval = tfToInterval[tf];
  const url = `${BINANCE_REST}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const response = await fetchWithBackoff(url);
  const data = (await response.json()) as unknown[];
  const candles = parseCandles(data);
  cache.set(key, { candles, updatedAt: Date.now() });
  return candles;
};

const updateCacheWithCandle = (symbol: string, tf: Timeframe, candle: Candle) => {
  const key = cacheKey(symbol, tf);
  const existing = cache.get(key);
  if (!existing) {
    cache.set(key, { candles: [candle], updatedAt: Date.now() });
    return;
  }
  const candles = existing.candles.slice();
  const last = candles[candles.length - 1];
  if (last && last.time === candle.time) {
    candles[candles.length - 1] = candle;
  } else {
    candles.push(candle);
    if (candles.length > 1000) {
      candles.shift();
    }
  }
  cache.set(key, { candles, updatedAt: Date.now() });
};

const findFractals = (candles: Candle[]) => {
  const highs: { index: number; price: number; time: number }[] = [];
  const lows: { index: number; price: number; time: number }[] = [];
  for (let i = 2; i < candles.length - 2; i += 1) {
    const prev2 = candles[i - 2];
    const prev1 = candles[i - 1];
    const current = candles[i];
    const next1 = candles[i + 1];
    const next2 = candles[i + 2];
    if (
      current.high > prev1.high &&
      current.high > prev2.high &&
      current.high > next1.high &&
      current.high > next2.high
    ) {
      highs.push({ index: i, price: current.high, time: current.time });
    }
    if (
      current.low < prev1.low &&
      current.low < prev2.low &&
      current.low < next1.low &&
      current.low < next2.low
    ) {
      lows.push({ index: i, price: current.low, time: current.time });
    }
  }
  return { highs, lows };
};

const computeATR = (candles: Candle[], length = 14) => {
  if (candles.length < length + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const prev = candles[i - 1];
    const current = candles[i];
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
    trs.push(tr);
  }
  const slice = trs.slice(-length);
  const sum = slice.reduce((acc, value) => acc + value, 0);
  return sum / length;
};

const computeAnalysis = async (symbol: string): Promise<AnalysisResponse> => {
  const candles1D = await fetchCandles(symbol, "1D", 1000);
  const candles4H = await fetchCandles(symbol, "4H", 1000);
  const candles1H = await fetchCandles(symbol, "1H", 1000);
  const lastPrice = candles1H[candles1H.length - 1]?.close ?? 0;

  const drCandles = candles1D.slice(-180);
  const drHigh = Math.max(...drCandles.map((c) => c.high));
  const drLow = Math.min(...drCandles.map((c) => c.low));
  const drEq = (drHigh + drLow) * 0.5;
  const dealingRange: DRRange = { high: drHigh, low: drLow, eq: drEq };

  const pdState =
    lastPrice > drEq * 1.001
      ? "premium"
      : lastPrice < drEq * 0.999
        ? "discount"
        : "eq";

  const direction = pdState === "premium" ? "sell" : "buy";

  const fractals4H = findFractals(candles4H);
  const fractals1H = findFractals(candles1H);

  const poiCandidates =
    direction === "sell" ? fractals4H.highs : fractals4H.lows;
  let poi: POILevel | null = null;
  if (poiCandidates.length > 0) {
    const sorted = poiCandidates
      .map((entry) => entry.price)
      .sort((a, b) => a - b);
    const targetPrice =
      direction === "sell"
        ? sorted.find((price) => price >= lastPrice) ?? sorted[sorted.length - 1]
        : [...sorted]
            .reverse()
            .find((price) => price <= lastPrice) ?? sorted[0];
    const epsilon = targetPrice * 0.001;
    poi = { price: targetPrice, direction, epsilon };
  }

  const touch = poi
    ? Math.abs(lastPrice - poi.price) <= poi.epsilon
    : false;

  const atr = computeATR(candles1H, 14);
  const lastCandle = candles1H[candles1H.length - 1];
  const candleBody = Math.abs(lastCandle.close - lastCandle.open);
  const k = 1.2;
  const lastSwingLow = fractals1H.lows[fractals1H.lows.length - 1]?.price ?? lastCandle.low;
  const lastSwingHigh = fractals1H.highs[fractals1H.highs.length - 1]?.price ?? lastCandle.high;

  const displacementSell =
    lastCandle.close < lastCandle.open &&
    candleBody > k * atr &&
    lastCandle.close < lastSwingLow;
  const displacementBuy =
    lastCandle.close > lastCandle.open &&
    candleBody > k * atr &&
    lastCandle.close > lastSwingHigh;

  const fvgSell = candles1H.length >= 3
    ? candles1H[candles1H.length - 3].high < lastCandle.low
    : false;
  const fvgBuy = candles1H.length >= 3
    ? candles1H[candles1H.length - 3].low > lastCandle.high
    : false;

  let vcState: VCState = "none";
  if (direction === "sell") {
    if (displacementSell) vcState = "displacement";
    else if (fvgSell) vcState = "fvg";
  } else {
    if (displacementBuy) vcState = "displacement";
    else if (fvgBuy) vcState = "fvg";
  }

  const poiState: POIState = !poi
    ? "invalidated"
    : touch && vcState !== "none"
      ? "confirmed"
      : touch
        ? "touched"
        : "candidate";

  const lastPivotHigh = fractals4H.highs[fractals4H.highs.length - 1]?.price ?? lastPrice;
  const lastPivotLow = fractals4H.lows[fractals4H.lows.length - 1]?.price ?? lastPrice;
  let structureState: StructureState;
  if (direction === "sell") {
    structureState = lastPrice > lastPivotHigh * 1.001 ? "invalidated" : "strongHigh";
  } else {
    structureState = lastPrice < lastPivotLow * 0.999 ? "invalidated" : "strongLow";
  }

  const executionState =
    pdState === (direction === "sell" ? "premium" : "discount") &&
    poiState === "confirmed" &&
    structureState !== "invalidated"
      ? "allowed"
      : "forbidden";

  let nextAction = "";
  if (structureState === "invalidated") {
    nextAction = "invalidated: пересборка";
  } else if (poiState === "candidate") {
    nextAction = "candidate: ждать касания";
  } else if (poiState === "touched") {
    nextAction = "touched: ждать VC";
  } else if (poiState === "confirmed") {
    nextAction = "confirmed: allowed искать execution";
  } else {
    nextAction = "invalidated: пересборка";
  }

  return {
    symbol,
    direction,
    pdState,
    dealingRange,
    poi,
    poiState,
    vcState,
    structureState,
    executionState,
    nextAction,
    lastPrice,
    timestamp: Date.now(),
  };
};

const broadcast = (event: WsEvent, symbol: string) => {
  const payload = JSON.stringify(event);
  for (const client of clients) {
    if (client.symbol === symbol && client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(payload);
    }
  }
};

const connectBinanceStream = (symbol: string) => {
  const interval = tfToInterval["1H"].toLowerCase();
  const wsUrl = `${BINANCE_WS}/${symbol.toLowerCase()}@kline_${interval}`;
  const ws = new WebSocket(wsUrl);

  ws.on("message", async (data) => {
    try {
      const parsed = JSON.parse(data.toString()) as {
        k: {
          t: number;
          o: string;
          h: string;
          l: string;
          c: string;
          v: string;
          x: boolean;
        };
      };
      if (!parsed.k.x) return;
      const candle: Candle = {
        time: parsed.k.t,
        open: Number(parsed.k.o),
        high: Number(parsed.k.h),
        low: Number(parsed.k.l),
        close: Number(parsed.k.c),
        volume: Number(parsed.k.v),
      };
      updateCacheWithCandle(symbol, "1H", candle);
      const candles = await fetchCandles(symbol, "1H", 1000);
      const analysis = await computeAnalysis(symbol);
      lastAnalysis.set(symbol, analysis);
      broadcast(
        { type: "candles_update", payload: { symbol, tf: "1H", candles } },
        symbol,
      );
      broadcast({ type: "analysis_update", payload: analysis }, symbol);
    } catch (error) {
      console.error("Binance WS parse error", error);
    }
  });

  ws.on("close", () => {
    setTimeout(() => connectBinanceStream(symbol), 2_000);
  });

  ws.on("error", (error) => {
    console.error("Binance WS error", error);
    ws.close();
  });
};

const start = async () => {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/api/symbols", async () => ({ symbols: SYMBOLS }));

  app.get("/api/candles", async (request, reply) => {
    const { symbol, tf, limit } = request.query as {
      symbol?: string;
      tf?: string;
      limit?: string;
    };
    try {
      const normalizedSymbol = clampSymbol(symbol);
      const normalizedTf = clampTf(tf);
      const limitNum = Math.min(Number(limit) || 1000, 1000);
      const candles = await fetchCandles(normalizedSymbol, normalizedTf, limitNum);
      const response: CandlesResponse = {
        symbol: normalizedSymbol,
        tf: normalizedTf,
        candles,
      };
      return response;
    } catch (error) {
      reply.status(502);
      return { error: "Failed to fetch candles" };
    }
  });

  app.get("/api/analysis", async (request, reply) => {
    const { symbol } = request.query as { symbol?: string };
    try {
      const normalizedSymbol = clampSymbol(symbol);
      const analysis = await computeAnalysis(normalizedSymbol);
      lastAnalysis.set(normalizedSymbol, analysis);
      return analysis;
    } catch (error) {
      reply.status(502);
      return { error: "Failed to compute analysis" };
    }
  });

  app.get(
    "/ws",
    { websocket: true },
    (connection, req) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const symbol = clampSymbol(url.searchParams.get("symbol") ?? undefined);
      const client = { socket: connection.socket, symbol };
      clients.add(client);

      const cachedAnalysis = lastAnalysis.get(symbol);
      if (cachedAnalysis) {
        connection.socket.send(
          JSON.stringify({ type: "analysis_update", payload: cachedAnalysis }),
        );
      }

      connection.socket.on("close", () => {
        clients.delete(client);
      });
    },
  );

  await app.listen({ port: 3001, host: "0.0.0.0" });
  SYMBOLS.forEach((symbol) => connectBinanceStream(symbol));
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
