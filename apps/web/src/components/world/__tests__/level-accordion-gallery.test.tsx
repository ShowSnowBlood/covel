import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import type { WorldRecord } from "@/services/api.js";
import {
  LevelAccordionGallery,
  type LevelAccordionItem,
} from "../level-accordion-gallery.js";

const items: LevelAccordionItem[] = [
  level("mistport", "Mistport", 1, { completed: true }),
  level("haruka-academy", "Haruka Academy", 2),
  level("emberback", "Emberback", 3, { locked: true }),
];

describe("LevelAccordionGallery", () => {
  it("expands a panel before entering its world", () => {
    const onEnter = vi.fn();
    renderGallery({ onEnter });

    fireEvent.click(screen.getByText("Mistport"));
    expect(onEnter).not.toHaveBeenCalled();
    expect(
      screen
        .getByText("Mistport")
        .closest("article")
        ?.getAttribute("aria-current"),
    ).toBe("true");
    fireEvent.click(screen.getByText("Mistport"));
    expect(onEnter).toHaveBeenCalledWith("mistport");
  });

  it("keeps locked levels gated after expansion", () => {
    const onEnter = vi.fn();
    const onLocked = vi.fn();
    renderGallery({ onEnter, onLocked });

    fireEvent.click(screen.getByText("Emberback"));
    fireEvent.click(screen.getByText("Emberback"));

    expect(onLocked).toHaveBeenCalledOnce();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("moves the active panel with arrow keys", () => {
    renderGallery({});
    const activeButton = screen.getByRole("button", {
      name: /Haruka Academy/,
    });

    fireEvent.keyDown(activeButton, { key: "ArrowRight" });

    expect(
      screen
        .getByText("Emberback")
        .closest("article")
        ?.getAttribute("aria-current"),
    ).toBe("true");
  });
});

function renderGallery({
  onEnter = vi.fn(),
  onLocked = vi.fn(),
}: {
  onEnter?: (worldId: string) => void;
  onLocked?: () => void;
}) {
  return render(
    <LevelAccordionGallery
      items={items}
      defaultIndex={1}
      t={i18n.t}
      onEnter={onEnter}
      onLocked={onLocked}
      onViewDetails={() => {}}
      onDelete={() => {}}
    />,
  );
}

function level(
  id: string,
  name: string,
  levelNumber: number,
  state: Partial<Pick<LevelAccordionItem, "locked" | "completed">> = {},
): LevelAccordionItem {
  return {
    world: {
      id,
      name,
      description: `${name} description`,
      metadata: { source: "file" },
    } as WorldRecord,
    levelNumber,
    locked: state.locked ?? false,
    completed: state.completed ?? false,
    unlocking: false,
    isEntering: false,
    dimmed: false,
  };
}
