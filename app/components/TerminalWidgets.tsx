"use client";

import { useEffect, useState } from "react";

export const TerminalWidgets = () => {
  const [systemStats, setSystemStats] = useState({
    cpu: 0,
    memory: 0,
    network: 0,
  });
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    // Update system stats randomly to simulate live data
    const interval = setInterval(() => {
      setSystemStats({
        cpu: Math.floor(Math.random() * 30) + 10,
        memory: Math.floor(Math.random() * 20) + 40,
        network: Math.floor(Math.random() * 50) + 20,
      });
      setCurrentTime(new Date());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="fixed top-20 right-4 z-30 space-y-2 pointer-events-none hidden xl:block w-[240px] opacity-80">
      {/* System Stats */}
      <div className="terminal-stats">
        <div className="flex justify-between items-center mb-1">
          <span>CPU:</span>
          <span className="terminal-stats-value">{systemStats.cpu}%</span>
        </div>
        <div className="w-full bg-terminal-border h-1 mb-2">
          <div
            className="bg-terminal-green h-1 w-full origin-left transition-transform duration-300 ease-linear motion-reduce:transition-none"
            style={{ transform: `scaleX(${systemStats.cpu / 100})` }}
          />
        </div>
        <div className="flex justify-between items-center mb-1">
          <span>MEM:</span>
          <span className="terminal-stats-value">{systemStats.memory}%</span>
        </div>
        <div className="w-full bg-terminal-border h-1 mb-2">
          <div
            className="bg-terminal-green h-1 w-full origin-left transition-transform duration-300 ease-linear motion-reduce:transition-none"
            style={{ transform: `scaleX(${systemStats.memory / 100})` }}
          />
        </div>
        <div className="flex justify-between items-center mb-1">
          <span>NET:</span>
          <span className="terminal-stats-value">
            {systemStats.network} Mb/s
          </span>
        </div>
        <div className="w-full bg-terminal-border h-1">
          <div
            className="bg-terminal-green h-1 w-full origin-left transition-transform duration-300 ease-linear motion-reduce:transition-none"
            style={{ transform: `scaleX(${systemStats.network / 100})` }}
          />
        </div>
      </div>

      {/* Clock */}
      <div className="terminal-stats">
        <div className="text-center">
          <div className="terminal-glow text-lg font-bold">
            {currentTime.toLocaleTimeString()}
          </div>
          <div className="text-xs text-muted-foreground">
            {currentTime.toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Status Indicator */}
      <div className="terminal-panel terminal-border p-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-terminal-green animate-pulse terminal-glow" />
          <span className="text-xs">SYSTEM ONLINE</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">TERMINAL_V1.0</div>
      </div>
    </div>
  );
};
