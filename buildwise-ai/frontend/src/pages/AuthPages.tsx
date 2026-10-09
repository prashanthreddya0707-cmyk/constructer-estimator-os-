import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/feedback'
import { Field, Input } from '@/components/ui/form'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

function Shell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-navy-900 to-navy-700 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl">
        <Link to="/" className="mb-6 inline-block"><Logo /></Link>
        <h1 className="text-2xl font-semibold text-navy-900">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
        {children}
        <p className="mt-6 text-center text-sm text-slate-500">{footer}</p>
      </div>
    </div>
  )
}

const loginSchema = z.object({ email: z.string().email('Enter a valid e-mail address'), password: z.string().min(1, 'Enter your password') })

export function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const loc = useLocation()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })
  if (user) return <Navigate to="/app" replace />
  const from = (loc.state as { from?: string } | null)?.from ?? '/app'
  return (
    <Shell title="Welcome back" subtitle="Log in to continue to your projects." footer={<>New to BuildWise AI? <Link className="font-medium text-orange-600 hover:underline" to="/signup">Create an account</Link></>}>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        setError(null)
        try { await login(v.email, v.password); navigate(from, { replace: true }) } catch (e) { setError(e instanceof Error ? e.message : 'Login failed.') }
      })}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="E-mail" error={errors.email?.message}><Input type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} /></Field>
        <Field label="Password" error={errors.password?.message}><Input type="password" autoComplete="current-password" invalid={!!errors.password} {...register('password')} /></Field>
        <Button type="submit" variant="accent" className="w-full" loading={isSubmitting}>Log in</Button>
      </form>
    </Shell>
  )
}

const signupSchema = z.object({
  full_name: z.string().min(1, 'Enter your name').max(120),
  email: z.string().email('Enter a valid e-mail address'),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
})

export function Signup() {
  const { user, signup } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof signupSchema>>({ resolver: zodResolver(signupSchema) })
  if (user) return <Navigate to="/app" replace />
  return (
    <Shell title="Create your account" subtitle="Start estimating materials and costs in minutes." footer={<>Already registered? <Link className="font-medium text-orange-600 hover:underline" to="/login">Log in</Link></>}>
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => {
        setError(null)
        try { await signup(v.email, v.full_name, v.password); toast.success('Account created.'); navigate('/app', { replace: true }) } catch (e) { setError(e instanceof Error ? e.message : 'Signup failed.') }
      })}>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Full name" error={errors.full_name?.message}><Input autoComplete="name" invalid={!!errors.full_name} {...register('full_name')} /></Field>
        <Field label="E-mail" error={errors.email?.message}><Input type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} /></Field>
        <Field label="Password" error={errors.password?.message} hint="At least 8 characters."><Input type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} /></Field>
        <Button type="submit" variant="accent" className="w-full" loading={isSubmitting}>Create account</Button>
      </form>
    </Shell>
  )
}
