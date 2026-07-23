import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const maxTicketLimit = 250;
const ticketIdPattern = /^B\d{10}$/;

function validTicketId(ticketId) {
  return ticketIdPattern.test(String(ticketId));
}

function parseTickets(content) {
  return content.split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

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
    return this.#enqueue(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await appendFile(join(this.directory, filename), `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
    });
  }

  async list(limit = 100, { status = "all" } = {}) {
    await this.writeQueue;
    const safeLimit = Math.min(maxTicketLimit, Math.max(1, Number(limit) || 100));
    const files = await this.#files();
    const contents = await Promise.all(files.map((file) => readFile(join(this.directory, file), "utf8")));
    const tickets = contents.flatMap(parseTickets).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const seen = new Set();
    return tickets.filter((ticket) => {
      if (!ticket.ticketId || seen.has(ticket.ticketId)) return false;
      seen.add(ticket.ticketId);
      const ticketStatus = ticket.status === "archived" ? "archived" : "open";
      return status === "all" || ticketStatus === status;
    }).slice(0, safeLimit);
  }

  async get(ticketId) {
    if (!validTicketId(ticketId)) return null;
    const tickets = await this.list(maxTicketLimit, { status: "all" });
    return tickets.find((ticket) => ticket.ticketId === ticketId) || null;
  }

  archive(ticketId, archived = true, now = new Date()) {
    return this.#update(ticketId, (ticket) => ({
      ...ticket,
      status: archived ? "archived" : "open",
      updatedAt: now.toISOString(),
    }));
  }

  recordReply(ticketId, reply, now = new Date()) {
    return this.#update(ticketId, (ticket) => ({
      ...ticket,
      replies: [...(Array.isArray(ticket.replies) ? ticket.replies : []), {
        message: String(reply.message),
        emailId: String(reply.emailId || ""),
        sentAt: now.toISOString(),
      }].slice(-50),
      updatedAt: now.toISOString(),
    }));
  }

  remove(ticketId) {
    if (!validTicketId(ticketId)) return Promise.resolve(false);
    return this.#enqueue(async () => {
      const files = await this.#files();
      let removed = false;
      for (const filename of files) {
        const path = join(this.directory, filename);
        const tickets = parseTickets(await readFile(path, "utf8"));
        const remaining = tickets.filter((ticket) => {
          if (ticket.ticketId !== ticketId) return true;
          removed = true;
          return false;
        });
        if (remaining.length === tickets.length) continue;
        if (!remaining.length) {
          await rm(path, { force: true });
          continue;
        }
        await this.#replace(path, remaining);
      }
      return removed;
    });
  }

  #enqueue(operation) {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.catch(() => {});
    return result;
  }

  async #files() {
    try {
      return (await readdir(this.directory)).filter((file) => /^\d{4}-\d{2}\.ndjson$/.test(file)).sort().slice(-12);
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  #update(ticketId, update) {
    if (!validTicketId(ticketId)) return Promise.resolve(false);
    return this.#enqueue(async () => {
      const files = await this.#files();
      let updated = false;
      for (const filename of files) {
        const path = join(this.directory, filename);
        const tickets = parseTickets(await readFile(path, "utf8"));
        let fileUpdated = false;
        const next = tickets.map((ticket) => {
          if (ticket.ticketId !== ticketId) return ticket;
          updated = true;
          fileUpdated = true;
          return update(ticket);
        });
        if (fileUpdated) await this.#replace(path, next);
      }
      return updated;
    });
  }

  async #replace(path, tickets) {
    const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${tickets.map((ticket) => JSON.stringify(ticket)).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
