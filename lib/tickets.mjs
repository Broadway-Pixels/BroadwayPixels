import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const maxTicketLimit = 250;

export function createTicketId(requestId) {
  const digest = createHash("sha256").update(String(requestId)).digest();
  const digits = (digest.readBigUInt64BE(0) % 10_000_000_000n).toString().padStart(10, "0");
  return `B${digits}`;
}

export class TicketStore {
  constructor(directory) {
    this.directory = directory;
    this.writeQueue = Promise.resolve();
  }

  record(ticket, now = new Date()) {
    const stored = { ...ticket, createdAt: now.toISOString() };
    const filename = `${stored.createdAt.slice(0, 7)}.ndjson`;
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await appendFile(join(this.directory, filename), `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    return this.writeQueue;
  }

  async list(limit = 100) {
    await this.writeQueue;
    const safeLimit = Math.min(maxTicketLimit, Math.max(1, Number(limit) || 100));
    let files;
    try {
      files = (await readdir(this.directory)).filter((file) => /^\d{4}-\d{2}\.ndjson$/.test(file)).sort().slice(-12);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }

    const contents = await Promise.all(files.map((file) => readFile(join(this.directory, file), "utf8")));
    const tickets = contents.flatMap((content) => content.split("\n").filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const seen = new Set();
    return tickets.filter((ticket) => {
      if (!ticket.ticketId || seen.has(ticket.ticketId)) return false;
      seen.add(ticket.ticketId);
      return true;
    }).slice(0, safeLimit);
  }
}
