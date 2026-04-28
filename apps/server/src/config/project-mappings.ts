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

function normalizeValue(value: string) {
  return value.trim().replace(/^\//, "");
}

function guessFromName(containerName: string) {
  const normalized = normalizeValue(containerName);

  // Common compose names:
  // - project-service-1
  // - project_service_1
  // - project-service
  const dashParts = normalized.split("-");
  if (dashParts.length >= 3) {
    const last = dashParts[dashParts.length - 1];
    if (/^\d+$/.test(last)) {
      return {
        project: dashParts.slice(0, -2).join("-") || "unassigned",
        service: dashParts[dashParts.length - 2] || normalized
      };
    }
  }

  const underscoreParts = normalized.split("_");
  if (underscoreParts.length >= 3) {
    const last = underscoreParts[underscoreParts.length - 1];
    if (/^\d+$/.test(last)) {
      return {
        project: underscoreParts.slice(0, -2).join("_") || "unassigned",
        service: underscoreParts[underscoreParts.length - 2] || normalized
      };
    }
  }

  return {
    project: "unassigned",
    service: normalized
  };
}

export function resolveProject(containerName: string, labels: Record<string, string> = {}) {
  const normalized = containerName.replace(/^\//, "");

  // Prefer docker compose labels when available.
  // These labels exist for compose-managed containers and reliably map to the actual project.
  const composeProject = labels["com.docker.compose.project"];
  const composeService = labels["com.docker.compose.service"];
  if (composeProject) {
    return {
      project: normalizeValue(composeProject),
      service: composeService ? normalizeValue(composeService) : normalized
    };
  }

  for (const mapping of projectMappings) {
    if (mapping.matchers.some((matcher) => normalized.includes(matcher))) {
      return {
        project: mapping.project,
        service: mapping.service || normalized
      };
    }
  }

  return guessFromName(normalized);
}
