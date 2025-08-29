import Stripe from "stripe";
import getRawBody from "raw-body";

export const config = {
  api: { bodyParser: false },
};

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2022-11-15",
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end("Method Not Allowed");
  }

  let event;
  try {
    const rawBody = await getRawBody(req);
    const signature = req.headers["stripe-signature"];

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Handle checkout completion
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Pick which plan
    let schedule;
    if (session.metadata?.plan === "6-inperson") {
      schedule = await stripe.subscriptionSchedules.create({
        customer: session.customer,
        start_date: "now",
        end_behavior: "cancel",
        phases: [
          {
            items: [{ price: process.env.PRICE_ID_500, quantity: 1 }],
            iterations: 1,
          },
          {
            items: [{ price: process.env.PRICE_ID_400, quantity: 1 }],
            iterations: 5,
          },
        ],
      });
    }

    if (session.metadata?.plan === "3-inperson") {
      schedule = await stripe.subscriptionSchedules.create({
        customer: session.customer,
        start_date: "now",
        end_behavior: "cancel",
        phases: [
          {
            items: [{ price: process.env.PRICE_ID_500, quantity: 1 }],
            iterations: 1,
          },
          {
            items: [{ price: process.env.PRICE_ID_400, quantity: 1 }],
            iterations: 2,
          },
        ],
      });
    }

    if (session.metadata?.plan === "6-online") {
      schedule = await stripe.subscriptionSchedules.create({
        customer: session.customer,
        start_date: "now",
        end_behavior: "cancel",
        phases: [
          {
            items: [{ price: process.env.PRICE_ID_300, quantity: 1 }],
            iterations: 1,
          },
          {
            items: [{ price: process.env.PRICE_ID_200, quantity: 1 }],
            iterations: 5,
          },
        ],
      });
    }

    console.log("✅ Subscription Schedule Created:", schedule.id);
  }

  res.json({ received: true });
}
