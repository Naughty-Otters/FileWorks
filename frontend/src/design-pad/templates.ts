import {
  type DesignDocument,
  type DesignNode,
  type LayoutProps,
  type NodeStyle,
  type VariableType,
  DEFAULT_LAYOUT,
  HEADING_LEVEL_PRESET,
  createEmptyDocument,
  createNode,
  createVariable,
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

/** Declares a template's variables in one shot — used by the templates
 * (pay stub, rental agreement) that lean on `{{ }}` placeholders instead
 * of literal sample copy, so opening them in Preview mode immediately
 * shows something meaningful. */
function declareVars(
  doc: DesignDocument,
  entries: [name: string, label: string, type: VariableType, sampleValue: string][],
) {
  doc.variables = entries.map(([name, label, type, sampleValue]) =>
    createVariable(name, label, type, sampleValue),
  );
}

function invoice(): DesignDocument {
  const doc = createEmptyDocument();
  const pageW = doc.root.w;
  const contentW = pageW - 80;

  const header = box(
    contentW,
    100,
    "Header",
    [
      box(
        340,
        76,
        "Company",
        [heading(320, "Your Company", 2), paragraph(320, 40, "123 Main St, City, ST 00000\nhello@yourcompany.com")],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        260,
        76,
        "Invoice info",
        [heading(240, "INVOICE", 1, "right"), paragraph(240, 40, "Invoice #: 0001\nDate: ____________", "right")],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", align: "start", padding: 24, gap: 24 },
    INVISIBLE,
  );

  const billTo = box(
    contentW,
    100,
    "Bill to",
    [heading(300, "Bill To", 3), paragraph(300, 50, "Client Name\nClient Address\nCity, ST 00000")],
    { direction: "column", gap: 6, padding: 20 },
  );

  function lineRow(desc: string, amount: string) {
    return box(
      contentW - 40,
      32,
      "Row",
      [paragraph(400, 24, desc), paragraph(120, 24, amount, "right")],
      { direction: "row", justify: "space-between", align: "center", padding: 0 },
      INVISIBLE,
    );
  }

  const lineItems = box(
    contentW,
    190,
    "Line items",
    [
      lineRow("Description", "Amount"),
      lineRow("Service or product description", "$0.00"),
      lineRow("Service or product description", "$0.00"),
    ],
    { direction: "column", gap: 12, padding: 20 },
  );

  const total = box(
    contentW,
    70,
    "Total",
    [heading(240, "Total: $0.00", 2, "right")],
    { direction: "row", justify: "end", padding: 20 },
    INVISIBLE,
  );

  placeStacked(doc, [header, billTo, lineItems, total]);
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
      heading(pageW - 64, "Your Store", 2, "center"),
      paragraph(pageW - 64, 40, "123 Main St, City, ST\n(555) 123-4567", "center"),
    ],
    { direction: "column", gap: 4, padding: 16, align: "center" },
    INVISIBLE,
  );

  function lineRow(desc: string, amount: string) {
    return box(
      contentW - 32,
      24,
      "Row",
      [paragraph(160, 20, desc), paragraph(100, 20, amount, "right")],
      { direction: "row", justify: "space-between", align: "center", padding: 0 },
      INVISIBLE,
    );
  }

  const items = box(
    contentW,
    140,
    "Items",
    [lineRow("Item 1", "$0.00"), lineRow("Item 2", "$0.00"), lineRow("Item 3", "$0.00")],
    { direction: "column", gap: 10, padding: 16 },
  );

  const total = box(
    contentW,
    56,
    "Total",
    [heading(120, "Total", 3), heading(120, "$0.00", 3, "right")],
    { direction: "row", justify: "space-between", padding: 16 },
  );

  const footer = box(
    contentW,
    50,
    "Footer",
    [paragraph(pageW - 64, 30, "Thank you for your purchase!", "center")],
    { direction: "column", padding: 16, align: "center" },
    INVISIBLE,
  );

  placeStacked(doc, [header, items, total, footer], 16, 16);
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
      box(340, 42, "Bank", [heading(320, "First National Bank", 2)], { direction: "column", padding: 0 }, INVISIBLE),
      box(
        300,
        76,
        "Statement info",
        [heading(280, "Account Statement", 3, "right"), paragraph(280, 30, "Period: 01/01/2026 – 01/31/2026", "right")],
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
      summaryItem("Account Number", "**** 4821"),
      summaryItem("Opening Balance", "$4,210.55"),
      summaryItem("Closing Balance", "$5,032.10"),
    ],
    { direction: "row", justify: "space-between", padding: 20, gap: 10 },
  );

  function txRow(date: string, desc: string, amount: string) {
    return box(
      contentW - 40,
      28,
      "Row",
      [paragraph(80, 20, date), paragraph(260, 20, desc), paragraph(100, 20, amount, "right")],
      { direction: "row", justify: "space-between", align: "center", padding: 0 },
      INVISIBLE,
    );
  }

  const transactions = box(
    contentW,
    260,
    "Transactions",
    [
      txRow("Date", "Description", "Amount"),
      txRow("01/03", "Grocery Store", "-$86.20"),
      txRow("01/07", "Payroll Deposit", "+$2,400.00"),
      txRow("01/15", "Electric Utility", "-$120.44"),
      txRow("01/22", "Online Transfer", "-$300.00"),
    ],
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
    100,
    "Policy holder",
    [heading(300, "Policy Holder", 3), paragraph(300, 50, "Jane Doe\n123 Main St, City, ST 00000\nPolicy #: INS-000123")],
    { direction: "column", gap: 6, padding: 20 },
  );

  function coverageRow(type: string, limit: string) {
    return box(
      contentW - 40,
      28,
      "Row",
      [paragraph(280, 20, type), paragraph(160, 20, limit, "right")],
      { direction: "row", justify: "space-between", align: "center", padding: 0 },
      INVISIBLE,
    );
  }

  const coverage = box(
    contentW,
    220,
    "Coverage",
    [
      coverageRow("Coverage Type", "Limit"),
      coverageRow("General Liability", "$1,000,000"),
      coverageRow("Property Damage", "$500,000"),
      coverageRow("Personal Injury", "$250,000"),
    ],
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
        [paragraph(240, 18, "Effective Date"), heading(240, "01/01/2026", 3)],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        260,
        42,
        "Expiration",
        [paragraph(240, 18, "Expiration Date", "right"), heading(240, "01/01/2027", 3, "right")],
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
    [paragraph(contentW - 40, 40, "Insurer: Acme Mutual Insurance Co.\nAuthorized Signature: ______________________")],
    { direction: "column", padding: 20 },
    INVISIBLE,
  );

  placeStacked(doc, [header, policyHolder, coverage, period, footer]);
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
    [paragraph(contentW, 60, "Your Name\nYour Company\n123 Main St, City, ST 00000")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const date = box(
    contentW,
    24,
    "Date",
    [paragraph(200, 20, "January 1, 2026")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const recipient = box(
    contentW,
    70,
    "Recipient",
    [paragraph(contentW, 60, "Recipient Name\nRecipient Company\n456 Market St, City, ST 00000")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const salutation = box(
    contentW,
    24,
    "Salutation",
    [paragraph(300, 20, "Dear Recipient Name,")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const body = box(
    contentW,
    160,
    "Body",
    [
      paragraph(
        contentW,
        150,
        "I am writing to introduce our services and explore an opportunity to work together. Double-click this paragraph to write your own message — cover the purpose of your letter in the first sentence, then add supporting details in the sentences that follow.",
      ),
    ],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  const closing = box(
    contentW,
    70,
    "Closing",
    [paragraph(contentW, 60, "Sincerely,\n\nYour Name")],
    { direction: "column", padding: 0 },
    INVISIBLE,
  );

  placeStacked(doc, [sender, date, recipient, salutation, body, closing], 60, 80);
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
        [heading(320, "{{ company_name }}", 2), paragraph(320, 30, "{{ company_address }}")],
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
    ["company_name", "Company name", "text", "Acme Corporation"],
    ["company_address", "Company address", "text", "123 Main St, City, ST 00000"],
    ["pay_date", "Pay date", "date", "02/15/2026"],
    ["employee_name", "Employee name", "text", "Jane Doe"],
    ["employee_id", "Employee ID", "text", "EMP-00214"],
    ["pay_period_start", "Pay period start", "date", "02/01/2026"],
    ["pay_period_end", "Pay period end", "date", "02/15/2026"],
    ["filing_status", "Filing status", "text", "Single"],
    ["regular_hours", "Regular hours", "number", "80"],
    ["hourly_rate", "Hourly rate", "currency", "$32.00"],
    ["overtime_pay", "Overtime pay", "currency", "$0.00"],
    ["gross_pay", "Gross pay", "currency", "$2,560.00"],
    ["federal_tax", "Federal tax", "currency", "$384.00"],
    ["state_tax", "State tax", "currency", "$128.00"],
    ["insurance_deduction", "Insurance deduction", "currency", "$60.00"],
    ["retirement_deduction", "Retirement (401k)", "currency", "$102.40"],
    ["total_deductions", "Total deductions", "currency", "$674.40"],
    ["net_pay", "Net pay", "currency", "$1,885.60"],
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
    [
      paragraph(
        contentW - 40,
        90,
        "Tenant agrees to pay rent in full on or before the due date each month, keep the property in good condition, and comply with all applicable building and safety codes. Late payments may incur a fee as permitted by local law.",
      ),
    ],
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
    ["agreement_date", "Agreement date", "date", "01/01/2026"],
    ["landlord_name", "Landlord name", "text", "Acme Properties LLC"],
    ["tenant_name", "Tenant name", "text", "John Smith"],
    ["property_address", "Property address", "text", "456 Oak Avenue, Apt 3B, Springfield, ST 00000"],
    ["lease_start_date", "Lease start date", "date", "02/01/2026"],
    ["lease_end_date", "Lease end date", "date", "01/31/2027"],
    ["monthly_rent", "Monthly rent", "currency", "$1,650.00"],
    ["security_deposit", "Security deposit", "currency", "$1,650.00"],
    ["rent_due_date", "Rent due date", "text", "1st of each month"],
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
    [paragraph(contentW - 40, 700, "{{ markdown }}")],
    { direction: "column", gap: 8, padding: 20 },
  );
  placeStacked(doc, [header, body]);
  declareVars(doc, [
    ["report_title", "Report title", "text", "Document report"],
    ["markdown", "Extracted Markdown", "text", "Preview of extracted content from FileWorks."],
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
