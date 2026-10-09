import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney } from '@/lib/utils'

export const PALETTE = ['#0b1f3a', '#f97316', '#3c6194', '#fdba74', '#94aecd', '#c2410c', '#243d62']

export function CostPie({ data, currency }: { data: { category: string; cost: number }[]; currency: string }) {
  const rows = data.filter((d) => d.cost > 0)
  if (!rows.length) return <p className="py-10 text-center text-sm text-slate-500">No priced materials yet.</p>
  return (
    <div className="h-72" role="img" aria-label="Cost distribution by material category">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={rows} dataKey="cost" nameKey="category" innerRadius={55} outerRadius={95} paddingAngle={2}>
            {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
          </Pie>
          <Tooltip formatter={(v) => formatMoney(Number(v), currency)} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export function CostBars({ data, currency }: { data: { name: string; cost: number }[]; currency: string }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">No priced materials yet.</p>
  return (
    <div className="h-72" role="img" aria-label="Cost by material">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={60} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 100000 ? `${(v / 100000).toFixed(1)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))} />
          <Tooltip formatter={(v) => formatMoney(Number(v), currency)} />
          <Bar dataKey="cost" fill="#f97316" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function QuantityBars({ data }: { data: { name: string; unit: string; quantity: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-slate-500">No estimates yet.</p>
  // Units differ per material, so each bar is labelled with its unit in the tooltip.
  return (
    <div className="h-72" role="img" aria-label="Material quantities">
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 30, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
          <Tooltip formatter={(v, _n, item) => [`${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 1 })} ${(item.payload as { unit: string }).unit}`, 'Quantity']} />
          <Bar dataKey="quantity" fill="#0b1f3a" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
