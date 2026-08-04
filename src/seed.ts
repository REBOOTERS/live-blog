import type { Article } from './types'
import { uid } from './lib/id'

const now = () => new Date().toISOString()

// Each knowledge point is its own article. New articles should follow the same
// shape: ordered blocks of text/widget, with text framing the interaction.

function pendulumArticle(): Article {
  return {
    id: 'art-pendulum',
    title: '单摆：从周期到能量守恒',
    description: '拖动小球释放，亲手感受简谐运动、等时性与能量转化。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 一根绳子挂一个小球\n\n单摆的运动由一个看似简单的方程描述：\n\n$$\\ddot{\\theta} = -\\frac{g}{L}\\sin\\theta$$\n\n其中 $\\theta$ 是摆角，$g$ 是重力加速度，$L$ 是摆长。小角度时 $\\sin\\theta \\approx \\theta$，它近似为**简谐运动**，周期只与 $L$ 和 $g$ 有关，与振幅无关——这就是伽利略发现的**等时性**。但当角度变大，非线性的 $\\sin\\theta$ 项就开始发挥作用，周期会随振幅缓慢增长。',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'pendulum',
        props: {
          length: 1.2,
          gravity: 9.8,
          damping: 0.02,
          initialAngle: 0.8,
          showEnergy: true,
        },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 动手试试\n\n- 把小球拖到不同高度后松手，观察大角度和小角度下周期的差别。\n- 把阻尼调到 0，观察动能和势能如何相互转化而总和近似不变。\n- 增大重力（比如调到 20，模拟木星），看看摆动如何变快。\n\n一个常见的误解是「重的球摆得更快」。实际上在理想模型中，质量被约掉了，起作用的只有摆长和重力——同一根摆上，铁球和乒乓球同频。',
      },
    ],
  }
}

function bezierArticle(): Article {
  return {
    id: 'art-bezier',
    title: '贝塞尔曲线：钢笔工具背后的数学',
    description: '拖动控制点，看 De Casteljau 算法如何逐层插值出一条曲线。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 从钢笔工具到三次贝塞尔\n\n几乎所有矢量绘图软件的钢笔工具，底层都是贝塞尔曲线。一条三次贝塞尔由两个锚点 $P_0, P_3$ 和两个控制点 $P_1, P_2$ 定义。曲线上的点由参数 $t \\in [0,1]$ 通过 **De Casteljau 算法** 逐层线性插值得到。\n\n下面你可以拖动四个点，并移动滑块观察红点如何沿曲线运动。',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'bezier',
        props: {
          p0x: 40,
          p0y: 280,
          p1x: 150,
          p1y: 60,
          p2x: 330,
          p2y: 300,
          p3x: 440,
          p3y: 120,
          animate: true,
          showConstruction: true,
          color: '#4f46e5',
        },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 看懂构造线\n\n图中黄色的点是第一轮插值的结果在第二轮上的位置，它们之间再连一条线；红色点最终落在曲线上。这正是公式\n\n$$B(t) = (1-t)^3 P_0 + 3(1-t)^2 t P_1 + 3(1-t)t^2 P_2 + t^3 P_3$$\n\n的几何含义。注意曲线并**不一定经过**控制点 $P_1$、$P_2$——它们是「拉」曲线的手柄：控制点离曲线越远，曲线在该方向被拉得越长。',
      },
    ],
  }
}

function sortArticle(): Article {
  return {
    id: 'art-sort',
    title: '看见复杂度：四种排序算法',
    description: '把每次比较和交换拆成一帧，亲眼比较冒泡、选择、插入与快排。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## $O(n^2)$ 到底长什么样\n\n「冒泡排序是 $O(n^2)$」很好记，但复杂度只是一个数字。下面的可视化把每一次比较和交换都拆成一步，你可以切换不同算法、调整数组长度，用「单步」按钮观察它们的策略差异。',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'sort',
        props: {
          count: 24,
          algorithm: 'quick',
          speed: 12,
        },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 观察要点\n\n- **冒泡排序**：每一轮把最大的元素「冒泡」到右端，像水壶里的气泡。\n- **选择排序**：每一轮在未排序区间找最小值，与左端交换——交换次数最少，但比较次数始终是 $O(n^2)$。\n- **插入排序**：像整理手牌，逐张插入到前面已排序的位置；对近乎有序的数据非常快。\n- **快速排序**：选一个基准（粉色），把比它小的放左边、大的放右边，再递归处理两边——平均 $O(n\\log n)$。\n\n用「🎲 新数组」生成不同的随机数据，体会最坏情况和最好情况的差别。',
      },
    ],
  }
}

function projectileArticle(): Article {
  return {
    id: 'art-projectile',
    title: '抛体运动：弹道与速度分解',
    description: '弹弓式拖拽设定初速度与角度，观察抛物线与水平/竖直分量。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 两个独立方向的叠加\n\n忽略空气阻力时，抛体的运动可以分解成两个互不干扰的方向：\n\n- **水平方向**没有加速度，是匀速直线运动；\n- **竖直方向**受重力作用，是初速度为 $v_y$ 的匀加速运动。\n\n两者独立叠加，合成一条抛物线。下面的演示采用「弹弓式」操作：在画面上从发射点向**反方向**拖拽（越远力越大），松手发射。红色箭头是 $v_x$，绿色箭头是 $v_y$。',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'projectile',
        props: {
          gravity: 9.8,
          showVelocity: true,
          airDrag: 0,
          trail: true,
        },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 几个值得验证的猜想\n\n- 45° 仰角时射程最远吗？（理想模型中答案是肯定的）\n- 竖直方向的速度分量在最高点是多少？\n- 把空气阻力调大，轨迹不再对称——落地段比上升段更陡。\n\n观察飞行过程中红色箭头长度始终不变（水平匀速），而绿色箭头持续缩短、过最高点后反向增长（竖直匀变速），这正是运动独立性的直观证据。',
      },
    ],
  }
}

/** Returns the initial set of articles shown on first launch / empty storage. */
export function seedArticles(): Article[] {
  return [pendulumArticle(), bezierArticle(), sortArticle(), projectileArticle()]
}
