import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = { api: { bodyParser: false } };

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function phasesForPlan(planCode) {
  switch (planCode) {
    case "6-inperson":
      return [
        { price: process.env.PRICE_ID_500, iterations: 1 },
        { price: process.env.PRICE_ID_400, iterations: 5 }
      ];
    case "3-inperson":
      return [
        { price: process.env.PRICE_ID_500, iterations: 1 },
        { price: process.env.PRICE_ID_400, iterations: 2 }
      ];
    case "6-online":
      return [
        { price: process.env.PRICE_ID_300, iterations: 1 },
        { price: process.env.PRICE_ID_200, iterations: 5 }
      ];
    default:
      return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  let event;
  try {
    const sig = req.headers["stripe-signature"];
    const raw = await getRawBody(req);
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    if (session.mode === "setup" && session.customer && session.setup_intent) {
      const planCode = session.client_reference_id;
      const defs = phasesForPlan(planCode);
      if (!defs) return res.json({ received: true });

      const si = await stripe.setupIntents.retrieve(session.setup_intent);
      const defaultPm = si.payment_method;

      const phases = defs.map(p => ({
        plans: [{ price: p.price, quantity: 1 }],
        iterations: p.iterations
      }));

      await stripe.subscriptionSchedules.create({
        customer: session.customer,
        start_date: "now",
        end_behavior: "cancel",
        default_settings: {
          collection_method: "charge_automatically",
          default_payment_method: defaultPm
        },
        phases
      });
    }
  }

  return res.json({ received: true });
}
