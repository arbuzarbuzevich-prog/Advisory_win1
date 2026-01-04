export type Timeframe = "1M" | "1W" | "1D" | "4H" | "1H";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PDState = "premium" | "discount" | "eq";
export type POIState = "candidate" | "touched" | "confirmed" | "rejected" | "invalidated";
export type VCState = "none" | "displacement" | "fvg";
export type StructureState = "strongHigh" | "strongLow" | "invalidated";
export type ExecutionState = "allowed" | "forbidden";

export interface DRRange {
  high: number;
  low: number;
  eq: number;
}

export interface POILevel {
  price: number;
  direction: "buy" | "sell";
  epsilon: number;
}

export interface AnalysisResponse {
  symbol: string;
  direction: "buy" | "sell";
  pdState: PDState;
  dealingRange: DRRange;
  poi: POILevel | null;
  poiState: POIState;
  vcState: VCState;
  structureState: StructureState;
  executionState: ExecutionState;
  nextAction: string;
  lastPrice: number;
  timestamp: number;
}

export interface CandlesResponse {
  symbol: string;
  tf: Timeframe;
  candles: Candle[];
}

export type WsEvent =
  | { type: "candles_update"; payload: CandlesResponse }
  | { type: "analysis_update"; payload: AnalysisResponse };
