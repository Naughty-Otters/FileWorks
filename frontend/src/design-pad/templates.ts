import {
  type DesignDocument,
  type DesignNode,
  type LayoutProps,
  type NodeStyle,
  type VariableSchemaField,
  type VariableType,
  DEFAULT_LAYOUT,
  HEADING_LEVEL_PRESET,
  createEmptyDocument,
  createNode,
  createVariable,
  nextId,
} from "./types";
import { arrange, resolveAutoSize } from "./layout/arrange";
import { enforcePageBounds } from "./layout/page-bounds";
import { estimateTextHeight, fitTextContent } from "./layout/text-fit";

function heading(w: number, label: string, level: 1 | 2 | 3 = 2, align: "left" | "center" | "right" = "left") {
  const n = createNode("heading", 0, 0);
  n.label = label;
  n.level = level;
  n.w = w;
  n.style.fontSize = HEADING_LEVEL_PRESET[level].fontSize;
  n.style.align = align;
  n.style.color = "#0f172a";
  n.h = Math.max(n.h, estimateTextHeight(n));
  return n;
}

function paragraph(
  w: number,
  h: number,
  label: string,
  align: "left" | "center" | "right" = "left",
  styleOverride?: Partial<NodeStyle>,
) {
  const n = createNode("paragraph", 0, 0);
  n.label = label;
  n.w = w;
  n.h = h;
  n.style.align = align;
  n.style.color = "#334155";
  if (styleOverride) n.style = { ...n.style, ...styleOverride };
  n.h = Math.max(n.h, estimateTextHeight(n));
  return n;
}

/** Invisible structural wrapper — no fill, border, or caption chip. */
const INVISIBLE: Partial<NodeStyle> = {
  backgroundColor: "transparent",
  borderStyle: "none",
  borderWidth: 0,
};

/** Soft card for named sections (Bill to, Earnings, …). */
const CARD: Partial<NodeStyle> = {
  backgroundColor: "#ffffff",
  borderStyle: "solid",
  borderWidth: 1,
  borderColor: "#e2e8f0",
};

const LABEL_STYLE: Partial<NodeStyle> = {
  color: "#64748b",
  fontSize: 13,
};

const VALUE_STYLE: Partial<NodeStyle> = {
  color: "#0f172a",
  fontSize: 13,
};

/** Printed section title (survives preview — editor captions do not). */
function sectionTitle(width: number, text: string) {
  const n = createNode("heading", 0, 0);
  n.label = text;
  n.level = 3;
  n.w = width;
  n.style.fontSize = 15;
  n.style.bold = true;
  n.style.color = "#0f172a";
  n.h = Math.max(28, estimateTextHeight(n));
  return n;
}

/** Builds a Box and immediately resolves its auto-sized dimension (height
 * for a column, width for a row) using the exact same formula the layout
 * engine applies later — so callers can size nested halves correctly. */
function box(
  wGuess: number,
  hGuess: number,
  label: string,
  children: DesignNode[],
  layout: Partial<LayoutProps>,
  styleOverride?: Partial<NodeStyle>,
) {
  const n = createNode("box", 0, 0);
  n.label = label;
  n.layout = { ...DEFAULT_LAYOUT, ...layout };
  n.children = children;
  if (styleOverride) n.style = { ...n.style, ...styleOverride };

  n.w = wGuess;
  n.h = hGuess;
  if (children.length > 0) {
    const isRow = n.layout.direction === "row";
    const gapTotal = n.layout.gap * (children.length - 1);
    if (isRow) {
      // Keep the authored width when justify distributes leftover space;
      // only hug when start-justified so halves/space-between rows stay put.
      if (n.layout.justify === "start") {
        n.w = children.reduce((a, c) => a + c.w, 0) + gapTotal + 2 * n.layout.padding;
      }
      // Never shorter than the tallest child on the cross axis.
      n.h = Math.max(n.h, Math.max(...children.map((c) => c.h)) + 2 * n.layout.padding);
    } else if (n.layout.justify === "start") {
      n.h = children.reduce((a, c) => a + c.h, 0) + gapTotal + 2 * n.layout.padding;
    }
  }
  return n;
}

