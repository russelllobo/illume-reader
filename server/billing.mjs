import { Buffer } from 'node:buffer';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { unlink, rmdir } from 'node:fs/promises';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { pool, transaction } from './database.mjs';
import { requireUser } from './auth.mjs';
import { filePath } from './storage.mjs';

const IOS_PRO_PRODUCT_ID = 'illume.pro.monthly';
const STRIPE_API = 'https://api.stripe.com/v1';
const SIGNATURE_TOLERANCE_SECONDS = 300;

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const missing = name => Object.assign(new Error(`Missing ${name}.`), { statusCode: 503 });
const statusOf = error => error.statusCode || 400;

function siteUrl() {
  const url = (process.env.SITE_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '');
  if (!url) throw missing('SITE_URL');
  return url;
}

function stripeForm(values) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    form.append(key, String(value));
  }
  return form;
}

async function stripeApi(method, resource, values) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw missing('STRIPE_SECRET_KEY');
  const url = `${STRIPE_API}${resource}`;
  const query = method === 'GET' && values ? `?${stripeForm(values).toString()}` : '';
  const response = await fetch(url + query, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(values && method !== 'GET' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
    },
    ...(values && method !== 'GET' ? { body: stripeForm(values) } : {})
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || `Stripe request failed (${response.status}).`);
  return result;
}

