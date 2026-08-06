# LiveBlog · Interactive Knowledge Blog

> Words tell the story; operable models build the intuition.

English | [简体中文](./README.md)

🌐 **Live demo**: <https://rebooters.github.io/live-blog/>

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/React-18-61dafb.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)
![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8.svg)

**LiveBlog** is an open-source, interactive writing platform for explaining ideas. Each article weaves **Markdown prose** together with **interactive widgets** — instead of just scrolling, the reader *drags, releases, and single-steps* the actual model behind a formula or algorithm, building intuition for abstract concepts through hands-on play.

---

## ✨ Features

- **Prose + operable demos, interleaved** — explain the idea in words, then hand the reader a model they can play with, so "I get it" becomes "I can feel it".
- **11 hand-written interactive demos** — spanning physics, math, algorithms, signals, and machine learning. All native Canvas/SVG, zero visualization dependencies.
- **Dark neon tech theme** — high-contrast canvases with glow, pixel-crisp on HiDPI.
- **Block-based editor** — add/remove/reorder blocks WYSIWYG; widget params auto-generate a schema-driven panel.
- **Extensible widget registry** — a new interactive component is one file + one registry line.
- **KaTeX math + code syntax highlighting** — typography that respects technical content.
- **Pure front-end, local persistence** — articles live in the browser's localStorage, no backend.

---

## 🎯 Why

Reading an article about the Fourier transform and **drawing a signal yourself to watch its spectrum** are two very different experiences. The hardest gap in an abstract concept isn't its *definition* — it's the *intuition*, and intuition comes from physical engagement.

LiveBlog structures every topic as **tell the story → give a playable model → guide the observation**, so by the end of an article the reader hasn't just memorized a conclusion — they've laid hands on the idea.

---

## 📚 The 11 built-in demos

| Topic | Widget | What you can play |
| --- | --- | --- |
| 🎯 Pendulum | Pendulum | Drag the bob and release; SHM & energy conservation |
| 〰️ Bézier curve | Bezier | Drag control points; De Casteljau construction |
| 📊 Sorting | Sort | Step through four algorithms; compare & swap |
| 🚀 Projectile motion | Projectile | Slingshot launch; velocity components |
| 🌊 Fourier transform | Fourier | Draw a signal; rebuild it from K frequencies |
| 🔢 Matrix transform | Matrix | Drag basis vectors; rotation/shear/determinant |
| 🧠 Backpropagation | Backprop | Train a tiny net to fit a function, live |
| 🎨 Color primaries | Color | Additive/subtractive mixing; RGB↔HSL |
| 🔊 Sound & frequency | Sound | Real audio; tune freq/waveform; beat frequencies |
| 🧩 Transformer | Self-Attention | Click a token to see real attention weights |
| 🌐 BFS / DFS | Graph Search | Maze traversal; rainbow wavefront vs. winding snake |

---

## 🚀 Quick start

```bash
git clone <your-fork-url>
cd live-blog
npm install
npm run dev        # local dev: http://localhost:5173
```

Other commands:

```bash
npm run build      # tsc strict type-check + Vite production build → dist/
npm run preview    # preview the production build
```

Requirements: Node v24+, npm.

> 📡 **Deploying to GitHub Pages?** See [DEPLOY.md](./DEPLOY.md).

---

## 🛠️ Tech stack

| Layer | Choice |
| --- | --- |
| Framework | React 18 + TypeScript (strict) |
| Build | Vite 6 |
| Styling | Tailwind CSS 4 (`@tailwindcss/vite`) |
| Math | KaTeX (the only runtime dep besides React) |
| Visualization | Native Canvas 2D & SVG, all hand-written |
| Markdown | Custom renderer + lightweight code highlighter |

---

## 📁 Project structure

```
src/
├── App.tsx                 top-level nav, sidebar, read/edit modes
├── types.ts                Article / Block data model
├── storage.ts              localStorage I/O + version migration
├── seed.ts                 the 11 built-in example articles
├── lib/
│   ├── useAnimationFrame.ts   rAF animation-loop hook
│   ├── canvas.ts              prepareCanvas(): crisp HiDPI drawing
│   ├── markdown.ts            Markdown + KaTeX renderer
│   └── highlight.ts           lightweight code highlighter
├── components/             BlockRenderer / BlockEditor / ConfigPanel / WidgetView
└── widgets/                11 interactive components + registry.tsx
```

---

## ➕ Extending: add an interactive component

This is the project's main extension point — and the main direction for PRs.

1. Create `src/widgets/XxxWidget.tsx`, exporting a component and a `WidgetDefinition`:

```ts
export const XxxWidget: WidgetDefinition<XxxProps> = {
  type: 'xxx',
  label: 'Demo widget',
  description: 'One line on what the reader can play with.',
  icon: '🆕',
  defaultProps: { /* ... */ },
  configSchema: [ /* schema-driven param panel */ ],
  Component: Xxx,
}
```

2. Import and register it in `src/widgets/registry.tsx`.
3. It shows up automatically under "Add block → Interactive component".

**Conventions** (see `CLAUDE.md`):

- Pointer interaction uses React pointer events + `setPointerCapture`; no `window.addEventListener`.
- Canvas must use `prepareCanvas()` for HiDPI, or text blurs.
- An SVG `viewBox` must match the coordinate scale of the rendered geometry.
- Reader-adjustable controls mirror props into local `useState`.

---

## 🤝 Contributing

Pull requests are welcome — new demos or article improvements alike!

- **New knowledge demos** — the most valuable contribution. Follow "add an interactive component" above and pair it with a progressive article (intuition → principle → hands-on → applications).
- **Article improvements** — add real-world applications, fix phrasing, include references.
- **Visual & interaction polish** — animation smoothness, palette, mobile adaptation.
- **Bug fixes** — please include reproduction steps.

Before submitting, make sure `npm run build` passes (it includes strict type-checking). Commit messages can be Chinese or English — just keep them concise.

---

## 📄 License

[MIT](./LICENSE) — free to use, modify, and distribute. Using the demos in teaching or commercial presentations is warmly encouraged.

---

If this project helps you, a ⭐ Star is appreciated — and we look forward to your PR.
