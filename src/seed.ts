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
    description: '朝目标方向拖拽设定初速度与角度，实时预览抛物线与水平/竖直分量。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 两个独立方向的叠加\n\n忽略空气阻力时，抛体的运动可以分解成两个互不干扰的方向：\n\n- **水平方向**没有加速度，是匀速直线运动；\n- **竖直方向**受重力作用，是初速度为 $v_y$ 的匀加速运动。\n\n两者独立叠加，合成一条抛物线。下面的演示中，从发射点**朝目标方向**拖拽（拖得越远初速度越大），实时虚线会预览落点，松手即可发射。飞行时红色箭头是 $v_x$，绿色箭头是 $v_y$。',
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

function fourierArticle(): Article {
  return {
    id: 'art-fourier',
    title: '傅里叶变换：把任意信号拆成正弦波',
    description: '从一段方波到 MP3 压缩——亲手调节频率分量，理解时域与频域的对应。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 一个反直觉的事实\n\n听音乐时，你听到的是空气压强随时间的起伏——一条复杂的波形。但音响均衡器上显示的却是「低音、中音、高音」一根根独立的柱子。**同一段声音，为什么可以有两种完全不同的描述方式？**\n\n傅里叶变换给出的答案惊人地简洁：**任何信号，无论多复杂，都可以表示成一系列不同频率正弦波的叠加。** 时域里的一条扭曲曲线，在频域里只是一组振幅。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 它到底在算什么\n\n把信号 $x[n]$ 切成 $N$ 个采样点，离散傅里叶变换（DFT）为每个频率 $k$ 计算一个复数系数：\n\n$$X[k] = \\sum_{n=0}^{N-1} x[n]\\, e^{-i\\,2\\pi k n / N}$$ \n\n你可以把它理解成一次**相关性测量**：拿频率为 $k$ 的标准正弦波去和信号相乘再求和。如果信号里恰好含有这个频率，乘积大多同号、累加出一个大值；如果没有，正负抵消、结果接近零。\n\n- $|X[k]|$（幅值）回答「这个频率有多少」；\n- $\\arg X[k]$（相位）回答「它从哪里开始」。\n\n逆变换则把这些正弦波重新加回去：\n\n$$x[n] = \\frac{1}{N}\\sum_{k} X[k]\\, e^{i\\,2\\pi k n / N}$$',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'fourier',
        props: { harmonics: 4, speed: 0.4, showSpectrum: true },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 动手实验\n\n- 选择**方波**，把 $K$ 从 1 慢慢往上加。你会看到锯齿状的波纹（吉布斯现象）逐渐逼近方波的直角——方波只含奇次谐波 $1,3,5,\\dots$，幅值按 $1/k$ 衰减。\n- 选择**三角波**或**锯齿波**，观察频谱柱的分布差异：锯齿波含有所有整数次谐波，三角波的高次谐波衰减得更快（按 $1/k^2$），所以它看起来更「圆滑」。\n- 在时域图上**用鼠标手绘**任意曲线，立刻看它的频谱——你的随手一画也不过是一堆正弦波。\n\n注意蓝色重建曲线：$K$ 越大，它越贴近灰色原始信号，但只需要很少几个分量就能抓住信号的主体。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 实际意义：为什么它无处不在\n\n傅里叶变换之所以是现代技术的基石，是因为**在频域里，很多在时域里极难的操作变得异常简单**：\n\n- **音频处理与均衡器**：提升低音、压制人声杂音，本质上就是放大或削弱特定的 $|X[k]|$。MP3 压缩则把人耳听不到的微弱频率分量直接丢弃，体积能缩小到原来的十分之一。\n- **图像与视频压缩（JPEG/MPEG）**：把图像切成小块做二维 DCT（傅里叶变换的近亲），保留低频、舍弃高频细节，文件大幅变小而人眼几乎无感。\n- **滤波与降噪**：工频噪声集中在 50/60 Hz，在频域里就是一个尖峰，挖掉它即可干净除噪——这比在时域里直接处理容易得多。\n- **通信与无线**：Wi-Fi、4G/5G 用 OFDM 把数据调制到许多正交频率上并行传输；频谱分析也是雷达、声呐的核心。\n- **科学与医学**：FFT（快速傅里叶变换，DFT 的 $O(N\\log N)$ 算法）是核磁共振成像（MRI）、射电天文、地震分析、量子力学计算的底层引擎。\n\n一句话：当你把信号「翻译」到频域，卷积变成乘法、噪声变成尖峰、周期性一目了然。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 工作原理的一个直觉\n\n为什么偏偏是正弦波，而不是别的形状？因为正弦波是线性时不变系统（比如一段空气、一个滤波器）的**特征函数**：让一个正弦波通过这样的系统，它出来还是同频率的正弦波，只是振幅和相位改变。\n\n这意味着，当信号被分解成正弦波后，预测系统对它的响应就从「解复杂微分方程」降级为「每个频率乘一个系数」。整个频域方法的威力，都建立在这个优雅的性质之上。\n\n一个朴素的 DFT 是 $O(N^2)$ 的双重循环：\n\n```typescript\nfor (let k = 0; k < N; k++)\n  for (let n = 0; n < N; n++)\n    re[k] += x[n] * Math.cos(2*pi*k*n/N);\n```\n\n而 1965 年普及的 FFT 利用旋转因子的对称性把它降到 $O(N\\log N)$——正是这一数量级的跨越，让实时音频、高清视频和现代信号处理成为可能。',
      },
    ],
  }
}

