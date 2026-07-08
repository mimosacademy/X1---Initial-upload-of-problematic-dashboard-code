import { calculateEMA, calculateRSI, calculateADX } from './indicators.js';

export interface RegimeData {
  id: number;
  label: string;
  strategy: string;
  color: string;
}

export const REGIMES: Record<number, RegimeData> = {
  1: { id: 1, label: '🟢 AGGRESSIVE LONG', strategy: 'LONG sahaja, elak SHORT', color: 'bg-emerald-500/10 border-emerald-500 text-emerald-400' },
  2: { id: 2, label: '🔥 MUST FOLLOW', strategy: 'LONG di breakout candle high sahaja', color: 'bg-orange-500/10 border-orange-500 text-orange-400 font-bold' },
  3: { id: 3, label: '✅ SAFE LONG', strategy: 'LONG di zon support/EMA', color: 'bg-cyan-500/10 border-cyan-500 text-cyan-400' },
  4: { id: 4, label: '🟡 RANGE TRADING', strategy: 'Buy support/sell resistance sahaja, TIADA breakout trade', color: 'bg-yellow-500/10 border-yellow-500 text-yellow-400' },
  5: { id: 5, label: '⚪ WAIT — NO TRADE', strategy: 'Tiada trade dibenarkan untuk coin ini', color: 'bg-zinc-500/10 border-zinc-500 text-zinc-400' },
  6: { id: 6, label: '🔴 MUST FOLLOW SHORT', strategy: 'SHORT di breakout candle low sahaja', color: 'bg-rose-600/10 border-rose-600 text-rose-400 font-bold' },
  7: { id: 7, label: '🔴 SAFE SHORT', strategy: 'SHORT di zon resistance/EMA', color: 'bg-red-500/10 border-red-500 text-red-400' },
  8: { id: 8, label: '🚨 AGGRESSIVE SHORT', strategy: 'SHORT sahaja, elak LONG', color: 'bg-red-600/10 border-red-600 text-rose-500' },
};

interface SwingPoint {
  index: number;
  price: number;
  type: 'HIGH' | 'LOW';
}

// Calculate Fractal 5-candle swings
export function getSwingStructure(highs: number[], lows: number[]): {
  structure: 'HH_HL' | 'LH_LL' | 'CHOPPY';
  latestSwingHigh: number;
  latestSwingLow: number;
} {
  const len = highs.length;
  const swingPoints: SwingPoint[] = [];

  for (let i = 2; i < len - 2; i++) {
    // Check Swing High
    if (
      highs[i] > highs[i - 1] &&
      highs[i] > highs[i - 2] &&
      highs[i] > highs[i + 1] &&
      highs[i] > highs[i + 2]
    ) {
      swingPoints.push({ index: i, price: highs[i], type: 'HIGH' });
    }

    // Check Swing Low
    if (
      lows[i] < lows[i - 1] &&
      lows[i] < lows[i - 2] &&
      lows[i] < lows[i + 1] &&
      lows[i] < lows[i + 2]
    ) {
      swingPoints.push({ index: i, price: lows[i], type: 'LOW' });
    }
  }

  const swingHighs = swingPoints.filter(p => p.type === 'HIGH');
  const swingLows = swingPoints.filter(p => p.type === 'LOW');

  const defaultHigh = highs[len - 1];
  const defaultLow = lows[len - 1];

  if (swingHighs.length < 2 || swingLows.length < 2) {
    return {
      structure: 'CHOPPY',
      latestSwingHigh: swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : defaultHigh,
      latestSwingLow: swingLows.length > 0 ? swingLows[swingLows.length - 1].price : defaultLow,
    };
  }

  const hLatest = swingHighs[swingHighs.length - 1].price;
  const hPrev = swingHighs[swingHighs.length - 2].price;

  const lLatest = swingLows[swingLows.length - 1].price;
  const lPrev = swingLows[swingLows.length - 2].price;

  let structure: 'HH_HL' | 'LH_LL' | 'CHOPPY' = 'CHOPPY';
  if (hLatest > hPrev && lLatest > lPrev) {
    structure = 'HH_HL';
  } else if (hLatest < hPrev && lLatest < lPrev) {
    structure = 'LH_LL';
  }

  return {
    structure,
    latestSwingHigh: hLatest,
    latestSwingLow: lLatest,
  };
}

