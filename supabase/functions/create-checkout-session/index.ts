import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.106.0";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const requiredEnv = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }

  try {
    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const anonKey = requiredEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const stripeSecretKey = requiredEnv("STRIPE_SECRET_KEY");
    const proPriceId = requiredEnv("STRIPE_PRO_PRICE_ID");
    const siteUrl = requiredEnv("SITE_URL").replace(/\/$/, "");
    const authorization = req.headers.get("Authorization");

    if (!authorization) throw new Error("Missing Authorization header");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } }
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth.getUser();

    if (userError || !userData.user) throw new Error("You must be signed in to subscribe.");

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-02-24.acacia",
      httpClient: Stripe.createFetchHttpClient()
    });

    const { data: profile } = await adminClient
      .from("billing_profiles")
      .select("stripe_customer_id")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id ?? "";

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userData.user.email,
        metadata: { supabase_user_id: userData.user.id }
      });
      customerId = customer.id;

      const { error: upsertError } = await adminClient.from("billing_profiles").upsert({
        user_id: userData.user.id,
        stripe_customer_id: customerId
      });
      if (upsertError) throw upsertError;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: proPriceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: userData.user.id,
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=canceled`,
      metadata: { supabase_user_id: userData.user.id },
      subscription_data: {
        metadata: { supabase_user_id: userData.user.id }
      }
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Could not start checkout." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
