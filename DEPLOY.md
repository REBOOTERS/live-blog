# 部署到 GitHub Pages 指南

本指南把 LiveBlog 部署到 GitHub Pages，访问地址 `https://rebooters.github.io/live-blog/`。

> 本项目是纯前端单页应用（无客户端路由），数据存浏览器 `localStorage`，天然适合 GitHub Pages 这种静态托管。

---

## 0. 前置条件

- 一个 GitHub 账号，仓库已推送到 GitHub（建议公共仓库；私有仓库需要 GitHub Pro 才能用 Pages）。
- 本地能跑通 `npm run build`（会生成 `dist/`）。

---

## 1. 配置 `base` 路径（关键）

GitHub Pages 的项目站点地址是 `https://<user>.github.io/<repo>/`，**子路径 `/repo/` 不能少**。Vite 默认 `base: '/'` 会导致打包后的 JS/CSS 仍指向根路径，部署后白屏。

本项目按构建模式自动判定 base，本地 dev 不受影响、CI 无需注入环境变量：

```ts
// vite.config.ts
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  // 生产构建默认带 /live-blog/ 子路径；dev / preview 保持 '/'
  base: mode === 'production' ? process.env.PAGES_BASE || '/live-blog/' : '/',
}))
```

- `npm run dev`（development）-> base `/`，本地开发不受影响。
- `npm run build`（production）-> base `/live-blog/`，对应 `https://rebooters.github.io/live-blog/`。
- 若换仓库名，改 `/live-blog/` 为 `/<新仓库名>/`。
- 若用自定义域名（根路径访问），构建时设 `PAGES_BASE=/` 覆盖。

> **用户/组织站点**（仓库名为 `<user>.github.io`）部署在根域名，把上面的 `/live-blog/` 改成 `/` 即可。

---

## 2. 部署方式 A：GitHub Actions（推荐，tag 触发）

只在打 tag 时部署，避免每次 push 都触发构建。本仓库已内置工作流 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    tags:
      - 'v*' # 只在推送 v 开头的 tag 时触发，如 v1.0.0
  workflow_dispatch: # 也允许在 Actions 页面手动触发

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build   # 生产构建自动用 /live-blog/ 子路径
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 2.1 开启 Pages

进入 GitHub 仓库 **Settings -> Pages**，**Source** 选 `GitHub Actions`（不是 Branch）。只需设置一次。

### 2.2 触发部署

打一个 `v` 开头的 tag 并推送：

```bash
git tag v1.0.0
git push origin v1.0.0
```

推送后 Actions 自动跑构建 + 发布。等绿色对勾出现，Pages 页面顶部会显示站点地址 `https://rebooters.github.io/live-blog/`。

> 之后再发布新版本，重复打 tag 即可（`v1.0.1`、`v1.1.0` …）。也可以在 Actions 页面点 `Run workflow` 手动触发。

---

## 3. 部署方式 B：`gh-pages` npm 工具（手动，更简单）

不想配 CI、想本地一键发布可用这种方式。

### 3.1 安装

```bash
npm install -D gh-pages
```

### 3.2 加脚本

在 `package.json` 的 `scripts` 里加一行（生产构建已自动带 `/live-blog/` 子路径，无需额外环境变量）：

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "deploy": "npm run build && gh-pages -d dist"
}
```

### 3.3 发布

```bash
npm run deploy
```

它会把 `dist/` 推到 `gh-pages` 分支。然后到 **Settings -> Pages**：

- **Source** 选 `Deploy from a branch`
- **Branch** 选 `gh-pages`，文件夹选 `/ (root)`，保存。

等 1–2 分钟即可访问。之后每次本地改完跑 `npm run deploy` 重新发布。

---

## 4. 验证

打开 `https://rebooters.github.io/live-blog/`：

- 首页应正常加载，侧栏 11 篇示例文章可见。
- 进入任一文章，拖动交互组件（如单摆、迷宫）应正常工作。
- 切到日间/夜间模式应正常（刷新后记住选择）。

若**白屏**：99% 是 `base` 路径没配对。打开浏览器开发者工具的 Network 面板，看 JS/CSS 是否 404。若 404 路径是 `/assets/...`（缺 `/live-blog/` 前缀），说明构建时没注入 `PAGES_BASE`。

---

## 5. 自定义域名（可选）

如想用 `https://blog.example.com` 代替默认地址：

1. 在仓库根目录建 `public/CNAME` 文件（注意是 `public/` 下，Vite 会原样拷到 `dist/`），内容写你的域名：
   ```
   blog.example.com
   ```
2. 到域名 DNS 服务商加一条 `CNAME` 记录，指向 `rebooters.github.io`。
3. GitHub **Settings -> Pages -> Custom domain** 填入域名，勾选 **Enforce HTTPS**。
4. 用了自定义域名后，站点从根域名访问，构建时**不要**注入 `PAGES_BASE`（保持 `/`），即 workflow 里去掉 `PAGES_BASE=/live-blog/`。

---

## 6. 常见问题

**Q: 刷新页面 404 吗？**
不会。本项目无客户端路由，整站只有一个 `index.html`，任意 URL 都回到首页，不存在路由刷新 404 问题。

**Q: 数据会丢吗？**
文章存在浏览器的 `localStorage`，绑定在 `https://rebooters.github.io` 这个源下。同一浏览器同一域名下持续保留；换浏览器/换设备看不到，因为没有后端（这是设计如此）。

**Q: 私有仓库能用吗？**
GitHub Pages 对私有仓库需要 GitHub Pro/Team 计划。公共仓库免费。

**Q: 构建在 CI 失败怎么办？**
Actions 日志里看 `npm run build` 那一步。常见是类型检查未过（`tsc -b` 严格模式），本地先跑 `npm run build` 确保通过再打 tag。

**Q: 想换仓库名怎么办？**
改完仓库名后，同步改 workflow 里的 `PAGES_BASE=/新仓库名/`，重新打 tag 部署即可。

---

## 附录：本地预览生产构建

部署前可本地预览（生产构建已带 `/live-blog/` 子路径）：

```bash
npm run build
npm run preview
```

浏览器打开 `http://localhost:4173/live-blog/` 检查（preview 会按 base 路径提供）。
