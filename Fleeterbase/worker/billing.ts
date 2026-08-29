import Stripe from 'stripe';
import type { WorkerEnv } from './store';

export type BillingRecord = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  status: string;
  current_period_end: number | null;
  cancel_at_period_end: number;
  updated_at: number;
};

const accessStatuses = new Set(['active', 'trialing', 'past_due']);

export function stripeConfigured(env: WorkerEnv): boolean {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRO_PRICE_ID);
}

export function stripeClient(env: WorkerEnv): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
  return new Stripe(env.STRIPE_SECRET_KEY);
}

export async function billingForUser(env: WorkerEnv, userId: string): Promise<BillingRecord | null> {
  return env.DB.prepare(`SELECT user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status,
    current_period_end, cancel_at_period_end, updated_at FROM billing_accounts WHERE user_id = ?`)
    .bind(userId).first<BillingRecord>();
}

export function hasProAccess(record: BillingRecord | null): boolean {
  return Boolean(record && accessStatuses.has(record.status));
}

export async function saveStripeCustomer(env: WorkerEnv, userId: string, customerId: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO billing_accounts (user_id, stripe_customer_id, status, updated_at)
    VALUES (?, ?, 'free', ?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
    updated_at = excluded.updated_at`).bind(userId, customerId, Date.now()).run();
}

function id(value: string | { id: string } | null): string {
  return typeof value === 'string' ? value : value?.id || '';
}

export async function saveSubscription(env: WorkerEnv, subscription: Stripe.Subscription): Promise<void> {
  const customerId = id(subscription.customer), userId = subscription.metadata.fleeterbase_user_id || '';
  const existing = customerId
    ? await env.DB.prepare('SELECT user_id FROM billing_accounts WHERE stripe_customer_id = ?').bind(customerId).first<{ user_id: string }>()
    : null;
  const ownerId = existing?.user_id || userId;
  if (!ownerId || !customerId) throw new Error('Stripe subscription is not linked to a Fleeterbase user.');
  const item = subscription.items.data[0], priceId = item ? id(item.price) : '';
  await env.DB.prepare(`INSERT INTO billing_accounts
    (user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id, status, current_period_end, cancel_at_period_end, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      stripe_price_id = excluded.stripe_price_id,
      status = excluded.status,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = excluded.updated_at`)
    .bind(ownerId, customerId, subscription.id, priceId, subscription.status, item?.current_period_end || null, subscription.cancel_at_period_end ? 1 : 0, Date.now()).run();
}

export async function webhookProcessed(env: WorkerEnv, eventId: string): Promise<boolean> {
  return Boolean(await env.DB.prepare('SELECT 1 AS found FROM stripe_webhook_events WHERE event_id = ?').bind(eventId).first<number>('found'));
}

export async function markWebhookProcessed(env: WorkerEnv, event: Stripe.Event): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO stripe_webhook_events (event_id, event_type, processed_at) VALUES (?, ?, ?)')
    .bind(event.id, event.type, Date.now()).run();
}
