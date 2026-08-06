# LiveBlog · 交互式知识博客

> 文字负责讲故事，可操作的模型负责建立直觉。

[English](./README.en.md) | 简体中文

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8.svg)

**LiveBlog** 是一个面向知识讲解的开源交互式写作平台。每篇文章由「Markdown 文字段落」与「可交互 Widget」混排组成——读者不只是滚动阅读，而是用鼠标**拖动、释放、单步执行**，直接操作公式与算法背后的模型，在动手过程中建立对抽象概念的直觉。

---

## ✨ 项目特性

- **文字 + 可操作演示混排** —— 概念先用文字讲清楚，再配一个能玩的模型，让「懂了」变成「感受到了」。
- **11 个手写交互演示** —— 覆盖物理、数学、算法、信号、机器学习，全部原生 Canvas/SVG 实现，零可视化依赖。
- **深色霓虹科技主题** —— 高对比、带辉光的画布，HiDPI 像素级清晰。
- **区块化编辑器** —— 所见即所得地增删 / 重排段落；Widget 参数由 schema 自动生成面板。
- **可扩展的 Widget 注册表** —— 新增一个交互组件只需写一个文件 + 注册一行。
- **KaTeX 数学公式 + 代码语法高亮** —— 排版对技术内容友好。
- **纯前端，数据本地持久化** —— 文章存浏览器 localStorage，无需后端。

---

## 🎯 为什么做这个

读一篇讲「傅里叶变换」的文章，和**亲手拖一条曲线看它的频谱**，是两种完全不同的体验。抽象概念最难跨越的不是「定义」，而是「直觉」——而直觉往往来自身体的参与。

LiveBlog 把每一个知识点都拆成「**讲故事 → 给你一个能玩的模型 → 引导你观察**」三段式，让读者在读完一篇文章后，不只是记住结论，而是真的「摸」过那个概念。

---

## 📚 内置的 11 篇交互示例

| 主题 | Widget | 你能玩什么 |
| --- | --- | --- |
| 🎯 单摆 | Pendulum | 拖动小球释放，观察简谐运动与能量守恒 |
| 〰️ 贝塞尔曲线 | Bezier | 拖动控制点，看 De Casteljau 递推 |
| 📊 排序可视化 | Sort | 单步执行四种排序，看比较与交换 |
| 🚀 抛体运动 | Projectile | 弹弓式拖拽发射，看速度分量分解 |
| 🌊 傅里叶变换 | Fourier | 手绘信号，调节频率分量数看重建 |
| 🔢 矩阵变换 | Matrix | 拖动基向量，看旋转/错切/行列式 |
| 🧠 反向传播 | Backprop | 实时训练小网络拟合函数 |
| 🎨 三原色 | Color | 加色/减色混合，RGB/HSL 实时换算 |
| 🔊 声波与频率 | Sound | 真实发声，调频率/波形，演示拍频 |
| 🧩 Transformer | Self-Attention | 点击 token 看真实注意力权重 |
| 🌐 BFS / DFS | Graph Search | 迷宫遍历，彩虹波纹 vs 蜿蜒长蛇 |

---

## 🚀 快速开始

```bash
git clone <your-fork-url>
cd live-blog
npm install
npm run dev        # 本地开发：http://localhost:5173
```

其他命令：

```bash
npm run build      # tsc 严格类型检查 + Vite 生产构建到 dist/
npm run preview    # 预览生产构建
```

环境要求：Node v24+，npm。

> 📡 **部署到 GitHub Pages？** 参见 [DEPLOY.md](./DEPLOY.md)。

---

## 🛠️ 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript（strict） |
| 构建 | Vite 6 |
| 样式 | Tailwind CSS 4（`@tailwindcss/vite`） |
| 公式 | KaTeX（唯一的运行时依赖，除 React 外） |
| 可视化 | 原生 Canvas 2D 与 SVG，全部手写 |
| Markdown | 自写渲染器 + 自写轻量代码高亮 |

---

## 📁 项目结构

```
src/
├── App.tsx                 顶部导航、侧栏、阅读/编辑模式
├── types.ts                Article / Block 数据模型
├── storage.ts              localStorage 读写 + 版本迁移
├── seed.ts                 内置的 11 篇示例文章
├── lib/
│   ├── useAnimationFrame.ts   rAF 动画循环 hook
│   ├── canvas.ts              prepareCanvas()：HiDPI 清晰绘制
│   ├── markdown.ts            Markdown + KaTeX 渲染器
│   └── highlight.ts           轻量代码高亮
├── components/             BlockRenderer / BlockEditor / ConfigPanel / WidgetView
└── widgets/                11 个交互组件 + registry.tsx 注册表
```

---

## ➕ 扩展：新增一个交互组件

这是本项目最重要的扩展点，也是欢迎 PR 的主要方向。

1. 在 `src/widgets/` 新建 `XxxWidget.tsx`，导出组件与 `WidgetDefinition`：

```ts
export const XxxWidget: WidgetDefinition<XxxProps> = {
  type: 'xxx',
  label: '示例组件',
  description: '一句话说明读者能玩什么。',
  icon: '🆕',
  defaultProps: { /* ... */ },
  configSchema: [ /* schema 驱动的参数面板 */ ],
  Component: Xxx,
}
```

2. 在 `src/widgets/registry.tsx` import 并加入 `registry`。
3. 它会自动出现在编辑器「+ 添加段落 → 交互组件」菜单。

**约定**（详见 `CLAUDE.md`）：

- 指针交互统一用 React 指针事件 + `setPointerCapture`，不要用 `window.addEventListener`。
- Canvas 必须用 `prepareCanvas()` 处理 HiDPI，避免文字模糊。
- SVG 的 `viewBox` 必须与渲染几何坐标系同一尺度。
- 阅读态可调的控件把 props 镜像到本地 `useState`。

---

## 🤝 贡献指南

欢迎通过 Pull Request 贡献新的交互演示或改进现有文章！

- **新增知识点演示**：最有价值的贡献。参考上方的「新增一个交互组件」，并配一篇循序渐进的讲解（直觉 → 原理 → 动手 → 应用）。
- **改进文章**：补充应用场景、修正表述、增加参考文献。
- **视觉与交互打磨**：动画流畅度、配色、移动端适配。
- **Bug 修复**：欢迎附上复现步骤。

提交前请确保 `npm run build` 通过（含严格类型检查）。提交信息用中文或英文均可，简洁描述改动即可。

---

## 📄 License

[MIT](./LICENSE) —— 自由使用、修改、分发。交互演示用于教学/商业演示都很欢迎。

---

如果这个项目对你有帮助，欢迎 ⭐ Star，也期待你的 PR。
