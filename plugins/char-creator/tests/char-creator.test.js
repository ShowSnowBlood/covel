/**
 * char-creator plugin discovery tests (multi-runtime).
 *
 * This plugin hosts two runtimes:
 *   - player-init       — deterministic function runtime that emits the
 *                         opening form and writes the submitted player itself;
 *   - character-tracker — LLM agent that detects NPC/state changes each turn.
 *
 * Full execution behavior is covered by E2E tests in apps/server and
 * Playwright tests in apps/web. This file only verifies the manifest
 * structure and discovery so that refactors of the plugin layout fail fast.
 *
 * Run: npx vitest run plugins/char-creator/tests/
 */

import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { discoverPlugins, loadPluginManifest } from "@covel/plugin-loader";

const PLUGINS_DIR = path.resolve(import.meta.dirname, "../..");

describe("char-creator plugin", () => {
  let discovery;
  let manifests;

  beforeAll(async () => {
    const discoveries = await discoverPlugins(PLUGINS_DIR);
    discovery = discoveries.find((d) => d.id === "char-creator");
    expect(discovery).toBeDefined();
    manifests = await loadPluginManifest(discovery);
  });

  describe("discovery", () => {
    it("is recognized as a multi-runtime plugin", () => {
      expect(discovery.isMultiRuntime).toBe(true);
      expect(discovery.pluginMdPaths.length).toBeGreaterThanOrEqual(2);
    });

    it("exposes player-init and character-tracker runtimes", () => {
      const names = manifests.map((m) => m.manifest.name).sort();
      expect(names).toEqual([
        "char-creator/character-tracker",
        "char-creator/player-init",
      ]);
    });
  });

  describe("player-init runtime", () => {
    let manifest;

    beforeAll(() => {
      const m = manifests.find(
        (x) => x.manifest.name === "char-creator/player-init",
      );
      manifest = m.manifest;
    });

    it("is a setup-stage core-plugin", () => {
      expect(manifest.stage).toBe("setup");
      expect(manifest.pluginType).toBe("core-plugin");
    });

    it("builds the opening interaction without an LLM", () => {
      expect(manifest.runtimeType).toBe("function");
      expect(manifest.handler).toBe("./handler.js");
      expect(manifest.tags).toContain("cost:function");
      expect(manifest.tags).not.toContain("cost:llm");
      expect(manifest.tools?.builtin ?? []).toEqual([]);
      expect(manifest.effects?.writes).toEqual([
        "interaction:*",
        "characters:*",
        "plugin-data:self:characters",
      ]);
    });

    it("binds the same-turn pregame opening and generated world schema", () => {
      expect(manifest.inputs).toEqual({
        opening: expect.objectContaining({
          from: { runtime: "pregame" },
          select: "/narrativeOutput",
          required: false,
        }),
        worldSchema: expect.objectContaining({
          from: { runtime: "world-init/schema-gen" },
          select: "/worldSchema",
          required: false,
        }),
      });
      expect(manifest.input?.inject ?? []).toEqual([]);
    });

    it("declares turn-scoped needs so it waits for pregame and schema init", () => {
      expect(manifest.needs).toEqual(["pregame", "world-init/schema-gen"]);
    });

    it("uses an auto trigger and completes from submitted state in its handler", () => {
      expect(manifest.trigger?.type).toBe("auto");
      expect(manifest.guard).toBeUndefined();
      expect(
        fs.existsSync(
          path.join(
            discovery.rootPath,
            "runtimes",
            "player-init",
            "handler.js",
          ),
        ),
      ).toBe(true);
      expect(
        fs.existsSync(
          path.join(discovery.rootPath, "runtimes", "player-init", "guard.js"),
        ),
      ).toBe(false);
    });

    it("declares the shared character-panel ui spec", () => {
      expect(manifest.ui?.right).toEqual(
        expect.arrayContaining(["../../ui/character-panel.json"]),
      );
    });
  });

  describe("character-tracker runtime", () => {
    let manifest;

    beforeAll(() => {
      const m = manifests.find(
        (x) => x.manifest.name === "char-creator/character-tracker",
      );
      manifest = m.manifest;
    });

    it("runs every turn in the post-turn stage", () => {
      expect(manifest.trigger?.type).toBe("scheduled");
      expect(manifest.trigger?.interval).toBe(1);
      // Band selection is stage-driven: post-turn runs in the main loop, after
      // the narrative stage.
      expect(manifest.stage).toBe("post-turn");
    });

    it("declares the write tools plus the on-demand detail read", () => {
      expect(manifest.tools?.builtin).toEqual(
        expect.arrayContaining([
          "create-character",
          "update-character",
          "get-character",
        ]),
      );
    });

    it("does not declare list-characters — the roster is injected", () => {
      // `<existing-characters>` is injected at prompt-build time, so a roster
      // tool would be a round-trip the runtime is told never to make. Handing
      // the model a tool its own prompt forbids costs tokens and invites a
      // detour; `get-character` remains for the truncated-snapshot case.
      expect(manifest.tools?.builtin).not.toContain("list-characters");
      expect(manifest.input?.inject).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ namespace: "characters" }),
        ]),
      );
    });

    it("injects narrativeOutput from both narrative engines ", () => {
      // Engine-agnostic: one inject per known narrative engine; the absent
      // engine resolves to nothing so exactly the active one fills the block.
      for (const engine of ["narrator", "chat-mode-narrator"]) {
        expect(manifest.input.inject).toContainEqual({
          kind: "runtime",
          from: engine,
          field: "narrativeOutput",
          as: "<narrator-output>",
        });
      }
    });

    it("injects the existing-characters roster as plugin-data (no list round-trip)", () => {
      // The tracker's own characters are mirrored to plugin_data[characters];
      // injecting them at prompt-build time removes the mandatory per-turn
      // list-characters tool round-trip (same pattern codex uses for entries).
      const pluginDataInjects = (manifest.input?.inject ?? []).filter(
        (i) => i.kind === "plugin-data",
      );
      expect(pluginDataInjects).toContainEqual(
        expect.objectContaining({
          kind: "plugin-data",
          namespace: "characters",
          as: "<existing-characters>",
          format: "summary",
        }),
      );
    });

    it("gates on the narrative-engine capability, not an exact runtime ", () => {
      expect(manifest.needs).toEqual([{ capability: "narrative-engine" }]);
    });
  });
});
