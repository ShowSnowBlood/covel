import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { invalidatePingResult, PingButton } from "../ping-button.js";

const api = vi.hoisted(() => ({
  pingPreset: vi.fn(),
}));

vi.mock("@/services/api.js", () => ({
  pingPreset: api.pingPreset,
}));

describe("PingButton", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage("en-US");
  });

  it("retries a provider failure instead of serving a stale error", async () => {
    const target = { kind: "preset" as const, presetId: "retryable-preset" };
    invalidatePingResult(target);
    api.pingPreset
      .mockResolvedValueOnce({
        ok: false,
        latencyMs: 0,
        error: "Provider did not return any content",
      })
      .mockResolvedValueOnce({ ok: true, latencyMs: 42, ttfbMs: 18 });

    render(<PingButton target={target} />);
    const button = screen.getByRole("button", { name: "Ping" });

    fireEvent.click(button);
    await waitFor(() =>
      expect(
        screen.getByText("Provider did not return any content"),
      ).toBeTruthy(),
    );
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/18\s*ms/)).toBeTruthy());
    expect(api.pingPreset).toHaveBeenCalledTimes(2);
  });

  it("caches a successful probe within the configured TTL", async () => {
    const target = { kind: "preset" as const, presetId: "cached-preset" };
    invalidatePingResult(target);
    api.pingPreset.mockResolvedValue({ ok: true, latencyMs: 12, ttfbMs: 7 });

    render(<PingButton target={target} />);
    const button = screen.getByRole("button", { name: "Ping" });

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("7ms")).toBeTruthy());
    act(() => invalidatePingResult(target));
    expect(screen.queryByText(/7\s*ms/)).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(api.pingPreset).toHaveBeenCalledTimes(2));
  });

  it("does not cache a failed pre-ping setup", async () => {
    const target = { kind: "preset" as const, presetId: "setup-preset" };
    invalidatePingResult(target);
    const onBeforePing = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    api.pingPreset.mockResolvedValue({ ok: true, latencyMs: 20, ttfbMs: 10 });

    render(<PingButton target={target} onBeforePing={onBeforePing} />);
    const button = screen.getByRole("button", { name: "Ping" });

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/save failed/)).toBeTruthy());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("10ms")).toBeTruthy());
    expect(onBeforePing).toHaveBeenCalledTimes(2);
    expect(api.pingPreset).toHaveBeenCalledTimes(1);
  });
});
