import type {
  DesignNode,
  ElementKind,
  LayoutProps,
  NodeStyle,
  TemplateVariable,
  VariableType,
} from "../types";

/** Alias for the node created by the most recent `add_element` in the same step. */
export const LAST_CREATED = "last_created";
/** Alias for the parent of `last_created` (sibling placement). */
export const LAST_CREATED_SIBLING = "last_created_sibling";
/**
 * Nearest column auto-layout ancestor of `last_created` (or self if it is a
 * column box). Use this to stack `add_info_row` under a section — NOT
 * `last_created_sibling`, which after a row points at the row and nests rows.
 */
export const LAST_COLUMN = "last_column";

export const NODE_REF_ALIASES = [LAST_CREATED, LAST_CREATED_SIBLING, LAST_COLUMN] as const;

export type DesignOp =
  | { op: "select"; id: string }
  | { op: "add_element"; kind: ElementKind; parentId: string; x?: number; y?: number }
  | { op: "remove_element"; id: string }
  | { op: "update_label"; id: string; label: string }
  | { op: "update_style"; id: string; patch: Partial<NodeStyle> }
  | { op: "update_level"; id: string; level: number }
  | { op: "move_node"; id: string; x: number; y: number }
  | { op: "resize_node"; id: string; w: number; h: number }
  | { op: "update_box"; id: string; box: { x: number; y: number; w: number; h: number } }
  | { op: "update_layout_props"; id: string; patch: Partial<LayoutProps> }
  | { op: "toggle_auto_layout"; id: string; enabled: boolean }
  | { op: "move_in_tree"; id: string; parentId: string; index: number; x?: number; y?: number }
  | { op: "update_image"; id: string; patch: { imageSrc?: string; objectFit?: "cover" | "contain" } }
  | { op: "update_node"; id: string; patch: Partial<Pick<DesignNode, "repeat" | "level">> }
  | { op: "add_variable"; name: string; label: string; type?: VariableType; sampleValue?: string }
  | { op: "update_variable"; id: string; patch: Partial<Omit<TemplateVariable, "id">> }
  | { op: "remove_variable"; id: string }
  | { op: "set_page_width"; w: number }
  | { op: "set_page_count"; n: number };

export type AgentToolName =
  | "edit_node"
  | "edit_variable"
  | "edit_page"
  | "select"
  | "scaffold_page"
  | "add_section"
  | "add_info_row"
  | "add_two_col";

export type AgentTool = {
  tool: AgentToolName | string;
  action?: "add" | "update" | "remove" | string;
  id?: string;
  parentId?: string;
  kind?: ElementKind;
  label?: string;
  title?: string;
  value?: string;
  level?: number;
  index?: number;
  style?: Partial<NodeStyle>;
  layout?: {
    enabled?: boolean;
    direction?: "row" | "column";
    gap?: number;
    padding?: number;
    align?: string;
    justify?: string;
  };
  box?: { x?: number; y?: number; w?: number; h?: number };
  image?: { imageSrc?: string; objectFit?: "cover" | "contain" };
  repeat?: { over?: string; as?: string };
  name?: string;
  type?: VariableType;
  sampleValue?: string;
  width?: number;
  pageCount?: number;
  gap?: number;
  padding?: number;
  [key: string]: unknown;
};

export type DesignEditBrief = {
  intent: "create" | "update" | "adjust" | "clarify" | string;
  concept: string;
  bands: string[];
  notes?: string;
};

export type DesignEditStep = {
  reasoning: string;
  summary: string;
  tools?: AgentTool[];
  ops: DesignOp[];
};

export type DesignEditResponse = {
  reply: string;
  designBrief?: DesignEditBrief | null;
  steps: DesignEditStep[];
};

export type ChatRole = "user" | "assistant";

export type DesignEditConversationTurn = {
  role: ChatRole;
  content: string;
};

export type DesignEditRequest = {
  message: string;
  document: unknown;
  selection_id?: string | null;
  conversation?: DesignEditConversationTurn[];
  mode?: "plan_and_apply";
};

export type OpResult = {
  ok: boolean;
  op: DesignOp;
  error?: string;
  createdId?: string;
};

export type ApplyOpsResult = {
  results: OpResult[];
  affectedNodeIds: string[];
  lastCreatedId?: string;
};
