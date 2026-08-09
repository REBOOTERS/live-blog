# CLAUDE.md

本文件为 Claude Code 提供本仓库的工作上下文。

## 项目概述

**LiveBlog** 是一个面向知识讲解的交互式写作平台。文章由「Markdown 文字段落」与「可交互 Widget」混排组成，读者可以用鼠标直接操作动画（拖动、释放、单步执行）来理解知识点，而不只是滚动阅读。

核心定位：文字负责讲故事，可操作的模型负责建立直觉。

## 技术栈

- **React 18** + **TypeScript**（strict 模式）
- **Vite 6** 构建 / 开发服务器
- **Tailwind CSS 4**（通过 `@tailwindcss/vite` 插件接入，入口在 `src/index.css` 用 `@import "tailwindcss"`）
- **可视化零依赖**：Canvas 2D 与 SVG 全部手写。唯一的额外运行时依赖是 **KaTeX**（数学公式渲染）；Markdown 渲染器为自写，代码高亮为自写的轻量分词器（`src/lib/highlight.ts`）
- 包管理器：npm（Node v24+）

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 启动开发服务器（默认 http://localhost:5173）
npm run build      # tsc -b 类型检查 + vite build 生产构建到 dist/
npm run preview    # 预览生产构建
```

构建分两步：先 `tsc -b`（含 `tsconfig.json` 与 `tsconfig.node.json` 两个 project reference），再 `vite build`。**任何 PR 必须通过 `npm run build`**，它会执行严格类型检查（`noUnusedLocals` / `noUnusedParameters` 均开启）。

## 目录结构

```
live-blog/
├── index.html              # Vite 入口，挂载 #root
├── vite.config.ts          # react + tailwindcss 插件
├── tsconfig.json           # app 源码配置（引用 tsconfig.node.json）
├── tsconfig.node.json      # vite.config.ts 的 composite 配置
├── public/favicon.svg
└── src/
    ├── main.tsx            # React 挂载入口
    ├── index.css           # Tailwind + .prose-lb 文章排版 + .math-* 公式样式
    ├── App.tsx             # 顶层：侧栏、阅读/编辑模式切换、增删文章
    ├── types.ts            # Article / Block 数据模型
    ├── storage.ts          # localStorage 读写（key: liveblog:articles:v1）
    ├── seed.ts             # 首次启动的示例文章
    ├── lib/
    │   ├── useAnimationFrame.ts  # rAF 循环 hook（dt 秒级，限制最大 0.05s）
    │   ├── canvas.ts             # prepareCanvas()：HiDPI 清晰绘制（所有 Canvas Widget 必用）
    │   ├── id.ts                 # uid()
    │   ├── markdown.ts           # Markdown 渲染器（含 KaTeX 公式、代码高亮、窗口栏）
    │   └── highlight.ts          # 轻量正则分词器，为代码块生成 tok-* 高亮 HTML
    ├── components/
    │   ├── BlockRenderer.tsx  # 阅读器中按 block.kind 分发渲染
    │   ├── BlockEditor.tsx    # 编辑器中的区块卡片（文字/Widget 编辑）
    │   ├── ConfigPanel.tsx    # schema 驱动的 Widget 属性表单
    │   └── WidgetView.tsx     # 从 registry 取组件并渲染（含标题/说明）
    └── widgets/
        ├── registry.tsx            # Widget 注册表与 ConfigField 类型
        ├── PendulumWidget.tsx      # 单摆（Canvas，鼠标拖动）
        ├── BezierWidget.tsx        # 三次贝塞尔（SVG，拖动控制点）
        ├── SortWidget.tsx          # 排序可视化（DOM 柱子 + 内部数值标签）
        ├── ProjectileWidget.tsx    # 抛体运动（Canvas，弹弓式拖拽）
        ├── FourierWidget.tsx       # 傅里叶变换（Canvas，手绘信号 + DFT 重建 + 频谱）
        ├── MatrixWidget.tsx        # 矩阵变换（SVG，拖动两列基向量 + 行列式）
        ├── BackpropWidget.tsx      # 反向传播（Canvas，真实 tanh MLP 训练 + 权重图）
        ├── ColorWidget.tsx         # 三原色混色（Canvas，加色/减色 + RGB/HSL）
        ├── SoundWaveWidget.tsx     # 声波与频率（Canvas + Web Audio，真实发声 + 拍频）
        ├── TransformerWidget.tsx   # Transformer 自注意力（SVG，真实 scaled dot-product）
        └── GraphSearchWidget.tsx   # BFS/DFS 迷宫遍历（Canvas，彩虹顺序上色 + 前沿 + 最短路径）
