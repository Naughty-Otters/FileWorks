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

function heading(w: number, label: string, level: 1 | 2 | 3 = 2, align: "left" | "center" | "right" = "left") {
  const n = createNode("heading", 0, 0);
  n.label = label;
  n.level = level;
  n.w = w;
  n.style.fontSize = HEADING_LEVEL_PRESET[level].fontSize;
  n.style.align = align;
  return n;
}

function paragraph(
  w: number,
  h: number,
  label: string,
  align: "left" | "center" | "right" = "left",
) {
  const n = createNode("paragraph", 0, 0);
  n.label = label;
  n.w = w;
  n.h = h;
  n.style.align = align;
  return n;
}

/** Same "invisible structural wrapper" preset used for rows/columns that
 * only exist to group a couple of fields — no fill, no border, no
 * caption chip. */
const INVISIBLE: Partial<NodeStyle> = {
  backgroundColor: "transparent",
  borderStyle: "none",
  borderWidth: 0,
};

/** Builds a Box and immediately resolves its auto-sized dimension (height
 * for a column, width for a row) using the exact same formula the Rust
 * layout engine applies later — so callers can read the real `.h`/`.w`
 * back and use it to place the *next* sibling correctly, instead of
 * guessing a height that gets silently overridden on the first relayout. */
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
      n.w = children.reduce((a, c) => a + c.w, 0) + gapTotal + 2 * n.layout.padding;
    } else {
      n.h = children.reduce((a, c) => a + c.h, 0) + gapTotal + 2 * n.layout.padding;
    }
  }
  return n;
}

const GAP = 16;

