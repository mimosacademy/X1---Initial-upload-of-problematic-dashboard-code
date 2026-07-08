import { describe, it, expect } from 'vitest';
import { calculateRSI, calculateEMA, calculateMACD, calculateATR } from './indicators';

describe('Signal Calculations', () => {
  it('should calculate RSI correctly', () => {
    // We need at least 15 elements to compute a 14-period RSI
    const prices = [
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
      110, 111, 112, 113, 114, 115, 114, 113, 112, 111
    ];
    const rsi = calculateRSI(prices, 14);
    
    expect(rsi.length).toBe(prices.length);
    // Since prices are positive, the calculated RSI at the end should be valid (between 0 and 100)
    const lastRsi = rsi[rsi.length - 1];
    expect(lastRsi).toBeGreaterThan(0);
    expect(lastRsi).toBeLessThan(100);
  });

  it('should calculate EMA correctly', () => {
    const prices = [10, 11, 12, 13, 14, 15];
    const ema = calculateEMA(prices, 3);
    expect(ema.length).toBe(prices.length);
    expect(ema[ema.length - 1]).toBeCloseTo(14.0, 1);
  });

  it('should calculate MACD correctly', () => {
    const prices = Array.from({ length: 30 }, (_, i) => 100 + i);
    const { macdLine, signalLine, histogram } = calculateMACD(prices, 12, 26, 9);
    expect(macdLine.length).toBe(30);
    expect(signalLine.length).toBe(30);
    expect(histogram.length).toBe(30);
  });
});
