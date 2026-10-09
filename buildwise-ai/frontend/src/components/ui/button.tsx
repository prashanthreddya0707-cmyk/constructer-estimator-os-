import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

const variants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 cursor-pointer whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-navy-900 text-white hover:bg-navy-800',
        accent: 'bg-orange-500 text-white hover:bg-orange-600',
        outline: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        ghost: 'text-slate-600 hover:bg-slate-100',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        'danger-outline': 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
      },
      size: { sm: 'h-8 px-3', md: 'h-9 px-4', lg: 'h-11 px-6 text-base', icon: 'h-8 w-8' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

interface Props extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> { loading?: boolean }

export const Button = forwardRef<HTMLButtonElement, Props>(({ className, variant, size, loading, children, disabled, type = 'button', ...rest }, ref) => (
  <button ref={ref} type={type} className={cn(variants({ variant, size }), className)} disabled={disabled || loading} {...rest}>
    {loading && <Loader2 className="h-4 w-4 animate-spin" />}
    {children}
  </button>
))
Button.displayName = 'Button'
