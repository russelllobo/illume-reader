import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";
import {
  Environment,
  SignedDataVerifier,
} from "npm:@apple/app-store-server-library";
import { Buffer } from "node:buffer";

const IOS_PRO_PRODUCT_ID = "illume.pro.monthly";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AppleTransactionPayload = {
  bundleId?: string;
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

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const decodeBase64Url = (value: string) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return atob(padded);
};

const decodeJwsPayload = <T>(jws: string): T => {
  const part = jws.split(".")[1];
  if (!part) throw new Error("Invalid Apple signed transaction.");
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

const verifyTransaction = async (signedTransactionInfo: string) => {
  const decoded = decodeJwsPayload<AppleTransactionPayload>(
    signedTransactionInfo,
  );
  const bundleId = optionalEnv("APPLE_BUNDLE_ID") || "com.illumereader.ios";
  const appAppleId = Number(optionalEnv("APPLE_APP_APPLE_ID") || "0") ||
    undefined;
  const rootCertificates = certBytesFromEnv();
  const verificationDisabled =
    optionalEnv("APPLE_DISABLE_SIGNATURE_VERIFICATION") === "true";

  if (!verificationDisabled) {
    if (!rootCertificates.length) {
      throw new Error(
        "Missing APPLE_ROOT_CERTIFICATES_BASE64 for Apple transaction verification.",
      );
    }
    const verifier = new SignedDataVerifier(
      rootCertificates,
      true,
      environmentFor(decoded.environment),
      bundleId,
      environmentFor(decoded.environment) === Environment.PRODUCTION
        ? appAppleId
        : undefined,
    );
    return await verifier.verifyAndDecodeTransaction(
      signedTransactionInfo,
    ) as AppleTransactionPayload;
  }

  return decoded;
};

const dateFromMs = (value?: number) =>
  value ? new Date(value).toISOString() : null;

const isStripeStillActive = (profile: any) =>
  profile?.stripe_subscription_id &&
  ["active", "trialing"].includes(profile?.status ?? "") &&
  (!profile?.current_period_end ||
    Date.parse(profile.current_period_end) > Date.now());

const upsertAppleProfile = async (
  adminClient: any,
  userId: string,
  transaction: AppleTransactionPayload,
  signedTransactionInfo: string,
) => {
  if (transaction.productId !== IOS_PRO_PRODUCT_ID) {
    throw new Error(
      `Unexpected Apple product ${transaction.productId ?? "unknown"}.`,
    );
  }

  if (!transaction.originalTransactionId) {
    throw new Error("Missing Apple original transaction id.");
  }

  const expiresAt = transaction.expiresDate
    ? new Date(transaction.expiresDate)
    : null;
  const active = !transaction.revocationDate &&
    (!expiresAt || expiresAt.getTime() > Date.now());

  const { data: profile, error: profileError } = await adminClient
    .from("billing_profiles")
    .select("stripe_subscription_id,status,current_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  if (profileError) throw profileError;

  const keepStripePro = !active && isStripeStillActive(profile);
  const { error } = await adminClient.from("billing_profiles").upsert({
    user_id: userId,
    apple_original_transaction_id: transaction.originalTransactionId,
    apple_transaction_id: transaction.transactionId ?? null,
    apple_product_id: transaction.productId ?? null,
    apple_environment: transaction.environment ?? null,
    apple_purchase_date: dateFromMs(transaction.purchaseDate),
    apple_expires_at: dateFromMs(transaction.expiresDate),
    apple_revocation_date: dateFromMs(transaction.revocationDate),
    apple_last_signed_transaction_info: signedTransactionInfo,
    current_period_end: active
      ? dateFromMs(transaction.expiresDate)
      : profile?.current_period_end ?? null,
    plan: active || keepStripePro ? "pro" : "free",
    status: active ? "active" : keepStripePro ? profile.status : "inactive",
  });

  if (error) throw error;

  return {
    expiresAt: dateFromMs(transaction.expiresDate),
    plan: active || keepStripePro ? "pro" : "free",
    productId: transaction.productId,
    status: active ? "active" : keepStripePro ? profile.status : "inactive",
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) throw new Error("Missing Authorization header");

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth
      .getUser();
    if (userError || !userData.user) {
      throw new Error("You must be signed in to sync purchases.");
    }

    const payload = await req.json();
    const signedTransactionInfo = String(payload.signedTransactionInfo ?? "");
    if (!signedTransactionInfo) {
      throw new Error("Missing signedTransactionInfo.");
    }

    const transaction = await verifyTransaction(signedTransactionInfo);
    const result = await upsertAppleProfile(
      adminClient,
      userData.user.id,
      transaction,
      signedTransactionInfo,
    );

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error
          ? error.message
          : "Could not sync Apple subscription.",
      },
      400,
    );
  }
});