```

## 数据模型

定义在 `src/types.ts`：

```ts
type Block =
  | { id: string; kind: 'text'; content: string }              // Markdown
  | { id: string; kind: 'widget'; type: string; props: Record<string, unknown> }

interface Article {
  id: string
  title: string
  description: string
  updatedAt: string   // ISO
  blocks: Block[]
}
```

- 文章持久化在 `localStorage`（`src/storage.ts`，当前 key 为 `liveblog:articles:v4`；修改数据结构或 seed 内容时记得升版本号并把上一版 key 作为 `LEGACY_KEY`。迁移会非破坏性地把内置 demo 文章刷新为最新 seed、追加新 demo、并保留用户自建文章）。
- `Block.id` 由 `src/lib/id.ts` 的 `uid(prefix)` 生成；示例文章使用稳定 id（`art-pendulum` 等）。
- 首次打开（或存储为空）时写入 `seed.ts` 的 `seedArticles()`，目前返回七篇独立示例文章（单摆 / 贝塞尔 / 排序 / 抛体 / 傅里叶 / 矩阵 / 反向传播，每个知识点一篇）。

## 核心架构模式

### Widget 注册表（最重要的扩展点）

所有交互组件在 `src/widgets/registry.tsx` 注册，结构：

```ts
interface WidgetDefinition<P extends object = Record<string, unknown>> {
  type: string                // 唯一标识，持久化到 block.type
  label: string               // 中文名
  description: string         // 阅读器中显示的说明
  icon: string                // emoji，用于菜单
  defaultProps: P             // 新建时的初始 props
  configSchema: ConfigField[] // 驱动编辑器属性面板
  Component: ComponentType<{ props: P }>  // 实际渲染组件
}
```

`ConfigField` 支持类型：`range` / `number` / `select` / `color` / `checkbox` / `text` / `textarea`。`ConfigPanel.tsx` 根据 schema 自动生成表单，**新增属性一般无需手写表单代码**。

**新增一个 Widget 的步骤：**
1. 在 `src/widgets/` 新建 `XxxWidget.tsx`，导出 `XxxWidget: WidgetDefinition<XxxProps>`。
2. 在 `registry.tsx` 中 import 并加入 `registry` 对象。
3. 它会自动出现在编辑器「+ 添加段落 → 交互组件」菜单中。

### 动画循环

统一使用 `src/lib/useAnimationFrame.ts`：
- 回调签名 `(dt: number, elapsed: number) => void`，`dt` 单位为**秒**，上限 0.05s（防止切后台后的大跳变）。
- 内部用 ref 持有最新回调，effect 只订阅一次，不会因重渲染重新订阅。
- 物理状态存在 `useRef` 中，循环里 mutate ref 并触发重绘；Widget 内部按需用 `force(n=>n+1)` 触发 React 重渲染（Canvas 通常在 `useEffect` 里根据 ref 绘制）。

### 指针 / 交互约定

- 统一使用 **React 指针事件**（`onPointerDown/Move/Up/Cancel`）+ `setPointerCapture`，**不要**用 `window.addEventListener` 监听拖动（会造成重绑/闭包/清理问题）。
- 画布元素设置 `touch-action: none`（Tailwind: `touch-none`）以阻止触屏滚动干扰。
- **Canvas HiDPI 必须用 `src/lib/canvas.ts` 的 `prepareCanvas(canvas, W, H)`**，不要手写 `canvas.width = W * dpr` + `setTransform(dpr,...)`。原因：Canvas 的 CSS 宽度是 `100%`，实际显示宽度约 880px 远大于逻辑 `W`（如 540），手写写法会把 `W*dpr` 的 backing store 拉伸到显示宽度，导致**文字与线条全部发虚**（傅里叶 Widget 曾因此模糊）。`prepareCanvas` 按「实际显示尺寸 × dpr」设 backing store 并把逻辑 0..W/0..H 坐标系缩放铺满，任何宽度下都像素级清晰。draw 函数开头写 `const ctx = prepareCanvas(canvas, W, H); if (!ctx) return; ctx.clearRect(0,0,W,H);` 即可，其余绘制代码不变。
- **关键**：`useAnimationFrame` 回调即便在拖拽状态也应触发重绘（不要在拖动时 `return` 掉整个循环），否则画面会冻结——物理更新可以跳过，但绘制必须继续。
- **阅读态也可调的控件**：Widget 若有滑块/下拉等让读者实时调节的交互，应把 `props` mirror 到本地 `useState`（用 `useEffect` 同步 prop 变化），不要依赖 `props.onPropsChange`——它在阅读态为 undefined。编辑器里的 ConfigPanel 仍通过 props 驱动保存的默认值（可参考 `SortWidget` / `FourierWidget` / `BackpropWidget`）。
- **批量更新**：rAF 循环里若每帧做多步计算（如反向传播），把多步合并后只触发一次 `setEpoch`/`force`，避免每步一次 React 更新。
- **SVG 的 `viewBox` 必须与渲染几何的坐标系同一尺度**。MatrixWidget 曾把 `viewBox` 设成像素尺度（±260），却用世界坐标（±5）画 Grid/箭头/手柄，导致全部缩成中心一个看不见的点--既看不到也点不到。若 `toWorld` 返回 ±5 世界坐标，`viewBox` 就必须是 `${-XMAX} ${-YMAX} ${2*XMAX} ${2*YMAX}` 的世界尺度。新增 SVG Widget 时务必核对二者一致。
- **SVG 可拖拽元素要确保命中区不被遮挡**：装饰性的填充图形（变换后的形状、原始基向量线等）应加 `pointerEvents="none"`，只让手柄（透明大圆 + 可见小圆）接收 `onPointerDown`；手柄命中圆半径取世界坐标的 ~0.5（约 4–5% 画宽）以保证好点。

### Markdown 渲染

`src/lib/markdown.ts` 是逐行手写的渲染器，输出字符串 HTML：
- 支持 `#`~`###` 标题、粗体 `**x**`、斜体 `*x*`、行内 `` `code` ``、围栏代码块 ```` ``` ````、链接 `[t](url)`、`-`/`1.` 列表、`>` 引用、`---` 分割线。
- 支持 `$...$` 行内公式与 `$$...$$` 块级公式，由 **KaTeX** 渲染（`main.tsx` 引入 `katex/dist/katex.min.css`，Vite 自动打包字体）。
- 围栏代码块带编辑器窗口栏（三圆点 + 语言标签 + 复制按钮）并经 `src/lib/highlight.ts` 做 C-like 语法高亮（`.tok-*`）。复制按钮在 `dangerouslySetInnerHTML` 内，靠 `BlockRenderer` 里的 scoped 委托 click 实现（是 click 不是拖拽，不受下面的 `window.addEventListener` 约定限制）。
- **安全模型**：`inline()` 先把行内代码与 `$...$` 抽到 NUL 分隔的占位槽（`String.fromCharCode(0)`）、各自渲染为 HTML，再对剩余文本 `escapeHtml`，最后还原占位。这样 KaTeX 收到的是原始 TeX（不会被预转义破坏，如 `$a<b$`），NUL 也不会与正文里的数字冲突。块级 `$$` 直接喂原始文本给 KaTeX。输出默认安全，在组件中用 `dangerouslySetInnerHTML` 渲染。
- 文章排版样式集中在 `index.css` 的 `.prose-lb` 命名空间下。