// Calculate Bollinger Band Width and BBWidth Percentiles over last 100 candles
export function getVolatilityStates(closes: number[]): {
  percentiles: number[];
  expansionBaharu: boolean;
  trendStabil: boolean;
  contractionSqueeze: boolean;
} {
  const len = closes.length;
  const bbWidths: number[] = new Array(len).fill(0);

  for (let i = 19; i < len; i++) {
    const slice = closes.slice(i - 19, i + 1);
    const middle = slice.reduce((sum, v) => sum + v, 0) / 20;

    const variance = slice.reduce((sum, v) => sum + Math.pow(v - middle, 2), 0) / 20;
    const stdDev = Math.sqrt(variance);

    const upper = middle + 2 * stdDev;
    const lower = middle - 2 * stdDev;
    bbWidths[i] = middle > 0 ? (upper - lower) / middle : 0;
  }

  const percentiles: number[] = new Array(len).fill(0);
  for (let i = 19; i < len; i++) {
    const lookbackStart = Math.max(19, i - 99);
    const lookbackSlice = bbWidths.slice(lookbackStart, i + 1);
    const currentVal = bbWidths[i];

    const count = lookbackSlice.filter(v => v <= currentVal).length;
    percentiles[i] = (count / lookbackSlice.length) * 100;
  }

  const lastPercentile = percentiles[len - 1];
  const contractionSqueeze = lastPercentile < 20;

  let expansionBaharu = false;
  for (let i = len - 3; i < len; i++) {
    if (i >= 0 && percentiles[i] >= 60) {
      for (let j = Math.max(0, i - 3); j <= i; j++) {
        if (percentiles[j] <= 20) {
          expansionBaharu = true;
          break;
        }
      }
    }
    if (expansionBaharu) break;
  }

  let trendStabil = true;
  if (len >= 6) {
    for (let i = len - 6; i < len; i++) {
      if (percentiles[i] < 60) {
        trendStabil = false;
        break;
      }
    }
  } else {
    trendStabil = false;
  }

  return {
    percentiles: percentiles.slice(len - 15),
    expansionBaharu,
    trendStabil,
    contractionSqueeze,
  };
}

// Check horizontal range metrics (deviation < 3% from midpoint of last 20 candles)
export function getRangeMetrics(highs: number[], lows: number[]): {
  deviation: number;
  midpoint: number;
  support: number;
  resistance: number;
  touches: number;
} {
  const len = highs.length;
  const last20Highs = highs.slice(len - 20);
  const last20Lows = lows.slice(len - 20);

  const highest = Math.max(...last20Highs);
  const lowest = Math.min(...last20Lows);
  const midpoint = (highest + lowest) / 2;
  const deviation = midpoint > 0 ? ((highest - lowest) / midpoint) * 100 : 100;

  let touches = 0;
  const thresholdSupport = lowest * 1.003;
  const thresholdResistance = highest * 0.997;

  for (let i = len - 20; i < len; i++) {
    if (lows[i] <= thresholdSupport) touches++;
    if (highs[i] >= thresholdResistance) touches++;
  }

  return {
    deviation,
    midpoint,
    support: lowest,
    resistance: highest,
    touches,
  };
}

// Calculate Volume State
export function getVolumeState(volumes: number[]): { volumeRendah: boolean } {
  const len = volumes.length;
  if (len < 120) return { volumeRendah: false };

  const avgVol20 = volumes.slice(len - 20).reduce((s, v) => s + v, 0) / 20;
  const avgVol100Prev = volumes.slice(len - 120, len - 20).reduce((s, v) => s + v, 0) / 100;

  return {
    volumeRendah: avgVol100Prev > 0 ? avgVol20 < 0.5 * avgVol100Prev : false,
  };
}

