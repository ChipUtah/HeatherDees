import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const ALLOWED_PLANS = {
  "6-inperson": "6 Month In Person",
  "3-inperson": "3 Month In Person",
  "6-online": "Online Body Transformation",
};

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).send("Method Not Allowed");

  const planCode = (req.query.plan || "").toString();
  if (!ALLOWED_PLANS[planCode]) return res.status(400).send("Unknown plan");

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "setup",                         // save card only
      success_url: process.env.SUCCESS_URL + "?ok=1",
      cancel_url: process.env.CANCEL_URL + "?canceled=1",
      client_reference_id: planCode,
      metadata: { plan: planCode },

      // 🔑 Make Checkout create a Customer so the webhook has session.customer
      customer_creation: { enabled: true },  // <-- add this
      payment_method_types: ["card"],
    });

    res.setHeader("Location", session.url);
    return res.status(303).end();
  } catch (e) {
    console.error(e);
    res.status(500).send("Unable to start checkout");
  }
}
