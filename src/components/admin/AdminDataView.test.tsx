import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminDataView from "./AdminDataView";

describe("AdminDataView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("does not fetch protected records before the password is verified", () => {
    render(<AdminDataView adminToken="admin-session" onBack={vi.fn()} onLogout={vi.fn()} />);

    expect(screen.getByText("Protected Data")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unlock Data" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
});
