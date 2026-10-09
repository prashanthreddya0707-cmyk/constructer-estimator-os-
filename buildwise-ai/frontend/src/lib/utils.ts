import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(v: number | null | undefined, currency = 'INR', digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency', currency, maximumFractionDigits: digits, minimumFractionDigits: digits,
    }).format(v)
  } catch {
    return `${currency} ${v.toFixed(digits)}`
  }
}

export function formatNumber(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : iso + 'Z')
  return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

export const KEY_LABEL: Record<string, string> = {
  cement: 'Cement', sand: 'Sand', aggregates: 'Aggregates', steel: 'Steel', concrete: 'Concrete', bricks: 'Bricks',
  blocks: 'Blocks', mortar: 'Mortar', plaster: 'Plaster', tiles: 'Tiles', paint: 'Paint',
}
export const PRICED_KEYS = ['cement', 'sand', 'aggregates', 'steel', 'concrete', 'bricks', 'blocks', 'tiles', 'paint'] as const
export const ROOM_TYPES = ['living', 'bedroom', 'kitchen', 'bathroom', 'dining', 'study', 'store', 'balcony', 'corridor', 'staircase', 'office', 'other']
export const BUILDING_TYPES = ['residential', 'commercial', 'industrial', 'institutional', 'mixed-use']
export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED']
