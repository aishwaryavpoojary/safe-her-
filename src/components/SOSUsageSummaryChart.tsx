import React, {useMemo, useState} from 'react';
import {BarChart3} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {SOSLogEntry} from '../types/safety';

interface SOSUsageSummaryChartProps {
  sosLogs: SOSLogEntry[];
  compact?: boolean;
  onViewHistory?: () => void;
}

type ChannelFilter = 'all' | 'online' | 'offline';

interface DailySOSBucket {
  dateKey: string;
  shortLabel: string;
  fullDateLabel: string;
  count: number;
  sourcesSummary: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{payload: DailySOSBucket}>;
}

const CustomChartTooltip: React.FC<CustomTooltipProps> = ({active, payload}) => {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0].payload;

  return (
    <div className="rounded-xl surface-red px-3 py-2 shadow-xl text-xs space-y-0.5">
      <div className="font-semibold text-slate-900">{bucket.fullDateLabel}</div>
      <div className="font-mono text-red-700 font-bold tabular-nums">
        {bucket.count} {bucket.count === 1 ? 'SOS alert' : 'SOS alerts'}
      </div>
      {bucket.sourcesSummary && (
        <div className="text-[11px] text-slate-600 max-w-[200px] truncate">
          {bucket.sourcesSummary}
        </div>
      )}
    </div>
  );
};

function toLocalDayKey(ts: number): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const SOSUsageSummaryChart: React.FC<SOSUsageSummaryChartProps> = ({
  sosLogs,
  compact = false,
  onViewHistory,
}) => {
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  const {dailyBuckets, total30d, total7d, activeDaysCount} = useMemo(() => {
    const filteredLogs = sosLogs.filter((entry) => {
      if (channelFilter === 'online') return entry.alertChannel === 'online-live';
      if (channelFilter === 'offline') return entry.alertChannel === 'offline-sms';
      return true;
    });

    const grouped = new Map<string, SOSLogEntry[]>();
    for (const entry of filteredLogs) {
      const key = toLocalDayKey(entry.timestamp);
      const list = grouped.get(key);
      if (list) {
        list.push(entry);
      } else {
        grouped.set(key, [entry]);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buckets: DailySOSBucket[] = [];
    let sum30 = 0;
    let sum7 = 0;
    let activeDays = 0;

    for (let offset = 29; offset >= 0; offset--) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      const key = toLocalDayKey(date.getTime());
      const matches = grouped.get(key) || [];
      const count = matches.length;

      sum30 += count;
      if (offset < 7) {
        sum7 += count;
      }
      if (count > 0) {
        activeDays += 1;
      }

      const uniqueSources = Array.from(new Set(matches.map((m) => m.triggerSource)));

      buckets.push({
        dateKey: key,
        shortLabel: date.toLocaleDateString([], {month: 'short', day: 'numeric'}),
        fullDateLabel: date.toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        }),
        count,
        sourcesSummary: uniqueSources.join(' · '),
      });
    }

    return {
      dailyBuckets: buckets,
      total30d: sum30,
      total7d: sum7,
      activeDaysCount: activeDays,
    };
  }, [sosLogs, channelFilter]);

  return (
    <div className="rounded-3xl surface-white p-5 space-y-4">
      {/* Header & Interactive Filter */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-red-600 shrink-0" />
            <h2 className="font-display text-base font-bold text-slate-900">
              30-Day SOS Activity
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            <span>Rolling 30-day alert frequency</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono text-slate-700 tabular-nums">{total30d} total</span>
          </p>
        </div>

        {!compact ? (
          <div className="flex items-center gap-1 surface-well p-1 rounded-xl">
            {(
              [
                {id: 'all', label: 'All'},
                {id: 'online', label: 'Online'},
                {id: 'offline', label: 'SMS'},
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChannelFilter(opt.id)}
                className={`min-h-[34px] px-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  channelFilter === opt.id
                    ? 'btn-red text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        ) : (
          onViewHistory && (
            <button
              type="button"
              onClick={onViewHistory}
              className="min-h-[36px] px-3 rounded-xl btn-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Full Log
            </button>
          )
        )}
      </div>

      {/* Tabular Summary Strip (Hairline Dividers, Zero Nested Cards) */}
      <div className="grid grid-cols-3 gap-3 py-2.5 border-y border-slate-200">
        <div>
          <div className="text-[11px] text-slate-500">30-Day Alerts</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
            {total30d}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Last 7 Days</div>
          <div className="font-mono text-lg font-bold text-red-600 tabular-nums mt-0.5">
            {total7d}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Active Days</div>
          <div className="font-mono text-lg font-bold text-slate-900 tabular-nums mt-0.5">
            {activeDaysCount}
            <span className="text-xs font-normal text-slate-400">/30</span>
          </div>
        </div>
      </div>

      {/* Recharts 30-Day Bar Chart */}
      <div
        className={compact ? 'h-[150px] w-full min-w-0' : 'h-[185px] w-full min-w-0'}
        aria-label="Bar chart showing daily SOS alert count over the past 30 days"
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dailyBuckets} margin={{top: 6, right: 4, left: -26, bottom: 0}}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(15,23,42,0.08)" />
            <XAxis
              dataKey="shortLabel"
              tickLine={false}
              axisLine={{stroke: 'rgba(15,23,42,0.16)'}}
              interval={6}
              tick={{
                fontSize: 10,
                fill: '#475569',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              domain={[0, (dataMax: number) => Math.max(3, dataMax)]}
              tick={{
                fontSize: 10,
                fill: '#475569',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            />
            <Tooltip
              content={<CustomChartTooltip />}
              cursor={{fill: 'rgba(220, 38, 38, 0.08)'}}
            />
            <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={12}>
              {dailyBuckets.map((entry) => (
                <Cell
                  key={entry.dateKey}
                  fill={entry.count >= 2 ? '#DC2626' : '#F87171'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Empty-state or active footnote */}
      <p className="text-xs text-slate-500 leading-relaxed">
        {total30d === 0
          ? 'No SOS triggers recorded in the past 30 days. Any triggered alert updates this timeline automatically.'
          : 'Deep crimson bars mark days with multiple SOS triggers; soft red bars mark single-alert days.'}
      </p>
    </div>
  );
};
