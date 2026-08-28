import { describe, expect, it } from "vitest";
import type { SettingsStoreApi } from "@covel/settings";
import {
  buildNavTree,
  filterNav,
  OPERATOR_ACCESS_NODE_ID,
  RUNTIME_POLICY_NODE_ID,
} from "../navigation.js";

const emptyStore = {
  listEntries: () => [],
} as unknown as SettingsStoreApi;

describe("operator access settings navigation", () => {
  it("exposes the browser credential pane only for hosted servers", () => {
    const local = buildNavTree(emptyStore, { locale: "en-US" });
    const english = buildNavTree(emptyStore, {
      locale: "en-US",
      includeOperatorAccess: true,
    });
    const chinese = buildNavTree(emptyStore, {
      locale: "zh-CN",
      includeOperatorAccess: true,
    });

    expect(local.some((node) => node.id === OPERATOR_ACCESS_NODE_ID)).toBe(
      false,
    );
    expect(
      english.find((node) => node.id === OPERATOR_ACCESS_NODE_ID)?.label,
    ).toBe("Operator Access");
    expect(
      chinese.find((node) => node.id === OPERATOR_ACCESS_NODE_ID)?.label,
    ).toBe("运维访问");
  });

  it("does not expose duplicate provider configuration", () => {
    const nodes = buildNavTree(emptyStore, { locale: "zh-CN" });

    expect(nodes.some((node) => node.id === "llm.providers")).toBe(false);
  });

  it("is discoverable through settings search", () => {
    const nodes = buildNavTree(emptyStore, {
      locale: "en-US",
      includeOperatorAccess: true,
    });

    expect(filterNav(nodes, "operator", "en-US")).toEqual([
      expect.objectContaining({ id: OPERATOR_ACCESS_NODE_ID }),
    ]);
  });

  it("shows runtime policy only when administrator access is explicit", () => {
    expect(
      buildNavTree(emptyStore, { locale: "en-US" }).some(
        (node) => node.id === RUNTIME_POLICY_NODE_ID,
      ),
    ).toBe(false);

    expect(
      buildNavTree(emptyStore, {
        locale: "en-US",
        includeRuntimePolicy: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: RUNTIME_POLICY_NODE_ID,
          label: "Runtime Policy",
        }),
      ]),
    );
  });

  it("hides onboarding bookkeeping from player settings", () => {
    const store = {
      listEntries: () => [
        {
          key: "ui.onboardedVersion",
          group: "general",
          label: "Onboarding version",
        },
        {
          key: "ui.onboardedAccountId",
          group: "general",
          label: "Onboarding account",
        },
        {
          key: "ui.locale",
          group: "general",
          label: "Language",
        },
      ],
    } as unknown as SettingsStoreApi;

    const nodes = buildNavTree(store, { locale: "en-US" });
    expect(nodes.flatMap((node) => node.children)).toEqual([
      expect.objectContaining({ key: "ui.locale" }),
    ]);
  });
});
