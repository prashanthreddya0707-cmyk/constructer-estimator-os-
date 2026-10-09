import { BarChart3, Box, Calculator, FileText, Layers, Recycle, ScanLine, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'

const FEATURES = [
  { icon: Calculator, title: 'Smart Material Estimation', text: 'Cement, steel, concrete, bricks, blocks, mortar, sand, aggregates, tiles, paint and plaster, each with its formula, assumptions and wastage allowance shown.' },
  { icon: ScanLine, title: '2D Floor Plan Input', text: 'Upload a JPG, PNG or PDF plan, calibrate its scale against a known distance, and confirm room dimensions yourself. Optional image pre-processing helps you read the plan.' },
  { icon: Box, title: '3D Building Visualization', text: 'An interactive model generated from your saved dimensions and rooms: floors, walls, openings, labels, orbit, zoom, top-down and room selection.' },
  { icon: BarChart3, title: 'Cost Prediction', text: 'Quantities multiplied by prices you control. Compare against a budget, view cost per m² and per sq ft, and keep material cost separate from optional labour and other costs.' },
  { icon: Layers, title: 'Material Comparison', text: 'Compare brands, grades, specifications and prices side by side and see the effect on the total project estimate.' },
  { icon: Recycle, title: 'Waste Reduction', text: 'Transparent rule-based recommendations: high wastage allowances, missing dimensions, purchase vs requirement mismatches and lower-priced alternatives.' },
  { icon: FileText, title: 'PDF Reports', text: 'Download a report with project details, quantities, prices, costs, assumptions, recommendations and an engineering-verification disclaimer.' },
]
const FLOW = ['Input', 'Visualize', 'Estimate', 'Analyze', 'Optimize']

export default function Landing() {
  const { user } = useAuth()
  const cta = user ? '/projects/new' : '/signup'
  return (
    <div className="min-h-full bg-white">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo />
          <nav className="flex items-center gap-2">
            <a href="#features" className="hidden px-3 text-sm text-slate-600 hover:text-navy-900 sm:inline">Features</a>
            <a href="#workflow" className="hidden px-3 text-sm text-slate-600 hover:text-navy-900 sm:inline">Workflow</a>
            {user ? <Link to="/app"><Button size="sm">Open dashboard</Button></Link> : (
              <><Link to="/login"><Button variant="ghost" size="sm">Log in</Button></Link><Link to="/signup"><Button variant="accent" size="sm">Sign up</Button></Link></>
            )}
          </nav>
        </div>
      </header>

      <section className="bg-gradient-to-br from-navy-900 via-navy-800 to-navy-700 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-20 md:grid-cols-2 md:py-28">
          <div>
            <p className="mb-3 text-sm font-medium uppercase tracking-widest text-orange-400">Plan Smarter. Build Better.</p>
            <h1 className="text-4xl font-bold leading-tight !text-white md:text-5xl">Build Smarter with AI-Powered Construction Estimation</h1>
            <p className="mt-5 max-w-xl text-lg text-slate-300">Estimate materials, visualize your building in 3D, predict project costs, and plan resources with confidence.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={cta}><Button variant="accent" size="lg">Create Your Project <ArrowRight className="h-4 w-4" /></Button></Link>
              <a href="#features"><Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10">Explore Features</Button></a>
            </div>
          </div>
          <div aria-hidden className="relative mx-auto h-64 w-full max-w-md md:h-80">
            <svg viewBox="0 0 400 300" className="h-full w-full">
              <g fill="none" stroke="#F97316" strokeWidth="2">
                <path d="M60 220 L200 270 L340 220 L340 120 L200 170 L60 120 Z" fill="#ffffff10" />
                <path d="M200 170 L200 270 M60 120 L200 70 L340 120" />
                <path d="M110 150 L110 205 M150 165 L150 222 M250 222 L250 165 M290 205 L290 150" stroke="#ffffff55" />
              </g>
            </svg>
            <p className="absolute bottom-0 left-0 right-0 text-center text-xs text-slate-400">Illustration</p>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <h2 className="text-center text-3xl font-bold">Everything for a first-pass construction plan</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-500">From dimensions to a downloadable report, with every calculation explained.</p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <span className="inline-flex rounded-lg bg-orange-50 p-2.5 text-orange-600"><Icon className="h-6 w-6" /></span>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="workflow" className="scroll-mt-20 bg-slate-50 py-20">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-bold">One connected workflow</h2>
          <ol className="mt-12 flex flex-col items-stretch gap-3 md:flex-row md:items-center">
            {FLOW.map((step, i) => (
              <li key={step} className="flex flex-1 items-center gap-3 md:flex-col md:gap-2">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-navy-900 text-lg font-bold text-white">{i + 1}</span>
                <span className="text-sm font-semibold tracking-widest text-navy-900">{step.toUpperCase()}</span>
                {i < FLOW.length - 1 && <ArrowRight className="hidden text-orange-500 md:block md:rotate-0" />}
              </li>
            ))}
          </ol>
          <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-slate-500">
            BuildWise AI produces preliminary, rule-based planning estimates. Always have a qualified engineer verify quantities before procurement or construction.
          </p>
          <div className="mt-8 text-center"><Link to={cta}><Button variant="accent" size="lg">Create Your Project</Button></Link></div>
        </div>
      </section>

      <footer className="bg-navy-950 text-slate-400">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
          <div><Logo light /><p className="mt-2 text-xs">Plan Smarter. Build Better.</p></div>
          <p className="max-w-md text-center text-xs sm:text-right">A college field project. Estimates are preliminary and must be verified by a qualified engineer.</p>
        </div>
      </footer>
    </div>
  )
}
