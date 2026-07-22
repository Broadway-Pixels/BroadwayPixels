import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTicketId, TicketStore } from "../lib/tickets.mjs";

test("creates a stable public ticket number from the request ID", () => {
  const ticketId = createTicketId("019f7c23-20f0-7fc1-a4c4-15c60685f833");
  assert.match(ticketId, /^B\d{10}$/);
  assert.equal(createTicketId("019f7c23-20f0-7fc1-a4c4-15c60685f833"), ticketId);
  assert.notEqual(createTicketId("019f7c23-20f0-7fc1-a4c4-15c60685f834"), ticketId);
});

test("stores private support tickets newest first", async () => {
  const directory = await mkdtemp(join(tmpdir(), "broadway-tickets-"));
  try {
    const store = new TicketStore(directory);
    await store.record({ ticketId: "B0000000001", topic: "First" }, new Date("2026-07-21T12:00:00.000Z"));
    await store.record({ ticketId: "B0000000002", topic: "Second" }, new Date("2026-07-22T12:00:00.000Z"));
    await store.record({ ticketId: "B0000000002", topic: "Second retry" }, new Date("2026-07-22T12:01:00.000Z"));
    const tickets = await store.list(1);
    assert.equal(tickets.length, 1);
    assert.equal(tickets[0].ticketId, "B0000000002");
    assert.equal(tickets[0].topic, "Second retry");
    const allTickets = await store.list(10);
    assert.equal(allTickets.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
