import {
  BarChart3, Boxes, Box, Calculator, ChevronsLeft, ChevronsRight, FileText, FolderKanban, LayoutDashboard, LogOut,
  Menu, PlusCircle, Recycle, Settings, Tags,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'My Projects', icon: FolderKanban, end: true },
  { to: '/projects/new', label: 'New Project', icon: PlusCircle, end: true },
  { to: '/studio', label: '3D Building Studio', icon: Box },
  { to: '/estimation', label: 'Material Estimation', icon: Calculator },
  { to: '/catalogue', label: 'Material Catalogue', icon: Boxes },
  { to: '/prices', label: 'Material Prices', icon: Tags },
  { to: '/cost-analysis', label: 'Cost Analysis', icon: BarChart3 },
  { to: '/optimization', label: 'Waste Optimization', icon: Recycle },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const COLLAPSE_KEY = 'bw_sidebar_collapsed'

export default function AppLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => { setMobileOpen(false) }, [location.pathname])
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1') } catch { /* ignore */ } return !c })

  const sidebar = (compact: boolean) => (
    <nav aria-label="Main" className="flex h-full flex-col bg-navy-900 text-slate-300">
      <div className={cn('flex h-16 items-center border-b border-white/10 px-4', compact && 'justify-center px-0')}>
        <Link to="/app"><Logo light compact={compact} /></Link>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} title={compact ? label : undefined}
              className={({ isActive }) => cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-white/10 hover:text-white',
                isActive && 'bg-orange-500 text-white hover:bg-orange-500', compact && 'justify-center px-0')}>
              <Icon className="h-4.5 w-4.5 shrink-0" />
              {!compact && <span className="truncate">{label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 p-3">
        <button onClick={() => { logout(); navigate('/') }}
          className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm hover:bg-white/10 hover:text-white', compact && 'justify-center px-0')}>
          <LogOut className="h-4.5 w-4.5 shrink-0" />{!compact && 'Log out'}
        </button>
      </div>
    </nav>
  )

  return (
    <div className="flex h-full">
      <aside className={cn('hidden shrink-0 transition-[width] duration-200 lg:block', collapsed ? 'w-16' : 'w-64')}>{sidebar(collapsed)}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar(false)}</aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" className="hidden lg:inline-flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={toggle}>
              {collapsed ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
            </Button>
            <span className="hidden text-sm italic text-slate-500 sm:inline">Plan Smarter. Build Better.</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/projects/new"><Button variant="accent" size="sm"><PlusCircle className="h-4 w-4" /><span className="hidden sm:inline">New Project</span></Button></Link>
            <Link to="/settings" className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-100" title="Account settings">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-sm font-semibold text-white">{user?.full_name?.[0]?.toUpperCase() ?? '?'}</span>
              <span className="hidden max-w-32 truncate text-sm font-medium text-slate-700 md:inline">{user?.full_name}</span>
            </Link>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6"><Outlet /></div>
        </main>
      </div>
    </div>
  )
}
