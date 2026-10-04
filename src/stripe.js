// src/stripe.js
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID;
const ENTERPRISE_PRICE_ID = process.env.STRIPE_ENTERPRISE_PRICE_ID;

/**
 * Creates Stripe subscription products and prices if they don't exist.
 * Stores the resulting price IDs in env vars for the running process.
 * Idempotent — looks up existing products by name before creating.
 */
export async function ensureStripeProducts() {
  // Hard-disabled. This function creates LIVE Stripe Products/Prices and
  // rewrites process.cwd()/.env — a side effect that must never happen on boot,
  // during a request, or in production. Nothing in the app calls it any more
  // (it used to run in the app.listen() callback); running it has to be an
  // explicit, deliberate act, and only ever against a test key.
  if (process.env.STRIPE_BOOTSTRAP_PRODUCTS !== "1") {
    console.warn(
      "[Stripe] ensureStripeProducts() is disabled — set STRIPE_BOOTSTRAP_PRODUCTS=1 to run it deliberately (test mode only)"
    );
    return { proPriceId: PRO_PRICE_ID, enterprisePriceId: ENTERPRISE_PRICE_ID };
  }
  if (!String(process.env.STRIPE_SECRET_KEY || "").startsWith("sk_test_")) {
    throw new Error(
      "ensureStripeProducts() refuses to run: STRIPE_SECRET_KEY is not a test-mode key"
    );
  }

  try {
    // ── Pro Plan ──
    let proProduct;
    const existingPro = await stripe.products.search({
      query: "name:'TrackQA Pro'",
    });
    if (existingPro.data.length > 0) {
      proProduct = existingPro.data[0];
    } else {
      proProduct = await stripe.products.create({
        name: "TrackQA Pro",
        description: "For growing teams that need power and flexibility — unlimited projects, configurable workflows, file attachments, priority support.",
      });
    }

    // Get or create Pro monthly price
    const proPrices = await stripe.prices.list({
      product: proProduct.id,
      recurring: { interval: "month" },
      active: true,
      limit: 1,
    });
    let proPriceId;
    if (proPrices.data.length > 0) {
      proPriceId = proPrices.data[0].id;
    } else {
      const proPrice = await stripe.prices.create({
        product: proProduct.id,
        unit_amount: 1200,
        currency: "usd",
        recurring: { interval: "month" },
      });
      proPriceId = proPrice.id;
    }

    // ── Enterprise Plan ──
    let enterpriseProduct;
    const existingEnt = await stripe.products.search({
      query: "name:'TrackQA Enterprise'",
    });
    if (existingEnt.data.length > 0) {
      enterpriseProduct = existingEnt.data[0];
    } else {
      enterpriseProduct = await stripe.products.create({
        name: "TrackQA Enterprise",
        description: "For organizations that need security and control — SSO, audit logs, dedicated onboarding, SLA guarantees.",
      });
    }

    const entPrices = await stripe.prices.list({
      product: enterpriseProduct.id,
      recurring: { interval: "month" },
      active: true,
      limit: 1,
    });
    let enterprisePriceId;
    if (entPrices.data.length > 0) {
      enterprisePriceId = entPrices.data[0].id;
    } else {
      const entPrice = await stripe.prices.create({
        product: enterpriseProduct.id,
        unit_amount: 2000,
        currency: "usd",
        recurring: { interval: "month" },
      });
      enterprisePriceId = entPrice.id;
    }

    // Store in process env
    process.env.STRIPE_PRO_PRICE_ID = proPriceId;
    process.env.STRIPE_ENTERPRISE_PRICE_ID = enterprisePriceId;

    // Also write back to .env so restarts pick them up
    const fs = await import("fs");
    const path = await import("path");
    const envPath = path.join(process.cwd(), ".env");
    let envContent = fs.readFileSync(envPath, "utf8");
    envContent = envContent
      .replace(/STRIPE_PRO_PRICE_ID=.*/, `STRIPE_PRO_PRICE_ID=${proPriceId}`)
      .replace(/STRIPE_ENTERPRISE_PRICE_ID=.*/, `STRIPE_ENTERPRISE_PRICE_ID=${enterprisePriceId}`);
    fs.writeFileSync(envPath, envContent);

    console.log(`[Stripe] Pro price: ${proPriceId}`);
    console.log(`[Stripe] Enterprise price: ${enterprisePriceId}`);
    return { proPriceId, enterprisePriceId };
  } catch (err) {
    console.error("[Stripe] Failed to ensure products:", err.message);
    // Non-fatal — the app can still serve existing tiers
    return { proPriceId: PRO_PRICE_ID, enterprisePriceId: ENTERPRISE_PRICE_ID };
  }
}