function placeStacked(doc: DesignDocument, boxes: DesignNode[], startY = 40, x = 40) {
  doc.root.children = boxes;
  let y = startY;
  for (const b of boxes) {
    b.x = x;
    b.y = y;
    y += b.h + GAP;
  }
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
  const pageW = doc.root.w;
  const contentW = pageW - 80;

  const header = box(
    contentW,
    80,
    "Header",
    [
      box(
        300,
        70,
        "Company",
        [
          heading(280, "{{ company_name }}", 2),
          paragraph(280, 36, "{{ company_address }}\n{{ company_email }}"),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        220,
        70,
        "Invoice meta",
        [
          heading(200, "INVOICE", 1, "right"),
          paragraph(200, 36, "Invoice #: {{ invoice_number }}\nDate: {{ invoice_date }}", "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 24, gap: 24 },
    INVISIBLE,
  );

  const billTo = box(
    contentW,
    90,
    "Bill to",
    [
      heading(200, "Bill To", 3),
      paragraph(360, 54, "{{ client_name }}\n{{ client_address }}\n{{ client_email }}"),
    ],
    { direction: "column", gap: 6, padding: 20 },
  );

  const headerRow = box(
    contentW - 40,
    28,
    "Column headers",
    [paragraph(360, 20, "Description"), paragraph(120, 20, "Amount", "right")],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  headerRow.style.bold = true;

  const itemRow = box(
    contentW - 40,
    28,
    "Line item",
    [
      paragraph(360, 20, "{{ item.description }}"),
      paragraph(120, 20, "{{ item.amount }}", "right"),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  itemRow.repeat = { over: "invoice_spending_items", as: "item" };

  const lineItems = box(
    contentW,
    160,
    "Line items",
    [headerRow, itemRow],
    { direction: "column", gap: 10, padding: 20 },
  );

  const totals = box(
    contentW,
    56,
    "Total",
    [heading(200, "Total", 3), heading(160, "{{ invoice_total }}", 3, "right")],
    { direction: "row", justify: "space-between", padding: 16 },
  );

  const notes = box(
    contentW,
    70,
    "Notes",
    [paragraph(contentW - 40, 50, "{{ invoice_notes }}")],
    { direction: "column", padding: 20 },
    INVISIBLE,
  );

  placeStacked(doc, [header, billTo, lineItems, totals, notes]);
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
  const pageW = doc.root.w;
  const contentW = pageW - 32;

  const header = box(
    contentW,
    90,
    "Header",
    [
      heading(pageW - 64, "{{ store_name }}", 2, "center"),
      paragraph(pageW - 64, 40, "{{ store_address }}\n{{ store_phone }}", "center"),
    ],
    { direction: "column", gap: 4, padding: 16, align: "center" },
    INVISIBLE,
  );

  const meta = box(
    contentW,
    40,
    "Meta",
    [paragraph(pageW - 64, 28, "Date: {{ receipt_date }}\nReceipt #: {{ receipt_number }}", "center")],
    { direction: "column", padding: 8, align: "center" },
    INVISIBLE,
  );

  const itemRow = box(
    contentW - 32,
    24,
    "Item",
    [
      paragraph(160, 20, "{{ item.description }}"),
      paragraph(100, 20, "{{ item.amount }}", "right"),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  itemRow.repeat = { over: "receipt_purchased_items", as: "item" };

  const items = box(
    contentW,
    100,
    "Items",
    [itemRow],
    { direction: "column", gap: 10, padding: 16 },
  );

  const totals = box(
    contentW,
    90,
    "Totals",
    [
      box(
        contentW - 32,
        24,
        "Subtotal row",
        [paragraph(120, 20, "Subtotal"), paragraph(100, 20, "{{ receipt_subtotal }}", "right")],
        { direction: "row", justify: "space-between", align: "center", padding: 0 },
        INVISIBLE,
      ),
      box(
        contentW - 32,
        24,
        "Tax row",
        [paragraph(120, 20, "Tax"), paragraph(100, 20, "{{ receipt_tax }}", "right")],
        { direction: "row", justify: "space-between", align: "center", padding: 0 },
        INVISIBLE,
      ),
      box(
        contentW - 32,
        28,
        "Total row",
        [heading(120, "Total", 3), heading(100, "{{ receipt_total }}", 3, "right")],
        { direction: "row", justify: "space-between", align: "center", padding: 0 },
        INVISIBLE,
      ),
    ],
    { direction: "column", gap: 6, padding: 16 },
  );

  const footer = box(
    contentW,
    50,
    "Footer",
    [paragraph(pageW - 64, 30, "{{ thank_you_message }}", "center")],
    { direction: "column", padding: 16, align: "center" },
    INVISIBLE,
  );

  placeStacked(doc, [header, meta, items, totals, footer], 16, 16);
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
  const pageW = doc.root.w;
  const contentW = pageW - 80;

  const header = box(
    contentW,
    90,
    "Header",
    [
      box(
        340,
        42,
        "Bank",
        [heading(320, "{{ bank_name }}", 2)],
        { direction: "column", padding: 0 },
        INVISIBLE,
      ),
      box(
        300,
        76,
        "Statement info",
        [
          heading(280, "Account Statement", 3, "right"),
          paragraph(280, 30, "Period: {{ statement_period }}", "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 24, gap: 24 },
    INVISIBLE,
  );

  function summaryItem(label: string, value: string) {
    return box(
      170,
      60,
      label,
      [paragraph(150, 18, label), heading(150, value, 3)],
      { direction: "column", gap: 4, padding: 0 },
      INVISIBLE,
    );
  }

  const summary = box(
    contentW,
    100,
    "Account summary",
    [
      summaryItem("Account Number", "{{ account_number }}"),
      summaryItem("Opening Balance", "{{ opening_balance }}"),
      summaryItem("Closing Balance", "{{ closing_balance }}"),
    ],
    { direction: "row", justify: "space-between", padding: 20, gap: 10 },
  );

  const txHeader = box(
    contentW - 40,
    28,
    "Column headers",
    [
      paragraph(80, 20, "Date"),
      paragraph(260, 20, "Description"),
      paragraph(100, 20, "Amount", "right"),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  txHeader.style.bold = true;

  const txRow = box(
    contentW - 40,
    28,
    "Transaction",
    [
      paragraph(80, 20, "{{ tx.date }}"),
      paragraph(260, 20, "{{ tx.description }}"),
      paragraph(100, 20, "{{ tx.amount }}", "right"),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  txRow.repeat = { over: "statement_transactions", as: "tx" };

  const transactions = box(
    contentW,
    200,
    "Transactions",
    [txHeader, txRow],
    { direction: "column", gap: 12, padding: 20 },
  );

  const footer = box(
    contentW,
    50,
    "Footer",
    [
      paragraph(
        contentW - 40,
        40,
        "This statement is provided for informational purposes. Please contact us within 30 days of any discrepancy.",
      ),
    ],
    { direction: "column", padding: 20 },
    INVISIBLE,
  );

  placeStacked(doc, [header, summary, transactions, footer]);
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
  const pageW = doc.root.w;
  const contentW = pageW - 80;

  const header = box(
    contentW,
    90,
    "Header",
    [
      heading(contentW - 40, "Certificate of Insurance", 1, "center"),
      paragraph(contentW - 40, 30, "This certifies that the policy described below is in effect.", "center"),
    ],
    { direction: "column", gap: 6, padding: 20, align: "center" },
    INVISIBLE,
  );

  const policyHolder = box(
    contentW,
    110,
    "Policy holder",
    [
      heading(300, "Policy Holder", 3),
      paragraph(
        360,
        70,
        "{{ holder_name }}\n{{ holder_address }}\nPolicy #: {{ policy_number }}",
      ),
    ],
    { direction: "column", gap: 6, padding: 20 },
  );

  const covHeader = box(
    contentW - 40,
    28,
    "Column headers",
    [paragraph(280, 20, "Coverage Type"), paragraph(160, 20, "Limit", "right")],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  covHeader.style.bold = true;

  const coverageRow = box(
    contentW - 40,
    28,
    "Coverage",
    [
      paragraph(280, 20, "{{ coverage.type }}"),
      paragraph(160, 20, "{{ coverage.limit }}", "right"),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0 },
    INVISIBLE,
  );
  coverageRow.repeat = { over: "insurance_coverages", as: "coverage" };

  const coverage = box(
    contentW,
    160,
    "Coverage",
    [covHeader, coverageRow],
    { direction: "column", gap: 12, padding: 20 },
  );

  const period = box(
    contentW,
    90,
    "Policy period",
    [
      box(
        260,
        42,
        "Effective",
        [paragraph(240, 18, "Effective Date"), heading(240, "{{ effective_date }}", 3)],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        260,
        42,
        "Expiration",
        [
          paragraph(240, 18, "Expiration Date", "right"),
          heading(240, "{{ expiration_date }}", 3, "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 20 },
  );

  const footer = box(
    contentW,
    60,
    "Footer",
    [
      paragraph(
        contentW - 40,
        40,
        "Insurer: {{ insurer_name }}\nAuthorized Signature: ______________________",
      ),
    ],
    { direction: "column", padding: 20 },
    INVISIBLE,
  );

  placeStacked(doc, [header, policyHolder, coverage, period, footer]);
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
  const pageW = doc.root.w;
  const contentW = pageW - 160;

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

  placeStacked(doc, [sender, date, recipient, greeting, body, closing], 60, 80);
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
  const pageW = doc.root.w;
  const contentW = pageW - 80;

  const header = box(
    contentW,
    90,
    "Header",
    [
      box(
        340,
        66,
        "Company",
        [heading(320, "{{ employer_name }}", 2), paragraph(320, 30, "{{ employer_address }}")],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        300,
        66,
        "Stub info",
        [
          heading(280, "PAY STUB", 2, "right"),
          paragraph(280, 30, "Pay date: {{ pay_date }}", "right"),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 24, gap: 24 },
    INVISIBLE,
  );

  function infoRow(labelText: string, value: string) {
    return box(
      340,
      28,
      "Row",
      [paragraph(200, 20, labelText), paragraph(140, 20, value, "right")],
      { direction: "row", justify: "space-between", align: "center", padding: 0 },
      INVISIBLE,
    );
  }

  const employeeInfo = box(
    contentW,
    100,
    "Employee info",
    [
      box(
        contentW - 40,
        56,
        "col",
        [infoRow("Employee", "{{ employee_name }}"), infoRow("Employee ID", "{{ employee_id }}")],
        { direction: "column", gap: 8, padding: 0 },
        INVISIBLE,
      ),
      box(
        contentW - 40,
        56,
        "col",
        [
          infoRow("Pay period", "{{ pay_period_start }} – {{ pay_period_end }}"),
          infoRow("Filing status", "{{ filing_status }}"),
        ],
        { direction: "column", gap: 8, padding: 0 },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 20, gap: 24 },
  );

  const earnings = box(
    contentW,
    150,
    "Earnings",
    [
      infoRow("Regular hours", "{{ regular_hours }}"),
      infoRow("Hourly rate", "{{ hourly_rate }}"),
      infoRow("Overtime pay", "{{ overtime_pay }}"),
      infoRow("Gross pay", "{{ gross_pay }}"),
    ],
    { direction: "column", gap: 10, padding: 20 },
  );

  const deductions = box(
    contentW,
    170,
    "Deductions",
    [
      infoRow("Federal tax", "{{ federal_tax }}"),
      infoRow("State tax", "{{ state_tax }}"),
      infoRow("Insurance", "{{ insurance_deduction }}"),
      infoRow("Retirement (401k)", "{{ retirement_deduction }}"),
      infoRow("Total deductions", "{{ total_deductions }}"),
    ],
    { direction: "column", gap: 10, padding: 20 },
  );

  const netPay = box(
    contentW,
    70,
    "Net pay",
    [heading(300, "Net Pay: {{ net_pay }}", 2, "right")],
    { direction: "row", justify: "end", padding: 20 },
    { backgroundColor: "#f0fdf4", borderStyle: "solid", borderWidth: 1, borderColor: "#bbf7d0" },
  );

  placeStacked(doc, [header, employeeInfo, earnings, deductions, netPay]);

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
  const pageW = doc.root.w;
  const contentW = pageW - 80;

  const title = box(
    contentW,
    60,
    "Title",
    [heading(contentW - 40, "Residential Lease Agreement", 1, "center")],
    { direction: "column", padding: 20, align: "center" },
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
  );

  function termRow(labelText: string, value: string) {
    return box(
      contentW - 40,
      28,
      "Row",
      [paragraph(280, 20, labelText), paragraph(160, 20, value, "right")],
      { direction: "row", justify: "space-between", align: "center", padding: 0 },
      INVISIBLE,
    );
  }

  const terms = box(
    contentW,
    180,
    "Lease terms",
    [
      termRow("Lease start date", "{{ lease_start_date }}"),
      termRow("Lease end date", "{{ lease_end_date }}"),
      termRow("Monthly rent", "{{ monthly_rent }}"),
      termRow("Security deposit", "{{ security_deposit }}"),
      termRow("Rent due date", "{{ rent_due_date }}"),
    ],
    { direction: "column", gap: 12, padding: 20 },
  );

  const clauses = box(
    contentW,
    110,
    "Additional terms",
    [paragraph(contentW - 40, 90, "{{ additional_terms }}")],
    { direction: "column", padding: 20 },
  );

  const signatures = box(
    contentW,
    90,
    "Signatures",
    [
      box(
        (contentW - 80) / 2,
        50,
        "Landlord",
        [paragraph(280, 40, "Landlord signature: ______________________\nDate: ______________")],
        { direction: "column", padding: 0 },
        INVISIBLE,
      ),
      box(
        (contentW - 80) / 2,
        50,
        "Tenant",
        [paragraph(280, 40, "Tenant signature: ______________________\nDate: ______________")],
        { direction: "column", padding: 0 },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 20, gap: 40 },
  );

  placeStacked(doc, [title, parties, terms, clauses, signatures]);

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
  const pageW = doc.root.w;
  const contentW = pageW - 80;
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
  placeStacked(doc, [header, body]);
  declareVars(doc, [
    ["report_title", "Report title taken from the source document", "text", "Document report"],
    ["report_body", "Full report body transcribed from the source Markdown", "text", "Preview of extracted content from FileWorks."],
  ]);
  return doc;
}

export interface Template {
  id: string;
  label: string;
  description: string;
  build: () => DesignDocument;
}

export const TEMPLATES: Template[] = [
  {
    id: "invoice",
    label: "Client invoice",
    description: "Design the invoice customers receive — bill-to, line items, and total",
    build: invoice,
  },
  {
    id: "receipt",
    label: "Store receipt",
    description: "Narrow till-print layout for itemized purchases and tax",
    build: receipt,
  },
  {
    id: "statement",
    label: "Account statement",
    description: "Bank-style summary with balances and transaction rows",
    build: bankStatement,
  },
  {
    id: "insurance",
    label: "Coverage certificate",
    description: "Proof-of-insurance page: holder, coverage table, and policy period",
    build: insuranceCertificate,
  },
  {
    id: "paystub",
    label: "Payroll stub",
    description: "Employee earnings slip driven entirely by {{ variables }}",
    build: payStub,
  },
  {
    id: "rental",
    label: "Residential lease",
    description: "Apartment lease terms, parties, and signature blocks",
    build: rentalAgreement,
  },
  {
    id: "letter",
    label: "Letterhead letter",
    description: "Formal correspondence with sender, recipient, and body",
    build: businessLetter,
  },
  {
    id: "report",
    label: "Markdown report",
    description: "Page layout for FileWorks-extracted Markdown from the workspace",
    build: documentReport,
  },
];

/** Library-facing alias (name instead of label). */
export const BUILT_IN_TEMPLATES = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.label,
  description: t.description,
  build: t.build,
}));

export function builtInTemplate(id: string) {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id);
}
