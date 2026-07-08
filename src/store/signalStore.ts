import { create } from 'zustand';
import { Signal, MarketStatus } from '../types';

interface SignalState {
  signals: Signal[];
  marketStatus: MarketStatus | null;
  loading: boolean;
  selectedSignal: Signal | null;
  lastScanTime: number;
  livePrices: Record<string, { bidPrice: number; askPrice: number; markPrice: number }>;
  
  setSignals: (signals: Signal[]) => void;
  setMarketStatus: (status: MarketStatus | null) => void;
  setLoading: (loading: boolean) => void;
  setSelectedSignal: (signal: Signal | null) => void;
  setLastScanTime: (time: number) => void;
  setLivePrices: (prices: Record<string, { bidPrice: number; askPrice: number; markPrice: number }> | ((prev: Record<string, { bidPrice: number; askPrice: number; markPrice: number }>) => Record<string, { bidPrice: number; askPrice: number; markPrice: number }>)) => void;
  fetchLatestData: () => Promise<void>;
}

export const useSignalStore = create<SignalState>((set, get) => ({
  signals: [],
  marketStatus: null,
  loading: true,
  selectedSignal: null,
  lastScanTime: 0,
  livePrices: {},

  setSignals: (signals) => set({ signals }),
  setMarketStatus: (marketStatus) => set({ marketStatus }),
  setLoading: (loading) => set({ loading }),
  setSelectedSignal: (selectedSignal) => set({ selectedSignal }),
  setLastScanTime: (lastScanTime) => set({ lastScanTime }),
  setLivePrices: (update) => {
    if (typeof update === 'function') {
      set((state) => ({ livePrices: update(state.livePrices) }));
    } else {
      set({ livePrices: update });
    }
  },

  fetchLatestData: async () => {
    set({ loading: true });
    try {
      const signalsRes = await fetch('/api/signals');
      if (signalsRes.ok) {
        const signalsData = await signalsRes.json();
        set({ signals: signalsData });
        
        // Auto-select first A+ or first signal if none selected
        const currentSelected = get().selectedSignal;
        if (signalsData.length > 0 && !currentSelected) {
          const aPlus = signalsData.find((s: Signal) => s.score >= 90 && s.outcome === 'PENDING');
          if (aPlus) {
            set({ selectedSignal: aPlus });
          } else {
            set({ selectedSignal: signalsData[0] });
          }
        }
      }

      const statusRes = await fetch('/api/market-status');
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        set({
          marketStatus: statusData,
          lastScanTime: statusData.lastScanTime || 0,
        });
      }
    } catch (err) {
      console.error('[Store] Failed to fetch latest data:', err);
    } finally {
      set({ loading: false });
    }
  }
}));
