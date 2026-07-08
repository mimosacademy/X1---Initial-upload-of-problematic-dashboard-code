/**
 * Ultimate Strategy Engine
 * - Provides evaluation for D1 (Trend), H4 (Momentum), M15 (Entry)
 * - Orderflow (bid/ask ratio, volume delta, whale detection)
 * - Volume spike filter, scoring, confidence, SL/TP, grading, ranking helper
 *
 * NOTE:
 * - Expects candle arrays in ascending chronological order (old -> new)
 * - This module is self-contained and pure-TS. Integrate with your data sources:
 *   D1 candles, H4 candles, M15 candles, orderbook snapshot, recent trades
 */

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type Orderbook = { bids: [number, number][]; asks: [number, number][] }; // [price, size]
export type Trade = { price: number; size: number; side: 'buy' | 'sell'; ts: number; quoteValue?: number };

export type SignalDirection = 'LONG' | 'SHORT' | 'NONE';

export type EvaluateInput = {
  pair: string;
  d1: Candle[]; // daily
  h4: Candle[]; // 4h
  m15: Candle[]; // 15min
  orderbook?: Orderbook;
  trades?: Trade[]; // recent trades (e.g., last 5-15 minutes)
  tickers?: { bid?: number; ask?: number; last?: number };
  quoteCurrency?: string; // for whale detection (e.g., 'USDT')
  price?: number; // current price (optional, defaults to last of m15)
};

export type EvaluateResult = {
  pair: string;
  direction: SignalDirection;
  confidence: number; // 0-100
  grade: 'ELITE' | 'STRONG' | 'GOOD' | 'MODERATE' | 'WAIT';
  scoreBreakdown: {
    d1Trend: number;
    h4Momentum: number;
    m15Entry: number;
    orderflow: number;
  };
  reasons: string[];
  sl?: number;
  tps?: number[]; // [TP1, TP2, TP3]
  timestamp: number;
};

/* ------------------------ helpers: indicators ------------------------ */
export function sma(values: number[], length: number) {
  if (values.length < length) return null;
  const slice = values.slice(-length);
  return slice.reduce((s, x) => s + x, 0) / length;
}

export function ema(values: number[], length: number) {
  if (values.length < length) return null;
  const k = 2 / (length + 1);
  let emaPrev = sma(values.slice(0, length), length) as number;
  for (let i = length; i < values.length; i++) {
    emaPrev = values[i] * k + emaPrev * (1 - k);
  }
  return emaPrev;
}

export function rsi(values: number[], length = 14) {
  if (values.length <= length) return null;

  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i <= length; i++) {
    const delta = values[i] - values[i - 1];
    if (delta > 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  let avgGain = gains / length;
  let avgLoss = losses / length;

  // FIXED: Forward iteration for Wilder's smoothing (was backward before!)
  for (let i = length + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = (avgGain * (length - 1) + gain) / length;
    avgLoss = (avgLoss * (length - 1) + loss) / length;
  }

  if (avgLoss === 0) {
    return avgGain > 0 ? 100 : 0;
  }

  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function atr(candles: Candle[], length = 14) {
  if (candles.length <= length) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i], prev = candles[i - 1];
    const tr = Math.max(cur.h - cur.l, Math.abs(cur.h - prev.c), Math.abs(cur.l - prev.c));
    trs.push(tr);
  }
  // simple sma of TRs for initial ATR
  const init = sma(trs.slice(0, length), length) as number;
  let atrPrev = init;
  for (let i = length; i < trs.length; i++) {
    atrPrev = (atrPrev * (length - 1) + trs[i]) / length;
  }
  return atrPrev;
}

// Supertrend basic implementation
export function supertrend(candles: Candle[], atrLen = 10, multiplier = 3) {
  // returns last supertrend value and direction: +1 bullish, -1 bearish
  if (candles.length <= atrLen) return null;
  const a = atr(candles, atrLen);
  if (a === null) return null;
  const hl2 = (candles[candles.length - 1].h + candles[candles.length - 1].l) / 2;
  const finalUpperBand = hl2 + multiplier * a;
  const finalLowerBand = hl2 - multiplier * a;
  // crude determination: if close > finalUpperBand => buy, if close < finalLowerBand => sell
  const lastClose = candles[candles.length - 1].c;
  if (lastClose > finalUpperBand) return { value: finalUpperBand, dir: 1 };
  if (lastClose < finalLowerBand) return { value: finalLowerBand, dir: -1 };
  // else maintain previous trend estimate by comparing close to hl2
  return { value: hl2, dir: lastClose >= hl2 ? 1 : -1 };
}

