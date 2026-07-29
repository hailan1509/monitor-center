import type Docker from "dockerode";

export type ContainerInspectSummary = {
  restartCount: number;
  health: string | null;
  ports: Array<{ privatePort: number; publicPort: number | null; type: string }>;
  networkMode: string;
  command: string;
};

export async function inspectContainer(docker: Docker, containerId: string): Promise<ContainerInspectSummary> {
  const info = await docker.getContainer(containerId).inspect();

  const ports: ContainerInspectSummary["ports"] = [];
  for (const [key, bindings] of Object.entries(info.NetworkSettings?.Ports ?? {})) {
    const [privatePortStr, type] = key.split("/");
    const privatePort = Number(privatePortStr);
    if (!bindings || bindings.length === 0) {
      ports.push({ privatePort, publicPort: null, type: type ?? "tcp" });
      continue;
    }
    for (const binding of bindings) {
      ports.push({ privatePort, publicPort: binding.HostPort ? Number(binding.HostPort) : null, type: type ?? "tcp" });
    }
  }

  return {
    restartCount: info.RestartCount ?? 0,
    health: info.State?.Health?.Status ?? null,
    ports,
    networkMode: info.HostConfig?.NetworkMode ?? "unknown",
    command: [info.Path, ...(info.Args ?? [])].filter(Boolean).join(" ")
  };
}

export async function restartContainer(docker: Docker, containerId: string): Promise<void> {
  await docker.getContainer(containerId).restart({ t: 10 });
}
