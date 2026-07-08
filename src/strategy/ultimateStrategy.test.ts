import { describe, it, expect } from 'vitest';
import { evaluatePair, isVolumeSpike, sma, ema, rsi, atr, supertrend, adx, macdHistogram, bollinger, Candle } from './ultimateStrategy';

// Generate mock candles
function generateMockCandles(count: number, trend: 'bull' | 'bear' | 'flat'): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  let baseVolume = 1000;
  for (let i = 0; i < count; i++) {
    const ts = Date.now() - (count - i) * 15 * 60 * 1000;
    let change = 0;
    if (trend === 'bull') change = Math.random() * 2;
    else if (trend === 'bear') change = -Math.random() * 2;
    else change = (Math.random() - 0.5) * 2;

    price += change;
    candles.push({
      t: ts,
      o: price - change,
      h: price + Math.abs(change) + 0.1,
      l: price - Math.abs(change) - 0.1,
      c: price,
      v: baseVolume + (i === count - 1 && trend === 'bull' ? baseVolume * 3 : Math.random() * 100),
    });
  }
  return candles;
}

describe('Ultimate Strategy Engine', () => {
  describe('Helper Indicators', () => {
    it('should calculate SMA correctly', () => {
      const values = [1, 2, 3, 4, 5];
      expect(sma(values, 3)).toBe(4);
      expect(sma(values, 5)).toBe(3);
    });

    it('should calculate EMA correctly', () => {
      const values = [10, 11, 12, 13, 14, 15];
      const result = ema(values, 3);
      expect(result).toBeCloseTo(14.0, 1);
    });

    it('should calculate RSI correctly', () => {
      const values = Array.from({ length: 30 }, (_, i) => 100 + i % 5);
      const val = rsi(values, 14);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(100);
    });

    it('should calculate ATR correctly', () => {
      const candles = generateMockCandles(20, 'flat');
      const val = atr(candles, 14);
      expect(val).not.toBeNull();
      expect(val).toBeGreaterThan(0);
    });

    it('should calculate Supertrend correctly', () => {
      const candles = generateMockCandles(20, 'bull');
      const result = supertrend(candles, 10, 3);
      expect(result).not.toBeNull();
      expect(result?.dir).toBeDefined();
    });

    it('should calculate ADX correctly', () => {
      const candles = generateMockCandles(40, 'bull');
      const result = adx(candles, 14);
      expect(result).not.toBeNull();
    });

    it('should calculate MACD histogram correctly', () => {
      const values = Array.from({ length: 50 }, (_, i) => 100 + i);
      const result = macdHistogram(values, 12, 26, 9);
      expect(result).not.toBeNull();
    });

    it('should calculate Bollinger Bands correctly', () => {
      const values = [10, 11, 10, 12, 11, 10, 11, 12, 11, 10, 11, 12, 11, 10, 11, 12, 11, 10, 11, 12];
      const bands = bollinger(values, 20, 2);
      expect(bands).not.toBeNull();
      expect(bands?.upper).toBeGreaterThan(bands?.middle);
      expect(bands?.middle).toBeGreaterThan(bands?.lower);
    });
  });

  describe('Volume Spike', () => {
    it('should flag high volume spikes correctly', () => {
      const candles = generateMockCandles(21, 'flat');
      // Set last volume as a spike
      candles[candles.length - 1].v = 50000;
      expect(isVolumeSpike(candles, 1.8)).toBe(true);
    });

    it('should not flag flat volume as a spike', () => {
      const candles = generateMockCandles(21, 'flat');
      expect(isVolumeSpike(candles, 1.8)).toBe(false);
    });
  });

  describe('Core Evaluation', () => {
    it('should return evaluate results for bullish coin', () => {
      const d1 = generateMockCandles(60, 'bull');
      const h4 = generateMockCandles(60, 'bull');
      const m15 = generateMockCandles(60, 'bull');
      m15[m15.length - 1].v = 10000; // Trigger volume spike

      const res = evaluatePair({
        pair: 'BTCUSDT',
        d1,
        h4,
        m15,
        orderbook: { bids: [[100, 50], [99, 100]], asks: [[101, 10], [102, 20]] },
        trades: [{ price: 100.5, size: 2, side: 'buy', ts: Date.now() }],
      });

      expect(res.pair).toBe('BTCUSDT');
      expect(res.direction).toBeDefined();
      expect(res.confidence).toBeGreaterThanOrEqual(0);
      expect(res.scoreBreakdown).toBeDefined();
      expect(res.reasons.length).toBeGreaterThan(0);
    });
  });
});
