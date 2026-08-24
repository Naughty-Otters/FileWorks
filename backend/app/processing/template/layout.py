"""Design-pad layout solver (parity with frontend design-pad/layout)."""

from __future__ import annotations

from app.processing.template.schema import DesignDocument, DesignNode, NodeLayout, PageStyle

TEXT_PAD_X = 12
TEXT_PAD_Y = 8
CHAR_WIDTH_RATIO = 0.52


def estimate_text_height(node: DesignNode) -> float:
    font_size = max(8.0, float(node.style.font_size or 14))
    line_height = 1.25 if node.type == "heading" else 1.4
    line_height_px = font_size * line_height
    content_w = max(20.0, node.w - TEXT_PAD_X)
    chars_per_line = max(1, int(content_w / (font_size * CHAR_WIDTH_RATIO)))
    text = node.label or " "

    lines = 0
    for part in text.split("\n"):
        if len(part) == 0:
            lines += 1
            continue
        lines += max(1, (len(part) + chars_per_line - 1) // chars_per_line)
    lines = max(1, lines)
    return float(int(lines * line_height_px + TEXT_PAD_Y + 0.999))


def fit_text_content(node: DesignNode) -> None:
    for child in node.children:
        fit_text_content(child)
    if node.type in {"paragraph", "heading"}:
        node.h = max(node.h, estimate_text_height(node))


def resolve_auto_size(node: DesignNode) -> None:
    for child in node.children:
        resolve_auto_size(child)
    if not node.children or node.layout is None:
        return

    layout = node.layout
    is_row = layout.direction != "column"
    gap_total = layout.gap * max(0, len(node.children) - 1)
    pad = 2 * layout.padding

    if layout.justify == "start":
        if is_row:
            content_w = sum(c.w for c in node.children) + gap_total
            node.w = content_w + pad
        else:
            content_h = sum(c.h for c in node.children) + gap_total
            node.h = content_h + pad

    if is_row:
        max_h = max(c.h for c in node.children)
        node.h = max(node.h, max_h + pad)


def _arrange_node(node: DesignNode, props: NodeLayout) -> None:
    is_row = props.direction != "column"
    inner_w = max(0.0, node.w - 2 * props.padding)
    inner_h = max(0.0, node.h - 2 * props.padding)
    inner_main = inner_w if is_row else inner_h
    inner_cross = inner_h if is_row else inner_w

    n = len(node.children)
    total_main = sum((c.w if is_row else c.h) for c in node.children) + props.gap * max(0, n - 1)
    extra = max(0.0, inner_main - total_main)

    if props.justify == "end":
        cursor = extra
        spacing = props.gap
    elif props.justify == "center":
        cursor = extra / 2
        spacing = props.gap
    elif props.justify == "space-between":
        cursor = 0.0
        spacing = props.gap + extra / (n - 1) if n > 1 else props.gap
    else:
        cursor = 0.0
        spacing = props.gap

    for child in node.children:
        main_size = child.w if is_row else child.h
        cross_size = child.h if is_row else child.w

        if props.align == "end":
            cross_pos = inner_cross - cross_size
            effective_cross = cross_size
        elif props.align == "center":
            cross_pos = (inner_cross - cross_size) / 2
            effective_cross = cross_size
        elif props.align == "stretch":
            cross_pos = 0.0
            effective_cross = inner_cross
        else:
            cross_pos = 0.0
            effective_cross = cross_size

        if is_row:
            child.x = props.padding + cursor
            child.y = props.padding + cross_pos
            child.h = effective_cross
        else:
            child.y = props.padding + cursor
            child.x = props.padding + cross_pos
            child.w = effective_cross

        cursor += main_size + spacing


def arrange(node: DesignNode) -> None:
    if node.layout is not None:
        _arrange_node(node, node.layout)
    for child in node.children:
        arrange(child)


def reflow_freeform_stacks(node: DesignNode, default_gap: float = 16.0) -> None:
    for child in node.children:
        reflow_freeform_stacks(child, default_gap)
    if node.layout is not None or len(node.children) < 2:
        return

    ordered = sorted(node.children, key=lambda c: (c.y, c.x))
    for i in range(1, len(ordered)):
        prev = ordered[i - 1]
        cur = ordered[i]
        natural_gap = cur.y - (prev.y + prev.h)
        gap = natural_gap if natural_gap > 0 else default_gap
        min_y = prev.y + prev.h + gap
        if cur.y < min_y:
            cur.y = min_y


def enforce_page_bounds(root: DesignNode, page_size: PageStyle) -> None:
    def clamp_width(node: DesignNode, parent_content_right: float | None) -> None:
        if node.id != "root" and parent_content_right is not None:
            node.w = min(node.w, max(20.0, parent_content_right - node.x))
        pad = node.layout.padding if node.layout else 0.0
        content_right = node.w - pad
        for child in node.children:
            clamp_width(child, content_right)

    clamp_width(root, None)

    max_bottom = 0.0

    def walk_bottom(node: DesignNode, ancestor_y: float) -> None:
        nonlocal max_bottom
        abs_y = ancestor_y + node.y
        if node.id != "root":
            max_bottom = max(max_bottom, abs_y + node.h)
        child_ancestor_y = 0.0 if node.id == "root" else abs_y
        for child in node.children:
            walk_bottom(child, child_ancestor_y)

    walk_bottom(root, 0.0)
    needed_pages = max(1, int((max_bottom + page_size.h - 1e-9) // page_size.h) or 1)
    if max_bottom > 0:
        needed_pages = max(1, int(-(-max_bottom // page_size.h)))
    root.w = page_size.w
    root.h = max(root.h, needed_pages * page_size.h)


def apply_full_layout(document: DesignDocument) -> DesignDocument:
    """Mutate a deep copy: fit text → hug → arrange → reflow → page bounds."""
    laid_out = document.model_copy(deep=True)
    fit_text_content(laid_out.root)
    resolve_auto_size(laid_out.root)
    arrange(laid_out.root)
    reflow_freeform_stacks(laid_out.root)
    enforce_page_bounds(laid_out.root, laid_out.page)
    return laid_out
