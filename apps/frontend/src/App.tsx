import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi } from "lightweight-charts";
import type {
  AnalysisResponse,
  Candle,
  CandlesResponse,
  Timeframe,
  WsEvent,
} from "@shared/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const timeframes: Timeframe[] = ["1M", "1W", "1D", "4H", "1H"];

const toSeries = (candles: Candle[]) =>
  candles.map((candle) => ({
    time: Math.floor(candle.time / 1000) as number,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  }));

const formatPrice = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });

const App = () => {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState<Timeframe>("1H");
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);

  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const poiLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[] | null>(null);
  const drLinesRef = useRef<ReturnType<ISeriesApi<"Candlestick">["createPriceLine"]>[] | null>(null);

  const wsUrl = useMemo(() => `${API_URL.replace("http", "ws")}/ws?symbol=${symbol}`, [symbol]);

  useEffect(() => {
    const chart = createChart(chartRef.current!, {
      height: 520,
      layout: { background: { color: "#0b1220" }, textColor: "#e2e8f0" },
      grid: { vertLines: { color: "#1f2937" }, horzLines: { color: "#1f2937" } },
      timeScale: { borderColor: "#1f2937" },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderDownColor: "#ef4444",
      borderUpColor: "#22c55e",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    chartApiRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const load = async () => {
      const response = await fetch(
        `${API_URL}/api/candles?symbol=${symbol}&tf=${timeframe}&limit=500`,
      );
      const payload = (await response.json()) as CandlesResponse;
      setCandles(payload.candles);
      seriesRef.current?.setData(toSeries(payload.candles));
      chartApiRef.current?.timeScale().fitContent();
    };
    load();
  }, [symbol, timeframe]);

  useEffect(() => {
    const loadAnalysis = async () => {
      const response = await fetch(`${API_URL}/api/analysis?symbol=${symbol}`);
      const payload = (await response.json()) as AnalysisResponse;
      setAnalysis(payload);
    };
    loadAnalysis();
  }, [symbol]);

  useEffect(() => {
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as WsEvent;
      if (parsed.type === "candles_update") {
        if (parsed.payload.tf === timeframe) {
          const updated = parsed.payload.candles;
          setCandles(updated);
          seriesRef.current?.setData(toSeries(updated));
        }
      }
      if (parsed.type === "analysis_update") {
        setAnalysis(parsed.payload);
      }
    };
    return () => {
      socket.close();
    };
  }, [wsUrl, timeframe]);

  useEffect(() => {
    if (!analysis || !seriesRef.current) return;
    poiLinesRef.current?.forEach((line) => seriesRef.current?.removePriceLine(line));
    drLinesRef.current?.forEach((line) => seriesRef.current?.removePriceLine(line));

    const drLines = [
      seriesRef.current.createPriceLine({
        price: analysis.dealingRange.high,
        color: "#38bdf8",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "DR High",
      }),
      seriesRef.current.createPriceLine({
        price: analysis.dealingRange.low,
        color: "#38bdf8",
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: "DR Low",
      }),
      seriesRef.current.createPriceLine({
        price: analysis.dealingRange.eq,
        color: "#fbbf24",
        lineWidth: 1,
        lineStyle: 0,
        axisLabelVisible: true,
        title: "DR EQ",
      }),
    ];

    const poiLines = analysis.poi
      ? [
          seriesRef.current.createPriceLine({
            price: analysis.poi.price + analysis.poi.epsilon,
            color: "#a855f7",
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: "POI High",
          }),
          seriesRef.current.createPriceLine({
            price: analysis.poi.price - analysis.poi.epsilon,
            color: "#a855f7",
            lineWidth: 1,
            lineStyle: 1,
            axisLabelVisible: true,
            title: "POI Low",
          }),
        ]
      : [];

    poiLinesRef.current = poiLines;
    drLinesRef.current = drLines;
  }, [analysis]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="controls">
          <label>
            Symbol
            <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
            </select>
          </label>
          <label>
            Timeframe
            <select
              value={timeframe}
              onChange={(event) => setTimeframe(event.target.value as Timeframe)}
            >
              {timeframes.map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="price">
          <span>Last:</span>
          <strong>{analysis ? formatPrice(analysis.lastPrice) : "--"}</strong>
        </div>
      </header>

      <main className="content">
        <section className="chart" ref={chartRef} />
        <aside className="panel">
          <h2>Status</h2>
          <ul>
            <li>
              <span>PD</span>
              <strong>{analysis?.pdState ?? "--"}</strong>
            </li>
            <li>
              <span>Direction</span>
              <strong>{analysis?.direction ?? "--"}</strong>
            </li>
            <li>
              <span>POI State</span>
              <strong>{analysis?.poiState ?? "--"}</strong>
            </li>
            <li>
              <span>VC</span>
              <strong>{analysis?.vcState ?? "--"}</strong>
            </li>
            <li>
              <span>Structure</span>
              <strong>{analysis?.structureState ?? "--"}</strong>
            </li>
            <li>
              <span>Execution</span>
              <strong>{analysis?.executionState ?? "--"}</strong>
            </li>
            <li className="next">
              <span>NextAction</span>
              <strong>{analysis?.nextAction ?? "--"}</strong>
            </li>
          </ul>
        </aside>
      </main>

      <footer className="legend">
        <span className="tag">DR High/Low/EQ</span>
        <span className="tag">POI band (±epsilon)</span>
        <span className="tag">TF: {timeframe}</span>
      </footer>
    </div>
  );
};

export default App;