// ADX (simplified): true directional movement and smoothed ratios
export function adx(candles: Candle[], length = 14) {
  if (candles.length <= length * 2) return null;
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].h - candles[i - 1].h;
    const downMove = candles[i - 1].l - candles[i].l;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(candles[i].h - candles[i].l, Math.abs(candles[i].h - candles[i - 1].c), Math.abs(candles[i].l - candles[i - 1].c)));
  }
  // smooth
  const atrVal = sma(tr.slice(-length), length) || 0;
  const pdi = 100 * ((sma(plusDM.slice(-length), length) || 0) / (atrVal || 1));
  const mdi = 100 * ((sma(minusDM.slice(-length), length) || 0) / (atrVal || 1));
  const dx = 100 * (Math.abs(pdi - mdi) / (pdi + mdi || 1));
  // smooth DX into ADX by simple average
  const adxVal = sma(new Array(length).fill(dx), length) || dx;
  return adxVal;
}

// MACD histogram
export function macdHistogram(values: number[], fast = 12, slow = 26, signal = 9) {
  if (values.length < slow + signal) return null;
  const emaFast = ema(values.slice(- (slow + signal)), fast) as number;
  const emaSlow = ema(values.slice(- (slow + signal)), slow) as number;
  if (!emaFast || !emaSlow) return null;
  const macdLine = emaFast - emaSlow;
  // compute signal line on macd series - here approximate by computing macd series for window
  const macdSeries: number[] = [];
  // build macd series across the window (slow+signal) for signal calculation
  for (let i = slow; i <= values.length; i++) {
    const slice = values.slice(i - slow, i);
    const ef = ema(slice, fast);
    const es = ema(slice, slow);
    if (ef == null || es == null) continue;
    macdSeries.push((ef as number) - (es as number));
  }
  const signalLine = ema(macdSeries.slice(- (signal + 5)), signal) as number; // approximation
  const hist = macdLine - (signalLine || 0);
  return hist;
}

export function bollinger(values: number[], length = 20, stdDev = 2) {
  if (values.length < length) return null;
  const slice = values.slice(-length);
  const mean = sma(slice, length) as number;
  const variance = slice.reduce((s, x) => s + (x - mean) ** 2, 0) / length;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd, sd };
}

/* ------------------------ Orderflow helpers ------------------------ */
export function bidAskRatio(orderbook?: Orderbook, tickers?: { bid?: number; ask?: number }) {
  if (!orderbook) {
    if (tickers && tickers.bid && tickers.ask) {
      // approximate: spread ratio of depth not available
      return (tickers.bid || 0) > 0 && (tickers.ask || 1) > 0 ? (tickers.bid || 0) / (tickers.ask || 1) : 1;
    }
    return 1;
  }
  const bidSize = orderbook.bids.slice(0, 10).reduce((s, [, size]) => s + size, 0);
  const askSize = orderbook.asks.slice(0, 10).reduce((s, [, size]) => s + size, 0);
  if (askSize === 0) return bidSize > 0 ? 999 : 1;
  return bidSize / askSize;
}

export function volumeDelta(trades: Trade[], windowMinutes = 5) {
  if (!trades || trades.length === 0) return 0;
  const now = Date.now();
  const start = now - windowMinutes * 60 * 1000;
  const recent = trades.filter(t => t.ts >= start);
  let buy = 0, sell = 0;
  for (const t of recent) {
    const q = t.quoteValue ?? (t.price * t.size);
    if (t.side === 'buy') buy += q; else sell += q;
  }
  return buy - sell; // positive => buying pressure
}

