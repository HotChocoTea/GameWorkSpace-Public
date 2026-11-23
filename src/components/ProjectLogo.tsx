import { api } from '../api/client'
import type { Project } from '../types'

export function ProjectLogo({ project }: { project: Project }) {
  return (
    <span className="project-logo" aria-hidden="true">
      {project.logoAsset ? (
        <img src={api.assetUrl(project.logoAsset)} alt="" />
      ) : (
        <span className="logo-rings">
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  )
}