### 阅读 / 编辑模式

`App.tsx` 维护 `mode: 'read' | 'edit'`：
- 进入编辑时用 `structuredClone(current)` 建立 `draft`，编辑作用于 draft。
- 「保存」写入 storage 并切回阅读；「取消」丢弃 draft。
- 编辑器每个区块由 `BlockEditor.tsx` 渲染，含上移/下移/删除、文字段的编辑/预览切换、Widget 的属性面板。

## 代码风格约定

- 函数组件 + Hooks；不使用 class 组件。
- 文件内组件命名：默认导出组件与具名 WidgetDefinition 导出（如 `PendulumWidget`）。
- 优先使用 `clsx` 之外的模板字符串做条件 class（项目未引入 clsx）。
- Tailwind utility 为主，自定义样式集中在 `index.css`：`.prose-lb` 排版、`.lb-surface` 卡片、滚动条、range 控件霓虹样式。
- **整体为浅色编辑型高级博客主题（Apple 风）**：默认浅色（`#fbfbfd`/`#f5f5f7`），无手动选择时跟随系统 `prefers-color-scheme`（见 `index.html` 预涂脚本与 `src/lib/theme.ts`）；主色为单一克制的蓝色（`#0071e3` 浅色 / `#2997ff` 深色）；大量留白、发丝边（hairline）、柔和阴影；文章大标题用衬线字体（`--lb-font-display`）。**不要再加霓虹辉光、网格底纹、渐变分隔线、发光徽章**。Widget 外层 `.lb-surface` **跟随主题**（浅色=白卡片 `var(--lb-surface-bg)`，深色=深卡片），与正文融为一体；面板用 `var(--lb-panel)`。
- **画布配色约定（跟随主题，禁止硬编码）**：Widget 的 Canvas/SVG 配色必须通过 `src/lib/canvas.ts` 的 `palette()` 获取，**不要写死 `#22d3ee`/`#6366f1`/`#0a0f1e` 等深色霓虹值**——这些在浅色主题下会变成「黑卡片装隐形内容」。`palette()` 按当前 `data-theme` 返回整套语义色：`bg`/`bg2`/`grid`/`axis`/`text`/`muted`/`faint`/`ghost`，以及强调色 `accent`（浅色 `#0071e3`/深色 `#22d3ee`）、`accent2`、`soft`、`glow`、`warn`/`danger`/`good`/`pink`。需要带 alpha 的强调色（如 SVG stroke 热力）用 `hexToRgba(P.accent, a)` 辅助（见 `BackpropWidget`/`TransformerWidget`）。**主题切换重绘**：画布/组件必须在顶层调用 `useTheme()` 触发重渲染（仅 `useAnimationFrame` 的回调不会自动响应主题），否则切主题后画布不更新。
- **特例：ColorWidget 混色画布**：三原色混色的画布背景由**物理模式**决定、与主题无关——加色（光 `additive`）必须深背景（暗室），减色（颜料 `subtractive`）必须白底（白纸）。标签文字对比度也随之取深/浅。这是演示正确性，不要为「统一跟随主题」而破坏。
- 所有 Canvas 须处理 HiDPI（DPR scaling），并按 `aspect-ratio` 自适应宽度，保证清晰与尺寸合理。
- 中文作为界面与文案语言；代码标识符用英文。
- 不使用第三方图标库，需要时优先内联 SVG 或 emoji。
- 无注释噪音，只在解释「为什么」而非「做什么」处加注释。

