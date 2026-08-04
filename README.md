# LiveBlog · 交互式写作平台

一个面向知识讲解的写作平台：文字负责讲故事，可交互的演示负责建立直觉。读者不只是滚动页面——他们可以拖动、释放、单步执行，直接操作公式背后的模型。

## 快速开始

```bash
npm install
npm run dev      # 本地开发 http://localhost:5173
npm run build    # 类型检查 + 生产构建到 dist/
npm run preview  # 预览生产构建
```

## 功能特性

### 写作 / 阅读
- **区块化文章**：每篇文章由若干「文字段落」和「交互组件」组成，可任意重排。
- **内置 Markdown**：标题、粗体、斜体、行内代码与代码块、链接、列表、引用、分割线，以及 `$...$` / `$$...$$` 公式片段。
- **编辑器 / 阅读器一键切换**：右侧属性面板实时调整组件参数，所见即所得。
- **本地持久化**：文章通过 `localStorage` 保存；首次打开自带一篇贯穿四个知识点的示例文章。

### 四个内置交互组件（Widget）

| 组件 | 知识点 | 鼠标交互 |
| --- | --- | --- |
| 🎯 **单摆** | 简谐运动、能量守恒、非线性 | 拖动小球设定角度，松手释放 |
| 〰️ **贝塞尔曲线** | De Casteljau 插值、钢笔工具 | 拖动四个控制点，滑块控制 `t` |
| 📊 **排序可视化** | 冒泡 / 选择 / 插入 / 快排的复杂度差异 | 播放、暂停、单步前进/后退、新数组 |
| 🚀 **抛体运动** | 速度分解、抛物线轨迹 | 弹弓式拖拽设定发射角与初速度 |

### 可扩展的 Widget 注册表
所有交互组件统一在 `src/widgets/registry.tsx` 注册。每个 widget 只需提供：

```ts
{
  type: string,
  label: string,
  description: string,
  icon: string,
  defaultProps: P,
  configSchema: ConfigField[],   // 驱动编辑器里的属性面板
  Component: ComponentType<{ props: P }>,
}
```

配置面板由 schema 自动生成（range / number / select / color / checkbox / text / textarea），无需手写表单。新增一个 widget 等于新增一个文件并在 registry 里加一行。

## 目录结构

```
src/
├── App.tsx                 顶部导航、侧栏、阅读/编辑模式切换
├── main.tsx
├── index.css               Tailwind + 文章排版样式
├── types.ts                Article / Block 数据模型
├── storage.ts              localStorage 读写
├── seed.ts                 内置示例文章
├── lib/
│   ├── useAnimationFrame.ts   rAF 循环 hook（dt 秒级）
│   ├── id.ts
│   └── markdown.ts            无依赖的 Markdown 渲染器
├── components/
│   ├── BlockRenderer.tsx     阅读器中按区块类型渲染
│   ├── BlockEditor.tsx       编辑器中的区块卡片（含文字/Widget 编辑）
│   ├── ConfigPanel.tsx       schema 驱动的属性表单
│   └── WidgetView.tsx
└── widgets/
    ├── registry.tsx
    ├── PendulumWidget.tsx
    ├── BezierWidget.tsx
    ├── SortWidget.tsx
    └── ProjectileWidget.tsx
```

## 技术栈

React 18 + TypeScript + Vite 6 + Tailwind CSS 4。无额外 UI / 动画 / Markdown 依赖，所有可视化均使用原生 Canvas 2D 与 SVG。
