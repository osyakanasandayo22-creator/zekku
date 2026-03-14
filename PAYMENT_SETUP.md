# 決済（Stripe）セットアップ手順

実際の決済を行うために、以下の設定を行ってください。

## 1. Stripe アカウント

1. [Stripe](https://stripe.com/jp) でアカウントを作成
2. ダッシュボードで **API キー** を取得
   - テスト時: **テストモード**の「シークレットキー」（`sk_test_...`）
   - 本番時: 「公開可能キー」（`pk_live_...`）と「シークレットキー」（`sk_live_...`）

## 2. Firebase Cloud Functions の環境変数

Blaze プラン（従量課金）が必要です。

```bash
cd functions
npm install
```

環境変数（シークレット）を設定します。

```bash
# Stripe シークレットキー（必須）
firebase functions:secrets:set STRIPE_SECRET_KEY
# プロンプトで sk_test_... または sk_live_... を入力

# Stripe Webhook シークレット（Webhook 設定後に取得）
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
# プロンプトで whsec_... を入力
```

または Firebase Console の **プロジェクトの設定 > 環境設定** で設定しても構いません。

## 3. Cloud Functions のデプロイ

```bash
# プロジェクトルートで
firebase deploy --only functions
```

デプロイ後、次の URL が発行されます。

- **createCheckoutSession**: `https://asia-northeast1-zekku-5ed59.cloudfunctions.net/createCheckoutSession`
- **stripeWebhook**: `https://asia-northeast1-zekku-5ed59.cloudfunctions.net/stripeWebhook`

## 4. Stripe Webhook の設定

1. [Stripe ダッシュボード](https://dashboard.stripe.com/webhooks) > **Webhook を追加**
2. **エンドポイント URL**: 上記 `stripeWebhook` の URL を指定
3. **リッスンするイベント**: `checkout.session.completed` を選択
4. 作成後、**署名シークレット**（`whsec_...`）をコピーし、上記のとおり `STRIPE_WEBHOOK_SECRET` に設定
5. シークレットを設定したら `firebase deploy --only functions` を再実行

## 5. Firestore セキュリティルール（推奨）

Firebase Console > Firestore > ルール で、`users` コレクションを認証ユーザーが自分のドキュメントのみ読み書きできるようにします。

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /matches/{matchId} {
      // 既存の matches ルールがあればそのまま
      allow read, write: if request.auth != null;
    }
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 6. 動作確認（テストモード）

1. アプリでログインし、ホームの「課金」から課金画面へ
2. いずれかのパッケージの「購入」をクリック → Stripe Checkout に遷移
3. [Stripe のテストカード](https://stripe.com/docs/testing)（例: カード番号 `4242 4242 4242 4242`）で支払い
4. 完了後、アプリに戻り「決済が完了しました」と表示され、画数資産が増えていれば成功

## 本番運用時

- Stripe の **本番モード** に切り替え、本番用の API キーと Webhook シークレットを環境変数に設定
- Stripe ダッシュボードで Webhook の本番 URL を登録（同じ `stripeWebhook` の URL で本番イベントを送信）
- 必要に応じて Firestore の `users` ドキュメントをバックアップ・監視