function matrixArticle(): Article {
  return {
    id: 'art-matrix',
    title: '矩阵变换：矩阵是对空间的操作',
    description: '拖动基向量的像，亲眼看到旋转、拉伸、错切、镜像与降维，并理解行列式的几何含义。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 别把矩阵只当数字表格\n\n大多数人第一次接触矩阵，记住的是「一堆数字做乘法」。但几何视角更有力：**一个 $2\\times2$ 矩阵，是一个把二维平面「挪动」到二维平面的函数。**\n\n关键在于它是**线性**的变换：直线变换后仍是直线，原点留在原地。这种变换完全由它把两个基向量送到哪里来决定：\n\n$$\\hat{\\imath}=(1,0) \\mapsto \\begin{pmatrix}a\\\\c\\end{pmatrix}=\\text{第一列},\\qquad \\hat{\\jmath}=(0,1) \\mapsto \\begin{pmatrix}b\\\\d\\end{pmatrix}=\\text{第二列}$$\n\n因此矩阵 $M=\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}$ 的两列，就是变换后新坐标系的两根轴。任意点 $(x,y)$ 都会落到 $x\\cdot$第一列$+y\\cdot$第二列的位置。',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'matrix',
        props: { a: 1, b: 1, c: 0, d: 1, showGrid: true, showDeterminant: true },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 动手实验\n\n- 直接**拖动红色 î→ 和蓝色 ĵ→ 的箭头端点**。你在拖动的就是矩阵的两列——图形会跟着你的手实时变形。试试把红箭头拖到 $(0,1)$、蓝箭头拖到 $(-1,0)$，你就完成了一次 90° 旋转。\n- 点击预设：**缩放**拉伸面积、**错切**把矩形推成平行四边形、**反射**让箭头图形左右翻面、**投影**把整个平面压成一条线。\n- 注意下方的 $\\det(M)$：它的绝对值是面积被放大的倍数；它的正负告诉你图形是否被翻面。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 行列式到底是什么\n\n行列式不是一个需要死记的公式 $ad-bc$，它有清晰的几何意义：**单位正方形经过变换后面积的缩放倍数，并带一个方向符号。**\n\n- $|\\det M| > 1$：空间被拉伸；\n- $0 < |\\det M| < 1$：空间被压缩；\n- $\\det M < 0$：定向被翻转（图形翻面，就像把纸翻到背面）；\n- $\\det M = 0$：变换把整个平面**压扁**到一条线甚至一个点上——矩阵不可逆。此时不同的输入会被映射到同一输出，信息永久丢失。\n\n这也是为什么线性方程组 $M\\mathbf{x}=\\mathbf{b}$ 当 $\\det M=0$ 时要么无解、要么有无穷多解：变换本身就是不可逆的。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 实际意义与应用\n\n矩阵把「对空间的几何操作」变成了「可以运算的数字」，这让它成为无数领域的通用语言：\n\n- **计算机图形学**：旋转、缩放、平移、3D 到 2D 的透视投影，全部是矩阵。GPU 本质上是在并行做海量矩阵乘法；游戏和电影里每一帧画面都是矩阵变换的结果。\n- **机器人与无人机**：机械臂每个关节的姿态用旋转矩阵描述，多个关节的复合运动就是矩阵相乘。\n- **数据分析与机器学习**：数据被表示成向量和矩阵；主成分分析（PCA）通过协方差矩阵的特征向量找到数据分布的主轴；神经网络的每一层就是 $\\mathbf{y}=\\sigma(W\\mathbf{x}+\\mathbf{b})$，核心是一次矩阵乘法。\n- **物理与工程**：量子力学中算符是矩阵（可观测量是其特征值）；电路、结构力学、控制系统都建立在线性变换之上。\n\n还有两个深刻的结论：\n\n- **复合变换 = 矩阵乘法**：先旋转再拉伸，对应两个矩阵相乘（注意顺序不可交换）。\n- **逆矩阵 = 撤销变换**：$M^{-1}$ 把空间恢复原样——这正是图形软件里「撤销」和求解线性系统的数学基础。',
      },
    ],
  }
}

