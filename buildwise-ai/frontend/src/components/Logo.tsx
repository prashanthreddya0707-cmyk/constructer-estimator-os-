import { cn } from '@/lib/utils'

export function Logo({ className, light = false, compact = false }: { className?: string; light?: boolean; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="7" fill={light ? '#ffffff' : '#0B1F3A'} />
        <path d="M7 24V13l9-6 9 6v11h-6v-7h-6v7z" fill="#F97316" />
      </svg>
      {!compact && <span className={light ? 'text-white' : 'text-navy-900'}>BuildWise <span className="text-orange-500">AI</span></span>}
    </span>
  )
}
