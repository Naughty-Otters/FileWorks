import { createEmptyDocument, createNode, nextId, type DesignDocument } from "./types";

function stack(doc: DesignDocument) {
  let y = 40;
  for (const node of doc.root.children) {
    node.x = 40;
    node.y = y;
    node.w = doc.pageSize.w - 80;
    y += node.h + 16;
  }
  return doc;
}

function invoice(): DesignDocument {
  const doc = createEmptyDocument();
  const title = createNode("heading");
  title.label = "INVOICE";
  const customer = createNode("paragraph");
  customer.label = "Bill to: {{ customer.name }}\n{{ customer.address }}";
  const row = createNode("box");
  row.label = "Line item";
  row.repeat = { over: "items", as: "item" };
  row.children = [createNode("paragraph"), createNode("paragraph")];
  row.children[0].label = "{{ item.description }}";
  row.children[1].label = "{{ item.amount }}";
  row.layout!.direction = "row";
  const total = createNode("heading");
  total.label = "Total: {{ total }}";
  doc.root.children = [title, customer, row, total];
  doc.variables = [
    { id: nextId("var"), name: "customer", label: "Customer", type: "object", sampleValue: '{"name":"Acme Co.","address":"100 Main Street"}' },
    {
      id: nextId("var"),
      name: "items",
      label: "Line items",
      type: "list",
      sampleValue: '[{"description":"Design services","amount":"$900"},{"description":"Hosting","amount":"$100"}]',
      itemSchema: [
        { id: nextId("field"), name: "description", label: "Description", type: "text" },
        { id: nextId("field"), name: "amount", label: "Amount", type: "currency" },
      ],
    },
    { id: nextId("var"), name: "total", label: "Total", type: "currency", sampleValue: "$1,000" },
  ];
  return stack(doc);
}

function report(): DesignDocument {
  const doc = createEmptyDocument();
  const heading = createNode("heading");
  heading.label = "{{ report_title }}";
  const body = createNode("paragraph");
  body.label = "{{ markdown }}";
  body.h = 700;
  doc.root.children = [heading, body];
  doc.variables = [
    { id: nextId("var"), name: "report_title", label: "Report title", type: "text", sampleValue: "Document report" },
    { id: nextId("var"), name: "markdown", label: "Extracted Markdown", type: "text", sampleValue: "Preview of extracted content" },
  ];
  return stack(doc);
}

function letter(): DesignDocument {
  const doc = createEmptyDocument();
  for (const text of ["{{ date }}", "Dear {{ recipient }},", "{{ markdown }}", "Sincerely,\n{{ sender }}"]) {
    const node = createNode(text.startsWith("Dear") ? "heading" : "paragraph");
    node.label = text;
    doc.root.children.push(node);
  }
  doc.variables = [
    { id: nextId("var"), name: "date", label: "Date", type: "date", sampleValue: "August 19, 2026" },
    { id: nextId("var"), name: "recipient", label: "Recipient", type: "text", sampleValue: "Reader" },
    { id: nextId("var"), name: "markdown", label: "Extracted Markdown", type: "text", sampleValue: "Your document content." },
    { id: nextId("var"), name: "sender", label: "Sender", type: "text", sampleValue: "FileWorks" },
  ];
  return stack(doc);
}

export const BUILT_IN_TEMPLATES = [
  { id: "invoice", name: "Invoice", description: "Repeating line items, customer details, and total.", build: invoice },
  { id: "report", name: "Document report", description: "A clean report driven by extracted Markdown.", build: report },
  { id: "letter", name: "Business letter", description: "Letter layout with recipient and sender variables.", build: letter },
] as const;

export function builtInTemplate(id: string) {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id);
}
