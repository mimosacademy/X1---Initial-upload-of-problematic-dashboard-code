import React, { useState, useEffect } from 'react';
import Header from './components/Header';
import MarketStatusBar from './components/MarketStatusBar';
import VipSignalPanel from './components/VipSignalPanel';
import SignalsTable from './components/SignalsTable';
import SignalDetailPanel from './components/SignalDetailPanel';
import PerformanceBacktest from './components/PerformanceBacktest';
import SettingsPanel from './components/SettingsPanel';
import MarketRegimeOverview from './components/MarketRegimeOverview';
import { Signal, MarketStatus } from './types';
import { ShieldAlert, BarChart3, TrendingUp, Settings as SettingsIcon, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { useSignalStore } from './store/signalStore';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export default function App() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'regimes' | 'performance' | 'settings'>('terminal');
  const queryClient = useQueryClient();

  const {
    signals,
    marketStatus,
    loading,
    selectedSignal,
    lastScanTime,
    livePrices,
    setLivePrices,
    setSelectedSignal,
    setSignals,
    setMarketStatus,
    setLastScanTime,
    setLoading,
  } = useSignalStore();

  const fetchSignals = async () => {
    const res = await fetch('/api/signals');
    if (!res.ok) throw new Error('Gagal mengambil data isyarat');
    return res.json();
  };

  const fetchMarketStatus = async () => {
    const res = await fetch('/api/market-status');
    if (!res.ok) throw new Error('Gagal mengambil status pasaran');
    return res.json();
  };

  const { data: queriedSignals, isLoading: signalsLoading } = useQuery<Signal[]>({
    queryKey: ['signals'],
    queryFn: fetchSignals,
    refetchInterval: 5000,
  });

  const { data: queriedMarketStatus, isLoading: marketLoading } = useQuery<MarketStatus>({
    queryKey: ['market-status'],
    queryFn: fetchMarketStatus,
    refetchInterval: 5000,
  });

  useEffect(() => {
    setLoading(signalsLoading || marketLoading);
  }, [signalsLoading, marketLoading, setLoading]);

  useEffect(() => {
    if (queriedSignals) {
      setSignals(queriedSignals);
      // Auto-select first A+ or first signal if none selected
      if (queriedSignals.length > 0 && !selectedSignal) {
        const aPlus = queriedSignals.find((s: Signal) => s.score >= 90 && s.outcome === 'PENDING');
        if (aPlus) {
          setSelectedSignal(aPlus);
        } else {
          setSelectedSignal(queriedSignals[0]);
        }
      }
    }
  }, [queriedSignals, setSignals, selectedSignal, setSelectedSignal]);

  useEffect(() => {
    if (queriedMarketStatus) {
      setMarketStatus(queriedMarketStatus);
      if (queriedMarketStatus.lastScanTime) {
        setLastScanTime(queriedMarketStatus.lastScanTime);
      }
    }
  }, [queriedMarketStatus, setMarketStatus, setLastScanTime]);

  useEffect(() => {
    console.log('[SSE] Connecting to /api/live-prices/stream...');
    const eventSource = new EventSource('/api/live-prices/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (Array.isArray(data)) {
          const priceMap: Record<string, { bidPrice: number, askPrice: number, markPrice: number }> = {};
          data.forEach((p: any) => {
            priceMap[p.symbol] = {
              bidPrice: p.bidPrice,
              askPrice: p.askPrice,
              markPrice: p.markPrice
            };
          });
          setLivePrices((prev) => ({ ...prev, ...priceMap }));
        }
      } catch (err) {
        console.error('[SSE] Failed to parse live prices message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('[SSE] EventSource encountered an issue. Reconnecting...');
    };

    return () => {
      console.log('[SSE] Disconnecting EventSource...');
      eventSource.close();
    };
  }, [setLivePrices]);

  const handleScanComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['signals'] });
    queryClient.invalidateQueries({ queryKey: ['market-status'] });
  };

  const handleSelectCoin = (coinSymbol: string) => {
    const foundSignal = signals.find(s => s.coin === coinSymbol);
    if (foundSignal) {
      setSelectedSignal(foundSignal);
    } else {
      const coinRegime = marketStatus?.coinRegimes?.find(cr => cr.coin === coinSymbol);
      if (coinRegime) {
        const placeholderSignal: Signal = {
          id: `placeholder-${coinSymbol}`,
          coin: coinSymbol,
          direction: 'LONG',
          entryPrice: 0,
          stopLoss: 0,
          takeProfit1: 0,
          takeProfit2: 0,
          takeProfit3: 0,
          timestamp: Date.now(),
          score: 0,
          scoreBreakdown: { trend: 0, momentum: 0, volume: 0, probability: 0, liquidity: 0 },
          metrics: {
            trend1D: 'NEUTRAL',
            trend4H: 'NEUTRAL',
            trendAlign: false,
            rsi4H: 50,
            rsi15M: 50,
            macdHistogram: [0],
            macdAlign: false,
            volumeSpike: 100,
            cvdDelta10: 0,
            cvdAlign: false,
            bidAskRatio: 1.0,
            spread: 0.02,
            fundingRate: 0.0001,
            openInterestChange: 0,
            adx: 0,
            volatility: 0.02
          },
          outcome: 'PENDING',
          regimeId: coinRegime.regimeId,
          regimeLabel: coinRegime.label,
          regimeStable: coinRegime.stable,
          noTrade: true,
          noTradeReason: `Tiada isyarat kemasukan dikesan. Pasaran berada dalam ${coinRegime.label} (${coinRegime.stable ? 'Stabil' : 'Transisi'}).`
        };
        setSelectedSignal(placeholderSignal);
      }
    }
    setActiveTab('terminal');
  };

  return (
    <div id="app-root" className="min-h-screen bg-[#050505] text-neutral-300 font-sans selection:bg-emerald-500/10 selection:text-emerald-400">
      {/* 1. Header component */}
      <Header onScanComplete={handleScanComplete} lastScanTime={lastScanTime} />

      {/* 2. Market Status Bar Component */}
      <MarketStatusBar status={marketStatus} loading={loading} />

      {/* 3. Main Dashboard Body */}
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6">
        
        {/* Navigation Tabs Bar */}
        <div className="mb-6 flex border-b border-neutral-800 font-mono text-xs">
          <button
            onClick={() => setActiveTab('terminal')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold transition-all ${
              activeTab === 'terminal'
                ? 'border-emerald-500 text-emerald-400 font-black bg-neutral-900/10'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            TRADING TERMINAL
          </button>

          <button
            onClick={() => setActiveTab('regimes')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold transition-all ${
              activeTab === 'regimes'
                ? 'border-emerald-500 text-emerald-400 font-black bg-neutral-900/10'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <Layers className="h-4 w-4" />
            MARKET REGIME OVERVIEW
          </button>
          
          <button
            onClick={() => setActiveTab('performance')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold transition-all ${
              activeTab === 'performance'
                ? 'border-emerald-500 text-emerald-400 font-black bg-neutral-900/10'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <TrendingUp className="h-4 w-4" />
            PRESTASI & BACKTEST
          </button>
          
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-5 py-3 border-b-2 font-bold transition-all ${
              activeTab === 'settings'
                ? 'border-emerald-500 text-emerald-400 font-black bg-neutral-900/10'
                : 'border-transparent text-neutral-500 hover:text-neutral-300'
            }`}
          >
            <SettingsIcon className="h-4 w-4" />
            TETAPAN ALGORITMA
          </button>

          {/* Hard Sync Button */}
          <button
            onClick={handleScanComplete}
            disabled={loading}
            className="ml-auto px-4 py-3 text-neutral-500 hover:text-neutral-300 flex items-center gap-1 bg-neutral-950/20"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Tab Content Router */}
        {activeTab === 'terminal' && (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Left Col: Main signals feed (Vip list and details table) */}
            <div className="space-y-6 lg:col-span-2">
              
              {/* VIP Signals Cards */}
              <VipSignalPanel 
                signals={signals} 
                onSelectSignal={(sig) => setSelectedSignal(sig)} 
                livePrices={livePrices}
              />
              
              {/* Top Ranked Signals Table */}
              <SignalsTable 
                signals={signals} 
                onSelectSignal={(sig) => setSelectedSignal(sig)} 
                selectedSignalId={selectedSignal?.id || null}
                livePrices={livePrices}
              />
            </div>

            {/* Right Col: Signal Detail & Calculators */}
            <div className="lg:col-span-1">
              <SignalDetailPanel signal={selectedSignal} livePrices={livePrices} />
            </div>
          </div>
        )}

        {activeTab === 'regimes' && (
          <MarketRegimeOverview 
            status={marketStatus} 
            signals={signals} 
            onSelectCoin={handleSelectCoin} 
            onRefresh={handleScanComplete}
            loading={loading}
          />
        )}

        {activeTab === 'performance' && (
          <PerformanceBacktest />
        )}

        {activeTab === 'settings' && (
          <SettingsPanel onSettingsSaved={handleScanComplete} />
        )}
      </main>

      {/* 4. Global Footer Disclaimer */}
      <footer id="app-footer" className="mt-12 border-t border-neutral-800 bg-[#050505] px-6 py-6 font-sans text-center">
        <div className="mx-auto max-w-4xl space-y-2">
          <p className="text-[10px] text-neutral-500 tracking-wide font-medium flex items-center justify-center gap-1.5 uppercase font-mono">
            <ShieldAlert className="h-4 w-4 text-neutral-600 flex-shrink-0" />
            PENAFIAN PENTING & HAD PENGGUNAAN (GLOBAL DISCLAIMER)
          </p>
          <p className="text-[10px] text-neutral-500 leading-relaxed max-w-2xl mx-auto">
            Alat ini ditubuhkan untuk tujuan **pembelajaran, analisis kuantitatif, dan edukasi sahaja**. Segala data, pengiraan penunjuk teknikal (EMA, RSI, MACD, ATR, CVD), serta isyarat yang dijana bukan merupakan nasihat pelaburan, nasihat kewangan, atau cadangan untuk melakukan aktiviti dagangan sebenar. Dagangan niaga hadapan (futures perpetual) kripto melibatkan risiko kehilangan modal yang tinggi. Kami tidak menyediakan perkhidmatan trading bot automatik (auto-trading).
          </p>
          <p className="text-[9px] text-neutral-600 pt-2 font-mono">
            CRYPTO SCALPER SIGNAL AI &copy; 2026 · Analisis Kuantitatif Deterministik
          </p>
        </div>
      </footer>
    </div>
  );
}
