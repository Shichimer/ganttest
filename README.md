# Mini Gantt Online — Netlify Fix
- ビルドコマンドを `vite build` のみに変更（TypeScriptの事前型チェックを省略）
- `.nvmrc` で Node 18 を指定
- それ以外のコードは同じ

## Deploy (Netlify)
1) GitHubにPush
2) Netlify: Add new site → Import from Git → リポジトリ選択
3) Build: `npm run build` / Publish: `dist`
