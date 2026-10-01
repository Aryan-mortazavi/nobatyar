"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: 12,
      fontSize: 12,
      color: "var(--popover-foreground)",
      boxShadow: "0 18px 40px -24px rgba(0,0,0,0.45)",
    },
    labelStyle: { color: "var(--muted-foreground)", fontWeight: 500 },
  } as const;
}

export function WeekTrendChart({
  data,
}: {
  data: { label: string; value: number }[];
  labels?: unknown;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
        <defs>
          <linearGradient id="nyTrend" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
          dy={6}
        />
        <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11 }} />
        <Tooltip {...tooltipStyle()} />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--chart-1)"
          strokeWidth={2.5}
          fill="url(#nyTrend)"
          dot={{ r: 3, strokeWidth: 0, fill: "var(--chart-1)" }}
          activeDot={{ r: 5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ServiceShareChart({ data }: { data: { label: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={92}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11 }}
        />
        <Tooltip {...tooltipStyle()} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
        <Bar dataKey="value" radius={[6, 6, 6, 6]} barSize={16}>
          {data.map((entry, index) => (
            <Cell key={entry.label} fill={CHART_COLORS[index % CHART_COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusDonut({ data }: { data: { key: string; label: string; value: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <div className="relative h-40 w-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius={52}
              outerRadius={76}
              paddingAngle={3}
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={entry.key} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip {...tooltipStyle()} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{total}</p>
            <p className="text-[11px] text-muted-foreground">total</p>
          </div>
        </div>
      </div>
      <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {data.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}
              aria-hidden
            />
            <span className="truncate text-muted-foreground">{entry.label}</span>
            <span className="ms-auto tabular-nums font-medium">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { CHART_COLORS };
