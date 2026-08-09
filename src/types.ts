// Core data model for LiveBlog
//
// An Article is an ordered list of Blocks. Each Block is either prose (markdown
// text) or an interactive Widget. Widgets are identified by a `type` key that
// maps to an entry in the widget registry. `props` holds the widget-specific
// configuration / initial state.

export type Block =
  | { id: string; kind: 'text'; content: string }
  | { id: string; kind: 'widget'; type: string; props: Record<string, unknown> }

export interface Article {
  id: string
  title: string
  description: string
  /** ISO timestamp — stable publication date, used as the sort key */
  publishedAt: string
  /** ISO timestamp — last edit, refreshed on every save */
  updatedAt: string
  blocks: Block[]
}