export function whaleDetected(trades: Trade[], thresholdQuote = 50000) { // e.g., USDT
  if (!trades) return false;
  for (const t of trades) {
    const q = t.quoteValue ?? (t.price * t.size);
    if (q >= thresholdQuote) return true;
  }
  return false;
}

/**
 * FIXED: Proper confidence calculation per specification
 * D1 Trend (25) + H4 Momentum (25) + M15 Entry (30) + OrderFlow (20) = 100 max
 */
function calculateConfidence(scores: {
  d1Trend: number;
  h4Momentum: number;
  m15Entry: number;
  orderflowScore: number;
  conflictingSignals: number;
  volumeSpikeConfirmed: boolean;
}): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  
  // Positive contributions only
  const positive = 
    Math.max(0, scores.d1Trend) +
    Math.max(0, scores.h4Momentum) +
    Math.max(0, scores.m15Entry) +
    Math.max(0, scores.orderflowScore);

  // Penalty for conflicts (-15 per opposing signal)
  const conflictPenalty = scores.conflictingSignals * 15;

  // Volume spike penalty (-20 if missing on bullish setup)
  const volumePenalty = positive > 0 && !scores.volumeSpikeConfirmed ? 20 : 0;

  let confidence = Math.max(0, Math.min(100, positive - conflictPenalty - volumePenalty));

  reasons.push(`Breakdown: D1=${Math.max(0, scores.d1Trend)}pt + H4=${Math.max(0, scores.h4Momentum)}pt + M15=${Math.max(0, scores.m15Entry)}pt + OF=${Math.max(0, scores.orderflowScore)}pt = ${positive}`);
  if (conflictPenalty > 0) reasons.push(`Conflict penalty: -${conflictPenalty}`);
  if (volumePenalty > 0) reasons.push(`Volume spike penalty: -${volumePenalty}`);
  reasons.push(`Final Confidence: ${confidence.toFixed(0)}/100`);

  return { confidence, reasons };
}