function backpropArticle(): Article {
  return {
    id: 'art-backprop',
    title: '反向传播：神经网络是怎样学习的',
    description: '实时观察一个小网络拟合函数的过程，理解梯度如何一层层往回传递。',
    updatedAt: now(),
    blocks: [
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 学习 = 逐步减小误差\n\n神经网络看起来很神秘，但拆开来看，它就是一个带许多可调旋钮（**权重**和**偏置**）的函数。给它一个输入，它算出一个输出；当输出和正确答案有差距时，就产生了**损失（loss）**。\n\n所谓「学习」，就是反复微调这些旋钮，让损失越来越小。问题是：一个网络可能有几百万个旋钮，怎么知道每个该往哪个方向拧、拧多少？反向传播（backpropagation）就是计算这个答案的高效算法。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 一个最小的网络\n\n下面演示的是一个 $1 \\to H \\to 1$ 的网络：一个输入 $x$，经过 $H$ 个隐藏神经元（用 $\\tanh$ 激活），加权求和得到输出 $\\hat{y}$：\n\n$$z_i = w_1^{(i)} x + b_1^{(i)},\\quad h_i = \\tanh(z_i),\\quad \\hat{y} = \\sum_i w_2^{(i)} h_i + b_2$$\n\n我们用均方误差 $L=\\frac{1}{N}\\sum(\\hat{y}-y)^2$ 衡量它和目标函数的差距。目标就是找到让 $L$ 最小的所有权重。',
      },
      {
        id: uid('blk'),
        kind: 'widget',
        type: 'backprop',
        props: { hidden: 4, learningRate: 0.08, speed: 8, target: 'sine' },
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 动手实验\n\n- 点**训练/暂停**，观察蓝色预测曲线如何逐步贴合灰色目标，右下角损失曲线如何下降。连线的粗细颜色代表权重大小与正负（蓝正红负）。\n- 把目标换成**阶跃**：$\\tanh$ 是光滑函数，网络需要用多个隐藏神经元拼出一个陡峭的转折——注意它为什么总是学不出真正的直角。\n- 试试**高斯峰**和**三次曲线**；再把隐藏层调到 2 或 6，感受模型容量的差异。\n- 把学习率拉到极小（训练几乎不动）或极大（损失剧烈震荡甚至发散）——这能让你直观理解为什么学习率是最关键的超参数之一。\n- 点**单步**一次只走一步，配合网络图观察权重如何改变。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 反向传播的核心：链式法则\n\n为什么叫「反向」传播？因为梯度要从损失出发，**从后往前**一层层算。\n\n假设输出端的误差是 $\\delta_o = \\frac{\\partial L}{\\partial \\hat{y}}$，我们想知道每个权重对损失的「贡献」。利用微积分的链式法则：\n\n$$\\frac{\\partial L}{\\partial w_2^{(i)}} = \\delta_o\\, h_i,\\qquad \\frac{\\partial L}{\\partial w_1^{(i)}} = \\underbrace{\\delta_o\\, w_2^{(i)}\\,(1-h_i^2)}_{\\text{误差传回隐藏层}}\\, x$$\n\n关键在于因子 $(1-h_i^2)$——这是 $\\tanh$ 的导数。误差从输出层流向隐藏层时，每经过一层都要乘上这样的导数。\n\n算出梯度后，用**梯度下降**更新每个权重：\n\n$$w \\leftarrow w - \\eta\\, \\frac{\\partial L}{\\partial w}$$\n\n其中 $\\eta$ 就是学习率。一次完整的训练 = 一次**前向传播**（算输出和损失）+ 一次**反向传播**（算所有梯度）+ 一次更新。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 实际意义与应用\n\n反向传播是 1986 年由 Rumelhart、Hinton 和 Williams 推广开来的，它是现代深度学习的基石——没有它，就无法训练动辄数十亿参数的网络：\n\n- **效率是关键**：如果对每个权重都单独扰动来估算梯度，成本是参数数量级的；反向传播利用链式法则，只需一次前向加一次反向就能算出**全部**梯度，成本与一次前向传播相当。PyTorch、TensorFlow 等框架的核心「自动微分」引擎，做的就是这件事。\n- **无处不在**：图像识别（CNN）、大语言模型（Transformer）、语音识别、AlphaGo、自动驾驶——每一个模型的训练循环都是前向、算损失、反向传播、更新这四步的重复。\n- **它也解释了训练中的难题**：因为梯度要连乘许多层的导数，深层网络容易出现**梯度消失**（乘积越来越小，前面的层学不动）或**梯度爆炸**（乘积越来越大，训练发散）。ReLU 激活、残差连接、层归一化等技术，本质上都是在缓解这个问题。',
      },
      {
        id: uid('blk'),
        kind: 'text',
        content:
          '## 一个值得记住的视角\n\n神经网络的「智能」并不神秘：它是一个由许多简单函数嵌套而成的高维函数，而反向传播让这个函数能**根据数据自动调整自己的形状**。图中那条蓝线慢慢贴合目标的过程，就是机器「学习」最朴素的样子——它不是在记忆答案，而是在误差曲面上一步步走向谷底。\n\n```text\n循环直到收敛：\n  1. 前向：把数据送入网络，算出预测和损失\n  2. 反向：从损失出发，用链式法则算出每个权重的梯度\n  3. 更新：每个权重沿梯度下降的方向移动一小步\n```\n\n调学习率、换目标函数、增减神经元——你在上面的演示里亲手操纵的，正是当今每一个 AI 系统内部正在发生的事。',
      },
    ],
  }
}

/** Returns the initial set of articles shown on first launch / empty storage. */
export function seedArticles(): Article[] {
  return [
    pendulumArticle(),
    bezierArticle(),
    sortArticle(),
    projectileArticle(),
    fourierArticle(),
    matrixArticle(),
    backpropArticle(),
  ]
}
