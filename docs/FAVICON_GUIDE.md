# ファビコン実装ガイド

## 概要
Video Analyzer V2のファビコンは、AIを活用した動画分析機能を視覚的に表現するために設計されました。

## デザインコンセプト

### 採用デザイン: VAモノグラム + アクセント
- **V + A**: Video Analyzer の頭文字
- **グラデーション**: 紫〜インディゴ（AI/テクノロジーを象徴）
- **再生ボタン**: 動画処理を表現
- **波形**: Whisper音声文字起こしを視覚化

### カラーパレット
```css
Primary Gradient:
- Start: #6366f1 (Indigo 500)
- End: #8b5cf6 (Purple 500)

Alternative Gradient (Option B):
- Start: #3b82f6 (Blue 500)
- End: #06b6d4 (Cyan 500)
```

## ファイル構成

### 生成されたファイル一覧
```
public/
├── favicon.svg                    # SVGファビコン（推奨・モダンブラウザ）
├── favicon.ico                    # レガシーブラウザ対応（16x16, 32x32, 48x48）
├── favicon-16x16.png              # 16x16 PNG
├── favicon-32x32.png              # 32x32 PNG
├── favicon-48x48.png              # 48x48 PNG
├── apple-touch-icon.png           # 180x180 iOS用
├── android-chrome-192x192.png     # 192x192 Android用
├── android-chrome-512x512.png     # 512x512 Android用
├── manifest.json                  # PWA Web App Manifest
└── favicon-alt-playbutton.svg     # 代替デザイン（バックアップ）
```

### ファイルサイズ
```
favicon.svg:                1.0 KB
favicon.ico:               14 KB
favicon-16x16.png:         554 B
favicon-32x32.png:         1.0 KB
favicon-48x48.png:         1.5 KB
apple-touch-icon.png:      5.6 KB
android-chrome-192x192.png: 6.1 KB
android-chrome-512x512.png: 21 KB
```

## 技術仕様

### SVGファビコンの特徴
- **ベクター形式**: 拡大しても劣化なし
- **軽量**: 1KB未満
- **グラデーション**: リニアグラデーション使用
- **アクセシビリティ**: 白色テキストで視認性確保

### 対応ブラウザ
| ブラウザ | SVG | PNG | ICO |
|---------|-----|-----|-----|
| Chrome 80+ | ✅ | ✅ | ✅ |
| Firefox 70+ | ✅ | ✅ | ✅ |
| Safari 14+ | ✅ | ✅ | ✅ |
| Edge 88+ | ✅ | ✅ | ✅ |
| iOS Safari | - | ✅ (apple-touch-icon) | - |
| Android Chrome | - | ✅ (android-chrome) | - |

## 実装詳細

### Next.js Metadata設定
`app/layout.tsx`:
```typescript
export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/manifest.json',
};
```

### 自動生成スクリプト

#### PNG生成
```bash
npm install --save-dev sharp
node scripts/generate-favicons.js
```

#### ICO生成
```bash
npm install --save-dev to-ico
node scripts/generate-ico.js
```

#### 一括生成（推奨）
```bash
# package.jsonに追加
"scripts": {
  "generate:favicons": "node scripts/generate-favicons.js && node scripts/generate-ico.js"
}

# 実行
npm run generate:favicons
```

## デザインバリエーション

### 現在のデザイン（VA Monogram）
- VAモノグラム + 再生ボタン + 波形アクセント
- ファイル: `public/favicon.svg`

### 代替デザイン（Play Button）
- 大きな再生ボタン + 波形
- ファイル: `public/favicon-alt-playbutton.svg`
- 切り替え方法:
  ```bash
  cp public/favicon-alt-playbutton.svg public/favicon.svg
  npm run generate:favicons
  ```

## カスタマイズ方法

### 色の変更
`public/favicon.svg`を編集：
```svg
<linearGradient id="gradient">
  <stop offset="0%" style="stop-color:#YOUR_COLOR_1" />
  <stop offset="100%" style="stop-color:#YOUR_COLOR_2" />
</linearGradient>
```

### 再生成
```bash
npm run generate:favicons
```

### ビルド確認
```bash
npm run build
npm run start
```

## トラブルシューティング

### ファビコンが表示されない
1. **ブラウザキャッシュクリア**: Ctrl+Shift+R (Win) / Cmd+Shift+R (Mac)
2. **Next.js再起動**: `npm run dev`
3. **ファイル存在確認**: `ls -la public/favicon*`
4. **URLアクセス**: http://localhost:3000/favicon.svg

### ビルドエラー
```bash
# TypeScriptエラー確認
npm run build

# ファイル権限確認
chmod 644 public/favicon.svg
```

### Vercelデプロイ後に404
- `.vercelignore`で`public/`が除外されていないか確認
- Vercel再デプロイ: `vercel --prod`

## 参考リンク

### 公式ドキュメント
- [Next.js Metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
- [MDN Favicon](https://developer.mozilla.org/en-US/docs/Glossary/Favicon)
- [Web.dev PWA Icons](https://web.dev/add-manifest/)

### ツール
- [RealFaviconGenerator](https://realfavicongenerator.net/)
- [Favicon Checker](https://realfavicongenerator.net/favicon_checker)
- [sharp (画像処理)](https://sharp.pixelplumbing.com/)

### デザイン参考
- [Heroicons](https://heroicons.com/)
- [Lucide Icons](https://lucide.dev/)
- [SVG Optimizer](https://jakearchibald.github.io/svgomg/)

## ライセンス
このファビコンはVideo Analyzer V2プロジェクトの一部として、プロジェクトと同じライセンスの下で提供されます。

---

**作成日**: 2025年11月9日
**バージョン**: 1.0.0
**デザイナー**: Claude Code (AI生成)
