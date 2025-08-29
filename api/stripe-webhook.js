import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

function defsFor(plan) {
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
    event = stripe.webhooks.constructEvent(
      raw,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("❌ Webhook signature failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== "checkout.session.completed") {
    return res.json({ received: true });
  }

  try {
    const session = event.data.object;

    // Get plan identifier (we set both)
    const plan =
      session.client_reference_id || (session.metadata && session.metadata.plan);
    if (!plan) {
      console.warn("⚠️ No plan on session; skipping.");
      return res.json({ received: true });
    }

    const defs = defsFor(plan);
    if (!defs) {
      console.warn("⚠️ Unknown plan:", plan);
      return res.json({ received: true });
    }

    // We created a Customer before Checkout, so this should exist now.
    const customerId = session.customer;
    if (!customerId) {
      console.error("❌ No customer on session");
      return res.status(500).send("schedule_create_error: missing customer");
    }

    // Pull saved payment method from SetupIntent (setup mode)
    let defaultPm = null;
    if (session.setup_intent) {
      const si = await stripe.setupIntents.retrieve(session.setup_intent);
      defaultPm = si?.payment_method || null;
    }

    // Build both shapes
    const phases_items = defs.map((d) => ({
      items: [{ price: d.price, quantity: 1 }],
      iterations: d.iterations,
    }));
    const phases_plans = defs.map((d) => ({
      plans: [{ price: d.price, quantity: 1 }],
      iterations: d.iterations,
    }));

    const base = {
      customer: customerId,
      start_date: "now",
      end_behavior: "cancel",
      default_settings: {
        collection_method: "charge_automatically",
        ...(defaultPm ? { default_payment_method: defaultPm } : {}),
      },
    };

    let schedule;

    // Try with items first
    try {
      schedule = await stripe.subscriptionSchedules.create({
        ...base,
        phases: phases_items,
      });
    } catch (e1) {
      // If the account expects "plans", retry with that
      const msg = (e1 && e1.message) || "";
      if (/unknown parameter.*items/i.test(msg) || /Received unknown parameter: items/i.test(msg)) {
        schedule = await stripe.subscriptionSchedules.create({
          ...base,
          phases: phases_plans,
        });
      } else {
        throw e1;
      }
    }

    console.log("✅ Created schedule", schedule?.id, "for plan", plan);
    return res.json({ received: true });
  } catch (err) {
    console.error("❌ Failed to create schedule:", err);
    return res
      .status(500)
      .send(
        `schedule_create_error: ${err.type || "Error"} - ${err.message || err}`
      );
  }
}
