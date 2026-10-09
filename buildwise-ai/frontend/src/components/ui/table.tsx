import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Table({ className, ...p }: HTMLAttributes<HTMLTableElement>) {
  return <div className="overflow-x-auto"><table className={cn('w-full text-left text-sm', className)} {...p} /></div>
}
export const THead = (p: HTMLAttributes<HTMLTableSectionElement>) => <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500" {...p} />
export const TBody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody className="divide-y divide-slate-100" {...p} />
export const TR = ({ className, ...p }: HTMLAttributes<HTMLTableRowElement>) => <tr className={cn('hover:bg-slate-50/60', className)} {...p} />
export const TH = ({ className, ...p }: ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('whitespace-nowrap px-4 py-2.5 font-medium', className)} {...p} />
export const TD = ({ className, ...p }: TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('px-4 py-2.5 align-top', className)} {...p} />
