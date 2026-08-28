import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";

const api = vi.hoisted(() => ({
  fetchRuntimePolicy: vi.fn(),
  saveRuntimePolicy: vi.fn(),
}));

vi.mock("@/services/api.js", () => ({
  fetchFrostFoxRuntimePolicy: api.fetchRuntimePolicy,
  saveFrostFoxRuntimePolicy: api.saveRuntimePolicy,
}));

const { RuntimePolicyPane } = await import("../RuntimePolicyPane.js");

describe("RuntimePolicyPane", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
    api.fetchRuntimePolicy.mockResolvedValue({
      policy: { timeoutMs: 180_000, maxRetries: 2 },
      updatedAt: null,
      canEdit: true,
    });
    api.saveRuntimePolicy.mockImplementation(async (policy) => ({
      policy,
      updatedAt: "2026-08-28T00:00:00.000Z",
      canEdit: true,
    }));
  });

  afterEach(cleanup);

  it("loads and saves the administrator retry policy", async () => {
    render(<RuntimePolicyPane />);

    const retries = await screen.findByRole("spinbutton", {
      name: /Automatic retries/,
    });
    expect((retries as HTMLInputElement).value).toBe("2");

    fireEvent.change(retries, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Save policy" }));

    await waitFor(() =>
      expect(api.saveRuntimePolicy).toHaveBeenCalledWith({
        timeoutMs: 180_000,
        maxRetries: 3,
      }),
    );
  });

  it("uses each field's own unit in inherited-value placeholders", async () => {
    render(<RuntimePolicyPane />);

    const steps = await screen.findByRole("spinbutton", {
      name: /Tool-loop steps/,
    });
    const retries = screen.getByRole("spinbutton", {
      name: /Automatic retries/,
    });

    expect((steps as HTMLInputElement).placeholder).toBe("10 steps");
    expect((retries as HTMLInputElement).placeholder).toBe("1 retries");
  });
});
