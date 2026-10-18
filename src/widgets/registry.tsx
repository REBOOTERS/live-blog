import type { ComponentType } from 'react'
import { PendulumWidget } from './PendulumWidget'
import { BezierWidget } from './BezierWidget'
import { SortWidget } from './SortWidget'
import { ProjectileWidget } from './ProjectileWidget'
import { FourierWidget } from './FourierWidget'
import { MatrixWidget } from './MatrixWidget'
import { BackpropWidget } from './BackpropWidget'
import { ColorWidget } from './ColorWidget'
import { SoundWaveWidget } from './SoundWaveWidget'
import { TransformerWidget } from './TransformerWidget'
import { GraphSearchWidget } from './GraphSearchWidget'
import { TokenizerWidget } from './TokenizerWidget'
import { TokenBudgetWidget } from './TokenBudgetWidget'
import { AirfoilWidget } from './AirfoilWidget'
import { RocketLaunchWidget } from './RocketLaunchWidget'
import { BoosterLandingWidget } from './BoosterLandingWidget'
import { VideoFilterWidget } from './VideoFilterWidget'
import { PipWidget } from './PipWidget'
import { WatermarkDiceWidget } from './WatermarkDiceWidget'
import { WatermarkCountWidget } from './WatermarkCountWidget'
import { WatermarkEditWidget } from './WatermarkEditWidget'
import { FrameConsistencyWidget } from './FrameConsistencyWidget'
import { VideoLedgerWidget } from './VideoLedgerWidget'
import { VideoPatchWidget } from './VideoPatchWidget'
import { WaveCancelWidget } from './WaveCancelWidget'
import { AncDelayWidget } from './AncDelayWidget'
import { AncLmsWidget } from './AncLmsWidget'
import { DctBasisWidget } from './DctBasisWidget'
import { DctBlockWidget } from './DctBlockWidget'
import { JpegQualityWidget } from './JpegQualityWidget'
import { OpusSessionWidget } from './OpusSessionWidget'
import { AgentLoopWidget } from './AgentLoopWidget'
import { InfographicWidget } from './InfographicWidget'
import { VpnTunnelWidget } from './VpnTunnelWidget'
import { HallwayWidget } from './HallwayWidget'

// ---- Config field schema (drives the editor's property panel) ----

export type ConfigField =
  | {
      key: string
      label: string
      type: 'range'
      min: number
      max: number
      step: number
      unit?: string
    }
  | { key: string; label: string; type: 'number'; min?: number; max?: number; step?: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[] }
  | { key: string; label: string; type: 'text' }
  | { key: string; label: string; type: 'textarea' }
  | { key: string; label: string; type: 'color' }
  | { key: string; label: string; type: 'checkbox' }

export interface WidgetDefinition<P extends object = Record<string, unknown>> {
  type: string
  label: string
  description: string
  /** Emoji or short symbol used in menus */
  icon: string
  defaultProps: P
  configSchema: ConfigField[]
  Component: ComponentType<{ props: P; editable?: boolean; onPropsChange?: (props: P) => void }>
  /** 支持把演示动画导出为视频（Canvas 直录；SVG/DOM 逐帧光栅化）。 */
  exportable?: boolean
}

const registry: Record<string, WidgetDefinition<any>> = {
  pendulum: PendulumWidget,
  bezier: BezierWidget,
  sort: SortWidget,
  projectile: ProjectileWidget,
  fourier: FourierWidget,
  matrix: MatrixWidget,
  backprop: BackpropWidget,
  'color-mix': ColorWidget,
  'sound-wave': SoundWaveWidget,
  transformer: TransformerWidget,
  'graph-search': GraphSearchWidget,
  tokenizer: TokenizerWidget,
  'token-budget': TokenBudgetWidget,
  airfoil: AirfoilWidget,
  'rocket-launch': RocketLaunchWidget,
  'booster-landing': BoosterLandingWidget,
  'video-filter': VideoFilterWidget,
  pip: PipWidget,
  'watermark-dice': WatermarkDiceWidget,
  'watermark-count': WatermarkCountWidget,
  'watermark-edit': WatermarkEditWidget,
  'frame-consistency': FrameConsistencyWidget,
  'video-ledger': VideoLedgerWidget,
  'video-patches': VideoPatchWidget,
  'wave-cancel': WaveCancelWidget,
  'anc-delay': AncDelayWidget,
  'anc-lms': AncLmsWidget,
  'dct-basis': DctBasisWidget,
  'dct-block': DctBlockWidget,
  'jpeg-quality': JpegQualityWidget,
  'opus-session': OpusSessionWidget,
  'agent-loop': AgentLoopWidget,
  infographic: InfographicWidget,
  'vpn-tunnel': VpnTunnelWidget,
  hallway: HallwayWidget,
}

// 新组件只放文件。这里扫一遍，已经写进上面名单的不覆盖，避免两个人同时改这一份对象。
const discovered = import.meta.glob('./*Widget.tsx', { eager: true }) as Record<string, Record<string, unknown>>

function isWidgetDefinition(value: unknown): value is WidgetDefinition {
  if (!value || typeof value !== 'object') return false
  const widget = value as Partial<WidgetDefinition>
  return typeof widget.type === 'string' && typeof widget.label === 'string' && typeof widget.Component === 'function'
}

for (const mod of Object.values(discovered)) {
  for (const value of Object.values(mod)) {
    if (!isWidgetDefinition(value) || registry[value.type]) continue
    registry[value.type] = value
  }
}

export function getWidget(type: string): WidgetDefinition<any> | undefined {
  return registry[type]
}

export function listWidgets(): WidgetDefinition<any>[] {
  return Object.values(registry)
}