function verifyStripeSignature(payload, header, secret) {
  if (!header) throw Object.assign(new Error('Missing stripe-signature header.'), { statusCode: 400 });
  const pairs = String(header).split(',');
  const timestamp = pairs.find(part => part.startsWith('t='))?.slice(2);
  const signatures = pairs.filter(part => part.startsWith('v1=')).map(part => part.slice(3));
  if (!timestamp || !signatures.length) throw Object.assign(new Error('Stripe signature is invalid.'), { statusCode: 400 });
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`, 'utf8').digest('hex');
  const verified = signatures.some(candidate => {
    const actual = Buffer.from(candidate);
    const wanted = Buffer.from(expected);
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  });
  if (!verified) throw Object.assign(new Error('Stripe signature is invalid.'), { statusCode: 400 });
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    throw Object.assign(new Error('Stripe signature timestamp is outside tolerance.'), { statusCode: 400 });
  }
}

async function claimEvent(provider, eventId, payload) {
  const inserted = await pool.query(
    `INSERT INTO webhook_events(provider,event_id,payload,status)
     VALUES($1,$2,$3::jsonb,'received')
     ON CONFLICT(provider,event_id) DO NOTHING RETURNING event_id`,
    [provider, eventId, JSON.stringify(payload ?? null)]
  );
  if (inserted.rows.length) return false;
  const { rows } = await pool.query('SELECT status FROM webhook_events WHERE provider=$1 AND event_id=$2', [provider, eventId]);
  if (rows[0]?.status === 'processed') return true;
  await pool.query(
    `UPDATE webhook_events SET payload=$3::jsonb, status='received', processed_at=NULL WHERE provider=$1 AND event_id=$2`,
    [provider, eventId, JSON.stringify(payload ?? null)]
  );
  return false;
}

async function finishEvent(provider, eventId, succeeded, message = null) {
  await pool.query(
    `UPDATE webhook_events
     SET status=$3, processed_at=now(),
         payload=jsonb_set(COALESCE(payload,'{}'::jsonb),'{error}',$4::jsonb)
     WHERE provider=$1 AND event_id=$2`,
    [provider, eventId, succeeded ? 'processed' : 'failed', JSON.stringify(message)]
  );
}

const paidStatus = status => ['active', 'trialing'].includes(status);
const planFromStatus = status => (paidStatus(status) ? 'pro' : 'free');

async function latestBillableSubscription(subscription) {
  if (paidStatus(subscription.status)) return subscription;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!customerId) return subscription;
  const listed = await stripeApi('GET', '/subscriptions', { customer: customerId, status: 'all', limit: 100 });
  const paid = (listed?.data ?? []).filter(candidate => paidStatus(candidate.status)).sort((a, b) => b.created - a.created)[0];
  return paid ?? subscription;
}

async function findUserIdByCustomer(customerId) {
  if (!customerId) return null;
  const { rows } = await pool.query('SELECT user_id FROM billing_profiles WHERE stripe_customer_id=$1', [customerId]);
  return rows[0]?.user_id ?? null;
}

async function upsertSubscription(subscription, fallbackUserId) {
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  // Legacy readers: existing customers carry their local user id in Stripe metadata.
  const userId = subscription.metadata?.supabase_user_id || subscription.metadata?.user_id || fallbackUserId || await findUserIdByCustomer(customerId);
  if (!userId) throw new Error(`No user found for Stripe customer ${customerId || 'unknown'}.`);
  const price = subscription.items?.data?.[0]?.price;
  const priceId = typeof price === 'string' ? price : price?.id ?? null;
  const periodEnd = subscription.current_period_end ? new Date(Number(subscription.current_period_end) * 1000).toISOString() : null;
  await pool.query(
    `INSERT INTO billing_profiles(user_id,stripe_customer_id,stripe_subscription_id,stripe_price_id,plan,status,current_period_end,cancel_at_period_end,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,now())
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id=excluded.stripe_customer_id, stripe_subscription_id=excluded.stripe_subscription_id,
       stripe_price_id=excluded.stripe_price_id, plan=excluded.plan, status=excluded.status,
       current_period_end=excluded.current_period_end, cancel_at_period_end=excluded.cancel_at_period_end, updated_at=now()`,
    [userId, customerId ?? null, subscription.id, priceId, planFromStatus(subscription.status),
      subscription.status, periodEnd, subscription.cancel_at_period_end ?? false]
  );
  return userId;
}

export async function createCheckoutSession(request) {
  try {
    const user = await requireUser(request);
    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) throw missing('STRIPE_PRO_PRICE_ID');
    const returnUrl = siteUrl();
    const profile = await pool.query('SELECT stripe_customer_id FROM billing_profiles WHERE user_id=$1', [user.id]);
    let customerId = profile.rows[0]?.stripe_customer_id ?? '';
    if (!customerId) {
      const customer = await stripeApi('POST', '/customers', { email: user.email, 'metadata[supabase_user_id]': user.id });
      customerId = customer.id;
      if (!customerId) throw new Error('Stripe did not return a customer.');
      await pool.query(
        `INSERT INTO billing_profiles(user_id,stripe_customer_id,updated_at) VALUES($1,$2,now())
         ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id, updated_at=now()`,
        [user.id, customerId]
      );
    }
    const session = await stripeApi('POST', '/checkout/sessions', {
      mode: 'subscription',
      customer: customerId,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': 1,
      allow_promotion_codes: 'true',
      client_reference_id: user.id,
      success_url: `${returnUrl}/?checkout=success`,
      cancel_url: `${returnUrl}/?checkout=canceled`,
      'metadata[supabase_user_id]': user.id,
      'subscription_data[metadata][supabase_user_id]': user.id
    });
    if (!session.url) throw new Error('Stripe did not return a checkout address.');
    return json({ url: session.url });
  } catch (error) {
    const status = statusOf(error);
    return json({ error: status >= 500 ? 'Could not start checkout.' : error.message }, status);
  }
}

export async function createBillingPortal(request) {
  try {
    const user = await requireUser(request);
    const returnUrl = siteUrl();
    const { rows } = await pool.query('SELECT stripe_customer_id FROM billing_profiles WHERE user_id=$1', [user.id]);
    if (!rows[0]?.stripe_customer_id) throw Object.assign(new Error('No Stripe customer exists for this account yet.'), { statusCode: 400 });
    const portal = await stripeApi('POST', '/billing_portal/sessions', { customer: rows[0].stripe_customer_id, return_url: returnUrl });
    if (!portal.url) throw new Error('Stripe did not return a billing portal address.');
    return json({ url: portal.url });
  } catch (error) {
    const status = statusOf(error);
    return json({ error: status >= 500 ? 'Could not open billing portal.' : error.message }, status);
  }
}

export async function stripeWebhook(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    const error = missing('STRIPE_WEBHOOK_SECRET');
    return new Response(error.message, { status: error.statusCode });
  }
  let event = null;
  try {
    const body = await request.text();
    verifyStripeSignature(body, request.headers.get('stripe-signature'), secret);
    event = JSON.parse(body);
    if (!event?.id || !event?.type) throw new Error('Stripe event is invalid.');
    if (await claimEvent('stripe', event.id, event)) return json({ received: true, duplicate: true });
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object ?? {};
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : '';
      if (subscriptionId) {
        const subscription = await latestBillableSubscription(await stripeApi('GET', `/subscriptions/${subscriptionId}`));
        await upsertSubscription(subscription, session.client_reference_id || undefined);
      }
    } else if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      await upsertSubscription(await latestBillableSubscription(event.data?.object ?? {}));
    }
    await finishEvent('stripe', event.id, true);
    return json({ received: true });
  } catch (error) {
    if (event?.id) await finishEvent('stripe', event.id, false, error.message).catch(() => {});
    const status = statusOf(error);
    return new Response(status >= 500 ? 'Webhook error.' : error.message, { status });
  }
}

const decodeJwsPayload = jws => {
  const part = String(jws).split('.')[1];
  if (!part) throw new Error('Invalid Apple signed payload.');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
};

const appleVerificationBypassed = () => process.env.APPLE_DISABLE_SIGNATURE_VERIFICATION === 'true';

function appleRootCertificates() {
  const raw = process.env.APPLE_ROOT_CERTIFICATES_BASE64 || '';
  return raw.split(',').map(item => item.trim()).filter(Boolean).map(item => Buffer.from(item, 'base64'));
}

function appleVerifierFor(environment) {
  const roots = appleRootCertificates();
  if (!roots.length) throw missing('APPLE_ROOT_CERTIFICATES_BASE64');
  const bundleId = process.env.APPLE_BUNDLE_ID || 'com.russellsystems.illume';
  const appAppleId = Number(process.env.APPLE_APP_APPLE_ID || '0') || undefined;
  const env = environment === 'Production' ? Environment.PRODUCTION : Environment.SANDBOX;
  return new SignedDataVerifier(roots, true, env, bundleId, env === Environment.PRODUCTION ? appAppleId : undefined);
}

async function verifyAppleTransaction(signedTransactionInfo) {
  const decoded = decodeJwsPayload(signedTransactionInfo);
  if (appleVerificationBypassed()) return decoded;
  return await appleVerifierFor(decoded.environment).verifyAndDecodeTransaction(signedTransactionInfo);
}

async function decodeAppleNotification(signedPayload) {
  const predecoded = decodeJwsPayload(signedPayload);
  if (appleVerificationBypassed()) return predecoded;
  const transaction = predecoded.data?.signedTransactionInfo
    ? decodeJwsPayload(predecoded.data.signedTransactionInfo)
    : null;
  return await appleVerifierFor(transaction?.environment).verifyAndDecodeNotification(signedPayload);
}

async function decodeAppleTransaction(signedTransactionInfo) {
  const predecoded = decodeJwsPayload(signedTransactionInfo);
  if (appleVerificationBypassed()) return predecoded;
  return await appleVerifierFor(predecoded.environment).verifyAndDecodeTransaction(signedTransactionInfo);
}

const appleDate = value => (value ? new Date(Number(value)).toISOString() : null);

const stripeStillActive = profile =>
  Boolean(profile?.stripe_subscription_id) && paidStatus(profile?.status ?? '') &&
  (!profile?.current_period_end || Date.parse(profile.current_period_end) > Date.now());

async function applyAppleTransaction(userId, transaction, signedTransactionInfo, notification = {}) {
  if (transaction.productId !== IOS_PRO_PRODUCT_ID) throw new Error(`Unexpected Apple product ${transaction.productId ?? 'unknown'}.`);
  if (!transaction.originalTransactionId) throw new Error('Missing Apple original transaction id.');
  const expiresAt = transaction.expiresDate ? new Date(Number(transaction.expiresDate)) : null;
  const active = !transaction.revocationDate && (!expiresAt || expiresAt.getTime() > Date.now());
  const { rows } = await pool.query(
    'SELECT stripe_subscription_id, status, current_period_end::text AS current_period_end FROM billing_profiles WHERE user_id=$1',
    [userId]
  );
  const profile = rows[0] ?? null;
  const keepStripePro = !active && stripeStillActive(profile);
  await pool.query(
    `INSERT INTO billing_profiles(user_id,apple_original_transaction_id,apple_transaction_id,apple_product_id,apple_environment,
       apple_purchase_date,apple_expires_at,apple_revocation_date,apple_last_signed_transaction_info,
       apple_last_notification_type,apple_last_notification_subtype,current_period_end,plan,status,updated_at)
     VALUES($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::timestamptz,$9,$10,$11,$12::timestamptz,$13,$14,now())
     ON CONFLICT(user_id) DO UPDATE SET
       apple_original_transaction_id=excluded.apple_original_transaction_id, apple_transaction_id=excluded.apple_transaction_id,
       apple_product_id=excluded.apple_product_id, apple_environment=excluded.apple_environment,
       apple_purchase_date=excluded.apple_purchase_date, apple_expires_at=excluded.apple_expires_at,
       apple_revocation_date=excluded.apple_revocation_date,
       apple_last_signed_transaction_info=excluded.apple_last_signed_transaction_info,
       apple_last_notification_type=excluded.apple_last_notification_type,
       apple_last_notification_subtype=excluded.apple_last_notification_subtype,
       current_period_end=excluded.current_period_end, plan=excluded.plan, status=excluded.status, updated_at=now()`,
    [userId, transaction.originalTransactionId, transaction.transactionId ?? null, transaction.productId ?? null,
      transaction.environment ?? null, appleDate(transaction.purchaseDate), appleDate(transaction.expiresDate),
      appleDate(transaction.revocationDate), signedTransactionInfo,
      notification.notificationType ?? null, notification.subtype ?? null,
      active ? appleDate(transaction.expiresDate) : profile?.current_period_end ?? null,
      active || keepStripePro ? 'pro' : 'free',
      active ? 'active' : keepStripePro ? profile.status : 'inactive']
  );
  return {
    expiresAt: appleDate(transaction.expiresDate),
    plan: active || keepStripePro ? 'pro' : 'free',
    productId: transaction.productId,
    status: active ? 'active' : keepStripePro ? profile?.status ?? 'inactive' : 'inactive'
  };
}

export async function syncAppleSubscription(request) {
  try {
    const user = await requireUser(request);
    const payload = await request.json().catch(() => ({}));
    const signedTransactionInfo = String(payload.signedTransactionInfo ?? '');
    if (!signedTransactionInfo) throw new Error('Missing signedTransactionInfo.');
    const transaction = await verifyAppleTransaction(signedTransactionInfo);
    return json(await applyAppleTransaction(user.id, transaction, signedTransactionInfo));
  } catch (error) {
    const status = statusOf(error);
    return json({ error: status >= 500 ? 'Could not sync Apple subscription.' : error.message }, status);
  }
}

export async function appleNotifications(request) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  let eventId = null;
  try {
    const payload = await request.json().catch(() => ({}));
    const signedPayload = String(payload.signedPayload ?? '');
    if (!signedPayload) throw new Error('Missing signedPayload.');
    eventId = createHash('sha256').update(signedPayload).digest('hex');
    const notification = await decodeAppleNotification(signedPayload);
    if (notification.notificationUUID) eventId = `apple-${notification.notificationUUID}`;
    const signedTransactionInfo = notification.data?.signedTransactionInfo;
    if (!signedTransactionInfo) throw new Error('Missing signed transaction info.');
    if (await claimEvent('apple', eventId, { notificationType: notification.notificationType ?? null })) {
      return json({ received: true, duplicate: true });
    }
    const transaction = await decodeAppleTransaction(String(signedTransactionInfo));
    if (transaction.productId !== IOS_PRO_PRODUCT_ID) {
      await finishEvent('apple', eventId, true);
      return json({ received: true, ignored: true });
    }
    if (!transaction.originalTransactionId) throw new Error('Missing original transaction id.');
    const { rows } = await pool.query(
      'SELECT user_id, stripe_subscription_id, status, current_period_end::text AS current_period_end FROM billing_profiles WHERE apple_original_transaction_id=$1',
      [transaction.originalTransactionId]
    );
    if (!rows[0]?.user_id) throw new Error('No billing profile found for Apple transaction.');
    await applyAppleTransaction(rows[0].user_id, transaction, String(signedTransactionInfo), {
      notificationType: notification.notificationType,
      subtype: notification.subtype
    });
    await finishEvent('apple', eventId, true);
    return json({ received: true });
  } catch (error) {
    if (eventId) await finishEvent('apple', eventId, false, error.message).catch(() => {});
    const status = statusOf(error);
    return new Response(status >= 500 ? 'Apple notification error.' : error.message, { status });
  }
}

export async function deleteAccount(request) {
  try {
    const user = await requireUser(request);
    const removed = await transaction(async db => {
      const files = await db.query('SELECT bucket, path FROM object_files WHERE user_id=$1', [user.id]);
      await db.query(`DELETE FROM jobs WHERE payload->>'userId'=$1`, [user.id]);
      await db.query('DELETE FROM object_files WHERE user_id=$1', [user.id]);
      const deleted = await db.query('DELETE FROM users WHERE id=$1 RETURNING id', [user.id]);
      if (!deleted.rows[0]) throw Object.assign(new Error('Account not found.'), { statusCode: 404 });
      return files.rows;
    });
    let removedDocuments = 0;
    let removedReaderImages = 0;
    for (const file of removed) {
      const destination = await filePath(file.bucket, file.path, true).catch(() => null);
      if (destination) await unlink(destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (file.bucket === 'epubs') removedDocuments += 1;
      if (file.bucket === 'reader-images') removedReaderImages += 1;
    }
    for (const bucket of [...new Set(removed.map(file => file.bucket))]) {
      const prefix = removed.find(file => file.bucket === bucket)?.path?.split('/')[0];
      if (!prefix) continue;
      const directory = await filePath(bucket, prefix, true).catch(() => null);
      if (directory) await rmdir(directory).catch(() => {});
    }
    return json({ deleted: true, removedDocuments, removedReaderImages });
  } catch (error) {
    const status = statusOf(error);
    return json({ error: status >= 500 ? 'Could not delete this account.' : error.message }, status);
  }
}
