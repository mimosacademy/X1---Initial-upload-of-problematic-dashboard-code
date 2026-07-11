import React, { useState, useEffect } from 'react';
import { Signal, SignalMetrics } from '../types';
import { Zap, Clock, TrendingUp, TrendingDown, CheckCircle, XCircle, Shield, AlertTriangle } from 'lucide-react';

interface VipSignalPanelProps {
  signals: Signal[];
  onSelectSignal: (signal: Signal) => void;
  livePrices?: Record<string, { bidPrice: number; askPrice: number; markPrice: number }>;
}

export default function VipSignalPanel({ signals, onSelectSignal, livePrices = {} }: VipSignalPanelProps) {
  const [elapsedTimes, setElapsedTimes] = useState<Record<string, number>>({});

  // Get only top A+ signals (score >= 90), limit to 3, sorted by score descending
  const aPlusSignals = signals
    .filter(s => s.score >= 90 && s.outcome === 'PENDING' && !s.noTrade)
    .slice(0, 3);

  useEffect(() => {
    const interval = setInterval(() => {
      const times: Record<string, number> = {};
      signals.forEach(s => {
        const elapsedSecs = Math.floor((Date.now() - s.timestamp) / 1000);
        times[s.id] = elapsedSecs;
      });
      setElapsedTimes(times);
    }, 1000);

    return () => clearInterval(interval);
  }, [signals]);

  if (aPlusSignals.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/10 p-8 text-center">
        <Zap className="mx-auto h-8 w-8 text-zinc-600 mb-2" />
        <p className="font-mono text-sm text-zinc-400 font-bold">Tiada Isyarat VIP (A+) Aktif</p>
        <p className="mt-1 font-sans text-xs text-zinc-500">
          Semua pasaran sedang dalam fasa konsolidasi atau tiada pengesahan volume yang sihat buat masa ini.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <Zap className="h-5 w-5 text-emerald-400 animate-pulse" />
        <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-200">
          VIP SIGNALS PANEL <span className="text-emerald-400">(A+ MUST FOLLOW)</span>
        </h2>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">Maksimum 3 Isyarat Teratas</span>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {aPlusSignals.map(signal => {
          const elapsedSecs = elapsedTimes[signal.id] || 0;
          const remainingSecs = Math.max(0, 15 * 60 - elapsedSecs);
          const progressPercent = (remainingSecs / (15 * 60)) * 100;
          
          const isExpired = remainingSecs <= 0;

          const metrics = signal.metrics;
          const isLong = signal.direction === 'LONG';

          // RR Calculation (Entry to TP1 / Entry to SL)
          const rrRatio = (Math.abs(signal.takeProfit1 - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss)).toFixed(1);

          return (
            <div
              key={signal.id}
              onClick={() => onSelectSignal(signal)}
              className={`group relative flex flex-col justify-between overflow-hidden rounded bg-neutral-900/40 p-5 transition-all duration-300 hover:border-neutral-700 cursor-pointer ${
                isLong
                  ? 'border border-emerald-500/30 hover:shadow-[0_0_20px_rgba(16,185,129,0.05)]'
                  : 'border border-rose-500/30 hover:shadow-[0_0_20px_rgba(239,68,68,0.05)]'
              }`}
            >
              {/* Badge Indicator */}
              <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                <div className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                  isLong ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white'
                }`}>
                  {isLong ? 'MUST FOLLOW' : 'A+ ENTRY'}
                </div>
              </div>

              <div>
                {/* Header info */}
                <div className="flex justify-between items-start mb-3">
                  <div>
                    {signal.regimeLabel && (
                      <div className="text-[9px] font-black font-mono text-amber-400 uppercase tracking-wider mb-1.5 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded inline-block">
                        Regime: {signal.regimeLabel}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-2xl font-black text-white leading-none font-mono">
                        {signal.coin}
                      </span>
                      <span className="text-xs text-neutral-500 uppercase font-mono">USDT Perpetual</span>
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded font-mono ${
                      isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {signal.direction} SIGNAL
                    </span>
                  </div>
                  <div className="text-right pr-20 md:pr-0">
                    <p className="text-[9px] text-neutral-500 uppercase font-mono">Strength Score</p>
                    <p className={`text-2xl font-mono font-bold leading-none mt-1 ${isLong ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {signal.score}
                    </p>
                  </div>
                </div>

                {/* Prices & SL/TP in beautiful design mockup format */}
                <div className="grid grid-cols-2 gap-y-3 mb-4 font-mono text-xs border-t border-b border-neutral-800/40 py-3 mt-4">
                  <div>
                    <p className="text-[9px] text-neutral-500 uppercase">Entry Zone</p>
                    <p className="text-sm text-white font-bold">
                      {(signal.entryPrice * 0.999).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} - {signal.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </p>
                    {livePrices[signal.coin] && (
                      <p className="text-[9px] text-emerald-400 font-bold animate-pulse mt-1 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                        LIVE: {livePrices[signal.coin].markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[9px] text-neutral-500 uppercase">Stop Loss (1.2 ATR)</p>
                    <p className="text-sm text-rose-400 font-bold">
                      {signal.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-neutral-500 uppercase">Target Profit 1</p>
                    <p className="text-sm text-emerald-400 font-bold">
                      {signal.takeProfit1.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] text-neutral-500 uppercase">Win Rate (Historical)</p>
                    <p className="text-sm text-white font-bold">
                      {signal.winRateHistorical?.toFixed(1)}% <span className="text-[9px] text-neutral-500 font-normal">(n={signal.sampleSize || 0})</span>
                    </p>
                  </div>
                </div>

                {/* Gemini Narrative Reasoning styled like template block */}
                {signal.narrative && (
                  <div className="p-2 bg-black/40 rounded border border-neutral-800 mb-4 mt-2">
                    <p className="text-[11px] text-emerald-300/80 italic leading-snug">
                      "{signal.narrative}"
                    </p>
                  </div>
                )}

                {/* 5-Category Criteria Checklist (Trend/Momentum/Volume/Liquidity/Funding) */}
                <div className="border-t border-neutral-800/40 pt-3 mt-3">
                  <p className="text-[9px] text-neutral-500 uppercase tracking-widest font-mono mb-2">Kriteria Pemilihan (Audit Trail)</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[9px] text-neutral-400">
                    <div className="flex items-center justify-between">
                      <span>1. Trend 1D/4H</span>
                      <span className="text-emerald-400 font-bold">✅ Aligned</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>2. Momentum</span>
                      <span className={metrics.macdAlign ? 'text-emerald-400 font-bold' : 'text-neutral-500'}>
                        {metrics.macdAlign ? '✅ RSI/MACD' : '❌ MACD No'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>3. Volume Spike</span>
                      <span className={metrics.volumeSpike >= 150 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {metrics.volumeSpike >= 150 ? '✅ >150%' : '❌ Low'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>4. Liquidity</span>
                      <span className={metrics.spread <= 0.05 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {metrics.spread <= 0.05 ? '✅ Spread' : '❌ Wide'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between col-span-2 border-t border-neutral-800/20 pt-1 mt-0.5">
                      <span>5. Funding Rate</span>
                      <span className="text-emerald-400 font-bold">✅ {(metrics.fundingRate * 100).toFixed(3)}%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 border-t border-neutral-800/40 pt-3">
                {/* Timer / Progress Bar */}
                <div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-neutral-500">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      Age: {Math.floor(elapsedSecs / 60)}m {elapsedSecs % 60}s
                    </span>
                    <span>{isExpired ? 'EXPIRED' : 'ACTIVE'}</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full rounded bg-neutral-950 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-1000 ${
                        isExpired
                          ? 'bg-neutral-800'
                          : progressPercent < 30
                          ? 'bg-rose-500'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    ></div>
                  </div>
                  <p className="mt-3.5 text-[8px] text-neutral-500 font-sans leading-tight border-t border-neutral-800/30 pt-2 text-center">
                    Bukan nasihat kewangan. Prestasi lampau tidak menjamin keputusan masa depan.
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
