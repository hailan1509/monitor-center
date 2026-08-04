import { isIP } from "node:net";
import type Docker from "dockerode";
import { query } from "../db/index.js";

export type BlockedIp = { ip: string; reason: string | null; blockedBy: string | null; createdAt: string };

// Blocking these would either do nothing (they're not real remote clients) or cut off the
// containers from each other / the host itself.
const LOOPBACK_RE = /^(127\.|::1$)/;
const DOCKER_INTERNAL_IP_RE = /^172\.(1[6-9]|2\d|3[01])\./;

export function isBlockableIp(ip: string): boolean {
  if (isIP(ip) === 0) return false;
  if (LOOPBACK_RE.test(ip)) return false;
  if (DOCKER_INTERNAL_IP_RE.test(ip)) return false;
  return true;
}

/**
 * Runs a short-lived, privileged (NET_ADMIN + host network) Alpine container to mutate the
 * VPS host's real iptables rules. monitor-server itself stays unprivileged; this reuses the
 * already-mounted Docker socket (which is effectively host-root access already) instead of
 * granting monitor-server's own container new capabilities.
 */
async function runFirewallScript(docker: Docker, script: string): Promise<void> {
  try {
    const container = await docker.createContainer({
      Image: "alpine:3.20",
      Cmd: ["sh", "-c", script],
      HostConfig: {
        NetworkMode: "host",
        CapAdd: ["NET_ADMIN"],
        AutoRemove: true
      },
      Tty: false
    });

    await container.start();
    const result = await container.wait();
    const exitCode = (result as { StatusCode?: number }).StatusCode ?? 0;
    if (exitCode !== 0) {
      throw new Error(`Firewall helper exited with code ${exitCode}`);
    }
  } catch (error) {
    // createContainer throws a 404 "No such image" if alpine hasn't been pulled yet.
    if (error instanceof Error && /No such image/i.test(error.message)) {
      const stream = await docker.pull("alpine:3.20");
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (followError: Error | null) => (followError ? reject(followError) : resolve()));
      });
      return runFirewallScript(docker, script);
    }
    throw error;
  }
}

function iptablesBin(ip: string): "iptables" | "ip6tables" {
  return isIP(ip) === 6 ? "ip6tables" : "iptables";
}

async function applyBlock(docker: Docker, ip: string): Promise<void> {
  const bin = iptablesBin(ip);
  // apk add is idempotent/fast once the alpine image layer is cached; -C checks first so
  // repeated blocks of the same IP don't pile up duplicate DROP rules.
  const script = `set -e; apk add --no-cache ${bin === "ip6tables" ? "ip6tables" : "iptables"} >/dev/null; ${bin} -C INPUT -s ${ip} -j DROP 2>/dev/null || ${bin} -I INPUT -s ${ip} -j DROP`;
  await runFirewallScript(docker, script);
}

async function applyUnblock(docker: Docker, ip: string): Promise<void> {
  const bin = iptablesBin(ip);
  // Loop the delete in case a bug or manual edit left duplicate rules — fully clears the IP.
  const script = `set -e; apk add --no-cache ${bin === "ip6tables" ? "ip6tables" : "iptables"} >/dev/null; while ${bin} -D INPUT -s ${ip} -j DROP 2>/dev/null; do :; done; true`;
  await runFirewallScript(docker, script);
}

export async function listBlockedIps(): Promise<BlockedIp[]> {
  const result = await query<{ ip: string; reason: string | null; blocked_by: string | null; created_at: string }>(
    "SELECT ip, reason, blocked_by, created_at FROM blocked_ips ORDER BY created_at DESC"
  );
  return result.rows.map((row) => ({ ip: row.ip, reason: row.reason, blockedBy: row.blocked_by, createdAt: row.created_at }));
}

export async function blockIp(docker: Docker, ip: string, reason: string | null, blockedBy: string | null): Promise<void> {
  if (!isBlockableIp(ip)) {
    throw new Error("IP không hợp lệ hoặc không thể chặn (loopback/nội bộ Docker).");
  }

  await applyBlock(docker, ip);

  await query(
    `INSERT INTO blocked_ips (ip, reason, blocked_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, blocked_by = EXCLUDED.blocked_by, created_at = NOW()`,
    [ip, reason, blockedBy]
  );
}

export async function unblockIp(docker: Docker, ip: string): Promise<void> {
  await applyUnblock(docker, ip);
  await query("DELETE FROM blocked_ips WHERE ip = $1", [ip]);
}

/** Re-applies every persisted block on server startup — iptables rules don't survive a host reboot. */
export async function reapplyAllBlocks(docker: Docker): Promise<void> {
  const blocked = await listBlockedIps();
  for (const { ip } of blocked) {
    try {
      await applyBlock(docker, ip);
    } catch (error) {
      console.error(`[ip-blocklist] Failed to reapply block for ${ip}:`, error instanceof Error ? error.message : error);
    }
  }
}
