import { Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/feedback'
import { PageHeader, ProjectPicker } from '@/components/ui/page'
import { useActiveProject } from '@/hooks/useActiveProject'
import type { ReactNode } from 'react'

/** Wraps project-scoped pages: handles loading / empty / error and renders a project picker in the header. */
export function ProjectScope({ basePath, title, description, actions, children }: {
  basePath: string
  title: string
  description?: string
  actions?: (projectId: string) => ReactNode
  children: (projectId: string) => ReactNode
}) {
  const { projects, projectId, loading, error, select, reloadProjects } = useActiveProject(basePath)
  if (loading) return <Spinner />
  if (error) return <ErrorState message={error} onRetry={reloadProjects} />
  if (!projects?.length || !projectId) {
    return (
      <>
        <PageHeader title={title} description={description} />
        <EmptyState title="No projects yet" description="Create a project with building dimensions and rooms to use this page."
          action={<Link to="/projects/new"><Button variant="accent"><Plus className="h-4 w-4" /> Create project</Button></Link>} />
      </>
    )
  }
  return (
    <>
      <PageHeader title={title} description={description}
        actions={<><ProjectPicker projects={projects} value={projectId} onChange={select} />{actions?.(projectId)}</>} />
      {children(projectId)}
    </>
  )
}
