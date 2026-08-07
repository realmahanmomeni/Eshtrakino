import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { env } from "../../config/env";

const execFileAsync = promisify(execFile);

function parseDatabaseUrl(databaseUrl: string): {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
} {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, "").split("?")[0] ?? "postgres";
  return {
    host: url.hostname,
    port: url.port || "5432",
    database,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export class BackupService {
  async createDump(): Promise<string> {
    const { host, port, database, user, password } = parseDatabaseUrl(env.DATABASE_URL);

    const dir = join(tmpdir(), "eshtrakino-backups");
    await mkdir(dir, { recursive: true });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(dir, `eshtrakino-${stamp}.sql`);

    await execFileAsync(
      "pg_dump",
      ["-h", host, "-p", port, "-U", user, "-d", database, "-F", "p", "-f", filePath],
      {
        env: { ...process.env, PGPASSWORD: password },
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    return filePath;
  }

  async cleanup(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      /* ignore */
    }
  }
}

export const backupService = new BackupService();
