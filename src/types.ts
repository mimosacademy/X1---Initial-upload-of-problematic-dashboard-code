export type SignalDirection = 'LONG' | 'SHORT';
export type SignalOutcome = 'PENDING' | 'WIN' | 'LOSS' | 'EXPIRED';

export interface SignalMetrics {
  trend1D: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend4H: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trendAlign: boolean;
  rsi4H: number;
  rsi15M: number;
  macdHistogram: number[];
  macdAlign: boolean;
  volumeSpike: number; // % of 20-period average
  cvdDelta10: number; // Sum of delta taker buy - taker sell for last 10 candles
  cvdAlign: boolean;
  bidAskRatio: number; // bid volume / ask volume of top 20
  spread: number; // % bestAsk - bestBid
  fundingRate: number; // current funding rate
  openInterestChange: number; // % change of OI
  adx?: number;
  volatility?: number;
}

export interface Signal {
  id: string;
  coin: string;
  direction: SignalDirection;
  timestamp: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  score: number;
  outcome: SignalOutcome;
  outcomeTimestamp?: number;
  narrative?: string;
  metrics: SignalMetrics;
  scoreBreakdown: {
    trend: number;
    momentum: number;
    volume: number;
    probability: number;
    liquidity: number;
  };
  sampleSize?: number;
  winRateHistorical?: number;
  regimeId?: number;
  regimeLabel?: string;
  regimeStable?: boolean;
  noTrade?: boolean;
  noTradeReason?: string;
}

export interface MarketStatus {
  btcTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  marketSentiment: number; // % of bullish altcoins
  altcoinStrengthIndex: number; // % altcoins aligned with BTC trend
  activeSignalsCount: number;
  strongSignalsCount: number;
  lastScanTime: number;
  regimeCounts?: Record<number, number>;
  coinRegimes?: Array<{ coin: string; regimeId: number; label: string; stable: boolean }>;
  simulations?: Array<{
    coin: string;
    regimeId: number;
    regimeLabel: string;
    stable: boolean;
    trend1D: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    trend4H: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rsi15M: number;
    rsi4H: number;
    volumeSpike: number;
    spread: number;
    bidAskRatio: number;
    cvdDelta10: number;
    cvdAlign: boolean;
    fundingRate: number;
    score: number;
    rr: number;
    status: 'PASSED' | 'REJECTED';
    rejectReason: string;
  }>;
}

export interface AppSettings {
  minRR: number;
  minScore: number;
  minVolumeSpike: number;
  minSampleSize: number;
  universeSize: number; // 50 | 100 | 150
  allowRangeTrading: boolean;
}

export interface PerformanceStats {
  totalSignals: number;
  winRateOverall: number;
  winRateAPlus: number;
  winRateA: number;
  winRateB: number;
  avgRRRealized: number;
  equityCurve: { timestamp: number; rMultiple: number }[];
}
