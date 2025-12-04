import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function safeExec(command: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(command);
    return stdout.trim();
  } catch {
    return null;
  }
}

function normalizeRepositoryUrl(raw?: string | null): string | null {
  if (raw == null || raw.trim() === "") return null;

  const sanitized = raw.trim().replace(/\.git$/i, "");

  if (/^https?:\/\//i.test(sanitized)) return sanitized;

  if (/^[^\s]+\/[^\s]+$/.test(sanitized))
    return `https://github.com/${sanitized}`;

  const sshMatch = /git@[^:]+:([^/]+\/[^/]+)$/i.exec(sanitized);
  if (sshMatch != null) return `https://github.com/${sshMatch[1]}`;

  return null;
}

function formatDuration(seconds: number): string {
  const duration = Math.max(0, Math.floor(seconds));

  const days = Math.floor(duration / 86400);
  const hours = Math.floor((duration % 86400) / 3600);
  const minutes = Math.floor((duration % 3600) / 60);
  const secs = duration % 60;

  const parts = [] as string[];
  if (days > 0) parts.push(`${days}j`);
  if (hours > 0 || parts.length > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

export async function getBuildInfo(): Promise<{
  uptime: string;
  commitHash: string | null;
  commitUrl: string | null;
}> {
  const uptime = formatDuration(process.uptime());

  const commitHash =
    (process.env.GITHUB_SHA ?? process.env.SOURCE_COMMIT)?.slice(0, 7) ??
    (await safeExec("git rev-parse --short HEAD"));

  const repositoryUrl =
    normalizeRepositoryUrl(process.env.GITHUB_REPOSITORY) ??
    normalizeRepositoryUrl(
      await safeExec("git config --get remote.origin.url")
    );

  const commitUrl =
    commitHash != null && repositoryUrl != null
      ? `${repositoryUrl}commit/${commitHash}`
      : null;

  return { uptime, commitHash, commitUrl };
}
