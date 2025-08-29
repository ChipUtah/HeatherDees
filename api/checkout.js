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
    // 1) Create a Customer up-front so session.customer is NEVER empty
    const customer = await stripe.customers.create();

    // 2) Create a setup-mode Checkout Session that saves a card to that customer
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customer.id,                 // <-- guarantees session.customer
      success_url: process.env.SUCCESS_URL + "?ok=1",
      cancel_url: process.env.CANCEL_URL + "?canceled=1",
      client_reference_id: planCode,
      metadata: { plan: planCode },
      payment_method_types: ["card"],
      // If your account supports it, this also makes Checkout collect email:
      // customer_update: { name: "auto", address: "auto", shipping: "auto" }
    });

    res.setHeader("Location", session.url);
    return res.status(303).end();
  } catch (e) {
    console.error("checkout error:", e);
    return res.status(500).send("Unable to start checkout");
  }
}

