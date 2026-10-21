import { compileRules } from './core.mjs';
export function migrateProjects(local) {
  if (Array.isArray(local.projects)) return local.projects;
  return local.rules?.length ? [{ id: 'legacy-default', name: '默认项目', rules: local.rules }] : [];
}
export function compileProjects(projects) {
  return projects.map(project => ({ ...project, rules: compileRules(project.rules) }));
}
