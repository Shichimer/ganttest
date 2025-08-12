# Mini Gantt Online (Free Hosting)

Instaganttライクな軽量ガント。Asana連携・課金・AIなし。静的サイトなので無料ホスティングで動きます。

## 共有リンク
- 左サイドバー「共有リンクをコピー」で現在の状態をURLハッシュ(#d=...)に圧縮保存。
- そのURLをブックマークすると別端末でも復元できます（サーバ保存なし）。

## デプロイ（Netlify）
1. このZIPを解凍してGitHubにPush。
2. Netlify → Add new site → Import from Git → リポジトリ選択。
3. Build: `npm run build` / Publish: `dist` → Deploy。

## ローカル確認
```bash
npm install
npm run dev
# http://localhost:5173
```