/**
 * Get or create a Stripe Customer for a user.
 */
export async function getOrCreateCustomer(user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name || undefined,
    metadata: { userId: user.id },
  });

  return customer.id;
}

/**
 * Create a Stripe Checkout Session for subscription.
 */
export async function createCheckoutSession({ customerId, priceId, userId, appUrl }) {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: { userId },
    },
    success_url: `${appUrl}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/settings/billing`,
    allow_promotion_codes: true,
  });

  return session;
}

/**
 * Create a Stripe Customer Portal session.
 */
export async function createPortalSession({ customerId, appUrl }) {
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl}/settings/billing`,
  });

  return session;
}

/**
 * Get the plan name from a price ID.
 */
export function planFromPriceId(priceId) {
  if (priceId === process.env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === process.env.STRIPE_ENTERPRISE_PRICE_ID) return "enterprise";
  return "free";
}

const PLACEHOLDER_WEBHOOK_SECRET = "whsec_test_placeholder";

/**
 * Verify Stripe webhook signature. FAILS CLOSED.
 *
 * `stripe.webhooks.constructEvent` always runs. The only way to skip it is the
 * deliberate, local-testing-only opt-out, which requires BOTH:
 *
 *     NODE_ENV !== "production"  AND  ALLOW_UNVERIFIED_WEBHOOKS === "1"
 *
 * A production runtime can never skip verification, not even with the flag set,
 * and a missing or placeholder signing secret throws (→ HTTP 400 upstream)
 * instead of accepting an unverified payload. An unverified webhook on this
 * path can forge `checkout.session.completed` and grant a paid plan for free,
 * so accepting one is never an acceptable fallback.
 */
export function verifyWebhook(payload, signature) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const isProduction = process.env.NODE_ENV === "production";
  const optOutRequested = process.env.ALLOW_UNVERIFIED_WEBHOOKS === "1";

  if (optOutRequested && isProduction) {
    throw new Error(
      "ALLOW_UNVERIFIED_WEBHOOKS=1 is ignored because NODE_ENV=production — refusing to process an unverified webhook"
    );
  }

  if (optOutRequested) {
    console.warn(
      "[Stripe] ALLOW_UNVERIFIED_WEBHOOKS=1 with NODE_ENV != production — SKIPPING signature verification. Local testing only; never set this in production."
    );
    return JSON.parse(payload);
  }

  if (!secret) {
    throw new Error(
      "STRIPE_WEBHOOK_SECRET is not set — refusing to process an unverified webhook. Set STRIPE_WEBHOOK_SECRET to the signing secret of the webhook endpoint registered in the Stripe dashboard (for local testing only, run with NODE_ENV != production and ALLOW_UNVERIFIED_WEBHOOKS=1)."
    );
  }
  if (secret === PLACEHOLDER_WEBHOOK_SECRET) {
    throw new Error(
      `STRIPE_WEBHOOK_SECRET is still the placeholder "${PLACEHOLDER_WEBHOOK_SECRET}"${isProduction ? " in production" : ""} — refusing to process an unverified webhook. Set STRIPE_WEBHOOK_SECRET to the signing secret of the webhook endpoint registered in the Stripe dashboard.`
    );
  }

  return stripe.webhooks.constructEvent(payload, signature, secret);
}

export { stripe, PRO_PRICE_ID, ENTERPRISE_PRICE_ID };
