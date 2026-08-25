import { describe, expect, it, vi } from "vitest";
import {
  assertEntityEnvelope,
  readManualEntity,
  runImageGeneration,
  splitList,
} from "../src/index.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

describe("splitList", () => {
  it("splits strings on comma / fullwidth-comma / newline", () => {
    expect(splitList("a, b，c\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps string items of an array input", () => {
    expect(splitList([" x ", 1, "", "y"])).toEqual(["x", "y"]);
  });

  it("returns [] for non-string / non-array input and caps at 32", () => {
    expect(splitList(42)).toEqual([]);
    expect(splitList(undefined)).toEqual([]);
    expect(
      splitList(Array.from({ length: 40 }, (_, i) => `k${i}`)),
    ).toHaveLength(32);
  });
});

describe("readManualEntity", () => {
  it("parses the <entity>Json branch and throws on invalid JSON", () => {
    expect(
      readManualEntity({ ruleJson: '{"id":"a"}' }, "rule", () => ({})),
    ).toEqual({ id: "a" });
    expect(() =>
      readManualEntity({ ruleJson: "{bad" }, "rule", () => ({})),
    ).toThrow("manualPayload.ruleJson must be valid JSON");
  });

  it("routes the <entity>Form branch through fromForm", () => {
    const fromForm = vi.fn(() => ({ built: true }));
    expect(
      readManualEntity({ ruleForm: { title: "t" } }, "rule", fromForm),
    ).toEqual({ built: true });
    expect(fromForm).toHaveBeenCalledWith({ title: "t" });
  });

  it("falls back to the raw <entity> object, else undefined", () => {
    expect(readManualEntity({ rule: { id: "r" } }, "rule", () => ({}))).toEqual(
      {
        id: "r",
      },
    );
    expect(readManualEntity("nope", "rule", () => ({}))).toBeUndefined();
  });
});

describe("assertEntityEnvelope", () => {
  const opts = {
    entity: "rule",
    idPattern: ID_PATTERN,
    idError: "rule.id must be 1-128 characters",
  };

  it("returns the built envelope on the happy path", () => {
    expect(assertEntityEnvelope({ id: "r1", extra: 1 }, opts)).toEqual({
      id: "r1",
      extra: 1,
      schemaVersion: 1,
    });
  });

  it("layers build() over the validated base", () => {
    expect(
      assertEntityEnvelope(
        { id: "r1" },
        { ...opts, build: (base) => ({ ...base, kind: "constant" }) },
      ),
    ).toMatchObject({ id: "r1", schemaVersion: 1, kind: "constant" });
  });

  it("supports a custom idField", () => {
    expect(
      assertEntityEnvelope(
        { characterId: "c1" },
        {
          entity: "presence",
          idField: "characterId",
          idPattern: ID_PATTERN,
          idError: "bad",
        },
      ),
    ).toMatchObject({ characterId: "c1", schemaVersion: 1 });
  });

  it("throws for non-object, bad id, bad pattern, bad schemaVersion, oversize", () => {
    expect(() => assertEntityEnvelope(undefined, opts)).toThrow(
      "manualPayload.rule must be an object",
    );
    expect(() => assertEntityEnvelope({}, opts)).toThrow(
      "rule.id must be a non-empty string",
    );
    expect(() => assertEntityEnvelope({ id: "../x" }, opts)).toThrow(
      "rule.id must be 1-128 characters",
    );
    expect(() =>
      assertEntityEnvelope({ id: "r1", schemaVersion: 2 }, opts),
    ).toThrow("rule.schemaVersion must be 1");
    expect(() =>
      assertEntityEnvelope({ id: "r1", blob: "x".repeat(70_000) }, opts),
    ).toThrow("rule is too large");
  });
});

describe("runImageGeneration", () => {
  it("persists the generated MediaRef on every gallery record", async () => {
    const refs = [
      { id: "a".repeat(64), mime: "image/png", size: 123 },
      { id: "b".repeat(64), mime: "image/png", size: 456 },
    ];
    const set = vi.fn(async () => undefined);

    const result = await runImageGeneration(
      {
        turnId: "turn-1",
        manualPayload: { prompt: "draw the harbour" },
        pluginData: { set },
        images: {
          generate: vi.fn(async () => ({ refs, warnings: [], cached: false })),
        },
      },
      {
        source: "image-test",
        triggerTopic: "image.generate.requested",
        planRequest: (_settings, { prompt }) => ({
          prompt,
          presetId: "image",
          size: "1024x1024",
          n: 2,
          requestTimeoutMs: 1_000,
        }),
      },
    );

    expect(result.status).toBe("done");
    expect(result.pluginData).toEqual([
      expect.objectContaining({
        namespace: "images",
        value: expect.objectContaining({ ref: refs[0], status: "done" }),
      }),
      expect.objectContaining({
        namespace: "images",
        value: expect.objectContaining({ ref: refs[1], status: "done" }),
      }),
    ]);
  });
});
