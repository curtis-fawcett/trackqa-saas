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

/**
 * Verify Stripe webhook signature.
 */
export function verifyWebhook(payload, signature) {
  if (process.env.STRIPE_WEBHOOK_SECRET === "whsec_test_placeholder") {
    console.warn("[Stripe] Webhook secret not configured — skipping signature verification");
    return JSON.parse(payload);
  }
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export { stripe, PRO_PRICE_ID, ENTERPRISE_PRICE_ID };