## 当前已知 / 进行中的工作

> 最后更新：2026-08-09

- **2026-08-09 视觉改版为高级博客风**：默认改为浅色编辑型主题（Apple 官网风），夜间模式仍在（顶栏右上角切换；无手动选择时跟随系统 `prefers-color-scheme`，见 `index.html` 预涂脚本与 `src/lib/theme.ts`）。去掉了霓虹辉光/网格底纹/渐变分隔线/发光徽章；主色统一为单一蓝；文章标题用衬线字体；圆角更大（胶囊按钮、12–16px 卡片）。**关键：`.lb-surface` 与全部 11 个 Widget 画布都跟随主题**——`palette()`（`src/lib/canvas.ts`）按 `data-theme` 返回浅/深两套语义色，所有 Widget 经 `useTheme()` 在切主题时重绘；硬编码的青/靛深色值已全部替换为 `palette()` 取值（唯一例外是 ColorWidget 混色画布，其背景由加/减色物理模式决定）。代码块仍保留深色窗口栏（但去掉了红黄绿圆点）。新增 UI 请遵循上面的「整体为浅色编辑型高级博客主题」「画布配色约定」两条。

- 所有可拖拽 Widget（单摆/贝塞尔/抛体/傅里叶/矩阵/三原色）统一使用 React 指针事件 + `setPointerCapture`，不要回退到 `window.addEventListener`。
- 内置示例共十一篇，每个知识点一篇：单摆、贝塞尔、排序、抛体、傅里叶变换、矩阵变换、反向传播、三原色混色、声波与频率、Transformer 自注意力、BFS/DFS 图遍历。localStorage key 已升至 `v6`，迁移逻辑见 `storage.ts`。
- **2026-08-05 视觉改版**：整体改为深色霓虹科技主题（indigo→cyan 渐变主色、辉光、网格底纹、`.lb-surface` 卡片），全部 Widget 画布重绘为深色高对比配色并加发光；range 控件自定义霓虹滑块。数学公式用 KaTeX、代码块有语法高亮。新增 Widget 时请遵循上面的「画布配色约定」。
- **2026-08-05 清晰度/交互修复**：① 所有 Canvas Widget 改用 `prepareCanvas` 解决文字模糊（见上「指针/交互约定」）；② 修复 MatrixWidget 的 `viewBox` 尺度不匹配导致图形缩成中心一点、无法交互的问题。

## 不做的事（避免误解范围）

- 不做后端 / 多端同步，数据仅存浏览器 `localStorage`。
- 不做富文本所见即所得编辑器，文字段落用 Markdown 文本域 + 预览。
- 不做账号、评论、发布流等 CMS 功能。
