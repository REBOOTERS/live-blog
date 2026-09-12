/**
 * JPEG 用的那套 8×8 DCT 数学：正交基、标准亮度量化表、之字形扫描序，
 * 以及正逆变换与按质量缩放的量化表。纯函数、无依赖。
 */

/** 正交归一 DCT-II 基，B[u*8+x] = c(u)·cos((2x+1)uπ/16)，c(0)=√(1/8)，c(u>0)=√(2/8)。 */
export const DCT_BASIS: Float64Array = (() => {
  const b = new Float64Array(64)
  for (let u = 0; u < 8; u++) {
    const c = u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8)
    for (let x = 0; x < 8; x++) b[u * 8 + x] = c * Math.cos(((2 * x + 1) * u * Math.PI) / 16)
  }
  return b
})()

/** ITU T.81 Annex K Table K.1 亮度量化表（自然序 v*8+u，非之字形序）。 */
export const JPEG_LUMA_Q: Float64Array = Float64Array.from([
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56,
  14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113,
  92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
])

/** ZIGZAG[k] = 之字形扫描第 k 步对应的自然序下标（v*8+u）。 */
export const ZIGZAG: Uint8Array = Uint8Array.from([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20,
  13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59,
  52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63,
])

/** libjpeg 的质量缩放：q<50 → scale=5000/q，否则 200−2q；q=50 原表，q=100 全 1。
 *  与 libjpeg 一致用截断除法（(Q·scale+50)/100），不用 Math.round——q=50 时每项
 *  恰为 x.5，round 会整体 +1，破坏恒等。 */
export function scaledQuantTable(quality: number): Float64Array {
  const q = Math.max(1, Math.min(100, Math.round(quality)))
  const scale = q < 50 ? 5000 / q : 200 - 2 * q
  const t = new Float64Array(64)
  for (let i = 0; i < 64; i++) {
    t[i] = Math.min(255, Math.max(1, Math.floor((JPEG_LUMA_Q[i] * scale + 50) / 100)))
  }
  return t
}

// dct8/idct8 是可分离的两次 8×8 矩阵乘：正向 F = B·f·Bᵀ，逆向 f = Bᵀ·F·B。
// 单线程 JS 里两函数互不重入，共用一块 scratch（dst 允许就是 src）。
const SCRATCH = new Float64Array(64)

export function dct8(src: Float64Array, dst: Float64Array): void {
  // T[v][x] = Σ_y B[v][y]·f[y][x]
  for (let v = 0; v < 8; v++) {
    for (let x = 0; x < 8; x++) {
      let s = 0
      for (let y = 0; y < 8; y++) s += DCT_BASIS[v * 8 + y] * src[y * 8 + x]
      SCRATCH[v * 8 + x] = s
    }
  }
  // F[v][u] = Σ_x B[u][x]·T[v][x]
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let x = 0; x < 8; x++) s += DCT_BASIS[u * 8 + x] * SCRATCH[v * 8 + x]
      dst[v * 8 + u] = s
    }
  }
}

export function idct8(src: Float64Array, dst: Float64Array): void {
  // T[y][u] = Σ_v B[v][y]·F[v][u]
  for (let y = 0; y < 8; y++) {
    for (let u = 0; u < 8; u++) {
      let s = 0
      for (let v = 0; v < 8; v++) s += DCT_BASIS[v * 8 + y] * src[v * 8 + u]
      SCRATCH[y * 8 + u] = s
    }
  }
  // f[y][x] = Σ_u B[u][x]·T[y][u]
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      let s = 0
      for (let u = 0; u < 8; u++) s += DCT_BASIS[u * 8 + x] * SCRATCH[y * 8 + u]
      dst[y * 8 + x] = s
    }
  }
}
