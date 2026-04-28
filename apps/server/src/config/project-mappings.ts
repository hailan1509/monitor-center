import { DEFAULT_PROJECT_MAPPINGS } from "@monitor-center/shared";

export type ProjectMapping = {
  project: string;
  service?: string;
  matchers: readonly string[];
};

export const projectMappings: ProjectMapping[] = [
  ...DEFAULT_PROJECT_MAPPINGS.map((mapping) => ({ ...mapping })),
  {
    project: "infra",
    matchers: ["nginx-proxy-manager", "mysql_server"]
  }
];

export function resolveProject(containerName: string) {
  const normalized = containerName.replace(/^\//, "");

  for (const mapping of projectMappings) {
    if (mapping.matchers.some((matcher) => normalized.includes(matcher))) {
      return {
        project: mapping.project,
        service: mapping.service || normalized
      };
    }
  }

  return {
    project: "unassigned",
    service: normalized
  };
}
