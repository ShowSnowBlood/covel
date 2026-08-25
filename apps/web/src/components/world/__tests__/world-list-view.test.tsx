import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorldListView } from "../world-list-view.js";
import type { WorldRecord } from "@/services/api.js";

vi.mock("@/components/reactbits/index.js", () => ({
  ShinyText: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/world/world-card.js", () => ({
  WorldCard: ({ world }: { world: WorldRecord }) => (
    <div data-testid="world-card">{String(world.name)}</div>
  ),
}));

const worlds = [
  {
    id: "mistport",
    name: "Mistport",
    description: "Foggy harbor",
    createdAt: "2026-08-25T00:00:00.000Z",
  },
  {
    id: "haruka-academy",
    name: "Haruka Academy",
    description: "School story",
    createdAt: "2026-08-25T00:00:00.000Z",
  },
  {
    id: "emberback",
    name: "Emberback",
    description: "Dragon road",
    createdAt: "2026-08-25T00:00:00.000Z",
  },
] as WorldRecord[];

const t = ((key: string, fallback?: string | Record<string, unknown>) =>
  typeof fallback === "string" ? fallback : key) as never;

describe("WorldListView", () => {
  it("shows every world without campaign locks or level progress", () => {
    render(
      <WorldListView
        worlds={worlds}
        t={t}
        primarySlotLabel={null}
        enabledPluginCount={0}
        enteringWorldId={null}
        storageLabel={() => "Built-in"}
        onOpenGenerator={vi.fn()}
        onEnterWorld={vi.fn()}
        onViewDetails={vi.fn()}
        onDeleteWorld={vi.fn()}
      />,
    );

    expect(screen.getAllByTestId("world-card")).toHaveLength(3);
    expect(screen.queryByText("Campaign route")).toBeNull();
    expect(screen.queryByText(/Level progress/i)).toBeNull();
    expect(screen.queryByText(/Sign in to unlock/i)).toBeNull();
  });
});