/* ------------------------ Core evaluation ------------------------ */
export function evaluatePair(input: EvaluateInput): EvaluateResult {
  const { pair, d1, h4, m15, orderbook, trades, tickers } = input;
  const now = Date.now();
  const reasons: string[] = [];
  // Defensive: current price
  const currentPrice = input.price ?? (m15 && m15.length ? m15[m15.length - 1].c : (h4 && h4.length ? h4[h4.length - 1].c : d1[d1.length - 1].c));

  // D1 Trend engine
  const closesD1 = d1.map(c => c.c);
  const ema50_d1 = ema(closesD1, 50);
  const ema200_d1 = ema(closesD1, 200);
  const super_d1 = supertrend(d1, 10, 3);
  const adx_d1 = adx(d1, 14);
  let d1Score = 0;
  let d1Signal: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
  if (ema50_d1 && ema200_d1 && adx_d1 != null && super_d1) {
    if (currentPrice > (ema200_d1 as number) && (ema50_d1 as number) > (ema200_d1 as number) && (adx_d1 as number) > 25 && super_d1.dir === 1) {
      d1Score = 25; d1Signal = 'BULL'; reasons.push('D1 Trend: BULL confirmed');
    } else if (currentPrice < (ema200_d1 as number) && (ema50_d1 as number) < (ema200_d1 as number) && (adx_d1 as number) > 25 && super_d1.dir === -1) {
      d1Score = -25; d1Signal = 'BEAR'; reasons.push('D1 Trend: BEAR confirmed');
    } else {
      reasons.push('D1 Trend: not confirmed');
    }
  } else {
    reasons.push('D1 Trend: insufficient data');
  }

  // H4 Momentum engine
  const closesH4 = h4.map(c => c.c);
  const rsi_h4 = rsi(closesH4, 14);
  const macdHist_h4 = macdHistogram(closesH4, 12, 26, 9);
  const ema50_h4 = ema(closesH4, 50);
  let h4Score = 0;
  let h4Signal: 'BULL' | 'BEAR' | 'NEUTRAL' = 'NEUTRAL';
  if (rsi_h4 != null && macdHist_h4 != null && ema50_h4 != null) {
    if (rsi_h4 > 55 && macdHist_h4 > 0 && currentPrice > (ema50_h4 as number)) {
      h4Score = 25; h4Signal = 'BULL'; reasons.push('H4 Momentum: BULL confirmed');
    } else if (rsi_h4 < 45 && macdHist_h4 < 0 && currentPrice < (ema50_h4 as number)) {
      h4Score = -25; h4Signal = 'BEAR'; reasons.push('H4 Momentum: BEAR confirmed');
    } else {
      reasons.push('H4 Momentum: not confirmed');
    }
  } else {
    reasons.push('H4 Momentum: insufficient data');
  }

  // M15 Entry engine
  const closesM15 = m15.map(c => c.c);
  const ema20_m15 = ema(closesM15, 20);
  const ema50_m15 = ema(closesM15, 50);
  const atr_m15 = atr(m15, 14);
  const boll_m15 = bollinger(closesM15, 20, 2);
  let m15Score = 0;
  let m15Signal: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
  // LuxAlgo placeholder: expect external boolean flags; for now treat as "unknown" and require only EMA cross + volume spike
  if (ema20_m15 != null && ema50_m15 != null) {
    // check volume spike below
    const volSpike = isVolumeSpike(m15, 1.8);
    if (ema20_m15 > ema50_m15 && volSpike) {
      m15Score = 30; m15Signal = 'LONG'; reasons.push('M15 Entry: LONG confirmed (EMA20>EMA50 + volume spike)');
    } else if (ema20_m15 < ema50_m15 && volSpike) {
      m15Score = -30; m15Signal = 'SHORT'; reasons.push('M15 Entry: SHORT confirmed (EMA20<EMA50 + volume spike)');
    } else {
      reasons.push('M15 Entry: not confirmed');
    }
  } else {
    reasons.push('M15 Entry: insufficient data');
  }

  // Orderflow engine (Hummingbot-like)
  const bar = bidAskRatio(orderbook, tickers);
  const vd = trades ? volumeDelta(trades, 5) : 0;
  const whale = trades ? whaleDetected(trades, 50000) : false;
  let orderflowScore = 0;
  if (bar > 1.3 || vd > 0 || whale) {
    if (bar > 1.3 || vd > 0 || whale) {
      // stronger bias toward buy when multiple conditions true
      if ((bar > 1.3 && vd > 0) || whale) {
        orderflowScore = 20; reasons.push('Orderflow: Strong Buy (bid>ask, positive delta or whale)');
      } else {
        orderflowScore = 10; reasons.push('Orderflow: Mild buy pressure');
      }
    }
  } else if (bar < 0.7 || vd < 0) {
    orderflowScore = -20; reasons.push('Orderflow: Strong Sell (ask side dominant or negative delta)');
  } else {
    reasons.push('Orderflow: neutral');
  }

  // Volume spike final filter (required)
  const volSpikePass = isVolumeSpike(m15, 1.8);
  if (!volSpikePass) {
    reasons.push('Volume Spike Filter: FAIL (no 1.8x volume) => Signal reject if required');
  } else {
    reasons.push('Volume Spike Filter: PASS');
  }

  // Direction decision rules and ELITE trigger rules
  // Determine direction by signs of D1 and H4 and M15 entry + orderflow
  let direction: SignalDirection = 'NONE';
  // Decide aggregated signs
  const d1Sign = Math.sign(d1Score);
  const h4Sign = Math.sign(h4Score);
  const m15Sign = Math.sign(m15Score);
  const ofSign = Math.sign(orderflowScore);
  const sumSigns = d1Sign + h4Sign + (m15Sign > 0 ? 1 : (m15Sign < 0 ? -1 : 0)) + (ofSign > 0 ? 1 : (ofSign < 0 ? -1 : 0));
  if (sumSigns > 0) direction = 'LONG';
  else if (sumSigns < 0) direction = 'SHORT';
  else direction = 'NONE';

  // Sum scores into confidence
  // mapping per your formula:
  // D1 Trend = 25, H4 Momentum = 25, M15 Entry = 30, Order Flow = 20 (total 100)
  const scoreBreakdown = {
    d1Trend: d1Score,
    h4Momentum: h4Score,
    m15Entry: m15Score,
    orderflow: orderflowScore,
  };

  // Identify conflicts: if overall direction is LONG, any negative signal is a conflict. If overall direction is SHORT, any positive signal is a conflict.
  let conflictingSignals = 0;
  if (direction === 'LONG') {
    if (d1Score < 0) conflictingSignals++;
    if (h4Score < 0) conflictingSignals++;
    if (m15Score < 0) conflictingSignals++;
    if (orderflowScore < 0) conflictingSignals++;
  } else if (direction === 'SHORT') {
    if (d1Score > 0) conflictingSignals++;
    if (h4Score > 0) conflictingSignals++;
    if (m15Score > 0) conflictingSignals++;
    if (orderflowScore > 0) conflictingSignals++;
  }

  const { confidence, reasons: confidenceReasons } = calculateConfidence({
    d1Trend: d1Score,
    h4Momentum: h4Score,
    m15Entry: m15Score,
    orderflowScore,
    conflictingSignals,
    volumeSpikeConfirmed: volSpikePass,
  });
  reasons.push(...confidenceReasons);

  // Grade by mapping
  let grade: EvaluateResult['grade'] = 'WAIT';
  if (confidence >= 95) grade = 'ELITE';
  else if (confidence >= 90) grade = 'STRONG';
  else if (confidence >= 80) grade = 'GOOD';
  else if (confidence >= 70) grade = 'MODERATE';
  else grade = 'WAIT';

  // Enforcement of trigger rules for ELITE (per your spec)
  const eliteRequirements = [
    d1Sign > 0, // D1 Trend confirmed bullish
    h4Sign > 0, // H4 momentum confirmed bullish
    m15Sign > 0, // M15 Entry confirmed
    volSpikePass,
    bar > 1.3,
    confidence >= 90,
  ];
  const eliteOk = eliteRequirements.every(Boolean);
  if (grade === 'ELITE' && !eliteOk) {
    // demote if missing strict requirements
    grade = 'STRONG';
    reasons.push('ELITE requirements not fully met, demoted to STRONG');
  }

  // compute SL and TPs for long/short using ATR
  let sl: number | undefined = undefined;
  const tps: number[] = [];
  if (direction !== 'NONE' && atr_m15) {
    const slMult = 1.5; // scalping default. Could be configurable
    const slPrice = direction === 'LONG' ? currentPrice - (atr_m15 * slMult) : currentPrice + (atr_m15 * slMult);
    sl = Math.max(0, slPrice);
    // TPs: 1:1, 1:2, 1:3
    const riskDist = Math.abs(currentPrice - sl);
    if (riskDist > 0) {
      if (direction === 'LONG') {
        tps.push(currentPrice + riskDist * 1);
        tps.push(currentPrice + riskDist * 2);
        tps.push(currentPrice + riskDist * 3);
      } else {
        tps.push(currentPrice - riskDist * 1);
        tps.push(currentPrice - riskDist * 2);
        tps.push(currentPrice - riskDist * 3);
      }
    }
  }

  return {
    pair,
    direction,
    confidence,
    grade,
    scoreBreakdown,
    reasons,
    sl,
    tps,
    timestamp: now,
  };
}

/* ------------------------ Utility: volume spike ------------------------ */
export function isVolumeSpike(candles: Candle[], factor = 1.8, lookback = 20) {
  if (!candles || candles.length < lookback + 1) return false;
  const last = candles[candles.length - 1];
  const avg = sma(candles.slice(0, candles.length - 1).map(c => c.v), lookback);
  if (!avg || avg <= 0) return false;
  return last.v > (avg * factor);
}

/* ------------------------ Pair ranking helper ------------------------ */
export function rankPairs(results: EvaluateResult[]) {
  // Sort by: 1) confidence desc, 2) volume spike (we can't compute here) 3) ATR expansion (approx: ATR / price) 4) orderflow score
  return results
    .map(r => ({ ...r, atrExpansion: r.sl && r.tps && r.tps.length ? Math.abs((r.tps[2] - (r.sl as number)) / (r.sl as number || 1)) : 0 }))
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if ((b.atrExpansion || 0) !== (a.atrExpansion || 0)) return (b.atrExpansion || 0) - (a.atrExpansion || 0);
      return 0;
    });
}
