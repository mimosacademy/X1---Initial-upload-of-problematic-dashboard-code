export function calculateEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = new Array(prices.length).fill(NaN);
  if (prices.length === 0) return [];

  let sum = 0;
  for (let i = 0; i < period && i < prices.length; i++) {
    sum += prices[i];
  }
  let prevEma = sum / Math.min(period, prices.length);
  const seedIndex = Math.min(period, prices.length) - 1;
  ema[seedIndex] = prevEma;

  for (let i = seedIndex + 1; i < prices.length; i++) {
    const currentEma = prices[i] * k + prevEma * (1 - k);
    ema[i] = currentEma;
    prevEma = currentEma;
  }

  return ema;
}

export function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = new Array(prices.length).fill(0);
  if (prices.length <= period) return rsi;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rsi[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }

  return rsi;
}

export function calculateMACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
) {
  const ema12 = calculateEMA(prices, fastPeriod);
  const ema26 = calculateEMA(prices, slowPeriod);
  
  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }
  
  const signalLine = calculateEMA(macdLine, signalPeriod);
  const histogram: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    histogram.push(macdLine[i] - signalLine[i]);
  }
  
  return { macdLine, signalLine, histogram };
}

export function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  const atr: number[] = new Array(closes.length).fill(0);
  if (closes.length <= period) return atr;

  const tr: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const hl = highs[i] - lows[i];
    const hcp = Math.abs(highs[i] - closes[i - 1]);
    const lcp = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(hl, hcp, lcp));
  }

  let trSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += tr[i];
  }
  let prevAtr = trSum / period;
  atr[period] = prevAtr;

  for (let i = period + 1; i < closes.length; i++) {
    const currentAtr = (prevAtr * (period - 1) + tr[i]) / period;
    atr[i] = currentAtr;
    prevAtr = currentAtr;
  }

  return atr;
}

export function calculateADX(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number[] {
  const adx: number[] = new Array(closes.length).fill(0);
  if (closes.length <= period * 2) return adx;

  const tr: number[] = [];
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      tr.push(highs[0] - lows[0]);
      plusDM.push(0);
      minusDM.push(0);
    } else {
      const hl = highs[i] - lows[i];
      const hcp = Math.abs(highs[i] - closes[i - 1]);
      const lcp = Math.abs(lows[i] - closes[i - 1]);
      tr.push(Math.max(hl, hcp, lcp));

      const upMove = highs[i] - highs[i - 1];
      const downMove = lows[i - 1] - lows[i];

      if (upMove > downMove && upMove > 0) {
        plusDM.push(upMove);
      } else {
        plusDM.push(0);
      }

      if (downMove > upMove && downMove > 0) {
        minusDM.push(downMove);
      } else {
        minusDM.push(0);
      }
    }
  }

  const smoothedTR: number[] = new Array(closes.length).fill(0);
  const smoothedPlusDM: number[] = new Array(closes.length).fill(0);
  const smoothedMinusDM: number[] = new Array(closes.length).fill(0);

  let trSum = 0;
  let plusDMSum = 0;
  let minusDMSum = 0;

  for (let i = 0; i < period; i++) {
    trSum += tr[i];
    plusDMSum += plusDM[i];
    minusDMSum += minusDM[i];
  }

  smoothedTR[period - 1] = trSum;
  smoothedPlusDM[period - 1] = plusDMSum;
  smoothedMinusDM[period - 1] = minusDMSum;

  for (let i = period; i < closes.length; i++) {
    smoothedTR[i] = smoothedTR[i - 1] - smoothedTR[i - 1] / period + tr[i];
    smoothedPlusDM[i] = smoothedPlusDM[i - 1] - smoothedPlusDM[i - 1] / period + plusDM[i];
    smoothedMinusDM[i] = smoothedMinusDM[i - 1] - smoothedMinusDM[i - 1] / period + minusDM[i];
  }

  const dx: number[] = new Array(closes.length).fill(0);
  for (let i = period - 1; i < closes.length; i++) {
    const trVal = smoothedTR[i];
    if (trVal === 0) {
      dx[i] = 0;
      continue;
    }
    const plusDI = (smoothedPlusDM[i] / trVal) * 100;
    const minusDI = (smoothedMinusDM[i] / trVal) * 100;
    const sum = plusDI + minusDI;
    const diff = Math.abs(plusDI - minusDI);
    dx[i] = sum === 0 ? 0 : (diff / sum) * 100;
  }

  let dxSum = 0;
  for (let i = period - 1; i < period * 2 - 1; i++) {
    dxSum += dx[i];
  }
  let prevADX = dxSum / period;
  adx[period * 2 - 2] = prevADX;

  for (let i = period * 2 - 1; i < closes.length; i++) {
    const currentADX = (prevADX * (period - 1) + dx[i]) / period;
    adx[i] = currentADX;
    prevADX = currentADX;
  }

  return adx;
}

