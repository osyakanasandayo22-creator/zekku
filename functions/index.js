const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");
const Stripe = require("stripe");
const express = require("express");

setGlobalOptions({ maxInstances: 10 });

admin.initializeApp();

const db = admin.firestore();

const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

function getStripe(secretKey) {
  if (!secretKey) throw new HttpsError("failed-precondition", "Stripe が設定されていません。");
  return new Stripe(secretKey, { apiVersion: "2024-11-20.acacia" });
}

/**
 * 画数資産の Checkout セッションを作成する（呼び出し可能関数）
 * 認証必須。data: { strokes: number, priceYen: number, baseUrl?: string }
 */
exports.createCheckoutSession = onCall(
  { region: "asia-northeast1", secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "ログインが必要です。");
    }
    const uid = request.auth.uid;
    const { strokes, priceYen } = request.data || {};
    if (typeof strokes !== "number" || strokes <= 0 || typeof priceYen !== "number" || priceYen <= 0) {
      throw new HttpsError("invalid-argument", "不正なパッケージです。");
    }

    const stripe = getStripe(stripeSecretKey.value());
    const baseUrl = (request.data && request.data.baseUrl) || "https://zekku-5ed59.web.app";
    const successUrl = `${baseUrl.replace(/\/$/, "")}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl.replace(/\/$/, "")}?payment=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "jpy",
            unit_amount: priceYen,
            product_data: {
              name: `画数資産 ${strokes.toLocaleString()} ポイント`,
              description: "五言絶句バトルで使用する画数資産です。",
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      metadata: {
        strokes: String(strokes),
        uid,
      },
    });

    return { url: session.url };
  }
);

/**
 * Stripe Webhook（checkout.session.completed で画数資産を付与）
 * Stripe ダッシュボードで Webhook の URL をこの関数の URL に設定し、
 * イベント "checkout.session.completed" を選択してください。
 * シークレットは firebase functions:config:set stripe.webhook_secret="whsec_..."
 * 署名検証のため raw body が必要なため Express で raw パースのみ適用。
 */
const stripeWebhookApp = express();
stripeWebhookApp.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const webhookSecretVal = stripeWebhookSecret.value();
    if (!webhookSecretVal) {
      console.error("Stripe webhook secret が設定されていません。");
      res.status(500).end();
      return;
    }

    const stripe = getStripe(stripeSecretKey.value());
    const sig = req.headers["stripe-signature"];
    const rawBody = req.body;
    if (!rawBody) {
      res.status(400).send("Missing body");
      return;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecretVal);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const uid = session.client_reference_id || session.metadata?.uid;
      const strokes = parseInt(session.metadata?.strokes || "0", 10);
      if (!uid || strokes <= 0) {
        console.error("Invalid session: missing uid or strokes", { uid, strokes });
        res.status(200).end();
        return;
      }

      const userRef = db.collection("users").doc(uid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const current = (snap.exists && snap.data().strokeAsset) || 500;
        tx.set(userRef, { strokeAsset: current + strokes, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    }

    res.status(200).end();
  }
);

exports.stripeWebhook = onRequest(
  { region: "asia-northeast1", secrets: [stripeSecretKey, stripeWebhookSecret] },
  stripeWebhookApp
);
