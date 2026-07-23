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

test("archives, restores, records replies, and permanently deletes tickets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "broadway-ticket-actions-"));
  try {
    const store = new TicketStore(directory);
    const ticketId = "B0000000042";
    await store.record({ ticketId, topic: "Manage me", status: "open" }, new Date("2026-07-23T12:00:00.000Z"));

    assert.equal(await store.archive(ticketId, true, new Date("2026-07-23T12:05:00.000Z")), true);
    assert.equal((await store.get(ticketId)).status, "archived");
    assert.equal((await store.list(10, { status: "open" })).length, 0);
    assert.equal((await store.list(10, { status: "archived" })).length, 1);

    assert.equal(await store.archive(ticketId, false, new Date("2026-07-23T12:06:00.000Z")), true);
    await store.recordReply(ticketId, { message: "A dashboard reply", emailId: "email_42" }, new Date("2026-07-23T12:07:00.000Z"));
    const replied = await store.get(ticketId);
    assert.equal(replied.status, "open");
    assert.equal(replied.replies.length, 1);
    assert.equal(replied.replies[0].emailId, "email_42");

    assert.equal(await store.remove(ticketId), true);
    assert.equal(await store.get(ticketId), null);
    assert.equal(await store.remove(ticketId), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
