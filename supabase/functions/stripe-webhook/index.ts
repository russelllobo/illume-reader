import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const planFromStatus = (status: string) =>
  ["active", "trialing"].includes(status) ? "pro" : "free";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"), {
      apiVersion: "2025-02-24.acacia",
      httpClient: Stripe.createFetchHttpClient()
    });
    const signature = req.headers.get("stripe-signature");

    if (!signature) throw new Error("Missing stripe-signature header");

    const body = await req.text();
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      requiredEnv("STRIPE_WEBHOOK_SECRET"),
      undefined,
      Stripe.createSubtleCryptoProvider()
    );
    const adminClient = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof session.subscription === "string" ? session.subscription : "";
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        await upsertSubscription(adminClient, subscription, session.client_reference_id ?? undefined);
      }
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await upsertSubscription(adminClient, event.data.object as Stripe.Subscription);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Webhook error", { status: 400 });
  }
});

async function upsertSubscription(
  adminClient: any,
  subscription: Stripe.Subscription,
  fallbackUserId?: string
) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const userId = subscription.metadata.supabase_user_id || fallbackUserId || await findUserId(adminClient, customerId);

  if (!userId) throw new Error(`No Supabase user found for Stripe customer ${customerId}`);

  const item = subscription.items.data[0];
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;
  const { error } = await adminClient.from("billing_profiles").upsert({
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: item?.price.id ?? null,
    plan: planFromStatus(subscription.status),
    status: subscription.status,
    current_period_end: periodEnd,
    cancel_at_period_end: subscription.cancel_at_period_end
  });

  if (error) throw error;
}

async function findUserId(adminClient: any, customerId: string) {
  const { data, error } = await adminClient
    .from("billing_profiles")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (error) throw error;
  return data?.user_id;
}
