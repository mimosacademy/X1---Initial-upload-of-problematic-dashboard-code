import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw, AlertTriangle, Play, Flame } from 'lucide-react';

interface HeaderProps {
  onScanComplete: () => void;
  lastScanTime: number;
}

export default function Header({ onScanComplete, lastScanTime }: HeaderProps) {
  const [countdown, setCountdown] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Live countdown timer to the next 15-minute sync (00, 15, 30, 45 UTC minutes)
    const interval = setInterval(() => {
      const now = new Date();
      const currentMinutes = now.getUTCMinutes();
      const currentSeconds = now.getUTCSeconds();
      
      const next15Min = Math.ceil((currentMinutes + 0.1) / 15) * 15;
      let diffMinutes = next15Min - currentMinutes;
      if (diffMinutes <= 0) diffMinutes += 60;
      
      const targetMin = (currentMinutes + diffMinutes) % 60;
      
      // Calculate remaining seconds
      const nowMs = now.getTime();
      const targetTime = new Date(now);
      targetTime.setUTCMinutes(targetMin, 5, 0); // add 5s buffer
      if (targetTime.getTime() <= nowMs) {
        targetTime.setUTCMinutes(targetMin + 15, 5, 0);
      }
      
      const secondsLeft = Math.max(0, Math.floor((targetTime.getTime() - nowMs) / 1000));
      const m = Math.floor(secondsLeft / 60);
      const s = secondsLeft % 60;
      
      setCountdown(`${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`);

      // Handle button cooldown
      if (lastScanTime > 0) {
        const diffSecs = Math.floor((Date.now() - lastScanTime) / 1000);
        const remainingCooldown = Math.max(0, 60 - diffSecs);
        setCooldown(remainingCooldown);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lastScanTime]);

  const handleManualScan = async () => {
    if (cooldown > 0 || isScanning) return;
    setIsScanning(true);
    setError(null);

    try {
      const res = await fetch('/api/scan-now', { method: 'POST' });
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Imbasan manual gagal.');
      }
      
      onScanComplete();
    } catch (err: any) {
      setError(err.message);
      // clear error after 5s
      setTimeout(() => setError(null), 5000);
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <header id="app-header" className="h-16 border-b border-neutral-800 bg-neutral-900/50 px-6 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-emerald-500 rounded-sm flex items-center justify-center rotate-45 flex-shrink-0">
          <span className="-rotate-45 text-black font-black text-xs font-mono">AI</span>
        </div>
        <div>
          <h1 className="text-sm sm:text-base font-bold tracking-tighter text-white font-mono leading-none">
            CRYPTO SCALPER <span className="text-emerald-400">SIGNAL AI</span>
          </h1>
          <p className="text-[9px] sm:text-[10px] text-neutral-500 uppercase tracking-widest leading-none font-mono mt-1 hidden sm:block">
            Scan: Top 100 Volume Perpetual Futures
          </p>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="text-right">
          <p className="text-[9px] text-neutral-500 uppercase tracking-wider font-mono">Next Scan In</p>
          <p className="font-mono text-emerald-400 text-sm sm:text-base leading-none font-bold mt-1">{countdown}</p>
        </div>

        <button
          id="scan-now-btn"
          onClick={handleManualScan}
          disabled={isScanning || cooldown > 0}
          className={`px-3 py-1.5 sm:px-4 sm:py-2 border text-[10px] sm:text-xs font-bold uppercase tracking-widest transition-all duration-200 font-mono ${
            isScanning || cooldown > 0
              ? 'bg-neutral-900 border-neutral-800 text-neutral-500 cursor-not-allowed opacity-60'
              : 'bg-emerald-500 border-emerald-500 text-black hover:bg-emerald-400 active:scale-95'
          }`}
        >
          {isScanning ? 'Mengimbas...' : cooldown > 0 ? `Cooling (${cooldown}s)` : 'Scan Now'}
        </button>
      </div>

      {error && (
        <div className="absolute top-16 left-6 right-6 z-50 mt-1 flex items-center gap-2 rounded bg-red-950/90 border border-red-900/60 p-2 text-xs text-red-400 font-mono animate-fade-in">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </header>
  );
}
