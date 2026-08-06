# 部署到 GitHub Pages 指南

本指南把 LiveBlog 部署到 GitHub Pages，访问地址形如 `https://<你的用户名>.github.io/<仓库名>/`。

> 本项目是纯前端单页应用（无客户端路由），数据存浏览器 `localStorage`，天然适合 GitHub Pages 这种静态托管。

---

## 0. 前置条件

- 一个 GitHub 账号，仓库已推送到 GitHub（建议公共仓库；私有仓库需要 GitHub Pro 才能用 Pages）。
- 本地能跑通 `npm run build`（会生成 `dist/`）。

---

## 1. 配置 `base` 路径（关键）

GitHub Pages 的项目站点地址是 `https://<user>.github.io/<repo>/`，**子路径 `/repo/` 不能少**。Vite 默认 `base: '/'` 会导致打包后的 JS/CSS 仍指向根路径，部署后白屏。必须改 `base`。

编辑 `vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/<仓库名>/',   // ← 改成你的仓库名，首尾斜杠都要
})
```

例如仓库名是 `live-blog`，就写 `base: '/live-blog/'`。

> **用户/组织站点**（仓库名为 `<user>.github.io`）部署在根域名 `https://<user>.github.io/`，保持 `base: '/'` 即可，无需修改。

---

## 2. 部署方式 A：GitHub Actions（推荐，全自动）

每次推送到 `main` 分支自动构建并发布，最省心。

### 2.1 新建工作流文件

在仓库根目录创建 `.github/workflows/deploy.yml`，内容如下：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch: # 允许手动触发

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
      - run: npm run build
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

### 2.2 推送到 GitHub

```bash
git add .github/workflows/deploy.yml vite.config.ts
git commit -m "ci: 部署到 GitHub Pages"
git push
```

### 2.3 开启 Pages

进入 GitHub 仓库 **Settings → Pages**：

- **Source** 选 `GitHub Actions`（不是 Branch）。

推送后 Actions 会自动跑一次构建发布。等绿色对勾出现，Pages 页面顶部会显示站点地址 `https://<user>.github.io/<repo>/`。

> 之后每次 `git push` 到 `main` 都会自动重新部署。

---

## 3. 部署方式 B：`gh-pages` npm 工具（手动，更简单）

不想配 CI、想本地一键发布可用这种方式。

### 3.1 安装

```bash
npm install -D gh-pages
```

### 3.2 加脚本

在 `package.json` 的 `scripts` 里加一行：

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

它会把 `dist/` 推到 `gh-pages` 分支。然后到 **Settings → Pages**：

- **Source** 选 `Deploy from a branch`
- **Branch** 选 `gh-pages`，文件夹选 `/ (root)`，保存。

等 1–2 分钟即可访问。之后每次本地改完跑 `npm run deploy` 重新发布。

---

## 4. 验证

打开 `https://<user>.github.io/<repo>/`：

- 首页应正常加载，侧栏 11 篇示例文章可见。
- 进入任一文章，拖动交互组件（如单摆、迷宫）应正常工作。
- 切到日间/夜间模式应正常（刷新后记住选择）。

若**白屏**：99% 是 `base` 路径没配对，检查 `vite.config.ts` 里的 `base` 是否与仓库名一致（含首尾斜杠）。打开浏览器开发者工具的 Network 面板看 JS/CSS 是否 404。

---

## 5. 自定义域名（可选）

如想用 `https://blog.example.com` 代替默认地址：

1. 在仓库根目录建 `public/CNAME` 文件（注意是 `public/` 下，Vite 会原样拷到 `dist/`），内容写你的域名：
   ```
   blog.example.com
   ```
2. 到域名 DNS 服务商加一条 `CNAME` 记录，指向 `<user>.github.io`。
3. GitHub **Settings → Pages → Custom domain** 填入域名，勾选 **Enforce HTTPS**。
4. 用了自定义域域名后，站点从根域名访问，`base` 保持 `/` 即可（无需子路径）。

---

## 6. 常见问题

**Q: 刷新页面 404 吗？**
不会。本项目无客户端路由，整站只有一个 `index.html`，任意 URL 都回到首页，不存在路由刷新 404 问题。

**Q: 数据会丢吗？**
文章存在浏览器的 `localStorage`，绑定在 `https://<user>.github.io` 这个源下。同一浏览器同一域名下持续保留；换浏览器/换设备看不到，因为没有后端（这是设计如此）。

**Q: 私有仓库能用吗？**
GitHub Pages 对私有仓库需要 GitHub Pro/Team 计划。公共仓库免费。

**Q: 构建在 CI 失败怎么办？**
Actions 日志里看 `npm run build` 那一步。常见是类型检查未过（`tsc -b` 严格模式），本地先跑 `npm run build` 确保通过再推。

**Q: 想换仓库名怎么办？**
改完仓库名后，同步改 `vite.config.ts` 的 `base`，重新部署即可。

---

## 附录：本地预览生产构建

部署前可本地预览，模拟线上路径：

```bash
npm run build
npm run preview -- --base=/仓库名/   # 模拟子路径
```

浏览器打开 `http://localhost:4173/仓库名/` 检查。
