import { type DesignDocument, createEmptyDocument } from "./types";
import type { Template } from "./templates-meta";
import {
  CARD,
  INVISIBLE,
  LABEL_STYLE,
  VALUE_STYLE,
  assemblePage,
  box,
  declareVars,
  heading,
  infoRow,
  paragraph,
  sectionTitle,
  threeColRow,
  twoColRow,
} from "./templates-helpers";

function partyHeader(contentW: number, title: string, leftMeta: string, rightMeta: string) {
  return box(
    contentW,
    72,
    "Header",
    [
      heading(Math.floor(contentW * 0.62), title, 1),
      paragraph(Math.floor(contentW * 0.35), 48, `${leftMeta}\n${rightMeta}`, "right", LABEL_STYLE),
    ],
    { direction: "row", justify: "space-between", align: "start", padding: 0, gap: 16 },
    INVISIBLE,
  );
}

function signatureBlock(contentW: number, leftLabel: string, rightLabel: string) {
  const half = Math.floor((contentW - 24) / 2);
  return box(
    contentW,
    100,
    "Signatures",
    [
      box(
        half,
        88,
        "Left sign",
        [
          paragraph(half - 8, 28, leftLabel, "left", LABEL_STYLE),
          paragraph(half - 8, 28, "Signature: _______________________"),
          paragraph(half - 8, 24, "Date: ______________", "left", LABEL_STYLE),
        ],
        { direction: "column", gap: 6, padding: 0 },
        INVISIBLE,
      ),
      box(
        half,
        88,
        "Right sign",
        [
          paragraph(half - 8, 28, rightLabel, "left", LABEL_STYLE),
          paragraph(half - 8, 28, "Signature: _______________________"),
          paragraph(half - 8, 24, "Date: ______________", "left", LABEL_STYLE),
        ],
        { direction: "column", gap: 6, padding: 0 },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 0, gap: 24 },
    INVISIBLE,
  );
}

function cardSection(contentW: number, title: string, body: string, minH = 90) {
  const inner = contentW - 40;
  return box(
    contentW,
    minH,
    title,
    [sectionTitle(inner, title), paragraph(inner, Math.max(40, minH - 50), body)],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );
}

// —— Agreements ————————————————————————————————————————————————

function nda(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(
    contentW,
    "NON-DISCLOSURE AGREEMENT",
    "Effective: {{ effective_date }}",
    "Ref: {{ agreement_ref }}",
  );
  const parties = box(
    contentW,
    110,
    "Parties",
    [
      sectionTitle(inner, "Parties"),
      paragraph(
        inner,
        70,
        "Disclosing party: {{ disclosing_party }}\nReceiving party: {{ receiving_party }}\nPurpose: {{ purpose }}",
      ),
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const itemRow = twoColRow(inner, "{{ item.topic }}", "{{ item.obligation }}", "Obligation", 0.4);
  itemRow.repeat = { over: "nda_obligations", as: "item" };
  const obligations = box(
    contentW,
    160,
    "Obligations",
    [
      sectionTitle(inner, "Confidentiality obligations"),
      twoColRow(inner, "Topic", "Obligation", "hdr", 0.4, true),
      itemRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const terms = cardSection(
    contentW,
    "Term & exclusions",
    "This agreement remains in force for {{ term_years }} years from the effective date. Exclusions: {{ exclusions }}. Governing law: {{ governing_law }}.",
    120,
  );

  assemblePage(doc, [header, parties, obligations, terms, signatureBlock(contentW, "{{ disclosing_party }}", "{{ receiving_party }}")], {
    padding: pad,
    gap: 18,
  });
  declareVars(doc, [
    ["effective_date", "Date the NDA becomes effective", "date", "March 15, 2026"],
    ["agreement_ref", "Internal reference number for the NDA", "text", "NDA-2026-041"],
    ["disclosing_party", "Party disclosing confidential information", "text", "Acme Studio LLC"],
    ["receiving_party", "Party receiving confidential information", "text", "Northwind Trading Inc."],
    ["purpose", "Business purpose for sharing confidential information", "text", "Evaluating a potential partnership"],
    [
      "nda_obligations",
      "List of confidentiality topics and matching obligations for the receiving party",
      "list",
      JSON.stringify([
        { topic: "Product roadmap", obligation: "Use only for evaluation; no third-party disclosure" },
        { topic: "Customer data", obligation: "Store encrypted; delete on request" },
        { topic: "Pricing", obligation: "Keep confidential for the term of this agreement" },
      ]),
      [
        ["topic", "Confidential topic or asset class", "text"],
        ["obligation", "Required handling obligation", "text"],
      ],
    ],
    ["term_years", "How many years the NDA remains in force", "number", "3"],
    ["exclusions", "Information excluded from confidentiality", "text", "Public information, independently developed materials"],
    ["governing_law", "Governing law and venue for the NDA", "text", "State of Delaware"],
  ]);
  return doc;
}

function serviceAgreement(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "SERVICE AGREEMENT", "Effective: {{ effective_date }}", "{{ agreement_ref }}");
  const parties = cardSection(
    contentW,
    "Parties & scope",
    "Provider: {{ provider_name }}\nClient: {{ client_name }}\nServices: {{ service_scope }}",
    120,
  );

  const deliverableRow = threeColRow(inner, "{{ item.name }}", "{{ item.due }}", "{{ item.fee }}");
  deliverableRow.repeat = { over: "service_agreement_deliverables", as: "item" };
  const deliverables = box(
    contentW,
    160,
    "Deliverables",
    [
      sectionTitle(inner, "Deliverables & fees"),
      threeColRow(inner, "Deliverable", "Due", "Fee", [0.45, 0.3, 0.25], true),
      deliverableRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const payment = box(
    contentW,
    100,
    "Payment",
    [
      sectionTitle(inner, "Payment terms"),
      infoRow(inner, "Total fees", "{{ total_fees }}"),
      infoRow(inner, "Payment schedule", "{{ payment_schedule }}"),
      infoRow(inner, "Invoice terms", "{{ invoice_terms }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  assemblePage(
    doc,
    [header, parties, deliverables, payment, signatureBlock(contentW, "{{ provider_name }}", "{{ client_name }}")],
    { padding: pad, gap: 18 },
  );
  declareVars(doc, [
    ["effective_date", "Service agreement start date", "date", "April 1, 2026"],
    ["agreement_ref", "Service agreement reference number", "text", "SA-7781"],
    ["provider_name", "Service provider legal name", "text", "Acme Studio LLC"],
    ["client_name", "Client legal name", "text", "Northwind Trading Inc."],
    ["service_scope", "Summary of services to be performed", "text", "Brand identity, website design, and launch support"],
    [
      "service_agreement_deliverables",
      "Deliverables with due dates and fees under the service agreement",
      "list",
      JSON.stringify([
        { name: "Brand guidelines", due: "Apr 30, 2026", fee: "$4,500" },
        { name: "Website design", due: "May 31, 2026", fee: "$8,200" },
        { name: "Launch support", due: "Jun 15, 2026", fee: "$1,800" },
      ]),
      [
        ["name", "Deliverable name", "text"],
        ["due", "Deliverable due date", "date"],
        ["fee", "Fee for this deliverable", "currency"],
      ],
    ],
    ["total_fees", "Total fees under the agreement", "currency", "$14,500"],
    ["payment_schedule", "When invoices are issued", "text", "50% on signing, 50% on delivery"],
    ["invoice_terms", "Net payment terms for invoices", "text", "Net 15"],
  ]);
  return doc;
}

function employmentAgreement(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "EMPLOYMENT AGREEMENT", "Start: {{ start_date }}", "{{ agreement_ref }}");
  const role = box(
    contentW,
    140,
    "Role",
    [
      sectionTitle(inner, "Position"),
      infoRow(inner, "Employee", "{{ employee_name }}"),
      infoRow(inner, "Title", "{{ job_title }}"),
      infoRow(inner, "Department", "{{ department }}"),
      infoRow(inner, "Reports to", "{{ manager_name }}"),
      infoRow(inner, "Location", "{{ work_location }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );
  const comp = box(
    contentW,
    120,
    "Compensation",
    [
      sectionTitle(inner, "Compensation & schedule"),
      infoRow(inner, "Base salary", "{{ base_salary }}"),
      infoRow(inner, "Pay frequency", "{{ pay_frequency }}"),
      infoRow(inner, "Equity / bonus", "{{ equity_bonus }}"),
      infoRow(inner, "Work schedule", "{{ work_schedule }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );
  const terms = cardSection(
    contentW,
    "Key terms",
    "Employment type: {{ employment_type }}. Benefits: {{ benefits_summary }}. Confidentiality and IP assignment apply as of the start date. At-will status: {{ at_will_note }}.",
    120,
  );

  assemblePage(
    doc,
    [header, role, comp, terms, signatureBlock(contentW, "Employer", "{{ employee_name }}")],
    { padding: pad, gap: 18 },
  );
  declareVars(doc, [
    ["start_date", "Employee start date", "date", "May 4, 2026"],
    ["agreement_ref", "Employment agreement reference", "text", "EA-4420"],
    ["employee_name", "Full legal name of the employee", "text", "Jordan Lee"],
    ["job_title", "Job title for the role", "text", "Senior Product Designer"],
    ["department", "Department or team name", "text", "Product"],
    ["manager_name", "Hiring manager or supervisor name", "text", "Alex Rivera"],
    ["work_location", "Primary work location or remote status", "text", "San Francisco / Hybrid"],
    ["base_salary", "Annual or period base salary", "currency", "$145,000 / year"],
    ["pay_frequency", "How often payroll runs", "text", "Bi-weekly"],
    ["equity_bonus", "Equity grant or bonus summary", "text", "0.15% options; target bonus 10%"],
    ["work_schedule", "Expected work hours or FTE", "text", "Full-time, 40 hours / week"],
    ["employment_type", "Full-time, part-time, or contractor classification note", "text", "Full-time exempt"],
    ["benefits_summary", "Summary of benefits eligibility", "text", "Medical, dental, vision, 401(k) match"],
    ["at_will_note", "At-will employment statement", "text", "Employment is at-will and may end by either party"],
  ]);
  return doc;
}

function boardResolution(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "BOARD RESOLUTION", "{{ company_name }}", "Date: {{ resolution_date }}");
  const body = cardSection(
    contentW,
    "Resolution",
    "Resolved, that the Board of Directors of {{ company_name }} hereby {{ resolution_action }}.\n\nBackground: {{ background }}",
    140,
  );

  const voteRow = threeColRow(inner, "{{ item.director }}", "{{ item.role }}", "{{ item.vote }}");
  voteRow.repeat = { over: "board_resolution_votes", as: "item" };
  const votes = box(
    contentW,
    150,
    "Votes",
    [
      sectionTitle(inner, "Directors voting"),
      threeColRow(inner, "Director", "Role", "Vote", [0.45, 0.3, 0.25], true),
      voteRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const certify = cardSection(
    contentW,
    "Certification",
    "Certified by {{ secretary_name }}, Corporate Secretary. Quorum present: {{ quorum_note }}. Resolution number: {{ resolution_number }}.",
    100,
  );

  assemblePage(doc, [header, body, votes, certify], { padding: pad, gap: 18 });
  declareVars(doc, [
    ["company_name", "Legal company name for the resolution", "text", "Acme Studio LLC"],
    ["resolution_date", "Date the board adopted the resolution", "date", "March 20, 2026"],
    ["resolution_action", "Action the board resolves to take", "text", "authorizes opening a corporate operating account at First National Bank"],
    ["background", "Brief background for the resolution", "text", "Treasury requested a dedicated operating account for customer receipts."],
    [
      "board_resolution_votes",
      "Board directors with role and vote on the resolution",
      "list",
      JSON.stringify([
        { director: "Sam Chen", role: "Chair", vote: "Aye" },
        { director: "Priya Nair", role: "Director", vote: "Aye" },
        { director: "Morgan Blake", role: "Director", vote: "Aye" },
      ]),
      [
        ["director", "Director full name", "text"],
        ["role", "Board role or title", "text"],
        ["vote", "Vote cast (Aye / Nay / Abstain)", "text"],
      ],
    ],
    ["secretary_name", "Name of the corporate secretary certifying", "text", "Riley Ortiz"],
    ["quorum_note", "Whether a quorum was present", "text", "Yes — 3 of 3 directors"],
    ["resolution_number", "Board resolution number", "text", "BR-2026-09"],
  ]);
  return doc;
}

// —— Plans ————————————————————————————————————————————————————

function businessPlan(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    80,
    "Header",
    [
      heading(contentW, "{{ company_name }}", 1),
      paragraph(contentW, 28, "Business plan · {{ plan_horizon }} · {{ prepared_date }}", "left", LABEL_STYLE),
    ],
    { direction: "column", gap: 6, padding: 0 },
    INVISIBLE,
  );

  const summary = cardSection(contentW, "Executive summary", "{{ executive_summary }}", 120);
  const market = cardSection(contentW, "Market & customers", "{{ market_summary }}", 100);
  const offer = cardSection(contentW, "Offer & differentiation", "{{ offer_summary }}", 100);

  const mileRow = threeColRow(inner, "{{ item.milestone }}", "{{ item.owner }}", "{{ item.date }}");
  mileRow.repeat = { over: "business_plan_milestones", as: "item" };
  const milestones = box(
    contentW,
    150,
    "Milestones",
    [
      sectionTitle(inner, "Near-term milestones"),
      threeColRow(inner, "Milestone", "Owner", "Target", [0.45, 0.3, 0.25], true),
      mileRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const finance = box(
    contentW,
    110,
    "Finance",
    [
      sectionTitle(inner, "Financial snapshot"),
      infoRow(inner, "Year-1 revenue target", "{{ revenue_target }}"),
      infoRow(inner, "Gross margin target", "{{ margin_target }}"),
      infoRow(inner, "Funding need", "{{ funding_need }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  assemblePage(doc, [header, summary, market, offer, milestones, finance], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Company name on the business plan", "text", "Acme Studio"],
    ["plan_horizon", "Planning horizon covered by the plan", "text", "2026–2027"],
    ["prepared_date", "Date the plan was prepared", "date", "March 1, 2026"],
    ["executive_summary", "One-paragraph executive summary", "text", "Acme Studio helps teams turn documents into structured outputs with AI-assisted conversion and fillable designs."],
    ["market_summary", "Target market and customer summary", "text", "SMB operations and professional services teams that convert PDFs and Office files weekly."],
    ["offer_summary", "Product or service differentiation summary", "text", "Browser workspace + API, with design templates that bind extracted Markdown to branded layouts."],
    [
      "business_plan_milestones",
      "Business plan milestones with owners and target dates",
      "list",
      JSON.stringify([
        { milestone: "Launch starter library", owner: "Product", date: "Q2 2026" },
        { milestone: "Expand API customers", owner: "Sales", date: "Q3 2026" },
        { milestone: "Break-even contribution", owner: "Finance", date: "Q4 2026" },
      ]),
      [
        ["milestone", "Milestone name", "text"],
        ["owner", "Owner team or person", "text"],
        ["date", "Target date or quarter", "text"],
      ],
    ],
    ["revenue_target", "Year-one revenue target", "currency", "$1.2M"],
    ["margin_target", "Target gross margin percentage", "text", "72%"],
    ["funding_need", "Funding required if any", "currency", "$250,000 seed extension"],
  ]);
  return doc;
}

function marketingPlan(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "MARKETING PLAN", "{{ company_name }}", "{{ plan_period }}");
  const goals = cardSection(contentW, "Goals", "{{ marketing_goals }}", 90);
  const audience = cardSection(contentW, "Audience", "{{ audience_summary }}", 90);

  const channelRow = threeColRow(inner, "{{ item.channel }}", "{{ item.tactic }}", "{{ item.budget }}");
  channelRow.repeat = { over: "marketing_plan_channels", as: "item" };
  const channels = box(
    contentW,
    160,
    "Channels",
    [
      sectionTitle(inner, "Channels & budget"),
      threeColRow(inner, "Channel", "Primary tactic", "Budget", [0.28, 0.47, 0.25], true),
      channelRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const kpi = box(
    contentW,
    100,
    "KPIs",
    [
      sectionTitle(inner, "Success metrics"),
      infoRow(inner, "Primary KPI", "{{ primary_kpi }}"),
      infoRow(inner, "Secondary KPI", "{{ secondary_kpi }}"),
      infoRow(inner, "Review cadence", "{{ review_cadence }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  assemblePage(doc, [header, goals, audience, channels, kpi], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Company name on the marketing plan", "text", "Acme Studio"],
    ["plan_period", "Marketing plan period", "text", "Q2 2026"],
    ["marketing_goals", "Top marketing goals for the period", "text", "Grow qualified signups 30% and improve activation to first conversion."],
    ["audience_summary", "Target audience description", "text", "Ops leads at 20–200 person companies who convert documents weekly."],
    [
      "marketing_plan_channels",
      "Marketing channels with tactics and budget amounts",
      "list",
      JSON.stringify([
        { channel: "Content", tactic: "SEO guides + comparison pages", budget: "$6,000" },
        { channel: "Paid", tactic: "Search ads on converter keywords", budget: "$8,500" },
        { channel: "Lifecycle", tactic: "Onboarding email sequence", budget: "$2,000" },
      ]),
      [
        ["channel", "Marketing channel name", "text"],
        ["tactic", "Primary tactic for the channel", "text"],
        ["budget", "Budget allocated to the channel", "currency"],
      ],
    ],
    ["primary_kpi", "Primary success metric", "text", "Qualified signups / week"],
    ["secondary_kpi", "Secondary success metric", "text", "Activation rate to first conversion"],
    ["review_cadence", "How often results are reviewed", "text", "Weekly growth review"],
  ]);
  return doc;
}

function cashFlowForecast(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "CASH FLOW FORECAST", "{{ company_name }}", "{{ forecast_period }}");
  const summary = box(
    contentW,
    100,
    "Summary",
    [
      sectionTitle(inner, "Opening position"),
      infoRow(inner, "Opening cash", "{{ opening_cash }}"),
      infoRow(inner, "Projected closing cash", "{{ closing_cash }}"),
      infoRow(inner, "Net change", "{{ net_change }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const row = threeColRow(inner, "{{ item.month }}", "{{ item.inflows }}", "{{ item.outflows }}");
  row.repeat = { over: "cash_flow_forecast_months", as: "item" };
  const months = box(
    contentW,
    180,
    "Months",
    [
      sectionTitle(inner, "Monthly cash movement"),
      threeColRow(inner, "Month", "Inflows", "Outflows", [0.34, 0.33, 0.33], true),
      row,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const notes = cardSection(contentW, "Assumptions", "{{ assumptions }}", 90);

  assemblePage(doc, [header, summary, months, notes], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Company name on the cash flow forecast", "text", "Acme Studio"],
    ["forecast_period", "Forecast period covered", "text", "Apr–Sep 2026"],
    ["opening_cash", "Cash balance at the start of the forecast", "currency", "$84,200"],
    ["closing_cash", "Projected cash at the end of the forecast", "currency", "$112,400"],
    ["net_change", "Net cash change over the forecast", "currency", "+$28,200"],
    [
      "cash_flow_forecast_months",
      "Monthly cash inflows and outflows for the forecast",
      "list",
      JSON.stringify([
        { month: "April", inflows: "$42,000", outflows: "$31,500" },
        { month: "May", inflows: "$45,500", outflows: "$33,200" },
        { month: "June", inflows: "$48,000", outflows: "$34,800" },
        { month: "July", inflows: "$46,200", outflows: "$35,100" },
      ]),
      [
        ["month", "Month name", "text"],
        ["inflows", "Cash inflows for the month", "currency"],
        ["outflows", "Cash outflows for the month", "currency"],
      ],
    ],
    ["assumptions", "Key forecast assumptions", "text", "Collections at 35 days; payroll stable; no new debt draws."],
  ]);
  return doc;
}

// —— Policies ——————————————————————————————————————————————————

function leavePolicy(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "LEAVE & ABSENCE POLICY", "{{ company_name }}", "Effective {{ effective_date }}");
  const purpose = cardSection(contentW, "Purpose", "{{ policy_purpose }}", 90);

  const typeRow = threeColRow(inner, "{{ item.leave_type }}", "{{ item.accrual }}", "{{ item.approval }}");
  typeRow.repeat = { over: "leave_policy_types", as: "item" };
  const types = box(
    contentW,
    160,
    "Types",
    [
      sectionTitle(inner, "Leave types"),
      threeColRow(inner, "Type", "Accrual / allotment", "Approval", [0.28, 0.42, 0.3], true),
      typeRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const process = cardSection(
    contentW,
    "Request process",
    "{{ request_process }}\n\nContact: {{ hr_contact }}",
    120,
  );

  assemblePage(doc, [header, purpose, types, process], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Company issuing the leave policy", "text", "Acme Studio"],
    ["effective_date", "Policy effective date", "date", "January 1, 2026"],
    ["policy_purpose", "Purpose statement for the leave policy", "text", "This policy explains paid and unpaid leave so employees can plan time away and managers can schedule coverage."],
    [
      "leave_policy_types",
      "Leave types with accrual rules and approval requirements",
      "list",
      JSON.stringify([
        { leave_type: "PTO", accrual: "20 days / year", approval: "Manager, 5 days notice" },
        { leave_type: "Sick", accrual: "10 days / year", approval: "Manager (same day OK)" },
        { leave_type: "Parental", accrual: "12 weeks", approval: "HR + manager" },
      ]),
      [
        ["leave_type", "Name of the leave type", "text"],
        ["accrual", "Accrual or allotment rule", "text"],
        ["approval", "Who must approve the leave", "text"],
      ],
    ],
    ["request_process", "How employees request leave", "text", "Submit a leave request in HRIS. Managers respond within 2 business days. Extended leave requires HR coordination."],
    ["hr_contact", "HR contact for leave questions", "text", "people@acme.example"],
  ]);
  return doc;
}

function remoteWorkPolicy(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "REMOTE WORK POLICY", "{{ company_name }}", "Effective {{ effective_date }}");
  const eligibility = cardSection(contentW, "Eligibility", "{{ eligibility }}", 90);
  const expectations = cardSection(contentW, "Expectations", "{{ expectations }}", 110);

  const equipRow = twoColRow(inner, "{{ item.item }}", "{{ item.provided_by }}", "Equip", 0.55);
  equipRow.repeat = { over: "remote_work_policy_equipment", as: "item" };
  const equipment = box(
    contentW,
    140,
    "Equipment",
    [
      sectionTitle(inner, "Equipment & security"),
      twoColRow(inner, "Item", "Provided by", "hdr", 0.55, true),
      equipRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const contact = cardSection(contentW, "Support", "Questions: {{ policy_owner }}. Security incidents: {{ security_contact }}.", 90);

  assemblePage(doc, [header, eligibility, expectations, equipment, contact], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Company issuing the remote work policy", "text", "Acme Studio"],
    ["effective_date", "Remote work policy effective date", "date", "February 1, 2026"],
    ["eligibility", "Who is eligible for remote or hybrid work", "text", "Full-time employees in roles marked Hybrid or Remote after 90 days of employment, with manager approval."],
    ["expectations", "Core remote work expectations", "text", "Core hours 10:00–15:00 local. Respond to Slack within 2 hours during core hours. Use VPN on public networks. Attend all-hands in person quarterly if local."],
    [
      "remote_work_policy_equipment",
      "Equipment items and who provides them for remote work",
      "list",
      JSON.stringify([
        { item: "Laptop", provided_by: "Company" },
        { item: "Monitor stipend", provided_by: "Company (up to $300)" },
        { item: "Home internet", provided_by: "Employee" },
      ]),
      [
        ["item", "Equipment or expense item", "text"],
        ["provided_by", "Who provides or pays for the item", "text"],
      ],
    ],
    ["policy_owner", "Owner of the remote work policy", "text", "People Ops — people@acme.example"],
    ["security_contact", "Security contact for incidents", "text", "security@acme.example"],
  ]);
  return doc;
}

// —— Forms —————————————————————————————————————————————————————

function purchaseOrder(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = box(
    contentW,
    80,
    "Header",
    [
      box(
        Math.floor(contentW * 0.55),
        70,
        "Buyer",
        [
          heading(Math.floor(contentW * 0.55) - 8, "{{ buyer_name }}", 2),
          paragraph(Math.floor(contentW * 0.55) - 8, 36, "{{ buyer_address }}"),
        ],
        { direction: "column", gap: 4, padding: 0 },
        INVISIBLE,
      ),
      box(
        Math.floor(contentW * 0.38),
        70,
        "PO meta",
        [
          heading(Math.floor(contentW * 0.38) - 8, "PURCHASE ORDER", 1, "right"),
          paragraph(
            Math.floor(contentW * 0.38) - 8,
            40,
            "PO #: {{ po_number }}\nDate: {{ po_date }}",
            "right",
          ),
        ],
        { direction: "column", gap: 4, padding: 0, align: "end" },
        INVISIBLE,
      ),
    ],
    { direction: "row", justify: "space-between", padding: 0, gap: 20 },
    INVISIBLE,
  );

  const vendor = cardSection(
    contentW,
    "Vendor",
    "{{ vendor_name }}\n{{ vendor_address }}\n{{ vendor_email }}",
    100,
  );

  const line = threeColRow(inner, "{{ item.description }}", "{{ item.qty }}", "{{ item.amount }}", [0.55, 0.15, 0.3]);
  line.repeat = { over: "purchase_order_lines", as: "item" };
  const lines = box(
    contentW,
    160,
    "Lines",
    [
      sectionTitle(inner, "Order lines"),
      threeColRow(inner, "Description", "Qty", "Amount", [0.55, 0.15, 0.3], true),
      line,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const totals = box(
    contentW,
    56,
    "Total",
    [heading(200, "Order total", 3), heading(160, "{{ order_total }}", 3, "right")],
    { direction: "row", justify: "space-between", align: "center", padding: 18 },
    CARD,
  );

  const ship = cardSection(
    contentW,
    "Ship / deliver to",
    "{{ ship_to }}\nNeeded by: {{ need_by_date }}\nNotes: {{ po_notes }}",
    110,
  );

  assemblePage(doc, [header, vendor, lines, totals, ship], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["buyer_name", "Buying company name on the purchase order", "text", "Acme Studio"],
    ["buyer_address", "Buying company address", "text", "123 Market St, City, ST 00000"],
    ["po_number", "Purchase order number", "text", "PO-5521"],
    ["po_date", "Purchase order date", "date", "March 18, 2026"],
    ["vendor_name", "Vendor company name", "text", "Bright Supply Co."],
    ["vendor_address", "Vendor mailing address", "text", "88 Industrial Ave, City, ST 00000"],
    ["vendor_email", "Vendor order email", "text", "orders@bright.example"],
    [
      "purchase_order_lines",
      "Purchase order line items with quantity and amount",
      "list",
      JSON.stringify([
        { description: "Laptop docks", qty: "12", amount: "$2,400.00" },
        { description: "USB-C hubs", qty: "24", amount: "$960.00" },
        { description: "Shipping", qty: "1", amount: "$85.00" },
      ]),
      [
        ["description", "Line item description", "text"],
        ["qty", "Quantity ordered", "number"],
        ["amount", "Extended amount for the line", "currency"],
      ],
    ],
    ["order_total", "Purchase order grand total", "currency", "$3,445.00"],
    ["ship_to", "Ship-to or deliver-to address", "text", "Acme Studio — Receiving, Dock B"],
    ["need_by_date", "Date goods or services are needed", "date", "April 2, 2026"],
    ["po_notes", "Additional purchase order notes", "text", "Reference ticket OPS-214 on packing slip."],
  ]);
  return doc;
}

function jobDescription(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "{{ job_title }}", "{{ company_name }}", "{{ location }} · {{ employment_type }}");
  const about = cardSection(contentW, "About the role", "{{ role_summary }}", 100);
  const respRow = twoColRow(inner, "{{ item.area }}", "{{ item.detail }}", "Resp", 0.32);
  respRow.repeat = { over: "job_description_responsibilities", as: "item" };
  const resp = box(
    contentW,
    160,
    "Responsibilities",
    [
      sectionTitle(inner, "Responsibilities"),
      twoColRow(inner, "Area", "Detail", "hdr", 0.32, true),
      respRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );
  const reqs = cardSection(contentW, "Requirements", "{{ requirements }}", 110);
  const offer = cardSection(contentW, "What we offer", "{{ offer_summary }}", 90);

  assemblePage(doc, [header, about, resp, reqs, offer], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["job_title", "Job title for the description", "text", "Senior Product Designer"],
    ["company_name", "Hiring company name", "text", "Acme Studio"],
    ["location", "Job location or remote label", "text", "San Francisco / Hybrid"],
    ["employment_type", "Full-time, contract, etc.", "text", "Full-time"],
    ["role_summary", "Short summary of the role", "text", "Own end-to-end product design for conversion workflows and template studio experiences."],
    [
      "job_description_responsibilities",
      "Responsibility areas and details for the job description",
      "list",
      JSON.stringify([
        { area: "Product", detail: "Design flows from upload through produce and export" },
        { area: "Systems", detail: "Maintain design system and template layout patterns" },
        { area: "Collaboration", detail: "Partner with eng and GTM on experiments" },
      ]),
      [
        ["area", "Responsibility area label", "text"],
        ["detail", "Responsibility detail", "text"],
      ],
    ],
    ["requirements", "Must-have requirements for candidates", "text", "5+ years product design; strong systems thinking; portfolio with complex B2B tools; comfort with AI-assisted workflows."],
    ["offer_summary", "Compensation and benefits summary", "text", "Competitive salary + equity, health benefits, learning stipend, flexible PTO."],
  ]);
  return doc;
}

// —— Checklists ————————————————————————————————————————————————

function newHireChecklist(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "NEW HIRE CHECKLIST", "{{ employee_name }}", "Start {{ start_date }}");
  const meta = box(
    contentW,
    90,
    "Meta",
    [
      infoRow(inner, "Role", "{{ job_title }}"),
      infoRow(inner, "Manager", "{{ manager_name }}"),
      infoRow(inner, "Buddy", "{{ buddy_name }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const taskRow = threeColRow(inner, "{{ item.task }}", "{{ item.owner }}", "{{ item.due }}");
  taskRow.repeat = { over: "new_hire_checklist_tasks", as: "item" };
  const tasks = box(
    contentW,
    200,
    "Tasks",
    [
      sectionTitle(inner, "Onboarding tasks"),
      threeColRow(inner, "Task", "Owner", "Due", [0.5, 0.25, 0.25], true),
      taskRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const notes = cardSection(contentW, "Notes", "{{ onboarding_notes }}", 80);

  assemblePage(doc, [header, meta, tasks, notes], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["employee_name", "New hire full name", "text", "Jordan Lee"],
    ["start_date", "New hire start date", "date", "May 4, 2026"],
    ["job_title", "New hire job title", "text", "Senior Product Designer"],
    ["manager_name", "Hiring manager name", "text", "Alex Rivera"],
    ["buddy_name", "Onboarding buddy name", "text", "Sam Chen"],
    [
      "new_hire_checklist_tasks",
      "New hire onboarding tasks with owners and due dates",
      "list",
      JSON.stringify([
        { task: "Provision laptop + accounts", owner: "IT", due: "Day 0" },
        { task: "Benefits enrollment", owner: "HR", due: "Day 3" },
        { task: "Product overview session", owner: "Manager", due: "Week 1" },
        { task: "First design critique", owner: "Buddy", due: "Week 2" },
      ]),
      [
        ["task", "Onboarding task name", "text"],
        ["owner", "Task owner", "text"],
        ["due", "Due timing or date", "text"],
      ],
    ],
    ["onboarding_notes", "Extra notes for the new hire checklist", "text", "Schedule lunch with the design team in week one."],
  ]);
  return doc;
}

function projectLaunchChecklist(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "PROJECT LAUNCH CHECKLIST", "{{ project_name }}", "Launch {{ launch_date }}");
  const meta = box(
    contentW,
    80,
    "Meta",
    [infoRow(inner, "Owner", "{{ project_owner }}"), infoRow(inner, "Status", "{{ launch_status }}")],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const itemRow = threeColRow(inner, "{{ item.item }}", "{{ item.owner }}", "{{ item.status }}");
  itemRow.repeat = { over: "project_launch_checklist_items", as: "item" };
  const items = box(
    contentW,
    200,
    "Items",
    [
      sectionTitle(inner, "Launch readiness"),
      threeColRow(inner, "Item", "Owner", "Status", [0.5, 0.25, 0.25], true),
      itemRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const go = cardSection(contentW, "Go / no-go", "{{ go_nogo_notes }}", 90);

  assemblePage(doc, [header, meta, items, go], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["project_name", "Project name for the launch checklist", "text", "Template Studio v2"],
    ["launch_date", "Target launch date", "date", "April 15, 2026"],
    ["project_owner", "Launch owner name", "text", "Alex Rivera"],
    ["launch_status", "Overall launch readiness status", "text", "On track"],
    [
      "project_launch_checklist_items",
      "Launch checklist items with owners and status",
      "list",
      JSON.stringify([
        { item: "QA pass on starters", owner: "QA", status: "Done" },
        { item: "Docs + changelog", owner: "Product", status: "In progress" },
        { item: "Support macros", owner: "Support", status: "Not started" },
        { item: "Marketing announce", owner: "GTM", status: "Scheduled" },
      ]),
      [
        ["item", "Checklist item", "text"],
        ["owner", "Item owner", "text"],
        ["status", "Item status", "text"],
      ],
    ],
    ["go_nogo_notes", "Go or no-go decision notes", "text", "Go if docs and support macros land by April 14 EOD."],
  ]);
  return doc;
}

// —— Letters ———————————————————————————————————————————————————

function offerLetter(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 48;
  const contentW = doc.root.w - pad * 2;

  const letterhead = box(
    contentW,
    70,
    "Letterhead",
    [
      heading(contentW, "{{ company_name }}", 2),
      paragraph(contentW, 28, "{{ company_address }} · {{ company_email }}", "left", LABEL_STYLE),
    ],
    { direction: "column", gap: 4, padding: 0 },
    INVISIBLE,
  );

  const meta = paragraph(
    contentW,
    70,
    "{{ letter_date }}\n\n{{ candidate_name }}\n{{ candidate_address }}",
  );
  const salutation = paragraph(contentW, 28, "Dear {{ candidate_name }},");
  const body = paragraph(
    contentW,
    160,
    "We are pleased to offer you the position of {{ job_title }} reporting to {{ manager_name }}. Your start date will be {{ start_date }}. Your base salary will be {{ base_salary }}, paid {{ pay_frequency }}. {{ equity_bonus }}\n\nThis offer is contingent on {{ contingencies }}. Please sign and return by {{ reply_by }}.\n\nSincerely,\n{{ signer_name }}\n{{ signer_title }}",
  );

  assemblePage(doc, [letterhead, meta, salutation, body], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Hiring company name on the offer letter", "text", "Acme Studio"],
    ["company_address", "Company address on the letterhead", "text", "123 Market St, City, ST 00000"],
    ["company_email", "Company HR or recruiting email", "text", "careers@acme.example"],
    ["letter_date", "Offer letter date", "date", "March 22, 2026"],
    ["candidate_name", "Candidate full name", "text", "Jordan Lee"],
    ["candidate_address", "Candidate mailing address", "text", "45 Oak Ave, City, ST 00000"],
    ["job_title", "Offered job title", "text", "Senior Product Designer"],
    ["manager_name", "Hiring manager name", "text", "Alex Rivera"],
    ["start_date", "Proposed start date", "date", "May 4, 2026"],
    ["base_salary", "Offered base salary", "currency", "$145,000 per year"],
    ["pay_frequency", "Pay frequency for the role", "text", "bi-weekly"],
    ["equity_bonus", "Equity or bonus language in the offer", "text", "You will also be recommended for an equity grant representing 0.15% of the company on a fully diluted basis."],
    ["contingencies", "Offer contingencies", "text", "successful background check and signed confidentiality agreement"],
    ["reply_by", "Date by which the candidate should reply", "date", "March 29, 2026"],
    ["signer_name", "Name of the person signing the offer", "text", "Alex Rivera"],
    ["signer_title", "Title of the person signing the offer", "text", "Head of Product"],
  ]);
  return doc;
}

function resignationLetter(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 48;
  const contentW = doc.root.w - pad * 2;

  const meta = paragraph(
    contentW,
    90,
    "{{ letter_date }}\n\n{{ manager_name }}\n{{ company_name }}\n{{ company_address }}",
  );
  const salutation = paragraph(contentW, 28, "Dear {{ manager_name }},");
  const body = paragraph(
    contentW,
    140,
    "Please accept this letter as formal notice of my resignation from the position of {{ job_title }} at {{ company_name }}. My last day of employment will be {{ last_day }}.\n\n{{ transition_note }}\n\nThank you for the opportunity to work with the team.\n\nSincerely,\n{{ employee_name }}",
  );

  assemblePage(doc, [meta, salutation, body], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["letter_date", "Resignation letter date", "date", "March 10, 2026"],
    ["manager_name", "Manager receiving the resignation", "text", "Alex Rivera"],
    ["company_name", "Employer company name", "text", "Acme Studio"],
    ["company_address", "Company address block", "text", "123 Market St, City, ST 00000"],
    ["job_title", "Current job title being resigned", "text", "Product Designer"],
    ["last_day", "Employee's last day of work", "date", "March 24, 2026"],
    ["transition_note", "Transition or thanks note", "text", "I will document open projects and am available to help with a smooth handover."],
    ["employee_name", "Resigning employee name", "text", "Jordan Lee"],
  ]);
  return doc;
}

// —— Proposals —————————————————————————————————————————————————

function businessProposal(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "BUSINESS PROPOSAL", "For {{ client_name }}", "{{ proposal_date }}");
  const intro = cardSection(contentW, "Opportunity", "{{ opportunity_summary }}", 100);
  const approach = cardSection(contentW, "Proposed approach", "{{ approach_summary }}", 100);

  const phaseRow = threeColRow(inner, "{{ item.phase }}", "{{ item.duration }}", "{{ item.fee }}");
  phaseRow.repeat = { over: "business_proposal_phases", as: "item" };
  const phases = box(
    contentW,
    160,
    "Phases",
    [
      sectionTitle(inner, "Phases & investment"),
      threeColRow(inner, "Phase", "Duration", "Fee", [0.45, 0.3, 0.25], true),
      phaseRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const next = cardSection(
    contentW,
    "Next steps",
    "{{ next_steps }}\n\nPrepared by {{ author_name }} · Valid until {{ valid_until }} · Total {{ proposal_total }}",
    110,
  );

  assemblePage(doc, [header, intro, approach, phases, next], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["client_name", "Client name on the business proposal", "text", "Northwind Trading"],
    ["proposal_date", "Proposal date", "date", "March 12, 2026"],
    ["opportunity_summary", "Problem or opportunity the proposal addresses", "text", "Northwind needs a faster path from scanned invoices and contracts into structured internal records."],
    ["approach_summary", "Proposed solution approach", "text", "Deploy FileWorks conversion with custom designs for AP packets, plus API automation for the ERP inbox."],
    [
      "business_proposal_phases",
      "Proposal phases with duration and fee",
      "list",
      JSON.stringify([
        { phase: "Discovery & design", duration: "2 weeks", fee: "$6,500" },
        { phase: "Implementation", duration: "4 weeks", fee: "$18,000" },
        { phase: "Enablement", duration: "1 week", fee: "$3,500" },
      ]),
      [
        ["phase", "Phase name", "text"],
        ["duration", "Phase duration", "text"],
        ["fee", "Phase fee", "currency"],
      ],
    ],
    ["next_steps", "Suggested next steps for the client", "text", "Schedule a technical workshop, confirm sample documents, and select a pilot team."],
    ["author_name", "Proposal author name", "text", "Sam Chen"],
    ["valid_until", "Date through which pricing remains valid", "date", "April 12, 2026"],
    ["proposal_total", "Total proposed investment", "currency", "$28,000"],
  ]);
  return doc;
}

function consultingProposal(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "CONSULTING PROPOSAL", "{{ consultant_name }}", "For {{ client_name }}");
  const scope = cardSection(contentW, "Scope of work", "{{ scope_of_work }}", 110);

  const outcomeRow = twoColRow(inner, "{{ item.outcome }}", "{{ item.measure }}", "Outcome", 0.55);
  outcomeRow.repeat = { over: "consulting_proposal_outcomes", as: "item" };
  const outcomes = box(
    contentW,
    140,
    "Outcomes",
    [
      sectionTitle(inner, "Outcomes"),
      twoColRow(inner, "Outcome", "How we measure", "hdr", 0.55, true),
      outcomeRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const commercial = box(
    contentW,
    110,
    "Commercials",
    [
      sectionTitle(inner, "Commercials"),
      infoRow(inner, "Engagement model", "{{ engagement_model }}"),
      infoRow(inner, "Fees", "{{ consulting_fees }}"),
      infoRow(inner, "Timeline", "{{ consulting_timeline }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  assemblePage(doc, [header, scope, outcomes, commercial], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["consultant_name", "Consulting firm or consultant name", "text", "River Advisory"],
    ["client_name", "Client name for the consulting proposal", "text", "Acme Studio"],
    ["scope_of_work", "Consulting scope of work summary", "text", "Advise on GTM packaging for API plans, including packaging, pricing experiments, and sales enablement assets."],
    [
      "consulting_proposal_outcomes",
      "Consulting outcomes and how each will be measured",
      "list",
      JSON.stringify([
        { outcome: "Clear plan tiers", measure: "Published packaging doc" },
        { outcome: "Pricing test design", measure: "Experiment brief + metrics" },
        { outcome: "Sales narrative", measure: "One-pager + talk track" },
      ]),
      [
        ["outcome", "Desired consulting outcome", "text"],
        ["measure", "How success is measured", "text"],
      ],
    ],
    ["engagement_model", "Retainer, project, or hourly model", "text", "Fixed-fee project"],
    ["consulting_fees", "Consulting fee summary", "currency", "$22,000"],
    ["consulting_timeline", "Engagement timeline", "text", "6 weeks from kickoff"],
  ]);
  return doc;
}

// —— Reports ———————————————————————————————————————————————————

function statusReport(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "STATUS REPORT", "{{ project_name }}", "{{ report_period }}");
  const summary = box(
    contentW,
    100,
    "Summary",
    [
      sectionTitle(inner, "Summary"),
      infoRow(inner, "Overall status", "{{ overall_status }}"),
      infoRow(inner, "Report author", "{{ author_name }}"),
      paragraph(inner, 40, "{{ executive_update }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const progressRow = threeColRow(inner, "{{ item.workstream }}", "{{ item.progress }}", "{{ item.next }}");
  progressRow.repeat = { over: "status_report_workstreams", as: "item" };
  const progress = box(
    contentW,
    160,
    "Progress",
    [
      sectionTitle(inner, "Workstreams"),
      threeColRow(inner, "Workstream", "Progress", "Next", [0.34, 0.33, 0.33], true),
      progressRow,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const risks = cardSection(contentW, "Risks & asks", "{{ risks_asks }}", 100);

  assemblePage(doc, [header, summary, progress, risks], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["project_name", "Project name on the status report", "text", "Template Studio v2"],
    ["report_period", "Reporting period", "text", "Week of Mar 16, 2026"],
    ["overall_status", "Overall RAG or status label", "text", "Green"],
    ["author_name", "Status report author", "text", "Alex Rivera"],
    ["executive_update", "Short executive update paragraph", "text", "Starter library expansion is on track; smoke tests pass for new document types."],
    [
      "status_report_workstreams",
      "Status report workstreams with progress and next steps",
      "list",
      JSON.stringify([
        { workstream: "Agreements", progress: "NDA + service live", next: "Employment polish" },
        { workstream: "Plans", progress: "Business + marketing", next: "Cash flow QA" },
        { workstream: "GTM", progress: "Copy draft", next: "Library screenshots" },
      ]),
      [
        ["workstream", "Workstream name", "text"],
        ["progress", "Progress this period", "text"],
        ["next", "Next step", "text"],
      ],
    ],
    ["risks_asks", "Risks and asks for stakeholders", "text", "Need legal review of employment agreement wording before staging publish."],
  ]);
  return doc;
}

function profitLoss(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = partyHeader(contentW, "PROFIT & LOSS", "{{ company_name }}", "{{ period_label }}");
  const totals = box(
    contentW,
    110,
    "Totals",
    [
      sectionTitle(inner, "Summary"),
      infoRow(inner, "Total revenue", "{{ total_revenue }}"),
      infoRow(inner, "Total expenses", "{{ total_expenses }}"),
      infoRow(inner, "Net income", "{{ net_income }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );

  const line = twoColRow(inner, "{{ item.line }}", "{{ item.amount }}", "P&L line", 0.7);
  line.repeat = { over: "profit_loss_lines", as: "item" };
  const lines = box(
    contentW,
    200,
    "Lines",
    [
      sectionTitle(inner, "Line items"),
      twoColRow(inner, "Line", "Amount", "hdr", 0.7, true),
      line,
    ],
    { direction: "column", gap: 10, padding: 20 },
    CARD,
  );

  const notes = cardSection(contentW, "Notes", "{{ pnl_notes }}", 80);

  assemblePage(doc, [header, totals, lines, notes], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["company_name", "Company name on the P&L statement", "text", "Acme Studio"],
    ["period_label", "Accounting period for the P&L", "text", "Q1 2026"],
    ["total_revenue", "Total revenue for the period", "currency", "$312,400"],
    ["total_expenses", "Total expenses for the period", "currency", "$248,900"],
    ["net_income", "Net income for the period", "currency", "$63,500"],
    [
      "profit_loss_lines",
      "Profit and loss line items with amounts",
      "list",
      JSON.stringify([
        { line: "Subscription revenue", amount: "$246,000" },
        { line: "API usage revenue", amount: "$66,400" },
        { line: "Payroll", amount: "$168,000" },
        { line: "Infrastructure", amount: "$41,200" },
        { line: "Marketing", amount: "$39,700" },
      ]),
      [
        ["line", "P&L line item name", "text"],
        ["amount", "Line item amount", "currency"],
      ],
    ],
    ["pnl_notes", "Notes accompanying the P&L", "text", "Figures are management draft; audit adjustments pending."],
  ]);
  return doc;
}

// —— Notices / memos / press ————————————————————————————————————

function cancellationNotice(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 48;
  const contentW = doc.root.w - pad * 2;

  const header = heading(contentW, "NOTICE OF CANCELLATION", 1);
  const meta = paragraph(
    contentW,
    70,
    "Date: {{ notice_date }}\nTo: {{ recipient_name }}\nRe: {{ contract_name }} ({{ contract_ref }})",
  );
  const body = paragraph(
    contentW,
    140,
    "This letter provides notice that {{ sender_name }} is cancelling {{ contract_name }} effective {{ effective_date }}, pursuant to {{ cancellation_clause }}.\n\n{{ reason_summary }}\n\nPlease confirm receipt and outline any wind-down steps by {{ reply_by }}.\n\nSincerely,\n{{ sender_name }}\n{{ sender_title }}",
  );

  assemblePage(doc, [header, meta, body], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["notice_date", "Date of the cancellation notice", "date", "March 8, 2026"],
    ["recipient_name", "Recipient of the cancellation notice", "text", "Bright Supply Co."],
    ["contract_name", "Name of the contract being cancelled", "text", "Master Supply Agreement"],
    ["contract_ref", "Contract reference number", "text", "MSA-1190"],
    ["sender_name", "Party sending the cancellation", "text", "Acme Studio LLC"],
    ["effective_date", "Cancellation effective date", "date", "April 8, 2026"],
    ["cancellation_clause", "Contract clause authorizing cancellation", "text", "Section 8.2 (termination for convenience with 30 days' notice)"],
    ["reason_summary", "Optional reason summary for cancellation", "text", "We are consolidating vendors and will complete open POs through the effective date."],
    ["reply_by", "Date by which confirmation is requested", "date", "March 18, 2026"],
    ["sender_title", "Title of the sender", "text", "Head of Operations"],
  ]);
  return doc;
}

function internalMemo(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;
  const inner = contentW - 40;

  const header = heading(contentW, "INTERNAL MEMO", 1);
  const meta = box(
    contentW,
    120,
    "Meta",
    [
      infoRow(inner, "To", "{{ memo_to }}"),
      infoRow(inner, "From", "{{ memo_from }}"),
      infoRow(inner, "Date", "{{ memo_date }}"),
      infoRow(inner, "Subject", "{{ memo_subject }}"),
    ],
    { direction: "column", gap: 8, padding: 20 },
    CARD,
  );
  const body = cardSection(contentW, "Message", "{{ memo_body }}", 140);
  const actions = cardSection(contentW, "Action requested", "{{ action_requested }}", 90);

  assemblePage(doc, [header, meta, body, actions], { padding: pad, gap: 16 });
  declareVars(doc, [
    ["memo_to", "Memo recipients", "text", "All managers"],
    ["memo_from", "Memo author", "text", "Alex Rivera, Head of Product"],
    ["memo_date", "Memo date", "date", "March 19, 2026"],
    ["memo_subject", "Memo subject line", "text", "New document starters in Design studio"],
    ["memo_body", "Body of the internal memo", "text", "We are shipping a broader starter library covering agreements, plans, policies, forms, and more. Please review the Designs library and flag gaps for your team."],
    ["action_requested", "Action requested from recipients", "text", "Try two starters this week and send feedback to product@acme.example by March 26."],
  ]);
  return doc;
}

function pressRelease(): DesignDocument {
  const doc = createEmptyDocument();
  const pad = 40;
  const contentW = doc.root.w - pad * 2;

  const dateline = paragraph(
    contentW,
    28,
    "FOR IMMEDIATE RELEASE · {{ release_date }} · {{ city_state }}",
    "left",
    LABEL_STYLE,
  );
  const headline = heading(contentW, "{{ headline }}", 1);
  const subhead = paragraph(contentW, 36, "{{ subhead }}", "left", { ...VALUE_STYLE, bold: true });
  const body = paragraph(
    contentW,
    180,
    "{{ lead_paragraph }}\n\n{{ body_paragraph }}\n\n\"{{ quote_text }}\" — {{ quote_attribution }}\n\n{{ closing_paragraph }}",
  );
  const boilder = cardSection(
    contentW,
    "About {{ company_name }}",
    "{{ company_boilerplate }}\n\nMedia contact: {{ media_contact_name }} · {{ media_contact_email }} · {{ media_contact_phone }}",
    120,
  );

  assemblePage(doc, [dateline, headline, subhead, body, boilder], { padding: pad, gap: 14 });
  declareVars(doc, [
    ["release_date", "Press release date", "date", "March 25, 2026"],
    ["city_state", "Dateline city and state", "text", "San Francisco, CA"],
    ["headline", "Press release headline", "text", "Acme Studio Expands Fillable Design Library for Business Documents"],
    ["subhead", "Press release subhead", "text", "New starters help teams turn converted files into agreements, plans, proposals, and more"],
    ["lead_paragraph", "Opening paragraph of the release", "text", "Acme Studio today announced a major expansion of its Design studio starters, adding popular business document types with ready-made variables for AI-assisted fill."],
    ["body_paragraph", "Supporting body paragraph", "text", "The update covers agreements, plans, policies, forms, checklists, letters, proposals, reports, notices, memos, and press releases—so operators can go from PDF to polished output without rebuilding layouts."],
    ["quote_text", "Executive quote text", "text", "Customers asked for the same document types they already use to run the business. Now those layouts are one click away."],
    ["quote_attribution", "Quote attribution name and title", "text", "Alex Rivera, Head of Product, Acme Studio"],
    ["closing_paragraph", "Closing paragraph before boilerplate", "text", "The starters are available now in the Designs library for workspace and API customers."],
    ["company_name", "Company name in the boilerplate", "text", "Acme Studio"],
    ["company_boilerplate", "About-the-company boilerplate", "text", "Acme Studio helps teams convert documents and produce branded outputs with AI reading, translation, and fillable designs."],
    ["media_contact_name", "Media contact name", "text", "Riley Ortiz"],
    ["media_contact_email", "Media contact email", "text", "press@acme.example"],
    ["media_contact_phone", "Media contact phone", "text", "+1 (415) 555-0142"],
  ]);
  return doc;
}

/** Document-type starters (BiB-style taxonomy). */
export const DOCUMENT_TYPE_TEMPLATES: Template[] = [
  {
    id: "nda",
    label: "Non-disclosure agreement",
    description: "Mutual or one-way NDA with parties, obligations, term, and signatures",
    category: "agreements",
    build: nda,
  },
  {
    id: "service_agreement",
    label: "Service agreement",
    description: "Provider/client scope, deliverables, fees, and payment terms",
    category: "agreements",
    build: serviceAgreement,
  },
  {
    id: "employment_agreement",
    label: "Employment agreement",
    description: "Role, compensation, schedule, and key employment terms",
    category: "agreements",
    build: employmentAgreement,
  },
  {
    id: "board_resolution",
    label: "Board resolution",
    description: "Corporate resolution with director votes and certification",
    category: "agreements",
    build: boardResolution,
  },
  {
    id: "business_plan",
    label: "Business plan",
    description: "One-page plan: summary, market, offer, milestones, and finance",
    category: "plans",
    build: businessPlan,
  },
  {
    id: "marketing_plan",
    label: "Marketing plan",
    description: "Goals, audience, channel budget, and KPIs for a period",
    category: "plans",
    build: marketingPlan,
  },
  {
    id: "cash_flow_forecast",
    label: "Cash flow forecast",
    description: "Opening cash, monthly inflows/outflows, and assumptions",
    category: "plans",
    build: cashFlowForecast,
  },
  {
    id: "leave_policy",
    label: "Leave & absence policy",
    description: "Leave types, accrual rules, approval, and request process",
    category: "policies",
    build: leavePolicy,
  },
  {
    id: "remote_work_policy",
    label: "Remote work policy",
    description: "Eligibility, expectations, equipment, and security contacts",
    category: "policies",
    build: remoteWorkPolicy,
  },
  {
    id: "purchase_order",
    label: "Purchase order",
    description: "Buyer/vendor PO with line items, total, and ship-to",
    category: "forms",
    build: purchaseOrder,
  },
  {
    id: "job_description",
    label: "Job description",
    description: "Role summary, responsibilities, requirements, and offer",
    category: "forms",
    build: jobDescription,
  },
  {
    id: "new_hire_checklist",
    label: "New hire checklist",
    description: "Onboarding tasks with owners and due timing",
    category: "checklists",
    build: newHireChecklist,
  },
  {
    id: "project_launch_checklist",
    label: "Project launch checklist",
    description: "Launch readiness items, owners, and go/no-go notes",
    category: "checklists",
    build: projectLaunchChecklist,
  },
  {
    id: "offer_letter",
    label: "Job offer letter",
    description: "Formal offer with compensation, start date, and contingencies",
    category: "letters",
    build: offerLetter,
  },
  {
    id: "resignation_letter",
    label: "Resignation letter",
    description: "Notice of resignation with last day and transition note",
    category: "letters",
    build: resignationLetter,
  },
  {
    id: "business_proposal",
    label: "Business proposal",
    description: "Client proposal with phases, fees, and next steps",
    category: "proposals",
    build: businessProposal,
  },
  {
    id: "consulting_proposal",
    label: "Consulting proposal",
    description: "Scope, outcomes, engagement model, and fees",
    category: "proposals",
    build: consultingProposal,
  },
  {
    id: "status_report",
    label: "Status report",
    description: "Project status with workstreams, risks, and asks",
    category: "reports",
    build: statusReport,
  },
  {
    id: "profit_loss",
    label: "Profit & loss statement",
    description: "P&L summary with revenue, expenses, and line items",
    category: "reports",
    build: profitLoss,
  },
  {
    id: "cancellation_notice",
    label: "Cancellation notice",
    description: "Formal notice cancelling a contract with effective date",
    category: "notices",
    build: cancellationNotice,
  },
  {
    id: "internal_memo",
    label: "Internal memo",
    description: "To/from/date/subject memo with action requested",
    category: "memos",
    build: internalMemo,
  },
  {
    id: "press_release",
    label: "Press release",
    description: "Headline, body, quote, boilerplate, and media contact",
    category: "press",
    build: pressRelease,
  },
];
