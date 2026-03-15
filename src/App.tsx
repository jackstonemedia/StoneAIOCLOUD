/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import UsageDashboard from './components/UsageDashboard';

export default function App() {
  return (
    <div className="min-h-screen bg-[var(--bg)] font-sans text-[var(--text)] selection:bg-[var(--accent-g2)]">
      <nav className="bg-[var(--bg2)] border-b border-[var(--border)] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-[var(--accent)] rounded-lg flex items-center justify-center text-[#0E0E0C] font-black italic shadow-[var(--glow-gold)]">S</div>
            <span className="font-display text-xl tracking-tight uppercase">Stone AIO</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg3)] border border-[var(--border)] rounded-full">
              <div className="status-live"></div>
              <span className="text-xs font-semibold text-[var(--text-m)]">System Live</span>
            </div>
            <div className="w-8 h-8 rounded-full bg-[var(--bg4)] border border-[var(--border)]" />
          </div>
        </div>
      </nav>

      <main className="py-8">
        <UsageDashboard />
      </main>
    </div>
  );
}
