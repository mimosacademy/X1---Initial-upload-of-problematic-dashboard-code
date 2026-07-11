import React, { useState, useEffect } from 'react';
import { Signal } from '../types';
import { ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { Compass, Calculator, Coins, Info } from 'lucide-react';

interface SignalDetailPanelProps {
  signal: Signal | null;
  livePrices?: Record<string, { bidPrice: number; askPrice: number; markPrice: number }>;
}

interface ChartData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export default function SignalDetailPanel({ signal, livePrices = {} }: SignalDetailPanelProps) {
  const [candles, setCandles] = useState<ChartData[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);
  
  // Position Sizing Calculator state
  const [accountSize, setAccountSize] = useState<number>(10000);
  const [riskPercent, setRiskPercent] = useState<number>(1);

  useEffect(() => {
    if (!signal) return;

    // Fetch real 15M klines from Binance in React frontend for interactive charting
    const fetchCandles = async () => {
      setLoadingChart(true);
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${signal.coin}&interval=15m&limit=15`);
        if (res.ok) {
          const klines = await res.json();
          const parsed: ChartData[] = klines.map((k: any) => {
            const date = new Date(parseInt(k[0]));
            const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
            return {
              time: timeStr,
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
            };
          });
          setCandles(parsed);
        }
      } catch (err) {
        console.error('Failed to fetch candles for chart:', err);
      } finally {
        setLoadingChart(false);
      }
    };

    fetchCandles();
  }, [signal]);

  if (!signal) {
    return (
      <div className="flex h-full flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/40 p-12 text-center text-zinc-500">
        <Compass className="h-8 w-8 text-zinc-700 mb-2 animate-bounce" />
        <p className="font-mono text-sm font-bold uppercase tracking-wider text-zinc-400 font-bold">PILIH ISYARAT UNTUK PERINCIAN</p>
        <p className="mt-1 font-sans text-xs">
          Klik mana-mana baris jadual isyarat untuk memaparkan visualisasi teknikal, kalkulator posisi, dan skor analitikal penuh.
        </p>
      </div>
    );
  }

  if (signal.noTrade) {
    return (
      <div id="signal-detail-panel" className="rounded border border-neutral-800 bg-[#050505] p-5 space-y-6 animate-fade-in text-neutral-400">
        {/* 1. Header Information */}
        <div className="flex items-start justify-between border-b border-neutral-800/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-base font-black text-white">{signal.coin}</h3>
              <span className="rounded bg-neutral-900 border border-neutral-800 text-neutral-500 px-1.5 py-0.5 font-mono text-[9px] font-bold">
                NO TRADE
              </span>
            </div>
            <p className="font-sans text-[10px] text-neutral-500 mt-1 uppercase tracking-wider">
              Regime: {signal.regimeLabel || "Wait / Neutral"}
            </p>
            {livePrices[signal.coin] && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-bold text-neutral-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-neutral-500 animate-pulse"></span>
                LIVE PRICE: {livePrices[signal.coin].markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </div>
            )}
          </div>
          <div className="text-right font-mono">
            <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Status</div>
            <div className="text-sm font-black text-rose-400 font-mono font-bold">
              HALTED
            </div>
          </div>
        </div>

        {/* 2. Alert message */}
        <div className="rounded border border-neutral-800/80 bg-neutral-900/30 p-4 font-mono text-xs space-y-2">
          <p className="text-amber-500 font-bold uppercase flex items-center gap-1">
            ⚠️ SCANNER HALTED ON THIS CONTRACT
          </p>
          <p className="text-neutral-400 leading-relaxed text-[11px]">
            Sebab: <span className="font-bold text-white">{signal.noTradeReason}</span>.
          </p>
          <p className="text-neutral-500 text-[10px] leading-relaxed">
            Regime semasa diklasifikasikan sebagai <span className="text-zinc-300 font-semibold">{signal.regimeLabel}</span>. Mengikut algoritma tapis ketat sedia ada, sebarang percubaan kemasukan dagangan (LONG/SHORT) disekat sepenuhnya untuk mengelakkan kerugian whipsaw dan mengekalkan kualiti isyarat keseluruhan.
          </p>
        </div>

        {/* 3. Interactive Chart (shows price movement anyway) */}
        <div className="space-y-2">
          <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
            <Coins className="h-3 w-3 text-neutral-400" />
            15M Price Action Feed
          </p>
          <div className="h-44 w-full rounded border border-neutral-800 bg-neutral-900/10 p-2 relative">
            {loadingChart ? (
              <div className="flex h-full items-center justify-center font-mono text-xs text-neutral-600">
                Memuatkan data carta...
              </div>
            ) : candles.length === 0 ? (
              <div className="flex h-full items-center justify-center font-mono text-xs text-neutral-600">
                Gagal memuatkan data kline.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={candles} margin={{ top: 10, right: 5, bottom: 5, left: 10 }}>
                  <CartesianGrid stroke="#1c1c1f" strokeDasharray="3 3" />
                  <XAxis dataKey="time" tick={{ fill: '#737373', fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis 
                    domain={['dataMin - 0.005', 'dataMax + 0.005']} 
                    tick={{ fill: '#737373', fontSize: 9 }} 
                    axisLine={false} 
                    tickLine={false} 
                    orientation="right"
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', fontSize: '10px', fontFamily: 'monospace' }}
                    labelStyle={{ color: '#a3a3a3' }}
                  />
                  <Line type="monotone" dataKey="close" stroke="#737373" strokeWidth={1.5} dot={false} name="Harga" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isLong = signal.direction === 'LONG';
  
  // Calculate position size based on SL distance
  const slPct = Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice;
  const dollarRisk = (accountSize * riskPercent) / 100;
  // position size = risk amount / SL percentage distance
  const positionSize = slPct > 0 ? dollarRisk / slPct : 0;
  // Leverage required (notional position size / account size)
  const leverageRequired = positionSize / accountSize;

  // Score breakdown custom data
  const scoreData = [
    { name: 'Trend', score: signal.scoreBreakdown.trend, max: 30 },
    { name: 'Momentum', score: signal.scoreBreakdown.momentum, max: 25 },
    { name: 'Volume', score: signal.scoreBreakdown.volume, max: 20 },
    { name: 'Probabiliti', score: signal.scoreBreakdown.probability, max: 15 },
    { name: 'Kecairan', score: signal.scoreBreakdown.liquidity, max: 10 },
  ];

  return (
    <div id="signal-detail-panel" className="rounded border border-neutral-800 bg-[#050505] p-5 space-y-6 animate-fade-in">
      {/* 1. Header Information */}
      <div className="flex items-start justify-between border-b border-neutral-800/60 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-mono text-base font-black text-white">{signal.coin}</h3>
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                isLong ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-500'
              }`}
            >
              {signal.direction}
            </span>
            <span className="font-mono text-[10px] text-neutral-500">
              Grade {signal.score >= 90 ? 'A+' : signal.score >= 80 ? 'A' : 'B'}
            </span>
          </div>
          <p className="font-sans text-[10px] text-neutral-500 mt-1.5 uppercase tracking-wider">
            Trigger: {new Date(signal.timestamp).toLocaleTimeString()}
          </p>
          {livePrices[signal.coin] && (
            <div className="mt-2 flex items-center gap-2 rounded bg-emerald-950/20 border border-emerald-500/20 px-2 py-1.5 w-fit">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="font-mono text-xs font-bold text-emerald-400">
                LIVE PRICE: {livePrices[signal.coin].markPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
              </span>
            </div>
          )}
        </div>
        <div className="text-right font-mono">
          <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Score</div>
          <div className={`text-xl font-black ${isLong ? 'text-emerald-400' : 'text-rose-400'}`}>
            {signal.score}
            <span className="text-xs text-neutral-500 font-normal">/100</span>
          </div>
          {(signal as any).originalScore !== undefined && (signal as any).originalScore !== signal.score && (
            <div className="text-[9px] text-amber-400 mt-0.5 uppercase tracking-wider font-bold">
              Asal: {(signal as any).originalScore}
            </div>
          )}
        </div>
      </div>

      {/* 2. Price chart */}
      <div className="space-y-2">
        <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
          <Coins className="h-3 w-3 text-neutral-400" />
          15M Klines & Risk Boundaries (Binance Feed)
        </p>

        <div className="h-44 w-full rounded border border-neutral-800 bg-neutral-900/10 p-2 relative">
          {loadingChart ? (
            <div className="flex h-full items-center justify-center font-mono text-xs text-neutral-600">
              Memuatkan data carta...
            </div>
          ) : candles.length === 0 ? (
            <div className="flex h-full items-center justify-center font-mono text-xs text-neutral-600">
              Gagal memuatkan data kline.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={candles} margin={{ top: 10, right: 5, bottom: 5, left: 10 }}>
                <CartesianGrid stroke="#1c1c1f" strokeDasharray="3 3" />
                <XAxis dataKey="time" tick={{ fill: '#737373', fontSize: 9 }} axisLine={false} tickLine={false} />
                <YAxis 
                  domain={['dataMin - 0.005', 'dataMax + 0.005']} 
                  tick={{ fill: '#737373', fontSize: 9 }} 
                  axisLine={false} 
                  tickLine={false} 
                  orientation="right"
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#0a0a0a', borderColor: '#262626', fontSize: '10px', fontFamily: 'monospace' }}
                  labelStyle={{ color: '#a3a3a3' }}
                />
                
                {/* Horizontal guide lines for SL and TP */}
                <ReferenceLine y={signal.stopLoss} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'SL', fill: '#ef4444', fontSize: 9, position: 'left' }} />
                <ReferenceLine y={signal.entryPrice} stroke="#e5e5e5" strokeDasharray="3 3" label={{ value: 'ENTRY', fill: '#e5e5e5', fontSize: 9, position: 'left' }} />
                <ReferenceLine y={signal.takeProfit1} stroke="#10b981" strokeDasharray="3 3" label={{ value: 'TP1', fill: '#10b981', fontSize: 9, position: 'left' }} />

                <Line type="monotone" dataKey="close" stroke={isLong ? '#10b981' : '#ef4444'} strokeWidth={1.5} dot={false} name="Harga" />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 3. Detailed Scoring Breakdown */}
      <div className="space-y-3 border-t border-neutral-800/60 pt-4">
        <p className="font-mono text-[9px] uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5 text-neutral-400" />
          Scoring Component Weight breakdown
        </p>
        <div className="space-y-2 font-mono text-xs">
          {scoreData.map(item => {
            const pct = (item.score / item.max) * 100;
            return (
              <div key={item.name} className="space-y-1">
                <div className="flex justify-between text-[11px]">
                  <span className="text-neutral-400">{item.name}</span>
                  <span className="text-neutral-200 font-bold">{item.score} / {item.max}</span>
                </div>
                <div className="h-1 w-full rounded bg-neutral-900 overflow-hidden">
                  <div 
                    className={`h-full ${isLong ? 'bg-emerald-500' : 'bg-rose-500'}`}
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 4. Position Sizing Risk Calculator */}
      <div className="border-t border-neutral-800/60 pt-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <Calculator className="h-4 w-4 text-emerald-400" />
          <p className="font-mono text-[9px] uppercase tracking-wider text-emerald-400 font-bold">
            Risk & Position Calculator
          </p>
        </div>
        
        <div className="grid grid-cols-2 gap-3 font-mono text-[11px] text-neutral-400">
          <div>
            <label className="block text-neutral-500 mb-1 uppercase tracking-wider text-[9px]">Account Size (USDT)</label>
            <input 
              type="number" 
              value={accountSize}
              onChange={(e) => setAccountSize(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full rounded border border-neutral-800 bg-neutral-900/50 p-1.5 text-white focus:outline-none focus:border-neutral-700"
            />
          </div>
          <div>
            <label className="block text-neutral-500 mb-1 uppercase tracking-wider text-[9px]">Risk per Trade (%)</label>
            <input 
              type="number" 
              value={riskPercent}
              onChange={(e) => setRiskPercent(Math.max(0, parseFloat(e.target.value) || 0))}
              step="0.1"
              className="w-full rounded border border-neutral-800 bg-neutral-900/50 p-1.5 text-white focus:outline-none focus:border-neutral-700"
            />
          </div>
        </div>

        {/* Calculated Output */}
        <div className="rounded border border-neutral-800/40 bg-neutral-950/40 p-3 font-mono text-[11px] space-y-2 text-neutral-400">
          <div className="flex justify-between">
            <span className="text-neutral-500">Total Capital at Risk:</span>
            <span className="font-bold text-rose-400">-{dollarRisk.toFixed(1)} USDT</span>
          </div>
          <div className="flex justify-between border-t border-neutral-800/40 pt-2 text-xs">
            <span className="text-neutral-300">Suggested Position Size:</span>
            <span className="font-bold text-white">{positionSize.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} USDT</span>
          </div>
          <div className="flex justify-between border-t border-neutral-800/40 pt-2">
            <span className="text-neutral-500">Leverage Factor:</span>
            <span className="font-bold text-amber-400">
              {leverageRequired.toFixed(1)}x
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
