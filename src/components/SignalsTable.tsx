import React, { useState } from 'react';
import { Signal } from '../types';
import { ArrowUpRight, ArrowDownRight, Award, Flame, AlertTriangle, ShieldAlert } from 'lucide-react';

interface SignalsTableProps {
  signals: Signal[];
  onSelectSignal: (signal: Signal) => void;
  selectedSignalId: string | null;
  livePrices?: Record<string, { bidPrice: number; askPrice: number; markPrice: number }>;
}

export default function SignalsTable({ signals, onSelectSignal, selectedSignalId, livePrices = {} }: SignalsTableProps) {
  const [sortBy, setSortBy] = useState<'score' | 'rr' | 'winrate'>('score');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showNoTrade, setShowNoTrade] = useState<boolean>(false);

  // Deduplicate and group active signals by coin to only show the LATEST state for each coin
  const latestByCoin = new Map<string, Signal>();
  
  // Sort signals by timestamp ascending first, so that later/newer ones overwrite older ones in the map
  const sortedByTime = [...signals].sort((a, b) => a.timestamp - b.timestamp);
  
  for (const s of sortedByTime) {
    if (s.outcome === 'PENDING' || s.noTrade) {
      const existing = latestByCoin.get(s.coin);
      if (!existing) {
        latestByCoin.set(s.coin, s);
      } else {
        // A real tradeable PENDING signal should take precedence over a noTrade signal.
        // Otherwise, if both are of the same type, we keep the newer one.
        const isNewPending = s.outcome === 'PENDING' && !s.noTrade;
        const isExistingPending = existing.outcome === 'PENDING' && !existing.noTrade;
        
        if (isNewPending || (!isExistingPending && s.timestamp > existing.timestamp)) {
          latestByCoin.set(s.coin, s);
        }
      }
    }
  }
  
  const allLatestSignals = Array.from(latestByCoin.values());
  const activeSignals = allLatestSignals.filter(s => showNoTrade ? true : !s.noTrade);

  const disputedSignals: Signal[] = [];

  // Check Correlation Risk (only for real tradeable signals)
  const longCount = allLatestSignals.filter(s => s.direction === 'LONG' && !s.noTrade).length;
  const shortCount = allLatestSignals.filter(s => s.direction === 'SHORT' && !s.noTrade).length;
  const hasCorrelationRisk = longCount >= 3 || shortCount >= 3;

  const handleSort = (field: 'score' | 'rr' | 'winrate') => {
    if (sortBy === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDirection('desc');
    }
  };

  const getSignalGrade = (score: number) => {
    if (score >= 90) return { label: 'A+', color: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40' };
    if (score >= 80) return { label: 'A', color: 'text-yellow-400 bg-yellow-950/40 border-yellow-800/40' };
    return { label: 'B', color: 'text-blue-400 bg-blue-950/40 border-blue-800/40' };
  };

  const sortedSignals = [...activeSignals].sort((a, b) => {
    let valA = 0;
    let valB = 0;

    if (sortBy === 'score') {
      valA = a.score;
      valB = b.score;
    } else if (sortBy === 'rr') {
      valA = Math.abs(a.takeProfit1 - a.entryPrice) / Math.abs(a.entryPrice - a.stopLoss);
      valB = Math.abs(b.takeProfit1 - b.entryPrice) / Math.abs(b.entryPrice - b.stopLoss);
    } else if (sortBy === 'winrate') {
      valA = a.winRateHistorical || 0;
      valB = b.winRateHistorical || 0;
    }

    return sortDirection === 'asc' ? valA - valB : valB - valA;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between px-1">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-2">
            <Award className="h-5 w-5 text-yellow-500" />
            <h2 className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-200">
              TOP RANKED SIGNALS <span className="text-zinc-500">({allLatestSignals.filter(s => !s.noTrade).length} Aktif)</span>
            </h2>
          </div>
          
          {/* Toggle Koin No-Trade */}
          <label className="flex items-center gap-2 bg-zinc-950/40 border border-zinc-800/80 rounded-md px-2.5 py-1 text-[10px] text-zinc-400 cursor-pointer hover:text-zinc-200 hover:bg-zinc-900/40 transition-all select-none">
            <input
              type="checkbox"
              checked={showNoTrade}
              onChange={(e) => setShowNoTrade(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-950 text-emerald-500 focus:ring-emerald-500/20 h-3 w-3 accent-emerald-500 cursor-pointer"
            />
            <span className="font-mono font-bold uppercase tracking-wider text-zinc-500">
              Tunjuk Koin No-Trade <span className="text-zinc-600">({allLatestSignals.filter(s => s.noTrade).length})</span>
            </span>
          </label>
        </div>

        {/* Sort filters buttons */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 font-mono text-[10px]">
          <button
            onClick={() => handleSort('score')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              sortBy === 'score'
                ? 'bg-zinc-800 text-zinc-100 font-bold'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Sort Score
          </button>
          <button
            onClick={() => handleSort('rr')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              sortBy === 'rr'
                ? 'bg-zinc-800 text-zinc-100 font-bold'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Sort Risk:Reward
          </button>
          <button
            onClick={() => handleSort('winrate')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              sortBy === 'winrate'
                ? 'bg-zinc-800 text-zinc-100 font-bold'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Sort Win Rate
          </button>
        </div>
      </div>

      {/* Correlation Risk Alert Banner */}
      {hasCorrelationRisk && (
        <div className="flex items-start gap-2.5 rounded border border-yellow-900/60 bg-yellow-950/10 p-3.5 animate-pulse">
          <ShieldAlert className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
          <div className="font-sans text-xs">
            <p className="font-mono font-bold text-yellow-500 uppercase tracking-wide">⚠️ Signal berkorelasi tinggi, elak over-expose</p>
            <p className="text-neutral-400 mt-0.5 leading-relaxed">
              Terdapat {longCount >= 3 ? `${longCount} isyarat LONG` : `${shortCount} isyarat SHORT`} aktif serentak (L1 tokens / correlated altcoins). Sila kawal saiz posisi dan elakkan over-exposure demi pengurusan risiko yang ketat.
            </p>
          </div>
        </div>
      )}

      {/* Signals Table */}
      <div className="overflow-x-auto rounded border border-neutral-800 bg-neutral-900/10">
        <table className="w-full text-left font-mono text-xs border-collapse">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-950/40 text-[10px] uppercase tracking-wider text-neutral-500 font-bold">
              <th className="px-4 py-3 font-normal">Coin / Kontrak</th>
              <th className="px-4 py-3 font-normal">Arah</th>
              <th className="px-4 py-3 text-right font-normal">Harga Masuk</th>
              <th className="px-4 py-3 text-right font-normal">Stop Loss (SL)</th>
              <th className="px-4 py-3 text-right font-normal">TP1 (Target 1)</th>
              <th className="px-4 py-3 text-center font-normal">Grade</th>
              <th className="px-4 py-3 text-center font-normal">Score</th>
              <th className="px-4 py-3 text-center font-normal">Risk:Reward</th>
              <th className="px-4 py-3 text-right font-normal">Win Rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {sortedSignals.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-neutral-500 font-sans text-xs leading-normal">
                  Tiada isyarat aktif yang menepati kriteria minimum dalam senarai utama.
                </td>
              </tr>
            ) : (
              sortedSignals.map(signal => {
                if (signal.noTrade) {
                  const isSelected = selectedSignalId === signal.id;
                  return (
                    <tr
                      key={signal.id}
                      onClick={() => onSelectSignal(signal)}
                      className={`cursor-pointer transition-all duration-150 bg-[#0c0c0c]/40 hover:bg-neutral-900/40 text-neutral-500 ${
                        isSelected ? 'bg-neutral-900/50 border-l-2 border-zinc-700' : ''
                      }`}
                    >
                      {/* Coin */}
                      <td className="px-4 py-3.5 font-bold text-neutral-400">
                        <div className="flex items-center gap-1.5">
                          <span>{signal.coin}</span>
                          <span className="text-[9px] bg-neutral-900 border border-neutral-800 text-neutral-500 rounded px-1.5 py-0.5">
                            NO TRADE
                          </span>
                        </div>
                      </td>
                      {/* Direction */}
                      <td className="px-4 py-3.5 font-bold text-neutral-600 uppercase tracking-wide">
                        HALTED
                      </td>
                      {/* Entry Price */}
                      <td className="px-4 py-3.5 text-right text-neutral-600 font-mono">
                        {livePrices[signal.coin] ? (
                          <div className="flex flex-col items-end justify-center">
                            <span className="text-neutral-400 font-bold">{livePrices[signal.coin].markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                            <span className="text-[8px] text-zinc-600 uppercase tracking-wider font-semibold font-mono">LIVE PRICE</span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      {/* Stop Loss */}
                      <td className="px-4 py-3.5 text-right text-neutral-600 font-mono">
                        —
                      </td>
                      {/* TP1 */}
                      <td className="px-4 py-3.5 text-right text-neutral-600 font-mono">
                        —
                      </td>
                      {/* Grade */}
                      <td className="px-4 py-3.5 text-center">
                        <span className="rounded border border-neutral-900 bg-neutral-950 px-1.5 py-0.5 text-[9px] font-bold text-neutral-600">
                          N/A
                        </span>
                      </td>
                      {/* Score */}
                      <td className="px-4 py-3.5 text-center font-bold text-neutral-600 font-mono">
                        0
                      </td>
                      {/* Risk Reward */}
                      <td className="px-4 py-3.5 text-center text-neutral-600 font-mono">
                        —
                      </td>
                      {/* Win Rate / No Trade Reason */}
                      <td className="px-4 py-3.5 text-right text-[10px] text-zinc-500 max-w-[150px] truncate" title={signal.noTradeReason}>
                        {signal.noTradeReason || "Regime Neutral"}
                      </td>
                    </tr>
                  );
                }

                const grade = getSignalGrade(signal.score);
                const isLong = signal.direction === 'LONG';
                const isSelected = selectedSignalId === signal.id;
                
                const rrRatio = (Math.abs(signal.takeProfit1 - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopLoss)).toFixed(1);

                return (
                  <tr
                    key={signal.id}
                    onClick={() => onSelectSignal(signal)}
                    className={`cursor-pointer transition-all duration-150 hover:bg-neutral-900/60 ${
                      isSelected ? 'bg-neutral-900/80 border-l-2 border-emerald-500' : ''
                    }`}
                  >
                    {/* Coin */}
                    <td className="px-4 py-3.5 font-bold text-white">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{signal.coin}</span>
                        {signal.score >= 90 && (
                          <span className="text-[9px] bg-red-950/80 border border-red-800/40 rounded px-1 text-red-400 font-black flex items-center gap-0.5 animate-pulse font-mono">
                            <Flame className="h-2.5 w-2.5" /> HOT
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Direction */}
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-flex items-center gap-0.5 font-bold ${
                          isLong ? 'text-emerald-400' : 'text-rose-500'
                        }`}
                      >
                        {isLong ? (
                          <>
                            <ArrowUpRight className="h-3.5 w-3.5" />
                            <span>LONG</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownRight className="h-3.5 w-3.5" />
                            <span>SHORT</span>
                          </>
                        )}
                      </span>
                    </td>
                    {/* Entry Price */}
                    <td className="px-4 py-3.5 text-right text-neutral-200">
                      <div className="flex flex-col items-end">
                        <span>{signal.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                        {livePrices[signal.coin] && (
                          <span className="text-[9px] text-emerald-400 font-normal font-mono animate-pulse">
                            Live: {livePrices[signal.coin].markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </span>
                        )}
                      </div>
                    </td>
                    {/* Stop Loss */}
                    <td className="px-4 py-3.5 text-right text-rose-400 font-semibold">
                      {signal.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    {/* TP1 */}
                    <td className="px-4 py-3.5 text-right text-emerald-400 font-semibold">
                      {signal.takeProfit1.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </td>
                    {/* Grade */}
                    <td className="px-4 py-3.5 text-center">
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${grade.color}`}>
                        {grade.label}
                      </span>
                    </td>
                    {/* Score */}
                    <td className="px-4 py-3.5 text-center font-bold text-neutral-200">
                      {signal.score}
                    </td>
                    {/* Risk Reward */}
                    <td className="px-4 py-3.5 text-center text-neutral-400">
                      1 : {rrRatio}
                    </td>
                    {/* Win Rate */}
                    <td className="px-4 py-3.5 text-right">
                      {signal.sampleSize && signal.sampleSize >= 20 ? (
                        <span className="text-emerald-400 font-bold">
                          {signal.winRateHistorical?.toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-amber-500 font-medium text-[10px]">
                          Terhad (n={signal.sampleSize || 0})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
