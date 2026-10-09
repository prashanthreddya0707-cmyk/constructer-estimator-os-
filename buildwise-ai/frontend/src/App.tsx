import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import { Spinner } from '@/components/ui/feedback'
import AppLayout from '@/layouts/AppLayout'
import { AuthProvider } from '@/lib/auth'
import { ToastProvider } from '@/lib/toast'
import { UnitsProvider } from '@/lib/units'
import Landing from '@/pages/Landing'
import { Login, Signup } from '@/pages/AuthPages'

// Heavier pages are code-split (3D studio pulls in three.js).
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Projects = lazy(() => import('@/pages/Projects'))
const NewProject = lazy(() => import('@/pages/NewProject'))
const ProjectDetails = lazy(() => import('@/pages/ProjectDetails'))
const Studio = lazy(() => import('@/pages/Studio'))
const Estimation = lazy(() => import('@/pages/Estimation'))
const Catalogue = lazy(() => import('@/pages/Catalogue'))
const Prices = lazy(() => import('@/pages/Prices'))
const CostAnalysis = lazy(() => import('@/pages/CostAnalysis'))
const Optimization = lazy(() => import('@/pages/Optimization'))
const Reports = lazy(() => import('@/pages/Reports'))
const SettingsPage = lazy(() => import('@/pages/Settings'))

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <UnitsProvider>
            <Suspense fallback={<Spinner className="h-screen" />}>
              <Routes>
                <Route path="/" element={<Landing />} />
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/app" element={<Dashboard />} />
                    <Route path="/projects" element={<Projects />} />
                    <Route path="/projects/new" element={<NewProject />} />
                    <Route path="/projects/:projectId" element={<ProjectDetails />} />
                    <Route path="/studio/:projectId?" element={<Studio />} />
                    <Route path="/estimation/:projectId?" element={<Estimation />} />
                    <Route path="/catalogue" element={<Catalogue />} />
                    <Route path="/prices" element={<Prices />} />
                    <Route path="/cost-analysis/:projectId?" element={<CostAnalysis />} />
                    <Route path="/optimization/:projectId?" element={<Optimization />} />
                    <Route path="/reports" element={<Reports />} />
                    <Route path="/settings" element={<SettingsPage />} />
                  </Route>
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </UnitsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
