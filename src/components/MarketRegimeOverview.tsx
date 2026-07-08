import React, { useState } from 'react';
import { MarketStatus, Signal } from '../types';
import { Search, Layers, RefreshCw, CheckCircle2, AlertTriangle, Eye, Flame, Compass } from 'lucide-react';

interface MarketRegimeOverviewProps {
  status: MarketStatus | null;
  signals: Signal[];
  onSelectCoin: (coin: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

const REGIME_DETAILS: Record<number, { label: string; desc: string; bg: string; text: string; border: string; emoji: string; category: 'LONG' | 'SHORT' | 'RANGE' | 'NEUTRAL' }> = {
  1: { label: 'AGGRESSIVE LONG', desc: 'Bullish kuat, momentum tinggi. Sesuai untuk beli terus.', bg: 'bg-emerald-950/40 hover:bg-emerald-900/40', text: 'text-emerald-400', border: 'border-emerald-500/20', emoji: '🟢', category: 'LONG' },
  2: { label: 'MUST FOLLOW LONG', desc: 'Breakout fasa pengumpulan. Beli jika tembus high.', bg: 'bg-orange-950/40 hover:bg-orange-900/40', text: 'text-orange-400', border: 'border-orange-500/20', emoji: '🔥', category: 'LONG' },
  3: { label: 'SAFE LONG', desc: 'Pullback ke EMA/Support dalam trend menaik.', bg: 'bg-cyan-950/40 hover:bg-cyan-900/40', text: 'text-cyan-400', border: 'border-cyan-500/20', emoji: '✅', category: 'LONG' },
  4: { label: 'RANGE TRADING', desc: 'Konsolidasi/Sisi. Beli di Support, Jual di Resistance.', bg: 'bg-yellow-950/40 hover:bg-yellow-900/40', text: 'text-yellow-400', border: 'border-yellow-500/20', emoji: '🟡', category: 'RANGE' },
  5: { label: 'WAIT — NO TRADE', desc: 'Pasaran bercampur/Choppy. Berada di luar pasaran.', bg: 'bg-zinc-950/40 hover:bg-zinc-900/40', text: 'text-zinc-400', border: 'border-zinc-500/20', emoji: '⚪', category: 'NEUTRAL' },
  6: { label: 'MUST FOLLOW SHORT', desc: 'Breakout ke bawah. Jual jika tembus low candle.', bg: 'bg-rose-950/50 hover:bg-rose-900/50', text: 'text-rose-400 font-bold', border: 'border-rose-500/30', emoji: '🚨', category: 'SHORT' },
  7: { label: 'SAFE SHORT', desc: 'Pullback ke EMA/Resistance dalam trend menurun.', bg: 'bg-red-950/40 hover:bg-red-900/40', text: 'text-red-400', border: 'border-red-500/20', emoji: '🔴', category: 'SHORT' },
  8: { label: 'AGGRESSIVE SHORT', desc: 'Bearish kuat, momentum ke bawah tinggi. Sell terus.', bg: 'bg-rose-950/60 hover:bg-rose-900/60', text: 'text-rose-500', border: 'border-rose-600/30', emoji: '🚨', category: 'SHORT' }
};

export default function MarketRegimeOverview({ status, signals, onSelectCoin, onRefresh, loading }: MarketRegimeOverviewProps) {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'LONG' | 'SHORT' | 'RANGE' | 'NEUTRAL'>('ALL');

  if (!status || !status.coinRegimes || status.coinRegimes.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 p-12 text-center text-zinc-500 animate-fade-in">
        <Layers className="h-8 w-8 text-zinc-700 mb-2 animate-pulse" />
        <p className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-400">TIADA DATA MARKET REGIME</p>
        <p className="mt-1 font-sans text-xs max-w-md">
          Sila mulakan imbasan pasaran baharu (SCAN NOW) di penjuru kanan sebelah atas untuk mengklasifikasikan regime coin utama.
        </p>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="mt-4 flex items-center gap-1.5 rounded bg-emerald-500 px-4 py-2 font-mono text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Muat Data / Imbas Semula
        </button>
      </div>
    );
  }

  // Count coins by regime
  const counts = status.regimeCounts || {};

  // Filter coins
  const filteredCoins = status.coinRegimes.filter(item => {
    const matchesSearch = item.coin.toLowerCase().includes(search.toLowerCase());
    const detail = REGIME_DETAILS[item.regimeId];
    const matchesFilter = filterType === 'ALL' || (detail && detail.category === filterType);
    return matchesSearch && matchesFilter;
  });

  return (
    <div id="market-regime-overview" className="space-y-6 animate-fade-in font-mono text-xs">
      
      {/* Overview stats header banner */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-emerald-400" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-200">
            MARKET REGIME OVERVIEW <span className="text-zinc-500">({status.coinRegimes.length} Coins Scanned)</span>
          </h2>
        </div>
        <div className="text-[10px] text-neutral-500">
          Last Snapshot: {new Date(status.lastScanTime).toLocaleTimeString()}
        </div>
      </div>

      {/* 8-Regime Summary Cards Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(REGIME_DETAILS).map(([idStr, details]) => {
          const id = parseInt(idStr);
          const count = counts[id] || 0;
          return (
            <div
              key={id}
              className={`rounded border p-3 flex flex-col justify-between ${details.bg} ${details.border}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-black uppercase text-neutral-400">
                  Regime {id} {details.emoji}
                </span>
                <span className={`text-base font-black ${details.text}`}>{count}</span>
              </div>
              <h4 className={`text-xs font-black uppercase tracking-wider ${details.text} mb-1`}>
                {details.label}
              </h4>
              <p className="text-[10px] text-neutral-500 leading-snug">
                {details.desc}
              </p>
            </div>
          );
        })}
      </div>

      {/* Filters & Search Control Bar */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-b border-neutral-800 pb-4">
        {/* Search input */}
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-neutral-500" />
          <input
            type="text"
            placeholder="Cari coin (cth: SOL)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-neutral-800 bg-[#0c0c0c] py-2 pl-9 pr-4 text-white placeholder-neutral-600 focus:outline-none focus:border-neutral-700 font-mono text-xs"
          />
        </div>

        {/* Filter categories buttons */}
        <div className="flex flex-wrap gap-1 bg-zinc-900/60 border border-neutral-800 p-0.5 rounded-lg text-[10px]">
          {(['ALL', 'LONG', 'SHORT', 'RANGE', 'NEUTRAL'] as const).map(type => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded transition-all font-bold ${
                filterType === type
                  ? 'bg-zinc-800 text-zinc-100 font-black'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              {type === 'ALL' ? 'SEMUA' : type}
            </button>
          ))}
        </div>
      </div>

      {/* Heatmap Grid of Coins */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        {filteredCoins.map((item) => {
          const details = REGIME_DETAILS[item.regimeId] || REGIME_DETAILS[5];
          const hasPendingSignal = signals.some(s => s.coin === item.coin && s.outcome === 'PENDING' && !s.noTrade);
          const hasHaltedSignal = signals.some(s => s.coin === item.coin && s.noTrade);

          return (
            <div
              key={item.coin}
              onClick={() => onSelectCoin(item.coin)}
              className={`group relative flex flex-col justify-between rounded border bg-neutral-900/20 p-2.5 hover:bg-neutral-900/50 hover:border-neutral-700 cursor-pointer transition-all duration-150 ${details.border}`}
            >
              {/* Coin and indicator */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-black text-white group-hover:text-emerald-400 transition-colors">
                  {item.coin}
                </span>
                
                {/* Active signals icon markers */}
                {hasPendingSignal && (
                  <span className="text-[8px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-1 rounded font-black flex items-center gap-0.5 animate-pulse">
                    <Flame className="h-2 w-2" /> ACTIVE
                  </span>
                )}
                {hasHaltedSignal && !hasPendingSignal && (
                  <span className="text-[8px] bg-neutral-950 border border-neutral-800 text-neutral-500 px-1 rounded">
                    HALTED
                  </span>
                )}
              </div>

              {/* Regime details */}
              <div className="space-y-1">
                <div className={`text-[9px] font-black tracking-wide uppercase leading-tight truncate ${details.text}`}>
                  {details.emoji} {details.label.split(' ')[0]}
                </div>

                <div className="flex items-center gap-1 text-[8px] text-neutral-500">
                  {item.stable ? (
                    <span className="text-emerald-400 flex items-center gap-0.5 font-bold">
                      <CheckCircle2 className="h-2 w-2" /> Stable (≥2H)
                    </span>
                  ) : (
                    <span className="text-amber-500 flex items-center gap-0.5">
                      <AlertTriangle className="h-2 w-2" /> Transition
                    </span>
                  )}
                </div>
              </div>

              {/* Action tooltip hover display */}
              <div className="absolute inset-0 bg-black/90 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center rounded transition-all duration-150 p-2 text-center text-[9px] gap-1">
                <Eye className="h-3 w-3 text-emerald-400" />
                <span className="text-white font-bold">Kaji Perincian</span>
                <span className="text-[8px] text-neutral-400 uppercase tracking-widest">{item.coin}/USDT</span>
              </div>
            </div>
          );
        })}

        {filteredCoins.length === 0 && (
          <div className="col-span-full py-12 text-center text-neutral-500 font-sans text-xs leading-normal">
            Tiada coin sepadan dengan carian atau kategori penapis yang dipilih.
          </div>
        )}
      </div>

    </div>
  );
}
