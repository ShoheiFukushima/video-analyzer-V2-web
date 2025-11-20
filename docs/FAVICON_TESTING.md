# ファビコン確認手順

## 1. ローカル開発環境での確認

### 開発サーバー起動
```bash
npm run dev
```

### ブラウザで確認
1. http://localhost:3000 にアクセス
2. ブラウザのタブを確認（アイコンが表示されているか）
3. 以下のURLに直接アクセスして確認：
   - http://localhost:3000/favicon.svg
   - http://localhost:3000/favicon.ico
   - http://localhost:3000/favicon-32x32.png
   - http://localhost:3000/apple-touch-icon.png

### 強制リロード（キャッシュクリア）
ファビコンが表示されない場合：
- **Chrome/Edge**: Ctrl+Shift+R (Windows) / Cmd+Shift+R (Mac)
- **Firefox**: Ctrl+F5 (Windows) / Cmd+Shift+R (Mac)
- **Safari**: Cmd+Option+E → Cmd+R

### ブラウザキャッシュクリア
1. Chrome: 設定 → プライバシーとセキュリティ → 閲覧履歴データの削除
2. Firefox: 設定 → プライバシーとセキュリティ → データを消去
3. Safari: 開発 → キャッシュを空にする

## 2. Vercel本番環境での確認

### デプロイ後の確認手順
```bash
# デプロイ
vercel --prod

# デプロイ完了後、本番URLにアクセス
# 例: https://video-analyzer-v2.vercel.app
```

### 確認項目
- [ ] ブラウザタブにファビコンが表示される
- [ ] ブックマーク追加時にファビコンが表示される
- [ ] モバイルブラウザでも表示される
- [ ] Apple Touch Iconが表示される（iOS Safari）

## 3. 各デバイスでの確認

### デスクトップ
- **Chrome**: タブ、ブックマークバー
- **Firefox**: タブ、ブックマークバー
- **Safari**: タブ、ブックマークバー
- **Edge**: タブ、ブックマークバー

### モバイル
- **iOS Safari**: タブ、ホーム画面に追加
- **Android Chrome**: タブ、ホーム画面に追加

## 4. デベロッパーツールでの確認

### Chromeデベロッパーツール
```bash
# 1. F12でデベロッパーツールを開く
# 2. Applicationタブ → Manifest
# 3. Icons項目を確認
```

### ネットワークタブで確認
```bash
# 1. F12 → Networkタブ
# 2. ページをリロード
# 3. "favicon" で検索
# 4. ステータスコード 200 OK を確認
```

## 5. オンラインツールでの確認

### RealFaviconGenerator
https://realfavicongenerator.net/favicon_checker

1. サイトにアクセス
2. URLを入力: https://video-analyzer-v2.vercel.app
3. "Check my favicon"をクリック
4. 結果を確認

### Google Lighthouse
```bash
# Chrome DevTools → Lighthouse
# PWA カテゴリーで "Provides a valid apple-touch-icon" を確認
```

## 6. トラブルシューティング

### ファビコンが表示されない場合

#### 原因1: ブラウザキャッシュ
**解決策**: 強制リロード（Ctrl+Shift+R / Cmd+Shift+R）

#### 原因2: ファイルパスの問題
**確認方法**:
```bash
# public/ディレクトリ内のファイルを確認
ls -la public/favicon*
```

**解決策**:
- Next.js再起動: `npm run dev`
- ファイル権限確認: `chmod 644 public/favicon.svg`

#### 原因3: Next.js Metadata設定ミス
**確認方法**:
- `app/layout.tsx`のMetadata設定を確認
- ビルドエラーがないか確認: `npm run build`

**解決策**:
```typescript
// app/layout.tsx
export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
};
```

#### 原因4: Vercelデプロイ時のファイル除外
**確認方法**:
- `.vercelignore`ファイルを確認
- `public/`ディレクトリが除外されていないか確認

**解決策**: `.vercelignore`から`public/`を削除

#### 原因5: 404エラー
**確認方法**:
```bash
# ブラウザでURLに直接アクセス
https://video-analyzer-v2.vercel.app/favicon.svg
```

**解決策**:
- Vercel再デプロイ
- `public/`ディレクトリのファイルを確認

## 7. 成功確認チェックリスト

- [ ] http://localhost:3000/favicon.svg → 200 OK（画像表示）
- [ ] http://localhost:3000/favicon.ico → 200 OK（ダウンロード可能）
- [ ] ブラウザタブにアイコン表示
- [ ] ブックマーク追加でアイコン表示
- [ ] モバイルブラウザでアイコン表示
- [ ] Lighthouseスコアでエラーなし
- [ ] 本番環境デプロイ後も表示
- [ ] 全ブラウザ（Chrome, Firefox, Safari, Edge）で表示

## 8. 参考リソース

- [Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [RealFaviconGenerator](https://realfavicongenerator.net/)
- [Favicon Checker](https://realfavicongenerator.net/favicon_checker)
- [MDN: Favicon](https://developer.mozilla.org/en-US/docs/Glossary/Favicon)
