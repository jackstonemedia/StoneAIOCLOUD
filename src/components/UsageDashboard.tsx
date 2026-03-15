import React, { useState, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, Cell, PieChart, Pie
} from 'recharts';
import { 
  Zap, MessageSquare, Smartphone, Play, HardDrive, 
  TrendingUp, AlertCircle, CheckCircle2, ChevronRight,
  Shield, Crown, Star
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { cn } from '../lib/utils';

interface UsageStats {
  resource: string;
  used: number;
  limit: number;
  percent: number;
  period: string;
}

interface UsageHistory {
  date: string;
  tokens: number;
  executions: number;
  api_requests: number;
  sms: number;
}

export default function UsageDashboard() {
  const [currentUsage, setCurrentUsage] = useState<UsageStats[]>([]);
  const [history, setHistory] = useState<UsageHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [currentRes, historyRes] = await Promise.all([
        fetch('/api/v1/usage/current'),
        fetch('/api/v1/usage/history')
      ]);

      if (!currentRes.ok || !historyRes.ok) throw new Error('Failed to fetch usage data');

      const currentData = await currentRes.json();
      const historyData = await historyRes.json();

      setCurrentUsage(currentData.usage);
      setHistory(historyData.history);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-xl flex items-center gap-3 text-red-700">
        <AlertCircle className="w-5 h-5" />
        <p>{error}</p>
      </div>
    );
  }

  const getResourceIcon = (resource: string) => {
    switch (resource) {
      case 'tokens': return <MessageSquare className="w-5 h-5" />;
      case 'sms': return <Smartphone className="w-5 h-5" />;
      case 'executions': return <Play className="w-5 h-5" />;
      case 'api_requests': return <Zap className="w-5 h-5" />;
      case 'storage': return <HardDrive className="w-5 h-5" />;
      default: return <TrendingUp className="w-5 h-5" />;
    }
  };

  const getResourceColor = (percent: number) => {
    if (percent >= 90) return 'text-[var(--err)] bg-[var(--err)]';
    if (percent >= 75) return 'text-[var(--warn)] bg-[var(--warn)]';
    return 'text-[var(--accent)] bg-[var(--accent)]';
  };

  return (
    <div className="space-y-8 p-6 max-w-7xl mx-auto animate-[fadeIn_0.5s_ease]">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text)] font-display uppercase">Usage & Limits</h1>
          <p className="text-[var(--text-m)] mt-1">Monitor your resource consumption and plan boundaries.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--bg2)] border border-[var(--border)] rounded-full text-sm font-medium text-[var(--text)] shadow-[var(--shadow-sm)]">
          <Crown className="w-4 h-4 text-[var(--accent)]" />
          <span>Pro Plan</span>
          <ChevronRight className="w-4 h-4 opacity-50" />
        </div>
      </div>

      {/* Current Usage Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {currentUsage.map((stat) => (
          <div key={stat.resource} className="card p-6 card-hover card-glow transition-all duration-300">
            <div className="flex items-start justify-between mb-4">
              <div className={cn("p-2.5 rounded-xl bg-opacity-10", getResourceColor(stat.percent).split(' ')[1])}>
                <div className={cn(getResourceColor(stat.percent).split(' ')[0])}>
                  {getResourceIcon(stat.resource)}
                </div>
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-d)]">
                {stat.period}
              </span>
            </div>
            
            <h3 className="text-sm font-semibold text-[var(--text-m)] uppercase tracking-tight mb-1">
              {stat.resource.replace('_', ' ')}
            </h3>
            
            <div className="flex items-baseline gap-2 mb-4">
              <span className="text-2xl font-bold text-[var(--text)] font-mono">
                {stat.used.toLocaleString()}
              </span>
              <span className="text-[var(--text-d)] text-sm">
                / {stat.limit === Infinity ? '∞' : stat.limit.toLocaleString()}
              </span>
            </div>

            <div className="space-y-2">
              <div className="h-1.5 w-full bg-[var(--bg4)] rounded-full overflow-hidden">
                <div 
                  className={cn("h-full transition-all duration-700 ease-out", getResourceColor(stat.percent).split(' ')[1])}
                  style={{ width: `${Math.min(stat.percent, 100)}%` }}
                />
              </div>
              <div className="flex justify-between text-[var(--text-micro)] font-medium uppercase tracking-wider">
                <span className={cn(stat.percent > 90 ? "text-[var(--err)]" : "text-[var(--text-m)]")}>
                  {stat.percent.toFixed(1)}% used
                </span>
                {stat.percent > 90 && (
                  <span className="text-[var(--err)] flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Limit Alert
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* History Chart */}
      <div className="card p-8 bg-[var(--bg2)] border-[var(--border)]">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-bold text-[var(--text)] font-display uppercase">Consumption History</h2>
            <p className="text-sm text-[var(--text-m)]">Daily usage trends over the last 30 days.</p>
          </div>
          <div className="flex gap-2">
             <button className="btn btn-primary btn-sm">Tokens</button>
             <button className="btn btn-ghost btn-sm">Executions</button>
          </div>
        </div>

        <div className="h-[350px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={history}>
              <defs>
                <linearGradient id="colorTokens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-s)" />
              <XAxis 
                dataKey="date" 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-d)', fontFamily: 'JetBrains Mono' }}
                tickFormatter={(str) => format(parseISO(str), 'MMM d')}
                minTickGap={30}
              />
              <YAxis 
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: 'var(--text-d)', fontFamily: 'JetBrains Mono' }}
                tickFormatter={(val) => val >= 1000 ? `${(val/1000).toFixed(1)}k` : val}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'var(--bg2)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  boxShadow: 'var(--shadow-lg)',
                  color: 'var(--text)',
                  fontSize: '12px',
                  fontFamily: 'JetBrains Mono'
                }}
                itemStyle={{ color: 'var(--accent)' }}
                labelFormatter={(str) => format(parseISO(str as string), 'MMMM d, yyyy')}
              />
              <Area 
                type="monotone" 
                dataKey="tokens" 
                stroke="var(--accent)" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorTokens)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Plan Details Footer */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[var(--accent-g)] border border-[var(--accent-g2)] p-6 rounded-2xl flex items-start gap-4">
          <div className="p-3 bg-[var(--accent)] rounded-xl text-[#0E0E0C]">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h3 className="font-bold text-[var(--accent)] uppercase tracking-tight">Resource Protection</h3>
            <p className="text-sm text-[var(--text-m)] mt-1">
              Your plan includes automatic scaling protection. If you reach a limit, we'll notify you before pausing services.
            </p>
          </div>
        </div>
        
        <div className="bg-[var(--bg2)] border border-[var(--accent)] p-6 rounded-2xl flex items-center justify-between shadow-[var(--glow-gold)]">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[var(--bg3)] rounded-xl border border-[var(--border)]">
              <Crown className="w-6 h-6 text-[var(--accent)]" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--text)] uppercase tracking-tight">Need more power?</h3>
              <p className="text-sm text-[var(--text-m)]">Upgrade to Ultra for unlimited everything.</p>
            </div>
          </div>
          <button className="btn btn-primary btn-lg">
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}
