import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

// Build phases per plan
function phasesFor(plan) {
  switch (plan) {
    case "6-inperson":
      return [
        { price: process.env.PRICE_ID_500, iterations: 1 }, // $500 x1
        { price: process.env.PRICE_ID_400, iterations: 5 }, // $400 x5
      ];
    case "3-inperson":
      return [
        { price: process.env.PRICE_ID_500, iterations: 1 }, // $500 x1
        { price: process.env.PRICE_ID_400, iterations: 2 }, // $400 x2
      ];
    case "6-online":
      return [
        { price: process.env.PRICE_ID_300, iterations: 1 }, // $300 x1
        { price: process.env.PRICE_ID_200, iterations: 5 }, // $200 x5
      ];
    default:
      return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  let event;
  try {
    const raw = await getRawBody(req);
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // identify plan robustly
    const plan =
      session.client_reference_id ||
      (session.metadata && session.metadata.plan);

    if (!plan) {
      console.warn("⚠️ No plan on session; nothing to schedule.");
      return res.json({ received: true });
    }

    const defs = phasesFor(plan);
    if (!defs) {
      console.warn("⚠️ Unknown plan:", plan);
      return res.json({ received: true });
    }

    try {
      // get saved payment method from SetupIntent
      const setupIntentId = session.setup_intent;
      const setupIntent = setupIntentId
        ? await stripe.setupIntents.retrieve(setupIntentId)
        : null;
      const defaultPm = setupIntent?.payment_method || null;

      const phases = defs.map(d => ({
        // API 2022-11-15 expects `items` (not `plans`)
        items: [{ price: d.price, quantity: 1 }],
        iterations: d.iterations,
      }));

      const schedule = await stripe.subscriptionSchedules.create({
        customer: session.customer,
        start_date: "now",
        end_behavior: "cancel",
        default_settings: {
          collection_method: "charge_automatically",
          ...(defaultPm ? { default_payment_method: defaultPm } : {}),
        },
        phases,
      });

      console.log("✅ Created schedule", schedule?.id, "for plan", plan);
    } catch (err) {
      console.error("❌ Failed to create schedule:", err);
      return res.status(500).send("Server error while creating schedule");
    }
  }

  return res.json({ received: true });
}

