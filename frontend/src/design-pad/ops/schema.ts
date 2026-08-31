import type {
  DesignNode,
  ElementKind,
  LayoutProps,
  NodeStyle,
  TemplateVariable,
  VariableType,
} from "../types";

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

export type DesignEditStep = {
  reasoning: string;
  summary: string;
  ops: DesignOp[];
};

export type DesignEditResponse = {
  reply: string;
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
};
