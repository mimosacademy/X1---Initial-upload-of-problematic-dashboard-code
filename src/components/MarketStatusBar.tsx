import React from 'react';
import { MarketStatus } from '../types';
import { TrendingUp, TrendingDown, RefreshCw, BarChart2, Zap, ShieldAlert } from 'lucide-react';

interface MarketStatusBarProps {
  status: MarketStatus | null;
  loading: boolean;
}

export default function MarketStatusBar({ status, loading }: MarketStatusBarProps) {
  if (loading || !status) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 md:h-20 border-b border-neutral-800 bg-neutral-900/10">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex flex-col justify-center px-6 py-3 border-r border-neutral-800/60 animate-pulse">
            <div className="h-2 w-16 bg-neutral-800 rounded mb-2"></div>
            <div className="h-4 w-24 bg-neutral-800 rounded"></div>
          </div>
        ))}
      </div>
    );
  }

  const getBtcTrendBadge = (trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL') => {
    switch (trend) {
      case 'BULLISH':
        return (
          <span className="text-emerald-400 font-bold uppercase tracking-wide">
            Bullish Aligned
          </span>
        );
      case 'BEARISH':
        return (
          <span className="text-rose-500 font-bold uppercase tracking-wide">
            Bearish Aligned
          </span>
        );
      default:
        return <span className="font-bold text-neutral-400 uppercase tracking-wide">Neutral / Range</span>;
    }
  };

  return (
    <div id="market-status-bar" className="grid grid-cols-2 md:grid-cols-5 md:h-20 border-b border-neutral-800 bg-[#050505]">
      {/* 1. BTC Trend */}
      <div className="flex flex-col justify-center px-6 py-4 border-r border-neutral-800 border-b md:border-b-0">
        <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-mono">BTC Trend (1D/4H)</span>
        <span className="text-xs font-mono mt-1">
          {getBtcTrendBadge(status.btcTrend)}
        </span>
      </div>

      {/* 2. Market Sentiment */}
      <div className="flex flex-col justify-center px-6 py-4 border-r border-neutral-800 border-b md:border-b-0">
        <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-mono">Market Sentiment</span>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-xs font-bold text-white font-mono uppercase">
            {status.marketSentiment.toFixed(0)}% Greedy
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-1.5 h-1 w-24 rounded-full bg-neutral-900 overflow-hidden">
          <div 
            className="h-full bg-emerald-500" 
            style={{ width: `${status.marketSentiment}%` }}
          ></div>
        </div>
      </div>

      {/* 3. Altcoin Strength Index */}
      <div className="flex flex-col justify-center px-6 py-4 border-r border-neutral-800 border-b md:border-b-0">
        <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-mono">Alt Strength Index</span>
        <span className="text-xs font-bold text-emerald-400 font-mono mt-1">
          {status.altcoinStrengthIndex.toFixed(0)}/100
        </span>
      </div>

      {/* 4. Active Signals Count */}
      <div className="flex flex-col justify-center px-6 py-4 border-r border-neutral-800 bg-emerald-500/5">
        <span className="text-[9px] text-emerald-500 uppercase tracking-wider font-mono">Active Signals</span>
        <span className="text-xs font-bold text-emerald-400 font-mono mt-1">
          {status.activeSignalsCount} Signals
        </span>
      </div>

      {/* 5. Strong Signals (A+) Count */}
      <div className="flex flex-col justify-center px-6 py-4 col-span-2 md:col-span-1">
        <span className="text-[9px] text-amber-500 uppercase tracking-wider font-mono">Strong (A+) Count</span>
        <span className="text-xs font-bold text-amber-400 font-mono mt-1">
          {status.strongSignalsCount.toString().padStart(2, '0')} Found
        </span>
      </div>
    </div>
  );
}
