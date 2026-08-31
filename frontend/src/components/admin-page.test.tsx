import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdminPage } from "@/components/admin-page";
import * as api from "@/lib/api";
import type { MeResponse } from "@/lib/api";
import { clearSession, setSession, writeSessionHint } from "@/lib/auth";
import { resetSessionStore } from "@/lib/session";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const quota = {
  used_day: 0,
  used_month: 0,
  limit_day: 1,
  limit_month: null,
  remaining_day: 1,
  remaining_month: null,
  used_ai_day: 0,
  used_ai_month: 0,
  limit_ai_day: 1,
  limit_ai_month: null,
  remaining_ai_day: 1,
  remaining_ai_month: null,
};

const memberMe: MeResponse = {
  user: { id: "1", email: "member@example.com", name: "Member", picture_url: null, plan: "basic" },
  plan: "basic",
  permissions: { extract: true },
  quota,
  google_client_id: null,
  is_admin: false,
};

const adminMe: MeResponse = {
  user: {
    id: "admin",
    email: "kenny.zlee@gmail.com",
    name: "Kenny",
    picture_url: null,
    plan: "premium",
  },
  plan: "premium",
  permissions: { extract: true },
  quota,
  google_client_id: null,
  is_admin: true,
};

const overview = {
  users: 2,
  usage_events: 5,
  api_keys: 1,
  history_documents: 3,
  templates: 4,
  plans: { basic: 1, premium: 1 },
  api_plans: { api_free: 2 },
};

const plans = {
  workspace_plans: [
    { id: "basic", label: "Casual" },
    { id: "pro", label: "Daily" },
    { id: "premium", label: "Expert" },
  ],
  api_plans: [
    { id: "api_free", label: "API Free" },
    { id: "api_scale", label: "API Scale" },
  ],
};

const targetUser = {
  id: "u2",
  email: "target@example.com",
  name: "Target",
  plan: "basic",
  api_plan: "api_free",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_api_subscription_id: null,
  history_indexed: false,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  usage_events: 2,
  api_keys: 0,
  history_documents: 1,
  templates: 0,
};

describe("AdminPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetSessionStore();
    clearSession();
  });

  beforeEach(() => {
    resetSessionStore();
    clearSession();
    setSession("access", "refresh");
    writeSessionHint({
      id: "1",
      email: "member@example.com",
      name: "Member",
      picture_url: null,
      plan: "basic",
    });
  });

  it("shows forbidden for signed-in non-admins", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue(memberMe);
    render(<AdminPage />);
    expect(await screen.findByText(/You do not have admin access/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to account/i })).toHaveAttribute("href", "/profile");
  });

  it("redirects guests to login", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "" });
    clearSession();
    resetSessionStore();
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      user: null,
      plan: "anonymous",
      permissions: {},
      quota,
      google_client_id: null,
    });
    render(<AdminPage />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?next=/admin"));
  });

  it("loads overview and lets admin update a user plan", async () => {
    const user = userEvent.setup();
    writeSessionHint({
      id: "admin",
      email: "kenny.zlee@gmail.com",
      name: "Kenny",
      picture_url: null,
      plan: "premium",
    });
    vi.spyOn(api, "fetchMe").mockResolvedValue(adminMe);
    vi.spyOn(api, "fetchAdminOverview").mockResolvedValue(overview);
    vi.spyOn(api, "fetchAdminPlans").mockResolvedValue(plans);
    vi.spyOn(api, "fetchAdminUsers").mockResolvedValue({
      items: [targetUser],
      total: 1,
      limit: 100,
      offset: 0,
    });
    const detail = {
      ...targetUser,
      picture_url: null,
      google_sub: "sub-target",
      quota,
      api_quota: {
        used_credits: 0,
        limit_credits: 100,
        remaining_credits: 100,
      },
    };
    vi.spyOn(api, "fetchAdminUser").mockResolvedValue(detail);
    vi.spyOn(api, "updateAdminUser").mockResolvedValue({
      ...detail,
      plan: "premium",
      api_plan: "api_scale",
    });

    render(<AdminPage />);
    expect(await screen.findByRole("heading", { name: "Database" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByText("target@example.com")).toBeInTheDocument();

    await user.click(screen.getByText("target@example.com"));
    expect(await screen.findByText("Google sub")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Workspace plan/i), "premium");
    await user.selectOptions(screen.getByLabelText(/API plan/i), "api_scale");
    await user.click(screen.getByRole("button", { name: "Save plans" }));

    await waitFor(() =>
      expect(api.updateAdminUser).toHaveBeenCalledWith("u2", {
        plan: "premium",
        api_plan: "api_scale",
      }),
    );
    expect(await screen.findByText("Plans updated.")).toBeInTheDocument();
  });

  it("surfaces search and save errors", async () => {
    const user = userEvent.setup();
    writeSessionHint({
      id: "admin",
      email: "kenny.zlee@gmail.com",
      name: "Kenny",
      picture_url: null,
      plan: "premium",
    });
    vi.spyOn(api, "fetchMe").mockResolvedValue(adminMe);
    vi.spyOn(api, "fetchAdminOverview").mockResolvedValue(overview);
    vi.spyOn(api, "fetchAdminPlans").mockResolvedValue(plans);
    vi.spyOn(api, "fetchAdminUsers")
      .mockResolvedValueOnce({ items: [targetUser], total: 1, limit: 100, offset: 0 })
      .mockRejectedValueOnce(new Error("search failed"));
    const detail = {
      ...targetUser,
      picture_url: null,
      google_sub: "sub-target",
      quota,
      api_quota: { used_credits: 0, limit_credits: 100, remaining_credits: 100 },
    };
    vi.spyOn(api, "fetchAdminUser").mockResolvedValue(detail);
    vi.spyOn(api, "updateAdminUser").mockRejectedValue(new Error("update failed"));

    render(<AdminPage />);
    expect(await screen.findByRole("heading", { name: "Database" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText(/Search email or name/i), "target");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("search failed")).toBeInTheDocument();

    await user.click(screen.getByText("target@example.com"));
    expect(await screen.findByText("Google sub")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Workspace plan/i), "premium");
    await user.click(screen.getByRole("button", { name: "Save plans" }));
    expect(await screen.findByText("update failed")).toBeInTheDocument();
  });

  it("surfaces load failures after admin auth", async () => {
    writeSessionHint({
      id: "admin",
      email: "kenny.zlee@gmail.com",
      name: "Kenny",
      picture_url: null,
      plan: "premium",
    });
    vi.spyOn(api, "fetchMe").mockResolvedValue(adminMe);
    vi.spyOn(api, "fetchAdminOverview").mockRejectedValue(new Error("overview down"));
    vi.spyOn(api, "fetchAdminPlans").mockResolvedValue(plans);
    render(<AdminPage />);
    expect(await screen.findByText("overview down")).toBeInTheDocument();
  });
});
