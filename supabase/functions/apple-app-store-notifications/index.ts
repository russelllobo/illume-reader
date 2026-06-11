import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";
import {
  Environment,
  SignedDataVerifier,
} from "npm:@apple/app-store-server-library";
import { Buffer } from "node:buffer";

const IOS_PRO_PRODUCT_ID = "illume.pro.monthly";

type AppleNotificationPayload = {
  data?: {
    signedRenewalInfo?: string;
    signedTransactionInfo?: string;
  };
  notificationType?: string;
  subtype?: string;
};

type AppleTransactionPayload = {
  environment?: string;
  expiresDate?: number;
  originalTransactionId?: string;
  productId?: string;
  purchaseDate?: number;
  revocationDate?: number;
  transactionId?: string;
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const optionalEnv = (name: string) => Deno.env.get(name) || "";

const decodeBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return atob(padded);
};

const decodeJwsPayload = <T>(jws: string): T => {
  const part = jws.split(".")[1];
  if (!part) throw new Error("Invalid Apple signed payload.");
  return JSON.parse(decodeBase64Url(part)) as T;
};

const certBytesFromEnv = () => {
  const raw = optionalEnv("APPLE_ROOT_CERTIFICATES_BASE64");
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Buffer.from(item, "base64"));
};

const environmentFor = (value?: string) =>
  value === "Production" ? Environment.PRODUCTION : Environment.SANDBOX;

const verifierFor = (environment?: string) => {
  const bundleId = optionalEnv("APPLE_BUNDLE_ID") || "com.russellsystems.illume";
  const appAppleId = Number(optionalEnv("APPLE_APP_APPLE_ID") || "0") ||
    undefined;
  const roots = certBytesFromEnv();
  if (!roots.length) {
    throw new Error(
      "Missing APPLE_ROOT_CERTIFICATES_BASE64 for Apple notification verification.",
    );
  }
  const env = environmentFor(environment);
  return new SignedDataVerifier(
    roots,
    true,
    env,
    bundleId,
    env === Environment.PRODUCTION ? appAppleId : undefined,
  );
};

const decodeNotification = async (signedPayload: string) => {
  const predecoded = decodeJwsPayload<AppleNotificationPayload>(signedPayload);
  if (optionalEnv("APPLE_DISABLE_SIGNATURE_VERIFICATION") === "true") {
    return predecoded;
  }
  const transaction = predecoded.data?.signedTransactionInfo
    ? decodeJwsPayload<AppleTransactionPayload>(
      predecoded.data.signedTransactionInfo,
    )
    : null;
  return await verifierFor(transaction?.environment)
    .verifyAndDecodeNotification(signedPayload) as AppleNotificationPayload;
};

const decodeTransaction = async (signedTransactionInfo: string) => {
  const predecoded = decodeJwsPayload<AppleTransactionPayload>(
    signedTransactionInfo,
  );
  if (optionalEnv("APPLE_DISABLE_SIGNATURE_VERIFICATION") === "true") {
    return predecoded;
  }
  return await verifierFor(predecoded.environment).verifyAndDecodeTransaction(
    signedTransactionInfo,
  ) as AppleTransactionPayload;
};

const dateFromMs = (value?: number) =>
  value ? new Date(value).toISOString() : null;

const isStripeStillActive = (profile: any) =>
  profile?.stripe_subscription_id &&
  ["active", "trialing"].includes(profile?.status ?? "") &&
  (!profile?.current_period_end ||
    Date.parse(profile.current_period_end) > Date.now());

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { signedPayload } = await req.json();
    if (!signedPayload) throw new Error("Missing signedPayload.");

    const notification = await decodeNotification(String(signedPayload));
    const signedTransactionInfo = notification.data?.signedTransactionInfo;
    if (!signedTransactionInfo) {
      throw new Error("Missing signed transaction info.");
    }

    const transaction = await decodeTransaction(signedTransactionInfo);
    if (transaction.productId !== IOS_PRO_PRODUCT_ID) {
      return new Response(JSON.stringify({ received: true, ignored: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!transaction.originalTransactionId) {
      throw new Error("Missing original transaction id.");
    }

    const adminClient = createClient(
      requiredEnv("SUPABASE_URL"),
      requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const { data: profile, error: profileError } = await adminClient
      .from("billing_profiles")
      .select("user_id,stripe_subscription_id,status,current_period_end")
      .eq("apple_original_transaction_id", transaction.originalTransactionId)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.user_id) {
      throw new Error("No billing profile found for Apple transaction.");
    }

    const expiresAt = transaction.expiresDate
      ? new Date(transaction.expiresDate)
      : null;
    const active = !transaction.revocationDate &&
      (!expiresAt || expiresAt.getTime() > Date.now());
    const keepStripePro = !active && isStripeStillActive(profile);

    const { error } = await adminClient.from("billing_profiles").upsert({
      user_id: profile.user_id,
      apple_original_transaction_id: transaction.originalTransactionId,
      apple_transaction_id: transaction.transactionId ?? null,
      apple_product_id: transaction.productId ?? null,
      apple_environment: transaction.environment ?? null,
      apple_purchase_date: dateFromMs(transaction.purchaseDate),
      apple_expires_at: dateFromMs(transaction.expiresDate),
      apple_revocation_date: dateFromMs(transaction.revocationDate),
      apple_last_signed_transaction_info: signedTransactionInfo,
      apple_last_notification_type: notification.notificationType ?? null,
      apple_last_notification_subtype: notification.subtype ?? null,
      current_period_end: active
        ? dateFromMs(transaction.expiresDate)
        : profile.current_period_end ?? null,
      plan: active || keepStripePro ? "pro" : "free",
      status: active ? "active" : keepStripePro ? profile.status : "inactive",
    });
    if (error) throw error;

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "Apple notification error",
      { status: 400 },
    );
  }
});