/** Label/value row that fits inside `width` without overflowing. */
function infoRow(width: number, labelText: string, valueText: string) {
  const labelW = Math.min(150, Math.max(90, Math.floor(width * 0.4)));
  const valueW = Math.max(70, width - labelW);
  const label = paragraph(labelW, 28, labelText, "left", LABEL_STYLE);
  const valueNode = paragraph(valueW, 28, valueText, "right", VALUE_STYLE);
  return box(
    width,
    32,
    "Row",
    [label, valueNode],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
}

/** Two-column table row sized to exactly `width` (gap 0). */
function twoColRow(
  width: number,
  left: string,
  right: string,
  caption = "Row",
  leftRatio = 0.72,
  header = false,
) {
  const leftW = Math.floor(width * leftRatio);
  const rightW = width - leftW;
  const style = header
    ? { ...LABEL_STYLE, fontSize: 12, bold: true as const }
    : VALUE_STYLE;
  return box(
    width,
    32,
    caption,
    [
      paragraph(leftW, 28, left, "left", style),
      paragraph(rightW, 28, right, "right", style),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
}

/** Mount top-level sections on an auto-arranged page column so preview
 * expansion can grow height and push later sections down. */
function assemblePage(
  doc: DesignDocument,
  sections: DesignNode[],
  opts: { gap?: number; padding?: number } = {},
) {
  const gap = opts.gap ?? 24;
  const padding = opts.padding ?? 40;
  doc.root.layout = {
    direction: "column",
    gap,
    padding,
    align: "stretch",
    justify: "start",
  };
  doc.root.children = sections;
  for (const section of sections) {
    section.x = 0;
    section.y = 0;
  }
  fitTextContent(doc.root);
  resolveAutoSize(doc.root);
  arrange(doc.root);
  enforcePageBounds(doc.root, doc.pageSize);
}

/** Declares a template's variables in one shot — used by starters that lean
 * on `{{ }}` placeholders so Preview / Home fill have real fields to bind. */
type ScalarVarEntry = [name: string, label: string, type: VariableType, sampleValue: string];
type ListFieldEntry = [name: string, label: string, type: VariableSchemaField["type"]];
type ListVarEntry = [
  name: string,
  label: string,
  type: "list",
  sampleValue: string,
  itemFields: ListFieldEntry[],
];
type VarEntry = ScalarVarEntry | ListVarEntry;

function declareVars(doc: DesignDocument, entries: VarEntry[]) {
  doc.variables = entries.map((entry) => {
    const [name, label, type, sampleValue] = entry;
    const variable = createVariable(name, label, type, sampleValue);
    if (type === "list" && entry.length === 5) {
      variable.itemSchema = entry[4].map(([fieldName, fieldLabel, fieldType]) => ({
        id: nextId("field"),
        name: fieldName,
        label: fieldLabel,
        type: fieldType,
      }));
    }
    return variable;
  });
}

function invoice(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;

  const header = box(
    contentW,
    80,
    "Header",
    [
      box(
        Math.floor(contentW * 0.55),
        70,
        "Company",
        [
          heading(Math.floor(contentW * 0.55) - 8, "{{ company_name }}", 2),
          paragraph(Math.floor(contentW * 0.55) - 8, 36, "{{ company_address }}\n{{ company_email }}"),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.38),
        70,
        "Invoice meta",
        [
          heading(Math.floor(contentW * 0.38) - 8, "INVOICE", 1, "right"),
          paragraph(
            Math.floor(contentW * 0.38) - 8,
            36,
            "Invoice #: {{ invoice_number }}\nDate: {{ invoice_date }}",
            "right",
          ),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 0, gap: 24, align: "start" },
    INVISIBLE,
  );

  const billTo = box(
    contentW,
    90,
    "Bill to",
    [
      sectionTitle(contentW - 40, "Bill To"),
      paragraph(contentW - 40, 54, "{{ client_name }}\n{{ client_address }}\n{{ client_email }}"),
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const rowW = contentW - 40;
  const headerRow = twoColRow(rowW, "Description", "Amount", "Column headers", 0.72, true);
  const itemRow = twoColRow(rowW, "{{ item.description }}", "{{ item.amount }}", "Line item", 0.72);
  itemRow.repeat = { over: "invoice_spending_items", as: "item" };

  const lineItems = box(
    contentW,
    160,
    "Line items",
    [sectionTitle(rowW, "Line items"), headerRow, itemRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const totals = box(
    contentW,
    56,
    "Total",
    [heading(200, "Total", 3), heading(160, "{{ invoice_total }}", 3, "right")],
    { direction: "row", justify: "space-between", align: "center", padding: 18 },
    CARD,
  );

  const notes = box(
    contentW,
    70,
    "Notes",
    [
      sectionTitle(contentW - 32, "Notes"),
      paragraph(contentW - 32, 50, "{{ invoice_notes }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    INVISIBLE,
  );

  assemblePage(doc, [header, billTo, lineItems, totals, notes], { padding: pad, gap: 24 });
  declareVars(doc, [
    ["company_name", "Issuing company name on the invoice", "text", "Acme Studio"],
    ["company_address", "Issuing company mailing address", "text", "123 Market St, City, ST 00000"],
    ["company_email", "Issuing company billing email", "text", "billing@acme.example"],
    ["invoice_number", "Invoice number or identifier", "text", "INV-1042"],
    ["invoice_date", "Invoice issue date", "date", "March 1, 2026"],
    ["client_name", "Bill-to client or customer name", "text", "Northwind Trading"],
    ["client_address", "Bill-to client address", "text", "500 Harbor Ave, City, ST 00000"],
    ["client_email", "Bill-to client email", "text", "ap@northwind.example"],
    [
      "invoice_spending_items",
      "Invoice spending items: each billed line from the source (description and amount)",
      "list",
      JSON.stringify([
        { description: "Design retainer — March", amount: "$2,400.00" },
        { description: "Print production", amount: "$350.00" },
      ]),
      [
        ["description", "What this invoice line billed", "text"],
        ["amount", "Amount charged on this invoice line", "currency"],
      ],
    ],
    ["invoice_total", "Invoice grand total due", "currency", "$2,750.00"],
    ["invoice_notes", "Invoice notes, payment terms, or footer remarks", "text", "Payment due within 30 days. Thank you for your business."],
  ]);
  return doc;
}

function receipt(): DesignDocument {
  const doc = createEmptyDocument({ w: 340, h: 620 });
  const pad = 16;
  const contentW = doc.root.w - pad * 2;
  const innerW = contentW - 24;

  const header = box(
    contentW,
    90,
    "Header",
    [
      heading(innerW, "{{ store_name }}", 2, "center"),
      paragraph(innerW, 40, "{{ store_address }}\n{{ store_phone }}", "center"),
    ],
    { direction: "column", gap: 6, padding: 12, align: "center" },
    INVISIBLE,
  );

  const meta = box(
    contentW,
    40,
    "Meta",
    [paragraph(innerW, 28, "Date: {{ receipt_date }}\nReceipt #: {{ receipt_number }}", "center")],
    { direction: "column", padding: 4, align: "center" },
    INVISIBLE,
  );

  const itemRow = twoColRow(innerW, "{{ item.description }}", "{{ item.amount }}", "Item", 0.65);
  itemRow.repeat = { over: "receipt_purchased_items", as: "item" };

  const items = box(
    contentW,
    100,
    "Items",
    [itemRow],
    { direction: "column", gap: 8, padding: 12 },
  );

  const totals = box(
    contentW,
    90,
    "Totals",
    [
      box(
        innerW,
        24,
        "Subtotal row",
        [paragraph(Math.floor(innerW * 0.55), 20, "Subtotal"), paragraph(innerW - Math.floor(innerW * 0.55), 20, "{{ receipt_subtotal }}", "right")],
        { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
        INVISIBLE,
      ),
      box(
        innerW,
        24,
        "Tax row",
        [paragraph(Math.floor(innerW * 0.55), 20, "Tax"), paragraph(innerW - Math.floor(innerW * 0.55), 20, "{{ receipt_tax }}", "right")],
        { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
        INVISIBLE,
      ),
      box(
        innerW,
        28,
        "Total row",
        [heading(Math.floor(innerW * 0.55), "Total", 3), heading(innerW - Math.floor(innerW * 0.55), "{{ receipt_total }}", 3, "right")],
        { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
        INVISIBLE,
      ),
    ],
    { direction: "column", gap: 6, padding: 12 },
  );

  const footer = box(
    contentW,
    50,
    "Footer",
    [paragraph(innerW, 30, "{{ thank_you_message }}", "center")],
    { direction: "column", padding: 8, align: "center" },
    INVISIBLE,
  );

  assemblePage(doc, [header, meta, items, totals, footer], { padding: pad, gap: 12 });
  declareVars(doc, [
    ["store_name", "Store or merchant name on the receipt", "text", "Your Store"],
    ["store_address", "Store address printed on the receipt", "text", "123 Main St, City, ST"],
    ["store_phone", "Store phone number", "text", "(555) 123-4567"],
    ["receipt_date", "Receipt transaction date", "date", "March 15, 2026"],
    ["receipt_number", "Receipt number or identifier", "text", "R-8821"],
    [
      "receipt_purchased_items",
      "Receipt purchased items: each sold line from the source (description and amount)",
      "list",
      JSON.stringify([
        { description: "Coffee", amount: "$4.50" },
        { description: "Pastry", amount: "$3.25" },
        { description: "Sandwich", amount: "$9.75" },
      ]),
      [
        ["description", "Purchased item description", "text"],
        ["amount", "Purchased item amount", "currency"],
      ],
    ],
    ["receipt_subtotal", "Receipt subtotal before tax", "currency", "$17.50"],
    ["receipt_tax", "Receipt tax amount", "currency", "$1.40"],
    ["receipt_total", "Receipt total charged", "currency", "$18.90"],
    ["thank_you_message", "Receipt thank-you or footer message", "text", "Thank you for your purchase!"],
  ]);
  return doc;
}

function bankStatement(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;

  const header = box(
    contentW,
    90,
    "Header",
    [
      box(
        Math.floor(contentW * 0.48),
        42,
        "Bank",
        [heading(Math.floor(contentW * 0.48) - 8, "{{ bank_name }}", 2)],
        { direction: "column", padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.45),
        76,
        "Statement info",
        [
          heading(Math.floor(contentW * 0.45) - 8, "Account Statement", 3, "right"),
          paragraph(Math.floor(contentW * 0.45) - 8, 30, "Period: {{ statement_period }}", "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  const summaryInner = contentW - 40;
  const summaryColW = Math.floor((summaryInner - 20) / 3);

  function summaryItem(label: string, value: string) {
    return box(
      summaryColW,
      56,
      label,
      [
        paragraph(summaryColW - 4, 22, label, "left", LABEL_STYLE),
        heading(summaryColW - 4, value, 3),
      ],
      { direction: "column", gap: 6, padding: 0 },
      INVISIBLE,
    );
  }

  const summary = box(
    contentW,
    100,
    "Account summary",
    [
      sectionTitle(summaryInner, "Account summary"),
      box(
        summaryInner,
        56,
        "Summary columns",
        [
          summaryItem("Account Number", "{{ account_number }}"),
          summaryItem("Opening Balance", "{{ opening_balance }}"),
          summaryItem("Closing Balance", "{{ closing_balance }}"),
        ],
        { direction: "row", justify: "space-between", padding: 0, gap: 10, align: "start" },
        INVISIBLE,
      ),
    ],
    { direction: "column", gap: 14, padding: 20 },
    CARD,
  );

  const rowW = contentW - 40;
  const dateW = 90;
  const amountW = 110;
  const descW = rowW - dateW - amountW;
  const txHeader = box(
    rowW,
    32,
    "Column headers",
    [
      paragraph(dateW, 28, "Date", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(descW, 28, "Description", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(amountW, 28, "Amount", "right", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );

  const txRow = box(
    rowW,
    32,
    "Transaction",
    [
      paragraph(dateW, 28, "{{ tx.date }}", "left", VALUE_STYLE),
      paragraph(descW, 28, "{{ tx.description }}", "left", VALUE_STYLE),
      paragraph(amountW, 28, "{{ tx.amount }}", "right", VALUE_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  txRow.repeat = { over: "statement_transactions", as: "tx" };

  const transactions = box(
    contentW,
    200,
    "Transactions",
    [sectionTitle(rowW, "Transactions"), txHeader, txRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const footer = box(
    contentW,
    50,
    "Footer",
    [
      paragraph(
        contentW - 32,
        40,
        "This statement is provided for informational purposes. Please contact us within 30 days of any discrepancy.",
        "left",
        LABEL_STYLE,
      ),
    ],
    { direction: "column", padding: 16 },
    INVISIBLE,
  );

  assemblePage(doc, [header, summary, transactions, footer], { padding: pad, gap: 24 });
  declareVars(doc, [
    ["bank_name", "Bank or financial institution name on the statement", "text", "First National Bank"],
    ["statement_period", "Statement period covered", "text", "01/01/2026 – 01/31/2026"],
    ["account_number", "Account number shown on the statement", "text", "**** 4821"],
    ["opening_balance", "Opening balance for the statement period", "currency", "$4,210.55"],
    ["closing_balance", "Closing balance for the statement period", "currency", "$5,032.10"],
    [
      "statement_transactions",
      "Account statement transactions for the period (date, description, amount)",
      "list",
      JSON.stringify([
        { date: "01/03", description: "Grocery Store", amount: "-$86.20" },
        { date: "01/07", description: "Payroll Deposit", amount: "+$2,400.00" },
        { date: "01/15", description: "Electric Utility", amount: "-$120.44" },
        { date: "01/22", description: "Online Transfer", amount: "-$300.00" },
      ]),
      [
        ["date", "Transaction date", "date"],
        ["description", "Transaction description", "text"],
        ["amount", "Transaction amount (signed)", "currency"],
      ],
    ],
  ]);
  return doc;
}

function insuranceCertificate(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;

  const header = box(
    contentW,
    90,
    "Header",
    [
      heading(contentW - 16, "Certificate of Insurance", 1, "center"),
      paragraph(contentW - 16, 30, "This certifies that the policy described below is in effect.", "center"),
    ],
    { direction: "column", gap: 8, padding: 8, align: "center" },
    INVISIBLE,
  );

  const policyHolder = box(
    contentW,
    110,
    "Policy holder",
    [
      sectionTitle(contentW - 40, "Policy holder"),
      paragraph(
        contentW - 40,
        70,
        "{{ holder_name }}\n{{ holder_address }}\nPolicy #: {{ policy_number }}",
      ),
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const rowW = contentW - 40;
  const covHeader = twoColRow(rowW, "Coverage Type", "Limit", "Column headers", 0.68, true);
  const coverageRow = twoColRow(rowW, "{{ coverage.type }}", "{{ coverage.limit }}", "Coverage", 0.68);
  coverageRow.repeat = { over: "insurance_coverages", as: "coverage" };

  const coverage = box(
    contentW,
    160,
    "Coverage",
    [sectionTitle(rowW, "Coverage"), covHeader, coverageRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const periodInner = contentW - 40;
  const periodColW = Math.floor((periodInner - 24) / 2);
  const period = box(
    contentW,
    90,
    "Policy period",
    [
      sectionTitle(periodInner, "Policy period"),
      box(
        periodInner,
        48,
        "Period columns",
        [
          box(
            periodColW,
            48,
            "Effective",
            [
              paragraph(periodColW - 4, 22, "Effective Date", "left", LABEL_STYLE),
              heading(periodColW - 4, "{{ effective_date }}", 3),
            ],
            { direction: "column", gap: 4, padding: 0 },
            INVISIBLE,
          ),
          box(
            periodColW,
            48,
            "Expiration",
            [
              paragraph(periodColW - 4, 22, "Expiration Date", "right", LABEL_STYLE),
              heading(periodColW - 4, "{{ expiration_date }}", 3, "right"),
            ],
            { direction: "column", gap: 4, padding: 0, align: "end" },
            INVISIBLE,
          ),
        ],
        { direction: "row", justify: "space-between", padding: 0, gap: 24, align: "start" },
        INVISIBLE,
      ),
    ],
    { direction: "column", gap: 14, padding: 20 },
    CARD,
  );

  const footer = box(
    contentW,
    60,
    "Footer",
    [
      paragraph(
        contentW - 32,
        40,
        "Insurer: {{ insurer_name }}\nAuthorized Signature: ______________________",
      ),
    ],
    { direction: "column", padding: 16 },
    INVISIBLE,
  );

  assemblePage(doc, [header, policyHolder, coverage, period, footer], { padding: pad, gap: 24 });
  declareVars(doc, [
    ["holder_name", "Insured policy holder name", "text", "Jane Doe"],
    ["holder_address", "Policy holder address", "text", "123 Main St, City, ST 00000"],
    ["policy_number", "Insurance policy number", "text", "INS-000123"],
    [
      "insurance_coverages",
      "Insurance coverages on the certificate (coverage type and limit)",
      "list",
      JSON.stringify([
        { type: "General Liability", limit: "$1,000,000" },
        { type: "Property Damage", limit: "$500,000" },
        { type: "Personal Injury", limit: "$250,000" },
      ]),
      [
        ["type", "Coverage type", "text"],
        ["limit", "Coverage limit", "currency"],
      ],
    ],
    ["effective_date", "Policy effective date", "date", "01/01/2026"],
    ["expiration_date", "Policy expiration date", "date", "01/01/2027"],
    ["insurer_name", "Insurance company issuing the certificate", "text", "Acme Mutual Insurance Co."],
  ]);
  return doc;
}

function businessLetter(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 64;
  const contentW = doc.root.w - pad * 2;

  const sender = box(
    contentW,
    70,
    "Sender",
    [paragraph(contentW, 60, "{{ sender_name }}\n{{ sender_company }}\n{{ sender_address }}")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const date = box(
    contentW,
    30,
    "Date",
    [paragraph(contentW, 24, "{{ letter_date }}")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const recipient = box(
    contentW,
    70,
    "Recipient",
    [paragraph(contentW, 60, "{{ recipient_name }}\n{{ recipient_company }}\n{{ recipient_address }}")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const greeting = box(
    contentW,
    30,
    "Greeting",
    [paragraph(contentW, 24, "Dear {{ recipient_name }},")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const body = box(
    contentW,
    220,
    "Body",
    [paragraph(contentW, 200, "{{ letter_body }}")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const closing = box(
    contentW,
    90,
    "Closing",
    [paragraph(contentW, 80, "Sincerely,\n\n{{ sender_name }}\n{{ sender_title }}")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  assemblePage(doc, [sender, date, recipient, greeting, body, closing], { padding: pad, gap: 18 });
  declareVars(doc, [
    ["sender_name", "Letter sender name", "text", "Alex Rivera"],
    ["sender_company", "Letter sender company", "text", "Rivera Consulting"],
    ["sender_address", "Letter sender address", "text", "123 Main St, City, ST 00000"],
    ["sender_title", "Letter sender title", "text", "Principal"],
    ["letter_date", "Letter date", "date", "March 20, 2026"],
    ["recipient_name", "Letter recipient name", "text", "Jordan Lee"],
    ["recipient_company", "Letter recipient company", "text", "Northwind Trading"],
    ["recipient_address", "Letter recipient address", "text", "500 Harbor Ave, City, ST 00000"],
    [
      "letter_body",
      "Letter body paragraphs from the source correspondence",
      "text",
      "I am writing to follow up on our recent conversation and outline the next steps we discussed. Please let me know if you have any questions or would like to schedule a call.",
    ],
  ]);
  return doc;
}

function payStub(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;

  const leftW = Math.floor(contentW * 0.55);
  const rightW = Math.floor(contentW * 0.38);
  const header = box(
    contentW,
    90,
    "Header",
    [
      box(
        leftW,
        66,
        "Company",
        [heading(leftW - 8, "{{ employer_name }}", 2), paragraph(leftW - 8, 30, "{{ employer_address }}")],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        rightW,
        66,
        "Stub info",
        [
          heading(rightW - 8, "PAY STUB", 2, "right"),
          paragraph(rightW - 8, 30, "Pay date: {{ pay_date }}", "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 0, gap: 20, align: "start" },
    INVISIBLE,
  );

  // Two equal columns that fit inside the card (padding + gap accounted for).
  const empPad = 20;
  const empGap = 20;
  const empColW = Math.floor((contentW - empPad * 2 - empGap) / 2);
  const employeeInfo = box(
    contentW,
    100,
    "Employee info",
    [
      sectionTitle(contentW - empPad * 2, "Employee"),
      box(
        contentW - empPad * 2,
        64,
        "Employee columns",
        [
          box(
            empColW,
            64,
            "Identity",
            [
              infoRow(empColW, "Employee", "{{ employee_name }}"),
              infoRow(empColW, "Employee ID", "{{ employee_id }}"),
            ],
            { direction: "column", gap: 10, padding: 0 },
            INVISIBLE,
          ),
          box(
            empColW,
            64,
            "Period",
            [
              infoRow(empColW, "Pay period", "{{ pay_period_start }} – {{ pay_period_end }}"),
              infoRow(empColW, "Filing status", "{{ filing_status }}"),
            ],
            { direction: "column", gap: 10, padding: 0 },
            INVISIBLE,
          ),
        ],
        { direction: "row", justify: "space-between", padding: 0, gap: empGap, align: "start" },
        INVISIBLE,
      ),
    ],
    { direction: "column", gap: 14, padding: empPad },
    CARD,
  );

  const detailsGap = 16;
  const halfW = Math.floor((contentW - detailsGap) / 2);
  const halfInner = halfW - 32;

  const earnings = box(
    halfW,
    150,
    "Earnings",
    [
      sectionTitle(halfInner, "Earnings"),
      infoRow(halfInner, "Regular hours", "{{ regular_hours }}"),
      infoRow(halfInner, "Hourly rate", "{{ hourly_rate }}"),
      infoRow(halfInner, "Overtime pay", "{{ overtime_pay }}"),
      infoRow(halfInner, "Gross pay", "{{ gross_pay }}"),
    ],
    { direction: "column", gap: 10, padding: 16 },
    CARD,
  );

  const deductions = box(
    halfW,
    170,
    "Deductions",
    [
      sectionTitle(halfInner, "Deductions"),
      infoRow(halfInner, "Federal tax", "{{ federal_tax }}"),
      infoRow(halfInner, "State tax", "{{ state_tax }}"),
      infoRow(halfInner, "Insurance", "{{ insurance_deduction }}"),
      infoRow(halfInner, "Retirement (401k)", "{{ retirement_deduction }}"),
      infoRow(halfInner, "Total deductions", "{{ total_deductions }}"),
    ],
    { direction: "column", gap: 10, padding: 16 },
    CARD,
  );

  const payDetails = box(
    contentW,
    180,
    "Pay details",
    [earnings, deductions],
    { direction: "row", justify: "start", padding: 0, gap: detailsGap, align: "start" },
    INVISIBLE,
  );

  const netPay = box(
    contentW,
    64,
    "Net pay",
    [heading(contentW - 40, "Net Pay: {{ net_pay }}", 2, "right")],
    { direction: "row", justify: "end", padding: 18, align: "center" },
    { backgroundColor: "#f0fdf4", borderStyle: "solid", borderWidth: 1, borderColor: "#bbf7d0" },
  );

  assemblePage(doc, [header, employeeInfo, payDetails, netPay], { padding: pad, gap: 24 });

  declareVars(doc, [
    ["employer_name", "Employer company name on the pay stub", "text", "Acme Corporation"],
    ["employer_address", "Employer address on the pay stub", "text", "123 Main St, City, ST 00000"],
    ["pay_date", "Pay date printed on the stub", "date", "02/15/2026"],
    ["employee_name", "Employee name on the pay stub", "text", "Jane Doe"],
    ["employee_id", "Employee ID on the pay stub", "text", "EMP-00214"],
    ["pay_period_start", "Pay period start date", "date", "02/01/2026"],
    ["pay_period_end", "Pay period end date", "date", "02/15/2026"],
    ["filing_status", "Employee tax filing status", "text", "Single"],
    ["regular_hours", "Regular hours worked this period", "number", "80"],
    ["hourly_rate", "Employee hourly rate", "currency", "$32.00"],
    ["overtime_pay", "Overtime pay this period", "currency", "$0.00"],
    ["gross_pay", "Gross pay this period", "currency", "$2,560.00"],
    ["federal_tax", "Federal tax withheld", "currency", "$384.00"],
    ["state_tax", "State tax withheld", "currency", "$128.00"],
    ["insurance_deduction", "Insurance deduction this period", "currency", "$60.00"],
    ["retirement_deduction", "Retirement (401k) deduction this period", "currency", "$102.40"],
    ["total_deductions", "Total deductions this period", "currency", "$674.40"],
    ["net_pay", "Net pay on the stub", "currency", "$1,885.60"],
  ]);

  return doc;
}

function rentalAgreement(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;

  const title = box(
    contentW,
    60,
    "Title",
    [heading(contentW - 16, "Residential Lease Agreement", 1, "center")],
    { direction: "column", padding: 8, align: "center" },
    INVISIBLE,
  );

  const parties = box(
    contentW,
    90,
    "Parties",
    [
      paragraph(
        contentW - 40,
        70,
        "This Lease Agreement (\"Agreement\") is made on {{ agreement_date }} between {{ landlord_name }} (\"Landlord\") and {{ tenant_name }} (\"Tenant\") for the residential property located at {{ property_address }}.",
      ),
    ],
    { direction: "column", padding: 20 },
    CARD,
  );

  const rowW = contentW - 40;
  function termRow(labelText: string, value: string) {
    return infoRow(rowW, labelText, value);
  }

  const terms = box(
    contentW,
    180,
    "Lease terms",
    [
      sectionTitle(rowW, "Lease terms"),
      termRow("Lease start date", "{{ lease_start_date }}"),
      termRow("Lease end date", "{{ lease_end_date }}"),
      termRow("Monthly rent", "{{ monthly_rent }}"),
      termRow("Security deposit", "{{ security_deposit }}"),
      termRow("Rent due date", "{{ rent_due_date }}"),
    ],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const clauses = box(
    contentW,
    110,
    "Additional terms",
    [
      sectionTitle(contentW - 40, "Additional terms"),
      paragraph(contentW - 40, 90, "{{ additional_terms }}"),
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const sigGap = 32;
  const sigPad = 20;
  const sigColW = Math.floor((contentW - sigPad * 2 - sigGap) / 2);
  const signatures = box(
    contentW,
    90,
    "Signatures",
    [
      box(
        sigColW,
        50,
        "Landlord",
        [paragraph(sigColW, 40, "Landlord signature: ______________________\nDate: ______________")],
        { direction: "column", padding: 0 },
        INVISIBLE,
      ),
      box(
        sigColW,
        50,
        "Tenant",
        [paragraph(sigColW, 40, "Tenant signature: ______________________\nDate: ______________")],
        { direction: "column", padding: 0 },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: sigPad, gap: sigGap, align: "start" },
    CARD,
  );

  assemblePage(doc, [title, parties, terms, clauses, signatures], { padding: pad, gap: 24 });

  declareVars(doc, [
    ["agreement_date", "Lease agreement date", "date", "01/01/2026"],
    ["landlord_name", "Landlord name on the lease", "text", "Acme Properties LLC"],
    ["tenant_name", "Tenant name on the lease", "text", "John Smith"],
    ["property_address", "Leased property address", "text", "456 Oak Avenue, Apt 3B, Springfield, ST 00000"],
    ["lease_start_date", "Lease start date", "date", "02/01/2026"],
    ["lease_end_date", "Lease end date", "date", "01/31/2027"],
    ["monthly_rent", "Monthly rent amount", "currency", "$1,650.00"],
    ["security_deposit", "Security deposit amount", "currency", "$1,650.00"],
    ["rent_due_date", "Rent due date each month", "text", "1st of each month"],
    [
      "additional_terms",
      "Additional lease terms and clauses from the source",
      "text",
      "Tenant agrees to pay rent in full on or before the due date each month, keep the property in good condition, and comply with all applicable building and safety codes. Late payments may incur a fee as permitted by local law.",
    ],
  ]);

  return doc;
}

/** FileWorks-specific: layout driven by extracted Markdown from the workspace. */
function documentReport(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const header = box(
    contentW,
    80,
    "Header",
    [heading(contentW - 40, "{{ report_title }}", 1)],
    { direction: "column", gap: 8, padding: 20 },
  );
  const body = box(
    contentW,
    760,
    "Body",
    [paragraph(contentW - 40, 700, "{{ report_body }}")],
    { direction: "column", gap: 8, padding: 20 },
  );
  assemblePage(doc, [header, body], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["report_title", "Report title taken from the source document", "text", "Document report"],
    ["report_body", "Full report body transcribed from the source Markdown", "text", "Preview of extracted content from FileWorks."],
  ]);
  return doc;
}

const FAMILY_HEADER: Partial<NodeStyle> = {
  backgroundColor: "#f8fafc",
  borderStyle: "solid",
  borderWidth: 1,
  borderColor: "#e2e8f0",
};

const DAY_CARD: Partial<NodeStyle> = {
  backgroundColor: "#ffffff",
  borderStyle: "solid",
  borderWidth: 1,
  borderColor: "#e2e8f0",
};

/** One fridge-ready day: timed blocks the whole household can follow. */
function familyDaily(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    100,
    "Header",
    [
      box(
        Math.floor(contentW * 0.58),
        70,
        "Family",
        [
          paragraph(Math.floor(contentW * 0.58) - 8, 22, "FAMILY SCHEDULE", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.58) - 8, "{{ family_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.36),
        70,
        "When",
        [
          heading(Math.floor(contentW * 0.36) - 8, "{{ day_name }}", 2, "right"),
          paragraph(Math.floor(contentW * 0.36) - 8, 28, "{{ schedule_date }}", "right", LABEL_STYLE),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 22, gap: 20, align: "start" },
    FAMILY_HEADER,
  );

  const timeW = 110;
  const activityW = inner - timeW;
  const blockHeader = box(
    inner,
    32,
    "Column headers",
    [
      paragraph(timeW, 28, "Time", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(activityW, 28, "Activity", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );

  const blockRow = box(
    inner,
    36,
    "Block",
    [
      paragraph(timeW, 28, "{{ block.time }}", "left", { ...VALUE_STYLE, bold: true }),
      paragraph(activityW, 28, "{{ block.activity }}", "left", VALUE_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  blockRow.repeat = { over: "family_daily_blocks", as: "block" };

  const timeline = box(
    contentW,
    280,
    "Timeline",
    [sectionTitle(inner, "Today's plan"), blockHeader, blockRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const sideInner = Math.floor((contentW - 16) / 2) - 32;
  const meals = box(
    Math.floor((contentW - 16) / 2),
    120,
    "Meals",
    [
      sectionTitle(sideInner, "Meals"),
      infoRow(sideInner, "Breakfast", "{{ breakfast }}"),
      infoRow(sideInner, "Lunch", "{{ lunch }}"),
      infoRow(sideInner, "Dinner", "{{ dinner }}"),
    ],
    { direction: "column", gap: 10, padding: 16 },
    CARD,
  );

  const focus = box(
    Math.floor((contentW - 16) / 2),
    120,
    "Focus",
    [
      sectionTitle(sideInner, "Don’t forget"),
      paragraph(sideInner, 70, "{{ daily_reminders }}"),
    ],
    { direction: "column", gap: 10, padding: 16 },
    CARD,
  );

  const extras = box(
    contentW,
    140,
    "Extras",
    [meals, focus],
    { direction: "row", justify: "start", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  const notes = box(
    contentW,
    70,
    "Notes",
    [
      sectionTitle(contentW - 32, "Notes"),
      paragraph(contentW - 32, 40, "{{ daily_notes }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    INVISIBLE,
  );

  assemblePage(doc, [header, timeline, extras, notes], { padding: pad, gap: 20 });
  declareVars(doc, [
    ["family_name", "Family or household name on the schedule", "text", "The Rivera Family"],
    ["day_name", "Weekday name for this daily schedule", "text", "Tuesday"],
    ["schedule_date", "Calendar date for this daily schedule", "date", "March 18, 2026"],
    [
      "family_daily_blocks",
      "Timed activity blocks for the day (time and what happens)",
      "list",
      JSON.stringify([
        { time: "7:00 AM", activity: "Breakfast & get ready" },
        { time: "8:15 AM", activity: "School drop-off" },
        { time: "12:30 PM", activity: "Lunch (kids at school)" },
        { time: "3:30 PM", activity: "Pickup · snacks · homework" },
        { time: "5:30 PM", activity: "Soccer practice (Maya)" },
        { time: "7:00 PM", activity: "Family dinner" },
        { time: "8:30 PM", activity: "Baths · bedtime stories" },
      ]),
      [
        ["time", "Clock time for this block", "text"],
        ["activity", "What the family does in this block", "text"],
      ],
    ],
    ["breakfast", "Breakfast plan for the day", "text", "Oatmeal and fruit"],
    ["lunch", "Lunch plan for the day", "text", "School lunch / leftovers"],
    ["dinner", "Dinner plan for the day", "text", "Tacos and salad"],
    [
      "daily_reminders",
      "Short reminders or errands for the day",
      "text",
      "Library books due\nBring soccer cleats\nCall grandma after dinner",
    ],
    ["daily_notes", "Freeform notes at the bottom of the daily card", "text", "Early bedtime tonight — big field trip tomorrow."],
  ]);
  return doc;
}

/** Landscape week-at-a-glance card — seven day columns for the fridge. */
function familyWeekly(): DesignDocument {
  const doc = createEmptyDocument({ w: 1100, h: 850 });
  const pad = 32;
  const contentW = doc.root.w - pad * 2;
  const gap = 10;
  const dayW = Math.floor((contentW - gap * 6) / 7);
  const dayInner = dayW - 20;

  const header = box(
    contentW,
    88,
    "Header",
    [
      box(
        Math.floor(contentW * 0.55),
        64,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.55) - 8, 20, "WEEKLY FAMILY SCHEDULE", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.55) - 8, "{{ family_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.4),
        64,
        "Range",
        [
          paragraph(Math.floor(contentW * 0.4) - 8, 22, "Week of", "right", LABEL_STYLE),
          heading(Math.floor(contentW * 0.4) - 8, "{{ week_of }}", 3, "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 20, gap: 16, align: "start" },
    FAMILY_HEADER,
  );

  const days: Array<[string, string]> = [
    ["Mon", "monday_plan"],
    ["Tue", "tuesday_plan"],
    ["Wed", "wednesday_plan"],
    ["Thu", "thursday_plan"],
    ["Fri", "friday_plan"],
    ["Sat", "saturday_plan"],
    ["Sun", "sunday_plan"],
  ];

  const dayColumns = days.map(([label, planVar]) =>
    box(
      dayW,
      420,
      label,
      [
        paragraph(dayInner, 26, label, "center", {
          ...VALUE_STYLE,
          fontSize: 14,
          bold: true,
          align: "center",
        }),
        paragraph(dayInner, 360, `{{ ${planVar} }}`, "left", { ...VALUE_STYLE, fontSize: 12 }),
      ],
      { direction: "column", gap: 10, padding: 10, align: "stretch" },
      DAY_CARD,
    ),
  );

  const weekGrid = box(
    contentW,
    440,
    "Week",
    dayColumns,
    { direction: "row", justify: "start", padding: 0, gap, align: "start" },
    INVISIBLE,
  );

  const eveningW = Math.floor((contentW - 16) / 2);
  const eveningInner = eveningW - 32;
  const dinners = box(
    eveningW,
    100,
    "Dinners",
    [
      sectionTitle(eveningInner, "Dinner plan"),
      paragraph(
        eveningInner,
        56,
        "Mon {{ mon_dinner }} · Tue {{ tue_dinner }} · Wed {{ wed_dinner }}\nThu {{ thu_dinner }} · Fri {{ fri_dinner }} · Sat {{ sat_dinner }} · Sun {{ sun_dinner }}",
      ),
    ],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );

  const focus = box(
    eveningW,
    100,
    "Week focus",
    [
      sectionTitle(eveningInner, "This week’s focus"),
      paragraph(eveningInner, 56, "{{ week_focus }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );

  const footerRow = box(
    contentW,
    110,
    "Footer row",
    [dinners, focus],
    { direction: "row", justify: "start", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  assemblePage(doc, [header, weekGrid, footerRow], { padding: pad, gap: 18 });
  declareVars(doc, [
    ["family_name", "Family or household name on the weekly card", "text", "The Rivera Family"],
    ["week_of", "Start date of the week shown on the card", "date", "March 16, 2026"],
    ["monday_plan", "Monday activities for the weekly schedule", "text", "School\nPiano 4:00 PM\nEarly bedtime"],
    ["tuesday_plan", "Tuesday activities for the weekly schedule", "text", "School\nGrocery run\nHomework club"],
    ["wednesday_plan", "Wednesday activities for the weekly schedule", "text", "School\nSoccer 5:30 PM"],
    ["thursday_plan", "Thursday activities for the weekly schedule", "text", "School\nLibrary books\nPack lunches"],
    ["friday_plan", "Friday activities for the weekly schedule", "text", "School\nPizza night\nGame night"],
    ["saturday_plan", "Saturday activities for the weekly schedule", "text", "Park morning\nChores\nMovie night"],
    ["sunday_plan", "Sunday activities for the weekly schedule", "text", "Brunch out\nMeal prep\nFamily video call"],
    ["mon_dinner", "Monday dinner", "text", "Pasta"],
    ["tue_dinner", "Tuesday dinner", "text", "Tacos"],
    ["wed_dinner", "Wednesday dinner", "text", "Stir-fry"],
    ["thu_dinner", "Thursday dinner", "text", "Soup and bread"],
    ["fri_dinner", "Friday dinner", "text", "Pizza"],
    ["sat_dinner", "Saturday dinner", "text", "Grill"],
    ["sun_dinner", "Sunday dinner", "text", "Roast chicken"],
    [
      "week_focus",
      "One short focus or goal for the household this week",
      "text",
      "Pack sports bags the night before. No screens after 8:30 on school nights.",
    ],
  ]);
  return doc;
}

/** Month overview: key dates, recurring rhythms, and household priorities. */
function familyMonthly(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    100,
    "Header",
    [
      box(
        Math.floor(contentW * 0.58),
        70,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.58) - 8, 20, "MONTHLY FAMILY PLANNER", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.58) - 8, "{{ family_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.36),
        70,
        "Month",
        [
          heading(Math.floor(contentW * 0.36) - 8, "{{ month_name }}", 1, "right"),
          paragraph(Math.floor(contentW * 0.36) - 8, 28, "{{ month_year }}", "right", LABEL_STYLE),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 22, gap: 20, align: "start" },
    FAMILY_HEADER,
  );

  const dateW = 100;
  const eventW = Math.floor(inner * 0.45);
  const whoW = inner - dateW - eventW;
  const eventHeader = box(
    inner,
    32,
    "Column headers",
    [
      paragraph(dateW, 28, "Date", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(eventW, 28, "Event", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(whoW, 28, "Who", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );

  const eventRow = box(
    inner,
    36,
    "Event",
    [
      paragraph(dateW, 28, "{{ event.date }}", "left", { ...VALUE_STYLE, bold: true }),
      paragraph(eventW, 28, "{{ event.title }}", "left", VALUE_STYLE),
      paragraph(whoW, 28, "{{ event.who }}", "left", LABEL_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  eventRow.repeat = { over: "family_monthly_events", as: "event" };

  const events = box(
    contentW,
    260,
    "Key dates",
    [sectionTitle(inner, "Key dates & events"), eventHeader, eventRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const halfW = Math.floor((contentW - 16) / 2);
  const halfInner = halfW - 32;
  const rhythms = box(
    halfW,
    160,
    "Rhythms",
    [
      sectionTitle(halfInner, "Monthly rhythms"),
      paragraph(halfInner, 110, "{{ monthly_rhythms }}"),
    ],
    { direction: "column", gap: 10, padding: 16 },
    CARD,
  );

  const goals = box(
    halfW,
    160,
    "Goals",
    [
      sectionTitle(halfInner, "Family goals"),
      paragraph(halfInner, 110, "{{ monthly_goals }}"),
    ],
    { direction: "column", gap: 10, padding: 16 },
    CARD,
  );

  const mid = box(
    contentW,
    170,
    "Mid",
    [rhythms, goals],
    { direction: "row", justify: "start", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  const budget = box(
    contentW,
    90,
    "Budget notes",
    [
      sectionTitle(inner, "Money & errands"),
      paragraph(inner, 40, "{{ monthly_errands }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  assemblePage(doc, [header, events, mid, budget], { padding: pad, gap: 20 });
  declareVars(doc, [
    ["family_name", "Family or household name on the monthly planner", "text", "The Rivera Family"],
    ["month_name", "Month name for the planner", "text", "March"],
    ["month_year", "Year for the monthly planner", "text", "2026"],
    [
      "family_monthly_events",
      "Important dates this month (date, event title, and who is involved)",
      "list",
      JSON.stringify([
        { date: "Mar 3", title: "Parent-teacher conferences", who: "Alex & Jordan" },
        { date: "Mar 12", title: "Maya's birthday party", who: "Whole family" },
        { date: "Mar 18", title: "School field trip", who: "Leo" },
        { date: "Mar 22", title: "Family photo session", who: "Whole family" },
        { date: "Mar 28", title: "Spring break starts", who: "Kids" },
      ]),
      [
        ["date", "Date of the event", "date"],
        ["title", "Event title or description", "text"],
        ["who", "Who the event involves", "text"],
      ],
    ],
    [
      "monthly_rhythms",
      "Recurring monthly habits or routines for the household",
      "text",
      "1st — pay bills & review calendar\n2nd Sunday — grandparents dinner\nLast Friday — family game night\nEvery Wednesday — recycling out",
    ],
    [
      "monthly_goals",
      "Family goals or intentions for the month",
      "text",
      "Eat dinner together 5 nights/week\nOne device-free Saturday morning\nFinish spring closet clean-out",
    ],
    [
      "monthly_errands",
      "Money, errands, or logistics to remember this month",
      "text",
      "Renew soccer registration · Schedule dentist · Order birthday gift for Maya",
    ],
  ]);
  return doc;
}

/** Landscape year wall calendar — twelve month cards plus annual priorities. */
function familyYearly(): DesignDocument {
  const doc = createEmptyDocument({ w: 1100, h: 850 });
  const pad = 28;
  const contentW = doc.root.w - pad * 2;
  const colGap = 12;
  const rowGap = 12;
  const monthW = Math.floor((contentW - colGap * 3) / 4);
  const monthInner = monthW - 20;

  const header = box(
    contentW,
    88,
    "Header",
    [
      box(
        Math.floor(contentW * 0.55),
        64,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.55) - 8, 20, "YEARLY FAMILY CALENDAR", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.55) - 8, "{{ family_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.38),
        64,
        "Year",
        [heading(Math.floor(contentW * 0.38) - 8, "{{ calendar_year }}", 1, "right")],
        { direction: "column", gap: 0, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 20, gap: 16, align: "center" },
    FAMILY_HEADER,
  );

  const months: Array<[string, string, string]> = [
    ["January", "jan_notes", "New Year · ski weekend"],
    ["February", "feb_notes", "Maya birthday (12th)"],
    ["March", "mar_notes", "Spring break · photos"],
    ["April", "apr_notes", "Taxes · Easter"],
    ["May", "may_notes", "Mother's Day · field day"],
    ["June", "jun_notes", "Last day of school"],
    ["July", "jul_notes", "Beach trip (week 2)"],
    ["August", "aug_notes", "Back-to-school shopping"],
    ["September", "sep_notes", "School starts · soccer"],
    ["October", "oct_notes", "Halloween · fall fest"],
    ["November", "nov_notes", "Thanksgiving travel"],
    ["December", "dec_notes", "Holidays · year review"],
  ];

  function monthCard(name: string, varName: string) {
    return box(
      monthW,
      118,
      name,
      [
        paragraph(monthInner, 24, name, "left", { ...VALUE_STYLE, fontSize: 13, bold: true }),
        paragraph(monthInner, 70, `{{ ${varName} }}`, "left", { ...VALUE_STYLE, fontSize: 12 }),
      ],
      { direction: "column", gap: 6, padding: 10 },
      DAY_CARD,
    );
  }

  const rows = [0, 1, 2].map((row) => {
    const slice = months.slice(row * 4, row * 4 + 4);
    return box(
      contentW,
      118,
      `Row ${row + 1}`,
      slice.map(([name, varName]) => monthCard(name, varName)),
      { direction: "row", justify: "start", padding: 0, gap: colGap, align: "start" },
      INVISIBLE,
    );
  });

  const yearGrid = box(
    contentW,
    380,
    "Months",
    rows,
    { direction: "column", gap: rowGap, padding: 0 },
    INVISIBLE,
  );

  const halfW = Math.floor((contentW - 16) / 2);
  const halfInner = halfW - 32;
  const goals = box(
    halfW,
    120,
    "Annual goals",
    [
      sectionTitle(halfInner, "Annual goals"),
      paragraph(halfInner, 70, "{{ yearly_goals }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );

  const trips = box(
    halfW,
    120,
    "Trips",
    [
      sectionTitle(halfInner, "Trips & big moments"),
      paragraph(halfInner, 70, "{{ yearly_trips }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );

  const bottom = box(
    contentW,
    130,
    "Bottom",
    [goals, trips],
    { direction: "row", justify: "start", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  assemblePage(doc, [header, yearGrid, bottom], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["family_name", "Family or household name on the yearly calendar", "text", "The Rivera Family"],
    ["calendar_year", "Calendar year shown on the yearly planner", "text", "2026"],
    ["jan_notes", "January highlights on the yearly calendar", "text", months[0][2]],
    ["feb_notes", "February highlights on the yearly calendar", "text", months[1][2]],
    ["mar_notes", "March highlights on the yearly calendar", "text", months[2][2]],
    ["apr_notes", "April highlights on the yearly calendar", "text", months[3][2]],
    ["may_notes", "May highlights on the yearly calendar", "text", months[4][2]],
    ["jun_notes", "June highlights on the yearly calendar", "text", months[5][2]],
    ["jul_notes", "July highlights on the yearly calendar", "text", months[6][2]],
    ["aug_notes", "August highlights on the yearly calendar", "text", months[7][2]],
    ["sep_notes", "September highlights on the yearly calendar", "text", months[8][2]],
    ["oct_notes", "October highlights on the yearly calendar", "text", months[9][2]],
    ["nov_notes", "November highlights on the yearly calendar", "text", months[10][2]],
    ["dec_notes", "December highlights on the yearly calendar", "text", months[11][2]],
    [
      "yearly_goals",
      "Family goals for the full year",
      "text",
      "Save for summer beach trip\nCook together every Sunday\nVisit both sets of grandparents",
    ],
    [
      "yearly_trips",
      "Major trips and celebrations planned for the year",
      "text",
      "July — beach week\nNovember — Thanksgiving travel\nDecember — holiday open house",
    ],
  ]);
  return doc;
}

/** Meeting agenda with timed topics and action items. */
function meetingAgenda(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    100,
    "Header",
    [
      box(
        Math.floor(contentW * 0.62),
        72,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.62) - 8, 20, "MEETING AGENDA", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.62) - 8, "{{ meeting_title }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.32),
        72,
        "When",
        [
          paragraph(Math.floor(contentW * 0.32) - 8, 28, "{{ meeting_date }}", "right", VALUE_STYLE),
          paragraph(Math.floor(contentW * 0.32) - 8, 28, "{{ meeting_time }}", "right", LABEL_STYLE),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 22, gap: 16, align: "start" },
    FAMILY_HEADER,
  );

  const meta = box(
    contentW,
    80,
    "Meta",
    [
      infoRow(inner, "Facilitator", "{{ facilitator }}"),
      infoRow(inner, "Attendees", "{{ attendees }}"),
      infoRow(inner, "Location", "{{ meeting_location }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const topicW = Math.floor(inner * 0.48);
  const ownerW = Math.floor(inner * 0.22);
  const minsW = inner - topicW - ownerW;
  const agendaHeader = box(
    inner,
    32,
    "Column headers",
    [
      paragraph(minsW, 28, "Time", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(topicW, 28, "Topic", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(ownerW, 28, "Owner", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  const agendaRow = box(
    inner,
    36,
    "Agenda item",
    [
      paragraph(minsW, 28, "{{ item.time }}", "left", { ...VALUE_STYLE, bold: true }),
      paragraph(topicW, 28, "{{ item.topic }}", "left", VALUE_STYLE),
      paragraph(ownerW, 28, "{{ item.owner }}", "left", LABEL_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  agendaRow.repeat = { over: "meeting_agenda_items", as: "item" };

  const agenda = box(
    contentW,
    220,
    "Agenda",
    [sectionTitle(inner, "Agenda"), agendaHeader, agendaRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const halfW = Math.floor((contentW - 16) / 2);
  const halfInner = halfW - 32;
  const notes = box(
    halfW,
    140,
    "Notes",
    [sectionTitle(halfInner, "Discussion notes"), paragraph(halfInner, 90, "{{ meeting_notes }}")],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );
  const actions = box(
    halfW,
    140,
    "Actions",
    [sectionTitle(halfInner, "Action items"), paragraph(halfInner, 90, "{{ action_items }}")],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );
  const bottom = box(
    contentW,
    150,
    "Bottom",
    [notes, actions],
    { direction: "row", justify: "start", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  assemblePage(doc, [header, meta, agenda, bottom], { padding: pad, gap: 20 });
  declareVars(doc, [
    ["meeting_title", "Meeting title on the agenda", "text", "Weekly product sync"],
    ["meeting_date", "Meeting date", "date", "March 18, 2026"],
    ["meeting_time", "Meeting start time and duration", "text", "10:00–10:45 AM"],
    ["facilitator", "Person running the meeting", "text", "Alex Rivera"],
    ["attendees", "People invited or present at the meeting", "text", "Alex, Jordan, Sam, Priya"],
    ["meeting_location", "Meeting room or video link", "text", "Zoom · Product room"],
    [
      "meeting_agenda_items",
      "Agenda topics with time box, topic title, and owner",
      "list",
      JSON.stringify([
        { time: "5 min", topic: "Wins since last week", owner: "All" },
        { time: "15 min", topic: "Sprint goals and blockers", owner: "Jordan" },
        { time: "15 min", topic: "Launch checklist review", owner: "Priya" },
        { time: "10 min", topic: "Decisions and next steps", owner: "Alex" },
      ]),
      [
        ["time", "Time box for this agenda topic", "text"],
        ["topic", "Agenda topic title", "text"],
        ["owner", "Person leading this topic", "text"],
      ],
    ],
    [
      "meeting_notes",
      "Discussion notes captured during the meeting",
      "text",
      "Launch date confirmed for Apr 2.\nNeed design QA sign-off by Friday.",
    ],
    [
      "action_items",
      "Follow-up actions with owners and due dates",
      "text",
      "Priya — finish QA checklist (Mar 20)\nSam — update status page copy (Mar 21)\nAlex — send notes to stakeholders (today)",
    ],
  ]);
  return doc;
}

/** Project plan with milestones and risks. */
function projectPlan(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    100,
    "Header",
    [
      box(
        Math.floor(contentW * 0.62),
        72,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.62) - 8, 20, "PROJECT PLAN", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.62) - 8, "{{ project_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.32),
        72,
        "Status",
        [
          paragraph(Math.floor(contentW * 0.32) - 8, 22, "Status", "right", LABEL_STYLE),
          heading(Math.floor(contentW * 0.32) - 8, "{{ project_status }}", 3, "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 22, gap: 16, align: "start" },
    FAMILY_HEADER,
  );

  const overview = box(
    contentW,
    110,
    "Overview",
    [
      sectionTitle(inner, "Overview"),
      paragraph(inner, 60, "{{ project_summary }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const metaHalf = Math.floor((contentW - 16) / 2);
  const metaInner = metaHalf - 32;
  const details = box(
    metaHalf,
    130,
    "Details",
    [
      sectionTitle(metaInner, "Details"),
      infoRow(metaInner, "Owner", "{{ project_owner }}"),
      infoRow(metaInner, "Start", "{{ project_start }}"),
      infoRow(metaInner, "Target", "{{ project_target }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );
  const success = box(
    metaHalf,
    130,
    "Success",
    [
      sectionTitle(metaInner, "Success criteria"),
      paragraph(metaInner, 70, "{{ success_criteria }}"),
    ],
    { direction: "column", gap: 8, padding: 16 },
    CARD,
  );
  const mid = box(
    contentW,
    140,
    "Mid",
    [details, success],
    { direction: "row", justify: "start", padding: 0, gap: 16, align: "start" },
    INVISIBLE,
  );

  const mDate = 100;
  const mTitle = Math.floor(inner * 0.45);
  const mOwner = inner - mDate - mTitle;
  const mileHeader = box(
    inner,
    32,
    "Column headers",
    [
      paragraph(mDate, 28, "Date", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(mTitle, 28, "Milestone", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(mOwner, 28, "Owner", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  const mileRow = box(
    inner,
    36,
    "Milestone",
    [
      paragraph(mDate, 28, "{{ mile.date }}", "left", { ...VALUE_STYLE, bold: true }),
      paragraph(mTitle, 28, "{{ mile.title }}", "left", VALUE_STYLE),
      paragraph(mOwner, 28, "{{ mile.owner }}", "left", LABEL_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  mileRow.repeat = { over: "project_plan_milestones", as: "mile" };

  const milestones = box(
    contentW,
    200,
    "Milestones",
    [sectionTitle(inner, "Milestones"), mileHeader, mileRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const risks = box(
    contentW,
    90,
    "Risks",
    [sectionTitle(inner, "Risks and open questions"), paragraph(inner, 40, "{{ project_risks }}")],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  assemblePage(doc, [header, overview, mid, milestones, risks], { padding: pad, gap: 18 });
  declareVars(doc, [
    ["project_name", "Project name on the plan", "text", "Website redesign launch"],
    ["project_status", "Current project status label", "text", "On track"],
    [
      "project_summary",
      "Short project summary or objective",
      "text",
      "Ship the new marketing site with updated brand, pricing page, and template gallery by April 2.",
    ],
    ["project_owner", "Project owner or lead", "text", "Alex Rivera"],
    ["project_start", "Project start date", "date", "Feb 10, 2026"],
    ["project_target", "Project target ship date", "date", "Apr 2, 2026"],
    [
      "success_criteria",
      "How success will be measured for this project",
      "text",
      "Lighthouse perf > 90 on homepage\nAll starters render in preview\nZero severity-1 bugs at launch",
    ],
    [
      "project_plan_milestones",
      "Project milestones with date, title, and owner",
      "list",
      JSON.stringify([
        { date: "Feb 28", title: "Design system freeze", owner: "Sam" },
        { date: "Mar 14", title: "Content migration complete", owner: "Priya" },
        { date: "Mar 21", title: "QA + accessibility pass", owner: "Jordan" },
        { date: "Apr 2", title: "Public launch", owner: "Alex" },
      ]),
      [
        ["date", "Milestone target date", "date"],
        ["title", "Milestone title", "text"],
        ["owner", "Milestone owner", "text"],
      ],
    ],
    [
      "project_risks",
      "Risks, dependencies, or open questions for the project",
      "text",
      "CMS migration may slip if redirects are incomplete.\nNeed legal review on pricing copy before launch.",
    ],
  ]);
  return doc;
}

/** Printable team task tracker sheet. */
function taskList(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    90,
    "Header",
    [
      box(
        Math.floor(contentW * 0.58),
        64,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.58) - 8, 20, "TASK LIST", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.58) - 8, "{{ board_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.36),
        64,
        "Period",
        [
          paragraph(Math.floor(contentW * 0.36) - 8, 22, "Period", "right", LABEL_STYLE),
          heading(Math.floor(contentW * 0.36) - 8, "{{ task_period }}", 3, "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 22, gap: 16, align: "start" },
    FAMILY_HEADER,
  );

  const taskW = Math.floor(inner * 0.42);
  const ownerW = Math.floor(inner * 0.18);
  const dueW = Math.floor(inner * 0.16);
  const statusW = inner - taskW - ownerW - dueW;
  const taskHeader = box(
    inner,
    32,
    "Column headers",
    [
      paragraph(taskW, 28, "Task", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(ownerW, 28, "Owner", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(dueW, 28, "Due", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(statusW, 28, "Status", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  const taskRow = box(
    inner,
    36,
    "Task",
    [
      paragraph(taskW, 28, "{{ task.title }}", "left", VALUE_STYLE),
      paragraph(ownerW, 28, "{{ task.owner }}", "left", LABEL_STYLE),
      paragraph(dueW, 28, "{{ task.due }}", "left", VALUE_STYLE),
      paragraph(statusW, 28, "{{ task.status }}", "left", { ...VALUE_STYLE, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  taskRow.repeat = { over: "task_list_items", as: "task" };

  const sheet = box(
    contentW,
    320,
    "Tasks",
    [sectionTitle(inner, "Work items"), taskHeader, taskRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const notes = box(
    contentW,
    80,
    "Notes",
    [sectionTitle(inner, "Notes"), paragraph(inner, 36, "{{ task_notes }}")],
    { direction: "column", gap: 8, padding: 20 },
    INVISIBLE,
  );

  assemblePage(doc, [header, sheet, notes], { padding: pad, gap: 20 });
  declareVars(doc, [
    ["board_name", "Task list or board name", "text", "Launch readiness"],
    ["task_period", "Sprint or date range for this task list", "text", "Mar 17 – Mar 28"],
    [
      "task_list_items",
      "Tasks with title, owner, due date, and status",
      "list",
      JSON.stringify([
        { title: "Finalize pricing table copy", owner: "Priya", due: "Mar 19", status: "In progress" },
        { title: "Accessibility pass on templates", owner: "Jordan", due: "Mar 21", status: "Todo" },
        { title: "Set up status page", owner: "Sam", due: "Mar 20", status: "In progress" },
        { title: "Customer email draft", owner: "Alex", due: "Mar 24", status: "Todo" },
        { title: "Load-test preview pipeline", owner: "Jordan", due: "Mar 25", status: "Blocked" },
      ]),
      [
        ["title", "Task title", "text"],
        ["owner", "Task owner", "text"],
        ["due", "Task due date", "date"],
        ["status", "Task status", "text"],
      ],
    ],
    [
      "task_notes",
      "Notes or blockers for the task list",
      "text",
      "Blocked item waiting on staging credentials from infra.",
    ],
  ]);
  return doc;
}

/** Employee timesheet for a pay or billing period. */
function timesheet(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    100,
    "Header",
    [
      box(
        Math.floor(contentW * 0.58),
        72,
        "Title",
        [
          paragraph(Math.floor(contentW * 0.58) - 8, 20, "TIMESHEET", "left", {
            ...LABEL_STYLE,
            fontSize: 11,
            bold: true,
          }),
          heading(Math.floor(contentW * 0.58) - 8, "{{ employee_name }}", 2),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.36),
        72,
        "Period",
        [
          paragraph(Math.floor(contentW * 0.36) - 8, 22, "Period", "right", LABEL_STYLE),
          heading(Math.floor(contentW * 0.36) - 8, "{{ timesheet_period }}", 3, "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 22, gap: 16, align: "start" },
    FAMILY_HEADER,
  );

  const info = box(
    contentW,
    70,
    "Info",
    [
      infoRow(inner, "Employee ID", "{{ employee_id }}"),
      infoRow(inner, "Manager", "{{ manager_name }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const dateW = 100;
  const projectW = Math.floor(inner * 0.42);
  const hoursW = 80;
  const notesW = inner - dateW - projectW - hoursW;
  const entryHeader = box(
    inner,
    32,
    "Column headers",
    [
      paragraph(dateW, 28, "Date", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(projectW, 28, "Project / code", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(hoursW, 28, "Hours", "right", { ...LABEL_STYLE, fontSize: 12, bold: true }),
      paragraph(notesW, 28, "Notes", "left", { ...LABEL_STYLE, fontSize: 12, bold: true }),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  const entryRow = box(
    inner,
    36,
    "Entry",
    [
      paragraph(dateW, 28, "{{ entry.date }}", "left", { ...VALUE_STYLE, bold: true }),
      paragraph(projectW, 28, "{{ entry.project }}", "left", VALUE_STYLE),
      paragraph(hoursW, 28, "{{ entry.hours }}", "right", VALUE_STYLE),
      paragraph(notesW, 28, "{{ entry.notes }}", "left", LABEL_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
  entryRow.repeat = { over: "timesheet_entries", as: "entry" };

  const entries = box(
    contentW,
    260,
    "Entries",
    [sectionTitle(inner, "Time entries"), entryHeader, entryRow],
    { direction: "column", gap: 12, padding: 20 },
    CARD,
  );

  const totals = box(
    contentW,
    64,
    "Totals",
    [
      heading(220, "Total hours", 3),
      heading(160, "{{ total_hours }}", 3, "right"),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 18 },
    CARD,
  );

  const sign = box(
    contentW,
    80,
    "Signatures",
    [
      paragraph(
        inner,
        48,
        "Employee signature: ______________________     Manager approval: ______________________",
      ),
    ],
    { direction: "column", padding: 16 },
    INVISIBLE,
  );

  assemblePage(doc, [header, info, entries, totals, sign], { padding: pad, gap: 18 });
  declareVars(doc, [
    ["employee_name", "Employee name on the timesheet", "text", "Jordan Lee"],
    ["timesheet_period", "Pay or billing period for the timesheet", "text", "Mar 1 – Mar 15, 2026"],
    ["employee_id", "Employee ID on the timesheet", "text", "EMP-00214"],
    ["manager_name", "Approving manager name", "text", "Alex Rivera"],
    [
      "timesheet_entries",
      "Timesheet rows with date, project code, hours, and notes",
      "list",
      JSON.stringify([
        { date: "Mar 2", project: "Website redesign", hours: "8.0", notes: "Template polish" },
        { date: "Mar 3", project: "Website redesign", hours: "7.5", notes: "Preview QA" },
        { date: "Mar 4", project: "Client support", hours: "8.0", notes: "On-call" },
        { date: "Mar 5", project: "Website redesign", hours: "8.0", notes: "Family starters" },
        { date: "Mar 6", project: "Internal", hours: "4.0", notes: "Planning" },
      ]),
      [
        ["date", "Work date", "date"],
        ["project", "Project name or cost code", "text"],
        ["hours", "Hours worked", "number"],
        ["notes", "Short note for the entry", "text"],
      ],
    ],
    ["total_hours", "Total hours for the timesheet period", "number", "35.5"],
  ]);
  return doc;
}

export type TemplateCategory = "business" | "family" | "general";

export interface Template {
  id: string;
  label: string;
  description: string;
  category: TemplateCategory;
  build: () => DesignDocument;
}

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string; blurb: string }[] = [
  { id: "family", label: "Family", blurb: "Schedules and planners for the household" },
  {
    id: "business",
    label: "Business",
    blurb: "Invoices, planning sheets, meetings, tasks, and contracts",
  },
  { id: "general", label: "General", blurb: "Flexible layouts for extracted documents" },
];

export const TEMPLATES: Template[] = [
  {
    id: "family_daily",
    label: "Daily family schedule",
    description: "Fridge-ready day card — timed blocks, meals, and reminders",
    category: "family",
    build: familyDaily,
  },
  {
    id: "family_weekly",
    label: "Weekly family schedule",
    description: "Landscape week-at-a-glance with seven day columns and dinners",
    category: "family",
    build: familyWeekly,
  },
  {
    id: "family_monthly",
    label: "Monthly family planner",
    description: "Month overview with key dates, rhythms, and household goals",
    category: "family",
    build: familyMonthly,
  },
  {
    id: "family_yearly",
    label: "Yearly family calendar",
    description: "Landscape year wall calendar with twelve months and annual goals",
    category: "family",
    build: familyYearly,
  },
  {
    id: "meeting_agenda",
    label: "Meeting agenda",
    description: "Timed topics, attendees, notes, and action items",
    category: "business",
    build: meetingAgenda,
  },
  {
    id: "project_plan",
    label: "Project plan",
    description: "Objectives, milestones, owners, and risks on one page",
    category: "business",
    build: projectPlan,
  },
  {
    id: "task_list",
    label: "Task list",
    description: "Printable work tracker — task, owner, due date, status",
    category: "business",
    build: taskList,
  },
  {
    id: "timesheet",
    label: "Timesheet",
    description: "Employee hours by project for a pay or billing period",
    category: "business",
    build: timesheet,
  },
  {
    id: "invoice",
    label: "Client invoice",
    description: "Design the invoice customers receive — bill-to, line items, and total",
    category: "business",
    build: invoice,
  },
  {
    id: "receipt",
    label: "Store receipt",
    description: "Narrow till-print layout for itemized purchases and tax",
    category: "business",
    build: receipt,
  },
  {
    id: "statement",
    label: "Account statement",
    description: "Bank-style summary with balances and transaction rows",
    category: "business",
    build: bankStatement,
  },
  {
    id: "insurance",
    label: "Coverage certificate",
    description: "Proof-of-insurance page: holder, coverage table, and policy period",
    category: "business",
    build: insuranceCertificate,
  },
  {
    id: "paystub",
    label: "Payroll stub",
    description: "Employee earnings slip driven entirely by {{ variables }}",
    category: "business",
    build: payStub,
  },
  {
    id: "rental",
    label: "Residential lease",
    description: "Apartment lease terms, parties, and signature blocks",
    category: "business",
    build: rentalAgreement,
  },
  {
    id: "letter",
    label: "Letterhead letter",
    description: "Formal correspondence with sender, recipient, and body",
    category: "business",
    build: businessLetter,
  },
  {
    id: "report",
    label: "Markdown report",
    description: "Page layout for FileWorks-extracted Markdown from the workspace",
    category: "general",
    build: documentReport,
  },
];

/** Library-facing alias (name instead of label). */
export const BUILT_IN_TEMPLATES = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.label,
  description: t.description,
  category: t.category,
  build: t.build,
}));

export function builtInTemplate(id: string) {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id);
}
