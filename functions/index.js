const { onCall, HttpsError, onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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

function safeLog(v) {
  return Math.log(Math.max(1, v));
}

function calcPrice({ base, usageCount, recentUsage, holderCount }) {
  const usageFactor = Math.max(1, safeLog(usageCount + 1));
  const trend = Math.max(0, recentUsage / 100);
  const holdersAdjust = Math.max(1, safeLog(holderCount + 2));
  const raw = base * usageFactor * (1 + trend) / holdersAdjust;
  return Math.max(1, Math.floor(raw));
}

async function recomputePriceTx(tx, charRef) {
  const snap = await tx.get(charRef);
  if (!snap.exists) return null;
  const data = snap.data();
  const base = data.base || data.strokeCount || 1;
  const usageCount = data.usageCount || 0;
  const recentUsage = data.recentUsage || 0;
  const holderCount = data.holderCount || 0;
  const price = calcPrice({ base, usageCount, recentUsage, holderCount });
  tx.set(charRef, { price, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ...data, price };
}

exports.applyPostUsage = onCall({ region: "asia-northeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const chars = Array.isArray(request.data?.chars) ? request.data.chars : [];
  if (chars.length === 0) return { ok: true };
  const validChars = chars.filter((c) => typeof c === "string" && /^[\u4E00-\u9FFF]$/.test(c));
  if (validChars.length === 0) return { ok: true };

  await db.runTransaction(async (tx) => {
    for (const char of validChars) {
      const ref = db.collection("kanjiStats").doc(char);
      const snap = await tx.get(ref);
      const prev = snap.exists ? snap.data() : {};
      const strokeCount = typeof prev.strokeCount === "number" ? prev.strokeCount : 1;
      const usageCount = (prev.usageCount || 0) + 1;
      const recentUsage = (prev.recentUsage || 0) + 1;
      const holderCount = prev.holderCount || 0;
      const base = prev.base || strokeCount;
      const price = calcPrice({ base, usageCount, recentUsage, holderCount });
      tx.set(ref, {
        char,
        strokeCount,
        base,
        usageCount,
        recentUsage,
        holderCount,
        price,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  return { ok: true };
});

exports.tradeKanji = onCall({ region: "asia-northeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const uid = request.auth.uid;
  const action = request.data?.action;
  const char = request.data?.char;
  const quantity = Number(request.data?.quantity);
  if (!["buy", "sell"].includes(action)) throw new HttpsError("invalid-argument", "action が不正です。");
  if (typeof char !== "string" || !/^[\u4E00-\u9FFF]$/.test(char)) {
    throw new HttpsError("invalid-argument", "char が不正です。");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) throw new HttpsError("invalid-argument", "quantity が不正です。");

  const result = await db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(uid);
    const holdingRef = userRef.collection("holdings").doc(char);
    const statRef = db.collection("kanjiStats").doc(char);

    const [userSnap, holdingSnap, statSnap] = await Promise.all([tx.get(userRef), tx.get(holdingRef), tx.get(statRef)]);
    const userData = userSnap.exists ? userSnap.data() : {};
    const holdingData = holdingSnap.exists ? holdingSnap.data() : {};
    const statData = statSnap.exists ? statSnap.data() : {};

    const strokeCount = statData.strokeCount || 1;
    const usageCount = statData.usageCount || 0;
    const recentUsage = statData.recentUsage || 0;
    let holderCount = statData.holderCount || 0;
    const base = statData.base || strokeCount;
    const currentPrice = statData.price || calcPrice({ base, usageCount, recentUsage, holderCount });
    const currentAsset = typeof userData.strokeAsset === "number" ? userData.strokeAsset : 500;
    const currentHolding = typeof holdingData.quantity === "number" ? holdingData.quantity : 0;

    let nextAsset = currentAsset;
    let nextHolding = currentHolding;
    if (action === "buy") {
      const cost = currentPrice * quantity;
      if (nextAsset < cost) throw new HttpsError("failed-precondition", "画数資産が不足しています。");
      nextAsset -= cost;
      nextHolding += quantity;
      if (currentHolding === 0 && nextHolding > 0) holderCount += 1;
    } else {
      if (currentHolding < quantity) throw new HttpsError("failed-precondition", "保有数が不足しています。");
      const gain = Math.floor(currentPrice * quantity * 0.98);
      nextAsset += gain;
      nextHolding -= quantity;
      if (currentHolding > 0 && nextHolding === 0) holderCount = Math.max(0, holderCount - 1);
    }

    tx.set(userRef, { strokeAsset: nextAsset, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(holdingRef, { quantity: nextHolding, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    tx.set(statRef, {
      char,
      strokeCount,
      base,
      usageCount,
      recentUsage,
      holderCount
    }, { merge: true });

    const nextPrice = calcPrice({ base, usageCount, recentUsage, holderCount });
    tx.set(statRef, { price: nextPrice, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return {
      strokeAsset: nextAsset,
      holdingQty: nextHolding,
      kanjiStats: {
        char,
        strokeCount,
        usageCount,
        recentUsage,
        holderCount,
        price: nextPrice
      }
    };
  });

  return result;
});

exports.recordPostView = onCall({ region: "asia-northeast1" }, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
  const uid = request.auth.uid;
  const postId = request.data?.postId;
  const dwellMs = Number(request.data?.dwellMs || 0);
  const chars = Array.isArray(request.data?.chars) ? request.data.chars : [];
  if (!postId || dwellMs < 3000) return { counted: false };

  const safeChars = chars.filter((c) => typeof c === "string" && /^[\u4E00-\u9FFF]$/.test(c));
  if (safeChars.length === 0) return { counted: false };

  const viewRef = db.collection("users").doc(uid).collection("viewUsage").doc(postId);
  const now = Date.now();
  const cooldownMs = 30 * 60 * 1000;

  const counted = await db.runTransaction(async (tx) => {
    const viewSnap = await tx.get(viewRef);
    const lastCountedAt = viewSnap.exists ? (viewSnap.data().lastCountedAt || 0) : 0;
    if (now - lastCountedAt < cooldownMs) return false;
    tx.set(viewRef, { lastCountedAt: now, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    for (const char of safeChars) {
      const ref = db.collection("kanjiStats").doc(char);
      const snap = await tx.get(ref);
      const prev = snap.exists ? snap.data() : {};
      const strokeCount = prev.strokeCount || 1;
      const base = prev.base || strokeCount;
      const usageCount = (prev.usageCount || 0) + 1;
      const recentUsage = (prev.recentUsage || 0) + 1;
      const holderCount = prev.holderCount || 0;
      const price = calcPrice({ base, usageCount, recentUsage, holderCount });
      tx.set(ref, { char, strokeCount, base, usageCount, recentUsage, holderCount, price }, { merge: true });
    }
    return true;
  });

  return { counted };
});

exports.decayKanjiTrends = onSchedule(
  { region: "asia-northeast1", schedule: "every 30 minutes" },
  async () => {
    const snap = await db.collection("kanjiStats").get();
    const batch = db.batch();
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const decayedRecent = Math.max(0, Math.floor((data.recentUsage || 0) * 0.9));
      const nextPrice = calcPrice({
        base: data.base || data.strokeCount || 1,
        usageCount: data.usageCount || 0,
        recentUsage: decayedRecent,
        holderCount: data.holderCount || 0
      });
      batch.set(docSnap.ref, {
        recentUsage: decayedRecent,
        price: nextPrice,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
    await batch.commit();
  }
);

exports.createCheckoutSession = onCall(
  { region: "asia-northeast1", secrets: [stripeSecretKey] },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
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
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "jpy",
          unit_amount: priceYen,
          product_data: {
            name: `画数資産 ${strokes.toLocaleString()} ポイント`,
            description: "五言絶句SNSで使用する画数資産です。"
          }
        }
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      metadata: { strokes: String(strokes), uid }
    });
    return { url: session.url };
  }
);

const stripeWebhookApp = express();
stripeWebhookApp.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const webhookSecretVal = stripeWebhookSecret.value();
  if (!webhookSecretVal) {
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
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const uid = session.client_reference_id || session.metadata?.uid;
    const strokes = parseInt(session.metadata?.strokes || "0", 10);
    if (uid && strokes > 0) {
      const userRef = db.collection("users").doc(uid);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        const current = (snap.exists && snap.data().strokeAsset) || 500;
        tx.set(userRef, { strokeAsset: current + strokes, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      });
    }
  }
  res.status(200).end();
});

exports.stripeWebhook = onRequest(
  { region: "asia-northeast1", secrets: [stripeSecretKey, stripeWebhookSecret] },
  stripeWebhookApp
);
