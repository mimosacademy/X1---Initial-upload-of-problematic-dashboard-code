import React, { useState, useEffect } from 'react';
import { AppSettings } from '../types';
import { Settings, Save, AlertCircle, HelpCircle, CheckCircle2, Search, ChevronDown, ChevronUp } from 'lucide-react';
import { FIXED_TRADE_PAIRS } from '../config/pairs';
import { useSignalStore } from '../store/signalStore';

interface SettingsPanelProps {
  onSettingsSaved: () => void;
}

export default function SettingsPanel({ onSettingsSaved }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authToken, setAuthToken] = useState(() => {
    return localStorage.getItem('admin_auth_token') || 'scalper_secret_token_2026';
  });

  // Simulation state hooks
  const [showSimulation, setShowSimulation] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'PASSED' | 'REJECTED'>('ALL');
  const marketStatus = useSignalStore((state) => state.marketStatus);

  useEffect(() => {
    // Fetch current settings
    const fetchSettings = async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;

    setSaving(true);
    setSavedSuccess(false);
    setError(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Auth-Token': authToken
        },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Gagal menyimpan tetapan.');
      }
      
      setSavedSuccess(true);
      onSettingsSaved();
      
      // hide success notification after 4s
      setTimeout(() => setSavedSuccess(false), 4000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex h-32 items-center justify-center font-mono text-xs text-zinc-600">
        Memuatkan tetapan penapis...
      </div>
    );
  }

  return (
    <div id="settings-panel" className="max-w-xl mx-auto rounded border border-neutral-800 bg-[#050505] p-6 space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 border-b border-neutral-800/60 pb-3">
        <Settings className="h-5 w-5 text-emerald-400" />
        <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-white">
          THRESHOLD SETTINGS
        </h2>
      </div>

      <form onSubmit={handleSave} className="space-y-5 font-mono text-xs text-neutral-300">
        {/* 1. Minimum Risk:Reward Ratio */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-neutral-400 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
              Nisbah Risk:Reward Minimum (RR)
              <HelpCircle className="h-3.5 w-3.5 text-neutral-600 cursor-help" title="Nisbah jarak Entry-SL berbanding Entry-TP1" />
            </label>
            <span className="font-bold text-emerald-400 text-sm">1 : {settings.minRR.toFixed(1)}</span>
          </div>
          <input 
            type="range"
            min="1.0"
            max="3.0"
            step="0.1"
            value={settings.minRR}
            onChange={(e) => setSettings({ ...settings, minRR: parseFloat(e.target.value) })}
            className="w-full accent-emerald-500 bg-neutral-900 h-1 rounded appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-neutral-500">
            <span>Scalper (1:1.0)</span>
            <span>Konservatif (1:3.0)</span>
          </div>
          <p className="text-[10px] text-neutral-500 mt-1.5 leading-normal">
            Nilai lebih rendah = lebih banyak isyarat tetapi risiko lebih tinggi.
          </p>
        </div>

        {/* 2. Minimum Strength Score */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center">
            <label className="text-neutral-400 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
              Had Skor Kekuatan Minimum (Score)
              <HelpCircle className="h-3.5 w-3.5 text-neutral-600 cursor-help" title="Isyarat dengan skor di bawah ambang ini akan ditolak terus" />
            </label>
            <span className="font-bold text-emerald-400 text-sm">{settings.minScore} / 100</span>
          </div>
          <input 
            type="range"
            min="65"
            max="85"
            step="1"
            value={settings.minScore}
            onChange={(e) => setSettings({ ...settings, minScore: parseInt(e.target.value) })}
            className="w-full accent-emerald-500 bg-neutral-900 h-1 rounded appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-neutral-500">
            <span>Konservatif (65)</span>
            <span>Sangat Ketat (85)</span>
          </div>
        </div>

        {/* 3. Minimum Volume Spike % */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center">
            <label className="text-neutral-400 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
              Lonjakan Volume Minimum (Volume Spike)
              <HelpCircle className="h-3.5 w-3.5 text-neutral-600 cursor-help" title="Volume kline 15M semasa berbanding purata 20 kline sebelumnya" />
            </label>
            <span className="font-bold text-emerald-400 text-sm">{settings.minVolumeSpike}%</span>
          </div>
          <input 
            type="range"
            min="100"
            max="250"
            step="10"
            value={settings.minVolumeSpike}
            onChange={(e) => setSettings({ ...settings, minVolumeSpike: parseInt(e.target.value) })}
            className="w-full accent-emerald-500 bg-neutral-900 h-1 rounded appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-[9px] text-neutral-500">
            <span>Normal (100%)</span>
            <span>Sangat Kuat (250%)</span>
          </div>
        </div>

        {/* 4. Minimum Sample Size for Probability */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between items-center">
            <label className="text-neutral-400 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
              Saiz Sampel Probabiliti Minimum (n)
              <HelpCircle className="h-3.5 w-3.5 text-neutral-600 cursor-help" title="Sampel sejarah serupa dalam Firestore untuk mengaktifkan markah penuh probabiliti" />
            </label>
            <span className="font-bold text-emerald-400 text-sm">{settings.minSampleSize} signals</span>
          </div>
          <input 
            type="range"
            min="10"
            max="40"
            step="5"
            value={settings.minSampleSize}
            onChange={(e) => setSettings({ ...settings, minSampleSize: parseInt(e.target.value) })}
            className="w-full accent-emerald-500 bg-neutral-900 h-1 rounded appearance-none cursor-pointer"
          />
        </div>

        {/* 5. Fixed Trading Pairs Universe Display */}
        <div className="space-y-2 pt-2">
          <label className="text-neutral-400 font-bold block mb-2 uppercase tracking-wider text-[10px]">
            Universe Pasangan Tetap ({FIXED_TRADE_PAIRS.length} Pasangan USDT-M)
          </label>
          <div className="border border-neutral-900 bg-neutral-950/40 rounded p-2.5 h-28 overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-850">
            <div className="flex flex-wrap gap-1">
              {FIXED_TRADE_PAIRS.map(pair => (
                <span key={pair} className="text-[9px] font-mono bg-neutral-900/80 border border-neutral-800/40 px-1.5 py-0.5 rounded text-neutral-400">
                  {pair}
                </span>
              ))}
            </div>
          </div>
          <p className="text-[10px] text-neutral-500 mt-2 leading-normal">
            Sistem menggunakan senarai statik crypto futures berlikuiditi tinggi ini sebagai sumber tunggal kebenaran (Single Source of Truth) untuk imbasan pasaran.
          </p>
        </div>

        {/* 6. Benarkan Range Trading Toggle */}
        <div className="space-y-2 pt-2 border-t border-neutral-900 pt-3">
          <label className="text-neutral-400 font-bold flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
            Benarkan Range Trading? (Allow Range Trading)
            <HelpCircle className="h-3.5 w-3.5 text-neutral-600 cursor-help" title="Fokus M15 scalping breakout biasanya elak range trading kerana RR rendah dan whipsaw tinggi. Default OFF." />
          </label>
          <div className="flex items-center gap-3">
            <input 
              type="checkbox"
              id="allowRangeTrading"
              checked={settings.allowRangeTrading || false}
              onChange={(e) => setSettings({ ...settings, allowRangeTrading: e.target.checked })}
              className="h-4 w-4 rounded border-neutral-800 bg-neutral-900 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-neutral-950 accent-emerald-500 cursor-pointer"
            />
            <span className="font-bold text-neutral-300">
              {settings.allowRangeTrading ? "AKTIF (Gaya Range Trading dibenarkan)" : "MATI (Fokus breakout/pullback sahaja)"}
            </span>
          </div>
          <p className="text-[10px] text-neutral-500 mt-2 leading-normal">
            Sila ambil perhatian: mengaktifkan range trading membenarkan isyarat di sempadan support dan resistance semasa regime pasaran "Range". Apabila dimatikan (default), isyarat Range akan ditolak untuk mengelakkan risiko whipsaw dan mengekalkan RR yang tinggi.
          </p>
        </div>

        {/* 7. Admin Authentication Token Field */}
        <div className="space-y-2 pt-2 border-t border-neutral-900 pt-3">
          <label className="text-neutral-400 font-bold uppercase tracking-wider text-[10px] block">
            Admin Authentication Token
          </label>
          <input 
            type="password"
            value={authToken}
            onChange={(e) => {
              setAuthToken(e.target.value);
              localStorage.setItem('admin_auth_token', e.target.value);
            }}
            placeholder="Sila masukkan token pentadbir"
            className="w-full bg-neutral-900 border border-neutral-800 rounded px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-emerald-500"
          />
          <p className="text-[10px] text-neutral-500 leading-normal">
            Sistem memerlukan token pengesahan yang sah untuk menyimpan sebarang perubahan tetapan.
          </p>
        </div>

        {/* Confirmation & Save */}
        <div className="border-t border-neutral-800/60 pt-4 flex flex-col gap-3">
          {savedSuccess && (
            <div className="flex items-center gap-2 rounded bg-emerald-950/60 border border-emerald-900 p-2.5 text-emerald-400 font-sans">
              <CheckCircle2 className="h-4.5 w-4.5 flex-shrink-0" />
              <span>Tetapan berjaya disimpan ke pangkalan data cloud! Semua imbasan masa depan akan menggunakan parameter baharu ini.</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 rounded bg-red-950/40 border border-red-900 p-2 text-red-400">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 rounded bg-emerald-500 py-2.5 font-bold text-black uppercase tracking-widest transition-all hover:bg-emerald-400 active:scale-[0.98] disabled:bg-neutral-900 disabled:text-neutral-600"
          >
            <Save className="h-4.5 w-4.5" />
            {saving ? 'Menyimpan...' : 'Simpan Tetapan'}
          </button>
        </div>
      </form>

      {/* Collapsible Simulation Block */}
      <div className="border-t border-neutral-800/80 pt-5 mt-4 space-y-4">
        <button
          type="button"
          onClick={() => setShowSimulation(!showSimulation)}
          className="w-full flex items-center justify-between bg-neutral-900/40 hover:bg-neutral-900 border border-neutral-800/60 rounded px-4 py-3 text-neutral-300 font-sans font-bold transition-all"
        >
          <div className="flex items-center gap-2">
            <span className="text-emerald-400">🔬</span>
            <span className="uppercase tracking-wider text-xs">Simulasi & Diagnostik Isyarat ({(marketStatus?.simulations || []).length} Koin)</span>
          </div>
          {showSimulation ? <ChevronUp className="h-4 w-4 text-emerald-400" /> : <ChevronDown className="h-4 w-4 text-emerald-400" />}
        </button>

        {showSimulation && (
          <div className="space-y-4 animate-fade-in">
            <p className="text-[10px] text-neutral-500 leading-normal font-sans">
              Uji syarat teknikal secara real-time untuk setiap pasangan crypto di bawah. Di sini anda boleh mengenal pasti kenapa syarat ketat (seperti sela spread, lonjakan volume, atau trend alignment) menolak mana-mana isyarat daripada dijana.
            </p>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2.5 items-center justify-between font-mono">
              {/* Search bar */}
              <div className="relative w-full sm:max-w-[200px]">
                <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-neutral-600">
                  <Search className="h-3 w-3" />
                </span>
                <input
                  type="text"
                  placeholder="Cari pasangan..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded pl-7 pr-2 py-1 text-[10px] text-zinc-300 placeholder-neutral-600 focus:outline-none focus:border-emerald-500 transition-all"
                />
              </div>

              {/* Tab Filter Status */}
              <div className="flex items-center gap-1 bg-neutral-950 border border-neutral-800 p-0.5 rounded text-[9px] w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => setFilterStatus('ALL')}
                  className={`px-2 py-0.5 rounded transition-all font-bold ${filterStatus === 'ALL' ? 'bg-neutral-900 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  Semua ({(marketStatus?.simulations || []).length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('PASSED')}
                  className={`px-2 py-0.5 rounded transition-all font-bold ${filterStatus === 'PASSED' ? 'bg-emerald-950/40 text-emerald-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  Lulus ({(marketStatus?.simulations || []).filter(s => s.status === 'PASSED').length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterStatus('REJECTED')}
                  className={`px-2 py-0.5 rounded transition-all font-bold ${filterStatus === 'REJECTED' ? 'bg-red-950/40 text-red-400' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  Ditolak ({(marketStatus?.simulations || []).filter(s => s.status === 'REJECTED').length})
                </button>
              </div>
            </div>

            {/* Main Simulations Table/Cards list */}
            {((marketStatus?.simulations || []).filter(sim => {
              const matchesSearch = sim.coin.toLowerCase().includes(search.toLowerCase());
              const matchesStatus = filterStatus === 'ALL' || sim.status === filterStatus;
              return matchesSearch && matchesStatus;
            })).length === 0 ? (
              <div className="border border-neutral-900 bg-neutral-950/40 rounded p-6 text-center text-neutral-600 font-sans text-[11px]">
                {(marketStatus?.simulations || []).length === 0 
                  ? "Tiada data simulasi semasa. Sila lancarkan imbasan pasaran (Manual Scan) terlebih dahulu untuk memaparkan status kriteria bagi semua pasangan crypto."
                  : "Tiada pasangan crypto yang sepadan dengan carian anda."}
              </div>
            ) : (
              <div className="border border-neutral-900 bg-neutral-950/20 rounded overflow-hidden max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-neutral-800">
                <div className="divide-y divide-neutral-900">
                  {((marketStatus?.simulations || []).filter(sim => {
                    const matchesSearch = sim.coin.toLowerCase().includes(search.toLowerCase());
                    const matchesStatus = filterStatus === 'ALL' || sim.status === filterStatus;
                    return matchesSearch && matchesStatus;
                  })).map((sim) => {
                    const isPassed = sim.status === 'PASSED';
                    return (
                      <div key={sim.coin} className="p-2.5 hover:bg-neutral-900/20 transition-all space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-zinc-200 text-[11px]">{sim.coin}</span>
                            <span className="text-[9px] text-neutral-500 bg-neutral-900 px-1 py-0.5 rounded font-mono">
                              {sim.regimeLabel}
                            </span>
                          </div>
                          <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase border font-mono ${
                            isPassed 
                              ? 'bg-emerald-950/30 border-emerald-900/60 text-emerald-400' 
                              : 'bg-red-950/20 border-red-900/50 text-red-400'
                          }`}>
                            {isPassed ? 'Lulus' : 'Ditolak'}
                          </span>
                        </div>

                        {/* Detailed Indicators Tested */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 font-mono text-[9px] text-neutral-400 bg-neutral-950 p-1.5 rounded border border-neutral-900/30">
                          <div>
                            <span className="text-neutral-600 block text-[8px] uppercase">RSI 15M/4H</span>
                            <span className="font-bold text-zinc-300">
                              {(sim.rsi15M || 0).toFixed(1)} <span className="text-neutral-600">/</span> {(sim.rsi4H || 0).toFixed(1)}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-600 block text-[8px] uppercase">Trend 1D/4H</span>
                            <span className={`font-bold ${sim.trend1D === 'BULLISH' ? 'text-emerald-500' : sim.trend1D === 'BEARISH' ? 'text-red-500' : 'text-neutral-500'}`}>
                              {sim.trend1D || 'NEUTRAL'}
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-600 block text-[8px] uppercase">Vol Spike</span>
                            <span className={`font-bold ${sim.volumeSpike >= 120 ? 'text-emerald-400' : 'text-zinc-400'}`}>
                              {(sim.volumeSpike || 0).toFixed(0)}%
                            </span>
                          </div>
                          <div>
                            <span className="text-neutral-600 block text-[8px] uppercase">Sela Spread</span>
                            <span className={`font-bold ${sim.spread > 0.15 ? 'text-red-400' : 'text-emerald-400'}`}>
                              {(sim.spread || 0).toFixed(3)}%
                            </span>
                          </div>
                        </div>

                        {!isPassed && sim.rejectReason && (
                          <div className="text-[9px] font-sans flex items-start gap-1 text-neutral-500 bg-red-950/5 border border-red-950/10 rounded p-1 leading-normal">
                            <span className="text-red-500 mt-0.5">⚠️</span>
                            <span>
                              <strong className="text-neutral-400">Gagal:</strong> {sim.rejectReason}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
