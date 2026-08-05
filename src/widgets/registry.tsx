import type { ComponentType } from 'react'
import { PendulumWidget } from './PendulumWidget'
import { BezierWidget } from './BezierWidget'
import { SortWidget } from './SortWidget'
import { ProjectileWidget } from './ProjectileWidget'
import { FourierWidget } from './FourierWidget'
import { MatrixWidget } from './MatrixWidget'
import { BackpropWidget } from './BackpropWidget'

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
}

const registry: Record<string, WidgetDefinition<any>> = {
  pendulum: PendulumWidget,
  bezier: BezierWidget,
  sort: SortWidget,
  projectile: ProjectileWidget,
  fourier: FourierWidget,
  matrix: MatrixWidget,
  backprop: BackpropWidget,
}

export function getWidget(type: string): WidgetDefinition<any> | undefined {
  return registry[type]
}

export function listWidgets(): WidgetDefinition<any>[] {
  return Object.values(registry)
}
