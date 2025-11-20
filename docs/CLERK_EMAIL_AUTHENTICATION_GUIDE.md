# Clerk メール認証・カスタムドメイン送信 実装ガイド

**プロジェクト**: Video Analyzer V2 Web
**カスタムドメイン**: video-handoff.com
**作成日**: 2025年11月8日
**バージョン**: 1.0

---

## 📋 目次

1. [概要](#概要)
2. [前提条件](#前提条件)
3. [実装手順（ステップバイステップ）](#実装手順ステップバイステップ)
4. [メールテンプレートのカスタマイズ](#メールテンプレートのカスタマイズ)
5. [設定確認チェックリスト](#設定確認チェックリスト)
6. [トラブルシューティング](#トラブルシューティング)
7. [予想される作業時間](#予想される作業時間)

---

## 概要

### 実装内容
本ガイドでは、Clerk認証システムに以下の機能を実装します：

- ✅ **メール認証の有効化**: OTP（ワンタイムパスワード）またはマジックリンク
- ✅ **カスタムドメインからのメール送信**: `noreply@video-handoff.com`
- ✅ **メールテンプレートのカスタマイズ**: Clerkブランディング削除、Video Analyzer V2ブランディング適用
- ✅ **Reply-To設定**: `support@video-handoff.com`（オプション）

### 重要な注意事項

#### ⚠️ Pro プラン必須
**カスタムメールテンプレート**と**Clerkブランディング削除**機能は、**Clerk Pro プラン**（$25/月）が必要です。

**現在のプラン確認方法**:
1. [Clerk Dashboard](https://dashboard.clerk.com/) にログイン
2. 左下の Settings → Billing を確認

**無料プランでできること**:
- ❌ カスタムメールテンプレート（Clerkデフォルトテンプレートのみ）
- ❌ Clerkブランディング削除
- ✅ From Address カスタマイズ（`noreply@video-handoff.com`）
- ✅ Reply-To 設定

**Pro プランでできること**:
- ✅ 完全なメールテンプレートカスタマイズ
- ✅ Clerkブランディング完全削除
- ✅ HTMLメールエディター（WYSIWYG）
- ✅ Handlebars変数使用
- ✅ カスタムロゴ・色・フォント

---

## 前提条件

### 1. DNS設定（完了済み ✅）
video-handoff.com ドメインに以下の5つのCNAMEレコードが設定済み：

- Frontend API
- Account Portal
- メール認証用レコード（SPF, DKIM, DMARC）

**確認方法**:
```bash
# Clerk Dashboard → Domains ページで確認
# ステータスが全て "Verified" になっていることを確認
```

### 2. Clerk本番インスタンス（完了済み ✅）
本番環境のClerkキーが設定済み：

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`

### 3. 必要なアクセス権限
- Clerk Dashboard の管理者権限
- video-handoff.com ドメインの所有者確認済み

---

## 実装手順（ステップバイステップ）

### Phase 1: メール認証の有効化（無料プランで可能）

#### ステップ 1-1: Email認証の設定

1. **Clerk Dashboard にアクセス**
   - URL: https://dashboard.clerk.com/
   - プロジェクト選択: Video Analyzer V2（本番インスタンス）

2. **Email設定ページに移動**
   ```
   左サイドバー → Configure → Email, Phone, Username
   ```

3. **Email Address を有効化**
   - "Email address" セクションを探す
   - トグルスイッチを **ON** にする

4. **認証方法の選択**

   **オプション A: Verification Code（推奨）**
   - ✅ メリット: 配信率が高い（スパムフィルター回避）、シンプル
   - ❌ デメリット: ユーザーがコードをコピー&ペースト必要
   - 設定: "Email verification strategy" → **Email verification code** を選択

   **オプション B: Verification Link（マジックリンク）**
   - ✅ メリット: ワンクリックで認証完了
   - ❌ デメリット: スパムフィルターに引っかかりやすい（特にOutlook/Gmail）
   - 設定: "Email verification strategy" → **Email verification link** を選択

   **推奨設定**: **Email verification code**（Clerkドキュメントでも推奨）

5. **変更を保存**
   - ページ右上の **Save changes** ボタンをクリック

#### ステップ 1-2: From Address のカスタマイズ

1. **Emails設定ページに移動**
   ```
   左サイドバー → Customization → Emails
   ```

2. **テンプレート選択**
   - "Email verification code" テンプレートをクリック

3. **From Address 設定**
   - **Settings** タブをクリック
   - "From email address" セクションを探す
   - **Local part** フィールドに `noreply` を入力
   - プレビュー: `noreply@video-handoff.com` と表示されることを確認

4. **Reply-To Address 設定（オプション）**
   - "Reply-to email address" フィールドに `support@video-handoff.com` を入力
   - ※ 注意: このアドレスのメールボックスを実際に作成する必要があります

5. **Subject Line のカスタマイズ**
   - "Subject" フィールドを編集
   - 例: `Video Analyzer V2 - メールアドレスの確認`（日本語可）

6. **変更を保存**
   - ページ右上の **Save** ボタンをクリック

7. **他のテンプレートにも同様の設定を適用**
   - "Magic link" テンプレート（使用する場合）
   - "Invitation" テンプレート（招待機能を使う場合）

#### ステップ 1-3: テスト送信

1. **開発環境でテスト**
   ```bash
   cd /Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web
   npm run dev
   ```

2. **新規ユーザー登録フローをテスト**
   - http://localhost:3000 にアクセス
   - Sign Up をクリック
   - テスト用メールアドレスを入力（自分のGmail等）
   - 送信されたメールを確認

3. **メールの確認ポイント**
   - ✅ From: `noreply@video-handoff.com`
   - ✅ Subject: カスタマイズした件名
   - ⚠️ 内容: Clerkデフォルトテンプレート（Pro プランなしの場合）

---

### Phase 2: メールテンプレートのカスタマイズ（Pro プラン必須）

#### ⚠️ 前提条件: Clerk Pro プランへのアップグレード

**アップグレード手順**:
1. Clerk Dashboard → Settings → Billing
2. "Upgrade to Pro" ボタンをクリック
3. クレジットカード情報を入力
4. 料金: $25/月 + $0.02/MAU（最初の10,000 MAUまで無料）

#### ステップ 2-1: Email Template Editor にアクセス

1. **Emails設定ページに移動**
   ```
   Clerk Dashboard → Customization → Emails
   ```

2. **カスタマイズするテンプレートを選択**
   - "Email verification code" をクリック

3. **Editor タブをクリック**
   - WYSIWYGエディターが表示される
   - プレビュー（デスクトップ/モバイル）が右側に表示される

#### ステップ 2-2: テンプレートの編集

**編集方法**:
- **ビジュアルモード**: ツールバーで文字装飾、画像挿入、ブロック追加
- **HTMLモード**: ツールバー右上の `</>` アイコンをクリック

**変数の挿入**:
- エディター内の変数ボタン（`{{ }}` アイコン）をクリック
- 利用可能な変数一覧から選択
- 自動的に `{{変数名}}` 形式で挿入される

#### ステップ 2-3: Clerkブランディングの削除

**削除対象**:
- Clerkロゴ
- "Secured by Clerk" テキスト
- Clerkへのリンク
- Clerkの色・フォント設定

**手順**:
1. ヘッダーブロックの Clerkロゴ を選択 → 削除
2. フッターブロックの "Secured by Clerk" テキスト → 削除
3. Video Analyzer V2 のロゴを挿入（後述）

#### ステップ 2-4: カスタムブランディングの追加

**ロゴの追加**:
1. 画像ブロックを挿入
2. ロゴ画像をアップロード（推奨サイズ: 200px × 50px、PNG形式）
3. 代替テキスト: "Video Analyzer V2"

**色の変更**:
1. ボタンブロックを選択
2. スタイル設定 → 背景色を変更（例: #3B82F6 - プライマリーブルー）
3. テキスト色を変更（例: #FFFFFF）

**フォントの変更**:
- テキストブロックを選択 → フォントファミリーを変更
- 推奨: `"Helvetica Neue", Helvetica, Arial, sans-serif`

#### ステップ 2-5: 変更の保存とテスト

1. **プレビュー確認**
   - 右側のプレビューでデスクトップ/モバイル表示を確認
   - "Send test email" ボタンで実際のメールを送信テスト

2. **変更を保存**
   - **Save** ボタンをクリック

3. **本番環境でテスト**
   - 実際の本番環境（https://video-handoff.com）でユーザー登録
   - 送信されたメールがカスタマイズされているか確認

---

## メールテンプレートのカスタマイズ

### テンプレート1: Email Verification Code（メール確認コード）

**用途**: 新規ユーザー登録時のメールアドレス確認

**利用可能な変数**:
- `{{app.name}}` - アプリケーション名（"Video Analyzer V2"）
- `{{verification_code}}` - 6桁の確認コード
- `{{user.email_address}}` - ユーザーのメールアドレス
- `{{app.logo}}` - アプリケーションロゴURL

**カスタマイズ例（HTMLモード）**:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>メールアドレスの確認</title>
  <style>
    body {
      font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      background-color: #f4f4f4;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .header {
      background-color: #3B82F6;
      padding: 30px 20px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 40px 30px;
    }
    .verification-code {
      background-color: #f0f9ff;
      border: 2px solid #3B82F6;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin: 30px 0;
    }
    .verification-code h2 {
      font-size: 36px;
      margin: 0;
      color: #3B82F6;
      letter-spacing: 8px;
      font-family: "Courier New", monospace;
    }
    .footer {
      background-color: #f9fafb;
      padding: 20px 30px;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background-color: #3B82F6;
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Video Analyzer V2</h1>
    </div>

    <div class="content">
      <p>こんにちは、</p>

      <p>Video Analyzer V2 へのご登録ありがとうございます。</p>

      <p>メールアドレス <strong>{{user.email_address}}</strong> の確認を完了するため、以下の確認コードを入力してください。</p>

      <div class="verification-code">
        <h2>{{verification_code}}</h2>
      </div>

      <p><strong>※ このコードは10分間有効です。</strong></p>

      <p>もしこのメールに心当たりがない場合は、このメールを無視してください。</p>

      <p>よろしくお願いいたします。<br>
      Video Analyzer V2 チーム</p>
    </div>

    <div class="footer">
      <p>このメールは <strong>{{user.email_address}}</strong> 宛に送信されました。</p>
      <p>&copy; 2025 Video Analyzer V2. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
```

**Subject（件名）**:
```
Video Analyzer V2 - メールアドレスの確認（確認コード: {{verification_code}}）
```

---

### テンプレート2: Magic Link（マジックリンク）

**用途**: パスワードなしサインイン、メールアドレス確認

**利用可能な変数**:
- `{{app.name}}` - アプリケーション名
- `{{magic_link}}` - ワンクリック認証リンク
- `{{user.email_address}}` - ユーザーのメールアドレス

**カスタマイズ例（HTMLモード）**:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>サインインリンク</title>
  <style>
    /* 上記と同じスタイル */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Video Analyzer V2</h1>
    </div>

    <div class="content">
      <p>こんにちは、</p>

      <p>Video Analyzer V2 にサインインするためのリンクをお送りします。</p>

      <p>下記のボタンをクリックして、サインインを完了してください。</p>

      <div style="text-align: center;">
        <a href="{{magic_link}}" class="button">サインインする</a>
      </div>

      <p style="font-size: 12px; color: #6b7280;">
        ボタンが機能しない場合は、以下のリンクをコピーしてブラウザに貼り付けてください：<br>
        <span style="word-break: break-all;">{{magic_link}}</span>
      </p>

      <p><strong>※ このリンクは10分間有効です。</strong></p>

      <p>もしこのメールに心当たりがない場合は、このメールを無視してください。</p>

      <p>よろしくお願いいたします。<br>
      Video Analyzer V2 チーム</p>
    </div>

    <div class="footer">
      <p>このメールは <strong>{{user.email_address}}</strong> 宛に送信されました。</p>
      <p>&copy; 2025 Video Analyzer V2. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
```

**Subject（件名）**:
```
Video Analyzer V2 - サインインリンク
```

---

### テンプレート3: Invitation（招待メール）

**用途**: 管理者から他のユーザーを招待

**利用可能な変数**:
- `{{app.name}}` - アプリケーション名
- `{{invitation_link}}` - 招待受け入れリンク
- `{{inviter.email_address}}` - 招待者のメールアドレス
- `{{inviter.first_name}}` - 招待者の名前

**カスタマイズ例（HTMLモード）**:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>招待状</title>
  <style>
    /* 上記と同じスタイル */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Video Analyzer V2</h1>
    </div>

    <div class="content">
      <p>こんにちは、</p>

      <p><strong>{{inviter.email_address}}</strong> さんが、あなたを Video Analyzer V2 に招待しました。</p>

      <p>Video Analyzer V2 は、動画ファイルから音声文字起こし（Whisper AI）とOCR（Gemini Vision）を実行し、シーン単位でスクリーンショット・テキストを統合したExcelレポートを生成するウェブアプリケーションです。</p>

      <div style="text-align: center;">
        <a href="{{invitation_link}}" class="button">招待を受け入れる</a>
      </div>

      <p style="font-size: 12px; color: #6b7280;">
        ボタンが機能しない場合は、以下のリンクをコピーしてブラウザに貼り付けてください：<br>
        <span style="word-break: break-all;">{{invitation_link}}</span>
      </p>

      <p><strong>※ この招待リンクは7日間有効です。</strong></p>

      <p>もしこのメールに心当たりがない場合は、このメールを無視してください。</p>

      <p>よろしくお願いいたします。<br>
      Video Analyzer V2 チーム</p>
    </div>

    <div class="footer">
      <p>このメールは <strong>{{user.email_address}}</strong> 宛に送信されました。</p>
      <p>&copy; 2025 Video Analyzer V2. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
```

**Subject（件名）**:
```
{{inviter.first_name}} さんが Video Analyzer V2 に招待しました
```

---

### テンプレート4: Password Reset（パスワードリセット）

**用途**: パスワード再設定（パスワード認証を使用する場合）

**利用可能な変数**:
- `{{app.name}}` - アプリケーション名
- `{{reset_password_link}}` - パスワードリセットリンク
- `{{user.email_address}}` - ユーザーのメールアドレス

**カスタマイズ例（HTMLモード）**:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>パスワードリセット</title>
  <style>
    /* 上記と同じスタイル */
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Video Analyzer V2</h1>
    </div>

    <div class="content">
      <p>こんにちは、</p>

      <p>パスワードのリセットがリクエストされました。</p>

      <p>下記のボタンをクリックして、新しいパスワードを設定してください。</p>

      <div style="text-align: center;">
        <a href="{{reset_password_link}}" class="button">パスワードをリセットする</a>
      </div>

      <p style="font-size: 12px; color: #6b7280;">
        ボタンが機能しない場合は、以下のリンクをコピーしてブラウザに貼り付けてください：<br>
        <span style="word-break: break-all;">{{reset_password_link}}</span>
      </p>

      <p><strong>※ このリンクは1時間有効です。</strong></p>

      <p style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 12px; margin: 20px 0;">
        <strong>⚠️ セキュリティ上の注意</strong><br>
        もしこのリクエストに心当たりがない場合は、すぐに <a href="mailto:support@video-handoff.com">support@video-handoff.com</a> までご連絡ください。
      </p>

      <p>よろしくお願いいたします。<br>
      Video Analyzer V2 チーム</p>
    </div>

    <div class="footer">
      <p>このメールは <strong>{{user.email_address}}</strong> 宛に送信されました。</p>
      <p>&copy; 2025 Video Analyzer V2. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
```

**Subject（件名）**:
```
Video Analyzer V2 - パスワードリセットのご案内
```

---

### Handlebars 変数リファレンス

#### 共通変数（全テンプレートで使用可能）
| 変数名 | 説明 | 例 |
|--------|------|-----|
| `{{app.name}}` | アプリケーション名 | "Video Analyzer V2" |
| `{{app.logo}}` | アプリケーションロゴURL | "https://..." |
| `{{user.email_address}}` | ユーザーのメールアドレス | "user@example.com" |
| `{{user.first_name}}` | ユーザーの名前（設定されている場合） | "太郎" |
| `{{user.last_name}}` | ユーザーの姓（設定されている場合） | "山田" |

#### テンプレート固有変数
| テンプレート | 変数名 | 説明 |
|------------|--------|------|
| Verification Code | `{{verification_code}}` | 6桁の確認コード（例: "123456"） |
| Magic Link | `{{magic_link}}` | ワンクリック認証URL |
| Invitation | `{{invitation_link}}` | 招待受け入れURL |
| Invitation | `{{inviter.email_address}}` | 招待者のメールアドレス |
| Invitation | `{{inviter.first_name}}` | 招待者の名前 |
| Password Reset | `{{reset_password_link}}` | パスワードリセットURL |

#### 特殊文字のエスケープ解除
HTMLエンティティをエスケープせずに表示する場合は、3重ブレースを使用：

```handlebars
{{{app.name}}}  <!-- "Video & Analyzer" → "Video & Analyzer" -->
{{app.name}}    <!-- "Video & Analyzer" → "Video &amp; Analyzer" -->
```

---

## 設定確認チェックリスト

### Phase 1: 基本設定（無料プランでも可能）

- [ ] **DNS設定確認**
  - [ ] Clerk Dashboard → Domains で全5レコードが "Verified" ステータス
  - [ ] Frontend API: `clerk.video-handoff.com`
  - [ ] Account Portal: `accounts.video-handoff.com`
  - [ ] Email レコード: SPF, DKIM, DMARC

- [ ] **Email認証有効化**
  - [ ] Configure → Email, Phone, Username → Email address トグル ON
  - [ ] Email verification strategy 選択済み（Code または Link）

- [ ] **From Address カスタマイズ**
  - [ ] 全テンプレートで From: `noreply@video-handoff.com`
  - [ ] Reply-To: `support@video-handoff.com`（オプション）

- [ ] **Subject Line カスタマイズ**
  - [ ] 日本語件名に変更済み
  - [ ] 全テンプレートで一貫性のある命名

- [ ] **テスト送信成功**
  - [ ] 開発環境でメール受信確認
  - [ ] From アドレス確認
  - [ ] Subject 確認
  - [ ] リンク/コードの動作確認

### Phase 2: テンプレートカスタマイズ（Pro プラン必須）

- [ ] **Clerk Pro プラン アップグレード**
  - [ ] Billing ページでプラン確認
  - [ ] クレジットカード登録済み

- [ ] **テンプレートカスタマイズ完了**
  - [ ] Email verification code テンプレート
  - [ ] Magic link テンプレート（使用する場合）
  - [ ] Invitation テンプレート（使用する場合）
  - [ ] Password reset テンプレート（使用する場合）

- [ ] **Clerkブランディング削除**
  - [ ] Clerkロゴ削除
  - [ ] "Secured by Clerk" テキスト削除
  - [ ] Clerkリンク削除

- [ ] **Video Analyzer V2 ブランディング適用**
  - [ ] カスタムロゴ追加
  - [ ] ブランドカラー適用（#3B82F6）
  - [ ] フォント統一
  - [ ] フッターに著作権表示

- [ ] **変数の動作確認**
  - [ ] `{{verification_code}}` 表示確認
  - [ ] `{{magic_link}}` クリック動作確認
  - [ ] `{{user.email_address}}` 正しく表示

- [ ] **本番環境テスト**
  - [ ] https://video-handoff.com で新規登録
  - [ ] カスタマイズされたメール受信確認
  - [ ] モバイルデバイスで表示確認
  - [ ] 複数メールクライアント（Gmail, Outlook, Apple Mail）で表示確認

### セキュリティ確認

- [ ] **メール認証レコード**
  - [ ] SPF レコード有効（`dig txt video-handoff.com` で確認）
  - [ ] DKIM レコード有効
  - [ ] DMARC ポリシー設定済み（`v=DMARC1; p=reject`）

- [ ] **メールボックス設定**
  - [ ] `noreply@video-handoff.com` 存在確認（受信確認不要）
  - [ ] `support@video-handoff.com` メールボックス作成（Reply-To用）

- [ ] **スパム対策**
  - [ ] Gmail Postmaster Tools 登録（オプション）
  - [ ] Microsoft Sender Support 登録（オプション）

---

## トラブルシューティング

### 問題1: メールが届かない

**症状**: ユーザーがメールを受信できない

**原因と対処法**:

#### 原因A: DNS設定が反映されていない
```bash
# DNS設定確認
dig txt video-handoff.com
dig cname clerk.video-handoff.com

# 対処法
- Clerk Dashboard → Domains で "Validate configuration" をクリック
- DNS変更後、最大48時間待つ
- DNSキャッシュをクリア（CloudflareやRoute53の場合）
```

#### 原因B: スパムフォルダに入っている
```
# 対処法
1. 受信トレイの検索で "Video Analyzer" または "video-handoff.com" を検索
2. 迷惑メールフォルダを確認
3. noreply@video-handoff.com を連絡先に追加
4. Verification Link の代わりに Verification Code を使用（推奨）
```

#### 原因C: DMARC ポリシーが厳しすぎる
```bash
# DMARC確認
dig txt _dmarc.video-handoff.com

# 対処法（厳しすぎる場合）
- p=reject → p=quarantine に変更（一時的）
- Clerk Dashboard で DMARC レコードを再生成
```

#### 原因D: Clerk側の送信エラー
```
# 確認方法
1. Clerk Dashboard → Logs ページ
2. "Email sent" イベントを検索
3. エラーメッセージを確認

# 対処法
- Clerkサポートに問い合わせ（support@clerk.com）
- 送信レート制限に達していないか確認（Pro プランでは制限緩和）
```

---

### 問題2: カスタムテンプレートが表示されない

**症状**: 無料プランでテンプレートカスタマイズができない

**原因**: カスタムメールテンプレートは Pro プラン限定機能

**対処法**:
```
1. Clerk Dashboard → Settings → Billing
2. "Upgrade to Pro" をクリック
3. プラン変更後、ページをリロード
4. Customization → Emails で "Editor" タブが表示されるか確認
```

---

### 問題3: 変数が正しく表示されない

**症状**: `{{verification_code}}` がそのまま表示される

**原因と対処法**:

#### 原因A: ブレースの数が間違っている
```handlebars
<!-- 間違い -->
{verification_code}
{{{verification_code}}}

<!-- 正しい -->
{{verification_code}}
```

#### 原因B: 変数名のタイポ
```handlebars
<!-- 間違い -->
{{verify_code}}
{{verificationCode}}

<!-- 正しい -->
{{verification_code}}
```

#### 原因C: テンプレートタイプが間違っている
```
# 確認方法
- 各変数は特定のテンプレートでのみ使用可能
- 例: {{magic_link}} は Magic Link テンプレートでのみ有効

# 対処法
- テンプレートタイプを確認
- 利用可能な変数リストを参照（本ガイドの「Handlebars 変数リファレンス」セクション）
```

---

### 問題4: Gmailで画像が表示されない

**症状**: Gmailで開くとロゴ画像が表示されない

**原因**: Gmailの画像プロキシ設定

**対処法**:
```html
<!-- 画像タグに width/height を明示 -->
<img src="{{app.logo}}"
     alt="Video Analyzer V2"
     width="200"
     height="50"
     style="display: block; max-width: 200px;">

<!-- または外部ホスティングURLを使用 -->
<img src="https://your-cdn.com/logo.png"
     alt="Video Analyzer V2"
     width="200"
     height="50">
```

---

### 問題5: モバイルで表示が崩れる

**症状**: スマートフォンでメールを開くとレイアウトが崩れる

**対処法**:
```html
<!-- レスポンシブ対応のメタタグ -->
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<!-- メディアクエリで調整 -->
<style>
  @media only screen and (max-width: 600px) {
    .container {
      width: 100% !important;
      padding: 0 10px !important;
    }
    .verification-code h2 {
      font-size: 28px !important;
      letter-spacing: 4px !important;
    }
  }
</style>

<!-- テーブルベースレイアウト（推奨） -->
<table width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td>コンテンツ</td>
  </tr>
</table>
```

---

### 問題6: Outlookで背景色が表示されない

**症状**: Outlook（Office365）で背景色が無視される

**原因**: OutlookのWord HTMLレンダリングエンジンの制限

**対処法**:
```html
<!-- VML（Vector Markup Language）を使用 -->
<!--[if mso]>
<v:rect xmlns:v="urn:schemas-microsoft-com:vml"
        fill="true"
        stroke="false"
        style="width:600px;height:400px;">
  <v:fill type="tile" color="#3B82F6" />
  <v:textbox inset="0,0,0,0">
<![endif]-->
<div style="background-color: #3B82F6;">
  コンテンツ
</div>
<!--[if mso]>
  </v:textbox>
</v:rect>
<![endif]-->
```

---

### 問題7: Reply-Toが機能しない

**症状**: ユーザーが返信しても `support@video-handoff.com` に届かない

**原因**: Reply-Toアドレスのメールボックスが存在しない

**対処法**:
```bash
# メールボックス作成確認
# 1. ドメインのメールホスティングサービスにログイン（例: Google Workspace, Office365）
# 2. support@video-handoff.com のメールボックスを作成
# 3. 転送設定を確認

# テスト送信
echo "Test reply-to" | mail -s "Test" -r "noreply@video-handoff.com" -S replyto="support@video-handoff.com" your-email@example.com
```

---

### 問題8: テンプレートが元に戻せない

**症状**: カスタマイズ後、元のClerkデフォルトテンプレートに戻したい

**対処法**:
```
1. Clerk Dashboard → Customization → Emails
2. 対象テンプレートをクリック
3. ページ上部の "Revert to default" ボタンをクリック
4. 確認ダイアログで "Revert" をクリック

⚠️ 注意: すべてのカスタマイズが失われます（事前にHTMLをコピー保存推奨）
```

---

### 問題9: 日本語が文字化けする

**症状**: メール本文の日本語が `????` や `ã` と表示される

**原因**: 文字エンコーディング設定の欠如

**対処法**:
```html
<!-- HTMLヘッダーに必ず追加 -->
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
</head>

<!-- Clerk Dashboard → Email Settings で確認 -->
- "Character encoding" が "UTF-8" に設定されているか確認
```

---

### 問題10: 配信率が低い（50%以下）

**症状**: 送信したメールの半分以上が届いていない

**原因と対処法**:

#### 1. DMARC/SPF/DKIM 設定確認
```bash
# SPF確認
dig txt video-handoff.com | grep spf

# DKIM確認
dig txt default._domainkey.video-handoff.com

# DMARC確認
dig txt _dmarc.video-handoff.com
```

#### 2. Gmail Postmaster Tools 登録
```
1. https://postmaster.google.com/ にアクセス
2. video-handoff.com ドメインを追加
3. 配信エラー率、スパム率、評判スコアを確認
```

#### 3. Microsoft Sender Support 登録
```
1. https://sendersupport.olc.protection.outlook.com/snds/ にアクセス
2. ドメインのIP評価を確認
3. 問題があればサポートに連絡
```

#### 4. Verification Link → Verification Code に変更
```
# Clerkドキュメントでも推奨
Clerk Dashboard → Configure → Email, Phone, Username
→ Email verification strategy を "Email verification code" に変更
```

---

## 予想される作業時間

### Phase 1: 基本設定（無料プランでも可能）

| タスク | 所要時間 | スキルレベル |
|--------|---------|------------|
| DNS設定確認 | 5分 | 初級 |
| Email認証有効化 | 10分 | 初級 |
| From Address/Reply-To 設定 | 15分 | 初級 |
| Subject Line カスタマイズ | 10分 | 初級 |
| テスト送信・確認 | 20分 | 初級 |
| **Phase 1 合計** | **約1時間** | - |

### Phase 2: テンプレートカスタマイズ（Pro プラン必須）

| タスク | 所要時間 | スキルレベル |
|--------|---------|------------|
| Pro プラン アップグレード | 10分 | 初級 |
| テンプレートエディター習熟 | 30分 | 中級 |
| Verification Code テンプレート作成 | 1時間 | 中級 |
| Magic Link テンプレート作成 | 45分 | 中級 |
| Invitation テンプレート作成 | 45分 | 中級 |
| Password Reset テンプレート作成 | 45分 | 中級 |
| Clerkブランディング削除 | 30分 | 初級 |
| Video Analyzer V2 ブランディング適用 | 1時間 | 中級 |
| 変数テスト・デバッグ | 1時間 | 中級 |
| マルチクライアントテスト（Gmail/Outlook/Apple Mail） | 1.5時間 | 中級 |
| モバイル最適化 | 1時間 | 上級 |
| **Phase 2 合計** | **約8-9時間** | - |

### 全体（Phase 1 + Phase 2）

| 項目 | 時間 |
|------|------|
| 実装作業 | 9-10時間 |
| DNS伝播待ち時間 | 0-48時間（バックグラウンド） |
| テスト・デバッグ | 2-3時間 |
| ドキュメント作成 | 1-2時間 |
| **総作業時間** | **12-15時間** |

### スキルレベル別の推奨スケジュール

#### 初級者（HTML/CSSの基礎知識あり）
- **Day 1**: Phase 1（基本設定） - 2時間
- **Day 2**: Pro プランアップグレード、エディター習熟 - 1時間
- **Day 3-4**: Verification Code テンプレート作成・テスト - 3時間
- **Day 5-6**: 残りのテンプレート作成 - 4時間
- **Day 7**: ブランディング適用・最終テスト - 3時間
- **合計**: 約13時間（1週間）

#### 中級者（HTML/CSS/Email Template経験あり）
- **Day 1**: Phase 1 + Pro アップグレード - 1.5時間
- **Day 2**: 全テンプレート作成 - 4時間
- **Day 3**: ブランディング適用・テスト・デバッグ - 3時間
- **合計**: 約8.5時間（3日間）

#### 上級者（Handlebars/Email開発経験豊富）
- **Day 1**: Phase 1 + 全テンプレート作成 - 4時間
- **Day 2**: ブランディング適用・マルチクライアントテスト - 3時間
- **合計**: 約7時間（2日間）

---

## 付録A: 利用可能な全変数リスト（推定）

以下は、Clerkドキュメントおよび一般的な認証システムから推定される利用可能な変数です。実際の利用可能な変数は、Clerk Dashboard のテンプレートエディター内の「変数挿入」ボタンから確認してください。

### ユーザー情報
- `{{user.id}}` - ユーザーID
- `{{user.email_address}}` - メールアドレス
- `{{user.first_name}}` - 名
- `{{user.last_name}}` - 姓
- `{{user.full_name}}` - フルネーム
- `{{user.username}}` - ユーザー名
- `{{user.phone_number}}` - 電話番号
- `{{user.profile_image_url}}` - プロフィール画像URL

### アプリケーション情報
- `{{app.name}}` - アプリ名
- `{{app.logo}}` - ロゴURL
- `{{app.url}}` - アプリURL
- `{{app.support_email}}` - サポートメールアドレス

### 認証情報
- `{{verification_code}}` - 確認コード（6桁）
- `{{magic_link}}` - マジックリンク
- `{{invitation_link}}` - 招待リンク
- `{{reset_password_link}}` - パスワードリセットリンク
- `{{verification_link}}` - 確認リンク

### 招待者情報（Invitationテンプレート）
- `{{inviter.email_address}}` - 招待者メール
- `{{inviter.first_name}}` - 招待者名
- `{{inviter.last_name}}` - 招待者姓
- `{{inviter.full_name}}` - 招待者フルネーム

### メタデータ
- `{{public_metadata.*}}` - パブリックメタデータ（カスタムフィールド）
- `{{unsafe_metadata.*}}` - アンセーフメタデータ

---

## 付録B: Email Deliverability Best Practices

### 1. SPF（Sender Policy Framework）
- **目的**: 送信元IPアドレスの認証
- **推奨設定**: Clerkが自動生成（変更不要）
- **確認方法**: `dig txt video-handoff.com`

### 2. DKIM（DomainKeys Identified Mail）
- **目的**: メール内容の改ざん検知
- **推奨設定**: Clerkが自動生成（変更不要）
- **確認方法**: `dig txt default._domainkey.video-handoff.com`

### 3. DMARC（Domain-based Message Authentication, Reporting & Conformance）
- **目的**: SPF/DKIM失敗時のポリシー設定
- **推奨設定**:
  ```
  v=DMARC1; p=quarantine; pct=100; rua=mailto:support@video-handoff.com; ruf=mailto:support@video-handoff.com;
  ```
- **ポリシー説明**:
  - `p=none` - 何もしない（モニタリングのみ）
  - `p=quarantine` - 迷惑メールフォルダに振り分け（推奨）
  - `p=reject` - 受信拒否（最も厳しい）

### 4. 送信元アドレスの選択
- **推奨**: `noreply@video-handoff.com`
- **避けるべき**: `no-reply@`, `donotreply@` → スパムフィルターに引っかかりやすい
- **メールボックス作成**: 必須ではないが、バウンスメール受信のため推奨

### 5. Verification Code vs Link
- **推奨**: Verification Code（OTP）
- **理由**:
  - スパムフィルター回避率が高い
  - Gmail/Outlookで高い配信率
  - フィッシング対策として安全

### 6. Subject Lineのベストプラクティス
- **避けるべき単語**: "無料", "今すぐ", "クリック", "緊急"
- **推奨**: 具体的で明確な件名
- **例（良い）**: "Video Analyzer V2 - メールアドレスの確認"
- **例（悪い）**: "今すぐ確認してください！"

### 7. コンテンツのベストプラクティス
- **テキスト版も用意**: HTMLのみは避ける（Clerkは自動生成）
- **画像とテキストのバランス**: 画像のみは避ける
- **リンクの数**: 1-3個に抑える
- **短縮URL**: 避ける（bit.ly等）

### 8. 送信頻度の管理
- **レート制限**: 突然大量送信しない
- **ウォームアップ**: 新しいドメインは段階的に送信量を増やす
- **Clerkの場合**: 自動管理されるため特別な対応不要

### 9. バウンス・苦情の管理
- **ハードバウンス**: 存在しないアドレスは即座に削除
- **ソフトバウンス**: 一時的なエラー（リトライ）
- **苦情率**: 0.1%未満を維持（Clerkが自動管理）

### 10. モニタリング
- **Gmail Postmaster Tools**: https://postmaster.google.com/
- **Microsoft SNDS**: https://sendersupport.olc.protection.outlook.com/snds/
- **Clerk Logs**: Dashboard → Logs → Email sent イベント

---

## 付録C: 参考リンク

### Clerk 公式ドキュメント
- [Email and SMS Templates](https://clerk.com/docs/guides/customizing-clerk/email-sms-templates)
- [Email Deliverability](https://clerk.com/docs/troubleshooting/email-deliverability)
- [Production Checklist](https://clerk.com/docs/deployments/overview)
- [Custom Domains](https://clerk.com/docs/deployments/domains)

### Email開発リソース
- [Can I Email](https://www.caniemail.com/) - メールクライアント互換性チェック
- [Litmus](https://www.litmus.com/) - メールテストツール
- [Email on Acid](https://www.emailonacid.com/) - メールテストツール
- [MJML](https://mjml.io/) - レスポンシブメールフレームワーク

### SPF/DKIM/DMARC ツール
- [MXToolbox](https://mxtoolbox.com/) - DNS/Email診断
- [DMARC Analyzer](https://www.dmarcanalyzer.com/) - DMARC レポート分析
- [Mail Tester](https://www.mail-tester.com/) - スパムスコアチェック

---

## サポート

### Clerk サポート
- **Email**: support@clerk.com
- **ドキュメント**: https://clerk.com/docs
- **コミュニティ**: https://clerk.com/discord

### プロジェクト内サポート
- **プロジェクトドキュメント**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web/CLAUDE.md`
- **システムアーキテクチャ**: `/Users/fukushimashouhei/dev1/projects/video-analyzer-V2-web/SYSTEM_ARCHITECTURE_2025-11-04.md`

---

**ドキュメントバージョン**: 1.0
**最終更新**: 2025年11月8日
**作成者**: Claude Code (Anthropic)
**レビュー**: 未実施
