import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { pool } from '../database.mjs';
import {
  appleNotifications,
  createBillingPortal,
  createCheckoutSession,
  deleteAccount,
  stripeWebhook,
  syncAppleSubscription
} from '../billing.mjs';

const password = `billing-${randomBytes(8).toString('hex')}`;
const users = [];
const events = [];
const savedEnv = {};
let realFetch = null;

const webhookSecret = `whsec_${randomBytes(16).toString('hex')}`;

function authedRequest(url, token, body) {
  return new Request(url, {
    method: 'POST',
    headers: { cookie: `illume_session=${token}`, 'content-type': 'application/json' },
    body: body === undefined ? '{}' : JSON.stringify(body)
  });
}

async function createUser(label) {
  const email = `${label}-${randomUUID()}@invalid.illume`;
  const hash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    `INSERT INTO users(id,email,password_hash,confirmed_at,role) VALUES($1,$2,$3,now(),'authenticated') RETURNING id,email`,
    [randomUUID(), email, hash]
  );
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `INSERT INTO auth_sessions(id,user_id,access_hash,expires_at,refresh_expires_at)
     VALUES($1,$2,$3,now()+interval '10 minutes',now()+interval '10 minutes')`,
    [randomUUID(), rows[0].id, createHash('sha256').update(token).digest('hex')]
  );
  users.push({ ...rows[0], token });
  return users[users.length - 1];
}

