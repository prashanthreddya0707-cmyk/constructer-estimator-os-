import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/feedback'
import type { Project } from '@/types'
import { BuildingDimensionFields, ProjectDetailsFields } from './ProjectFields'
import { projectSchema, toProjectBase, type ProjectFormValues } from './schemas'
import { api } from '@/lib/api'
import { useToast } from '@/lib/toast'

/** Edit project details + building dimensions of a saved project. */
export function BuildingDialog({ open, onClose, project, onSaved, dimensionsOnly = false }: {
  open: boolean; onClose: () => void; project: Project; onSaved: () => void; dimensionsOnly?: boolean
}) {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } = useForm<ProjectFormValues>({ resolver: zodResolver(projectSchema) })
  useEffect(() => {
    if (open) {
      setError(null)
      reset({ ...project, budget: project.budget ?? undefined, built_up_area: project.built_up_area ?? undefined })
    }
  }, [open, project, reset])
  const [l, w] = watch(['length', 'width'])

  return (
    <Dialog open={open} onClose={onClose} title={dimensionsOnly ? 'Edit building dimensions' : 'Edit project'} className="w-[min(44rem,calc(100vw-2rem))]">
      <form className="space-y-5" onSubmit={handleSubmit(async (v) => {
        setError(null)
        try {
          await api.updateProject(project.id, toProjectBase(v))
          toast.success('Project updated.')
          onSaved()
          onClose()
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the project.') }
      })}>
        {error && <Alert tone="error">{error}</Alert>}
        {!dimensionsOnly && <ProjectDetailsFields register={register} errors={errors} />}
        <BuildingDimensionFields register={register} errors={errors} area={Number.isFinite(l * w) ? l * w : undefined} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="accent" loading={isSubmitting}>Save changes</Button>
        </div>
      </form>
    </Dialog>
  )
}