// Primary Classification function (using 4H for trend bias and 15M for structure/ADX/volatility)
export function runClassification(
  closes1D: number[],
  highs4H: number[],
  lows4H: number[],
  closes4H: number[],
  volumes4H: number[],
  rsi15M: number,
  m15Closes: number[],
  m15Highs: number[],
  m15Lows: number[],
  volumeSpike15M: number,
  indexOffset = 0,
  spread = 0,
  bidAskDepthRatio = 1.0,
  m15Volumes: number[] = []
): {
  id: number;
  label: string;
  trend1D: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trend4H: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  structure: 'HH_HL' | 'LH_LL' | 'CHOPPY';
  adx4H: number;
  bbWidthPercentile: number;
  deviation: number;
  touches: number;
  midpoint: number;
  support: number;
  resistance: number;
} {
  // A2. Lapisan CIRCUIT BREAKER - Semakan paling awal sebelum apa-apa trend
  const isIlliquid = spread > 0.03 || bidAskDepthRatio < 0.15 || bidAskDepthRatio > 6.0;
  
  // Calculate trend1D solely as macro information context
  const d1Ema50 = calculateEMA(closes1D, 50);
  const d1Ema200 = calculateEMA(closes1D, 200);
  const d1Ema50Last = d1Ema50[d1Ema50.length - 1] || 0;
  const d1Ema200Last = d1Ema200[d1Ema200.length - 1] || 0;
  const d1CloseLast = closes1D[closes1D.length - 1] || 0;

  let trend1D: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (d1Ema50Last > d1Ema200Last && d1CloseLast > d1Ema50Last) {
    trend1D = 'BULLISH';
  } else if (d1Ema50Last < d1Ema200Last && d1CloseLast < d1Ema50Last) {
    trend1D = 'BEARISH';
  }

  // A1. Trend 4H as bias trend (EMA50 vs EMA200 & Close vs EMA50)
  const h4Ema50 = calculateEMA(closes4H, 50);
  const h4Ema200 = calculateEMA(closes4H, 200);
  const h4Ema50Last = h4Ema50[h4Ema50.length - 1] || 0;
  const h4Ema200Last = h4Ema200[h4Ema200.length - 1] || 0;
  const h4CloseLast = closes4H[closes4H.length - 1] || 0;

  let trend4H: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (h4Ema50Last > h4Ema200Last && h4CloseLast > h4Ema50Last) {
    trend4H = 'BULLISH';
  } else if (h4Ema50Last < h4Ema200Last && h4CloseLast < h4Ema50Last) {
    trend4H = 'BEARISH';
  }

  // 15M Slices for Scalper-focused structure/ADX/volatility
  const slice15MCloses = m15Closes.slice(0, m15Closes.length - indexOffset);
  const slice15MHighs = m15Highs.slice(0, m15Highs.length - indexOffset);
  const slice15MLows = m15Lows.slice(0, m15Lows.length - indexOffset);
  const slice15MVolumes = m15Volumes.slice(0, m15Volumes.length - indexOffset);

  // B) ADX 15M
  const adx15MList = calculateADX(slice15MHighs, slice15MHighs, slice15MCloses, 14);
  const adx15M = adx15MList[adx15MList.length - 1] || 0;

  // C) Swing Structure (15M)
  const swingRes = getSwingStructure(slice15MHighs, slice15MLows);
  const structure = swingRes.structure;

  // D) Volatility State (15M)
  const volRes = getVolatilityStates(slice15MCloses);
  const lastPercentile = volRes.percentiles[volRes.percentiles.length - 1] || 0;

  // E) Range Metrics
  const rangeRes = getRangeMetrics(slice15MHighs, slice15MLows);

  // F) Volume State
  const { volumeRendah } = getVolumeState(slice15MVolumes);

  // G) Pullback Price EMA Support on 15M (EMA50 and EMA200)
  const m15CloseLast = slice15MCloses[slice15MCloses.length - 1] || 0;
  const m15Ema50 = calculateEMA(slice15MCloses, 50);
  const m15Ema200 = calculateEMA(slice15MCloses, 200);
  const m15Ema50Last = m15Ema50[m15Ema50.length - 1] || 0;
  const m15Ema200Last = m15Ema200[m15Ema200.length - 1] || 0;

  const nearEmaSupport15M =
    Math.min(
      Math.abs(m15CloseLast - m15Ema50Last) / m15Ema50Last,
      Math.abs(m15CloseLast - m15Ema200Last) / m15Ema200Last
    ) <= 0.012; // within 1.2% distance

  if (isIlliquid) {
    return {
      id: 5,
      label: '🚫 ILLIQUID / SPREAD LEBAR',
      trend1D,
      trend4H,
      structure,
      adx4H: adx15M,
      bbWidthPercentile: lastPercentile,
      deviation: rangeRes.deviation,
      touches: rangeRes.touches,
      midpoint: rangeRes.midpoint,
      support: rangeRes.support,
      resistance: rangeRes.resistance,
    };
  }

  // DECISION TREE (Using trend4H as trend bias instead of trend1D)
  let id = 5; // Default: NEUTRAL

  // Rule 1: JIKA Trend 4H = Choppy ATAU (Trend 4H ≠ Trend 15M structure) ATAU Volume Rendah -> NEUTRAL
  const structureMismatch =
    (trend4H === 'BULLISH' && structure !== 'HH_HL') ||
    (trend4H === 'BEARISH' && structure !== 'LH_LL');

  if (trend4H === 'NEUTRAL' || structureMismatch || volumeRendah) {
    id = 5;
  }
  // Rule 2: JIKA ADX(15M) < 20 DAN deviation < 3% -> RANGE
  else if (adx15M < 20 && rangeRes.deviation < 3) {
    id = 4;
  }
  // Rule 3: JIKA Trend 4H = Bullish DAN ADX(15M) > 25 DAN struktur = HH_HL DAN Volatility = "Expansion baharu" DAN Volume Spike (15M) > 150% -> UPTREND EXPANSION
  else if (
    trend4H === 'BULLISH' &&
    adx15M > 25 &&
    structure === 'HH_HL' &&
    volRes.expansionBaharu &&
    volumeSpike15M >= 150
  ) {
    id = 2;
  }
  // Rule 4: JIKA Trend 4H = Bullish DAN ADX(15M) > 25 DAN struktur = HH_HL DAN Volatility = "Trend stabil" -> STRONG UPTREND
  else if (
    trend4H === 'BULLISH' &&
    adx15M > 25 &&
    structure === 'HH_HL' &&
    volRes.trendStabil
  ) {
    id = 1;
  }
  // Rule 5: JIKA Trend 4H = Bullish DAN struktur HH_HL DAN RSI(15M) pullback 30-45 DAN near EMA support -> PULLBACK TREND
  else if (
    trend4H === 'BULLISH' &&
    structure === 'HH_HL' &&
    rsi15M >= 30 &&
    rsi15M <= 45 &&
    nearEmaSupport15M
  ) {
    id = 3;
  }
  // Rule 6: BEARISH EXPANSION
  else if (
    trend4H === 'BEARISH' &&
    adx15M > 25 &&
    structure === 'LH_LL' &&
    volRes.expansionBaharu &&
    volumeSpike15M >= 150
  ) {
    id = 6;
  }
  // Rule 7: STRONG DOWNTREND
  else if (
    trend4H === 'BEARISH' &&
    adx15M > 25 &&
    structure === 'LH_LL' &&
    volRes.trendStabil
  ) {
    id = 8;
  }
  // Rule 8: BEARISH PULLBACK
  else if (
    trend4H === 'BEARISH' &&
    structure === 'LH_LL' &&
    rsi15M >= 60 &&
    rsi15M <= 75 &&
    nearEmaSupport15M
  ) {
    id = 7;
  }
  // Rule 9: Default to NEUTRAL
  else {
    id = 5;
  }

  return {
    id,
    label: REGIMES[id].label,
    trend1D,
    trend4H,
    structure,
    adx4H: adx15M,
    bbWidthPercentile: lastPercentile,
    deviation: rangeRes.deviation,
    touches: rangeRes.touches,
    midpoint: rangeRes.midpoint,
    support: rangeRes.support,
    resistance: rangeRes.resistance,
  };
}

