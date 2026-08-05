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
        └── BackpropWidget.tsx      # 反向传播（Canvas，真实 tanh MLP 训练 + 权重图）
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
- Canvas 需要处理 HiDPI：用 `window.devicePixelRatio` 放大 backing store，再 `ctx.setTransform(dpr,...)`，CSS 尺寸保持逻辑像素。
- **关键**：`useAnimationFrame` 回调即便在拖拽状态也应触发重绘（不要在拖动时 `return` 掉整个循环），否则画面会冻结——物理更新可以跳过，但绘制必须继续。
- **阅读态也可调的控件**：Widget 若有滑块/下拉等让读者实时调节的交互，应把 `props` mirror 到本地 `useState`（用 `useEffect` 同步 prop 变化），不要依赖 `props.onPropsChange`——它在阅读态为 undefined。编辑器里的 ConfigPanel 仍通过 props 驱动保存的默认值（可参考 `SortWidget` / `FourierWidget` / `BackpropWidget`）。
- **批量更新**：rAF 循环里若每帧做多步计算（如反向传播），把多步合并后只触发一次 `setEpoch`/`force`，避免每步一次 React 更新。

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
- Tailwind utility 为主，自定义样式仅用于 `.prose-lb` 排版与滚动条。
- 中文作为界面与文案语言；代码标识符用英文。
- 不使用第三方图标库，需要时优先内联 SVG 或 emoji。
- 无注释噪音，只在解释「为什么」而非「做什么」处加注释。

## 当前已知 / 进行中的工作

> 最后更新：2026-08-05

- 所有可拖拽 Widget（单摆/贝塞尔/抛体/傅里叶/矩阵）统一使用 React 指针事件 + `setPointerCapture`，不要回退到 `window.addEventListener`。
- 内置示例共七篇，每个知识点一篇：单摆、贝塞尔、排序、抛体、傅里叶变换、矩阵变换、反向传播。localStorage key 已升至 `v4`，迁移逻辑见 `storage.ts`。
- **2026-08-04 大改版**：① 数学公式改用 KaTeX 真实渲染（新增运行时依赖 `katex`，见上「技术栈」）；② 代码块加语法高亮 + 编辑器窗口栏 + 复制；③ 排序 Widget 在阅读模式新增算法 Tab / 复杂度徽标 / 长度与速度滑块（此前只能在编辑器里切换算法）；④ 抛体 Widget 重写为「朝目标方向拖拽 + 实时预测轨迹」，落地显示射程/最高/飞行时间；⑤ 整体打磨为精致浅色「技术博客」主题（阅读时长、品牌 prompt、代码卡片等）。**localStorage key 升至 `v3`，首次加载非破坏性迁移 v2 数据（刷新内置 demo 文章、保留用户自建文章）**——因为旧的 seed 文案（如抛体「向反方向拖拽」）必须随新交互一起更新，否则说明书与组件行为对不上。

## 不做的事（避免误解范围）

- 不做后端 / 多端同步，数据仅存浏览器 `localStorage`。
- 不做富文本所见即所得编辑器，文字段落用 Markdown 文本域 + 预览。
- 不做账号、评论、发布流等 CMS 功能。