function stripeSignature(body, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function subscriptionEvent(eventId, userId, customerId, status = 'active') {
  return {
    id: eventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_${randomBytes(6).toString('hex')}`,
        customer: customerId,
        status,
        metadata: { supabase_user_id: userId },
        items: { data: [{ price: { id: 'price_test_pro' } }] },
        current_period_end: Math.floor(Date.now() / 1000) + 2592000,
        cancel_at_period_end: false,
        created: Math.floor(Date.now() / 1000)
      }
    }
  };
}

const jws = payload =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;

describe('billing', { concurrency: 1 }, () => {
  before(() => {
    for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRO_PRICE_ID', 'SITE_URL', 'APPLE_DISABLE_SIGNATURE_VERIFICATION']) {
      savedEnv[name] = process.env[name];
    }
    process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID || 'price_test_pro';
    process.env.SITE_URL = process.env.SITE_URL || 'http://127.0.0.1:8787';
    process.env.APPLE_DISABLE_SIGNATURE_VERIFICATION = 'true';
    realFetch = globalThis.fetch;
  });

  after(async () => {
    if (realFetch) globalThis.fetch = realFetch;
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const eventId of events) {
      await pool.query(`DELETE FROM webhook_events WHERE event_id=$1`, [eventId]);
    }
    for (const user of users) {
      await pool.query('DELETE FROM jobs WHERE payload->>\'userId\'=$1', [user.id]);
      await pool.query('DELETE FROM object_files WHERE user_id=$1', [user.id]);
      await pool.query('DELETE FROM users WHERE id=$1', [user.id]);
    }
    await pool.end();
  });

  test('rejects webhooks with an invalid signature', async () => {
    const body = JSON.stringify({ id: 'evt_bad', type: 'customer.subscription.updated' });
    const response = await stripeWebhook(new Request('http://127.0.0.1/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': 't=123,v1=deadbeef', 'content-type': 'application/json' },
      body
    }));
    assert.equal(response.status, 400);
    assert.match(await response.text(), /signature/i);
  });

  test('rejects webhooks with a stale timestamp', async () => {
    const body = JSON.stringify({ id: 'evt_stale', type: 'customer.subscription.updated' });
    const stale = stripeSignature(body, Math.floor(Date.now() / 1000) - 3600);
    const response = await stripeWebhook(new Request('http://127.0.0.1/webhook', {
      method: 'POST',
      headers: { 'stripe-signature': stale, 'content-type': 'application/json' },
      body
    }));
    assert.equal(response.status, 400);
  });

  test('processes a webhook once and dedupes the repeat', async () => {
    const user = await createUser('webhook');
    const customerId = `cus_${randomBytes(6).toString('hex')}`;
    await pool.query('INSERT INTO billing_profiles(user_id,stripe_customer_id) VALUES($1,$2)', [user.id, customerId]);
    const eventId = `evt_${randomBytes(8).toString('hex')}`;
    events.push(eventId);
    const send = () => {
      const body = JSON.stringify(subscriptionEvent(eventId, user.id, customerId));
      return stripeWebhook(new Request('http://127.0.0.1/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': stripeSignature(body), 'content-type': 'application/json' },
        body
      }));
    };
    const first = await send();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { received: true });
    const second = await send();
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { received: true, duplicate: true });
    const { rows } = await pool.query(`SELECT status FROM webhook_events WHERE provider='stripe' AND event_id=$1`, [eventId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'processed');
    const profile = await pool.query('SELECT plan, status, stripe_subscription_id FROM billing_profiles WHERE user_id=$1', [user.id]);
    assert.equal(profile.rows[0].plan, 'pro');
    assert.equal(profile.rows[0].status, 'active');
    assert.ok(profile.rows[0].stripe_subscription_id);
  });

  test('creates a checkout session through the Stripe REST API', async () => {
    const user = await createUser('checkout');
    const customerId = `cus_${randomBytes(6).toString('hex')}`;
    await pool.query('INSERT INTO billing_profiles(user_id,stripe_customer_id) VALUES($1,$2)', [user.id, customerId]);
    const calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return Response.json({ id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay_test' });
    };
    try {
      const response = await createCheckoutSession(authedRequest('http://127.0.0.1/checkout', user.token));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { url: 'https://checkout.stripe.com/c/pay_test' });
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.endsWith('/v1/checkout/sessions'));
      const sent = new URLSearchParams(calls[0].options.body.toString());
      assert.equal(sent.get('customer'), customerId);
      assert.equal(sent.get('mode'), 'subscription');
      assert.equal(sent.get('client_reference_id'), user.id);
      assert.equal(sent.get('metadata[supabase_user_id]'), user.id);
      assert.ok(String(calls[0].options.headers.Authorization).startsWith('Bearer '));
    } finally {
      globalThis.fetch = realFetch;
    }
    const denied = await createCheckoutSession(authedRequest('http://127.0.0.1/checkout', 'invalid-token'));
    assert.equal(denied.status, 401);
  });

  test('opens the billing portal only for the caller’s own customer', async () => {
    const owner = await createUser('portal-owner');
    const stranger = await createUser('portal-stranger');
    const customerId = `cus_${randomBytes(6).toString('hex')}`;
    await pool.query('INSERT INTO billing_profiles(user_id,stripe_customer_id) VALUES($1,$2)', [owner.id, customerId]);
    globalThis.fetch = async (url, options) => {
      const sent = new URLSearchParams(options.body.toString());
      assert.equal(sent.get('customer'), customerId);
      return Response.json({ url: 'https://billing.stripe.com/p/session_test' });
    };
    try {
      const ok = await createBillingPortal(authedRequest('http://127.0.0.1/portal', owner.token));
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { url: 'https://billing.stripe.com/p/session_test' });
    } finally {
      globalThis.fetch = realFetch;
    }
    const missing = await createBillingPortal(authedRequest('http://127.0.0.1/portal', stranger.token));
    assert.equal(missing.status, 400);
    const body = await missing.json();
    assert.match(body.error, /No Stripe customer/);
  });

  test('syncs an Apple subscription for the signed-in user', async () => {
    const user = await createUser('apple');
    const expires = Date.now() + 2592000000;
    const signedTransactionInfo = jws({
      bundleId: 'com.russellsystems.illume',
      environment: 'Sandbox',
      expiresDate: expires,
      originalTransactionId: `orig_${randomBytes(6).toString('hex')}`,
      productId: 'illume.pro.monthly',
      purchaseDate: Date.now(),
      transactionId: `txn_${randomBytes(6).toString('hex')}`
    });
    const response = await syncAppleSubscription(
      authedRequest('http://127.0.0.1/apple', user.token, { signedTransactionInfo })
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.plan, 'pro');
    assert.equal(body.productId, 'illume.pro.monthly');
    const profile = await pool.query('SELECT plan, status FROM billing_profiles WHERE user_id=$1', [user.id]);
    assert.equal(profile.rows[0].plan, 'pro');
  });

  test('applies an Apple server notification to the matching profile', async () => {
    const user = await createUser('apple-notify');
    const originalTransactionId = `orig_${randomBytes(6).toString('hex')}`;
    await pool.query(
      'INSERT INTO billing_profiles(user_id,apple_original_transaction_id) VALUES($1,$2)',
      [user.id, originalTransactionId]
    );
    const signedTransactionInfo = jws({
      environment: 'Sandbox',
      expiresDate: Date.now() + 2592000000,
      originalTransactionId,
      productId: 'illume.pro.monthly',
      purchaseDate: Date.now(),
      transactionId: `txn_${randomBytes(6).toString('hex')}`
    });
    const signedPayload = jws({
      notificationType: 'DID_RENEW',
      subtype: '',
      notificationUUID: randomUUID(),
      data: { signedTransactionInfo }
    });
    events.push(`apple-${JSON.parse(Buffer.from(signedPayload.split('.')[1], 'base64url').toString('utf8')).notificationUUID}`);
    const response = await appleNotifications(new Request('http://127.0.0.1/apple-notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signedPayload })
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { received: true });
    const profile = await pool.query('SELECT plan, status FROM billing_profiles WHERE user_id=$1', [user.id]);
    assert.equal(profile.rows[0].plan, 'pro');
  });

  test('rejects an Apple notification without verifiable payload structure', async () => {
    const response = await appleNotifications(new Request('http://127.0.0.1/apple-notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signedPayload: 'not-a-jws' })
    }));
    assert.equal(response.status, 400);
  });

  test('deletes only the caller’s own account and files', async () => {
    const leaving = await createUser('leaving');
    const staying = await createUser('staying');
    await pool.query(
      `INSERT INTO object_files(bucket,path,user_id,size,mime_type,sha256) VALUES
       ('epubs',$1,$2,10,'application/epub+zip','a'),('reader-images',$3,$2,10,'image/png','b'),
       ('epubs',$4,$5,10,'application/epub+zip','c')`,
      [`${leaving.id}/book.epub`, leaving.id, `${leaving.id}/img.png`, `${staying.id}/book.epub`, staying.id]
    );
    await pool.query(`INSERT INTO jobs(kind,payload) VALUES('process-reader-document',$1::jsonb)`, [JSON.stringify({ bookId: 'x', userId: leaving.id })]);
    await pool.query('INSERT INTO billing_profiles(user_id,stripe_customer_id) VALUES($1,$2)', [leaving.id, `cus_${randomBytes(6).toString('hex')}`]);

    const anonymous = await deleteAccount(authedRequest('http://127.0.0.1/account', 'invalid-token'));
    assert.equal(anonymous.status, 401);

    const response = await deleteAccount(authedRequest('http://127.0.0.1/account', leaving.token));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { deleted: true, removedDocuments: 1, removedReaderImages: 1 });

    const gone = await pool.query('SELECT id FROM users WHERE id=$1', [leaving.id]);
    assert.equal(gone.rows.length, 0);
    const remaining = await pool.query('SELECT id FROM users WHERE id=$1', [staying.id]);
    assert.equal(remaining.rows.length, 1);
    const files = await pool.query('SELECT path FROM object_files WHERE user_id=$1 OR user_id=$2', [leaving.id, staying.id]);
    assert.deepEqual(files.rows.map(row => row.path), [`${staying.id}/book.epub`]);
    const jobs = await pool.query(`SELECT id FROM jobs WHERE payload->>'userId'=$1`, [leaving.id]);
    assert.equal(jobs.rows.length, 0);
    const survivor = users.find(entry => entry.id === staying.id);
    users.splice(users.indexOf(users.find(entry => entry.id === leaving.id)), 1);
    assert.ok(survivor);
  });
});