// Main evaluation including Stability Check
export function evaluateMarketRegime(
  closes1D: number[],
  highs4H: number[],
  lows4H: number[],
  closes4H: number[],
  volumes4H: number[],
  rsi15M: number,
  m15Closes: number[],
  m15Highs: number[],
  m15Lows: number[],
  volumeSpike15M: number,
  m15Volumes: number[] = [],
  spread = 0,
  bidAskDepthRatio = 1.0,
  m15TakerBuyVolumes: number[] = []
) {
  // Current closed candle (indexOffset = 0)
  const current = runClassification(
    closes1D,
    highs4H,
    lows4H,
    closes4H,
    volumes4H,
    rsi15M,
    m15Closes,
    m15Highs,
    m15Lows,
    volumeSpike15M,
    0,
    spread,
    bidAskDepthRatio,
    m15Volumes
  );

  // Previous closed candle (indexOffset = 1)
  const prevM15Closes = m15Closes.slice(0, -1);
  const prevM15Highs = m15Highs.slice(0, -1);
  const prevM15Lows = m15Lows.slice(0, -1);

  const prevRsi15MList = calculateRSI(prevM15Closes, 14);
  const prevRsi15M = prevRsi15MList[prevRsi15MList.length - 1] || rsi15M;

  let prevVolumeSpike15M = volumeSpike15M;
  if (m15Volumes && m15Volumes.length >= 22) {
    const last20VolsPrev = m15Volumes.slice(m15Volumes.length - 22, m15Volumes.length - 2);
    const avgVol20Prev = last20VolsPrev.reduce((s, v) => s + v, 0) / 20;
    const prevVol = m15Volumes[m15Volumes.length - 2];
    prevVolumeSpike15M = avgVol20Prev > 0 ? (prevVol / avgVol20Prev) * 100 : 0;
  }

  const previous = runClassification(
    closes1D,
    highs4H,
    lows4H,
    closes4H,
    volumes4H,
    prevRsi15M,
    prevM15Closes,
    prevM15Highs,
    prevM15Lows,
    prevVolumeSpike15M,
    1,
    spread,
    bidAskDepthRatio,
    m15Volumes
  );

  // Regime Stability Check: Must be the same for last 2 candles
  let stable = current.id === previous.id;

  // A3. CVD confirmation: direction must align with CVD for Momentum Regimes (1, 2, 6, 8)
  if (stable && [1, 2, 6, 8].includes(current.id)) {
    let cvdDelta5M = 0;
    if (m15Volumes && m15Volumes.length > 0 && m15TakerBuyVolumes && m15TakerBuyVolumes.length > 0) {
      const lastIdx = m15Closes.length - 1;
      const v = m15Volumes[lastIdx];
      const tb = m15TakerBuyVolumes[lastIdx] || 0;
      cvdDelta5M = tb - (v - tb);
    }
    const isBullishRegime = [1, 2].includes(current.id);
    const cvdAligned = isBullishRegime ? (cvdDelta5M > 0) : (cvdDelta5M < 0);
    if (!cvdAligned) {
      stable = false;
    }
  }

  return {
    ...current,
    stable,
    previousId: previous.id,
    previousLabel: previous.label,
  };
}
