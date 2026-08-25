import { describe, expect, it } from "vitest";
import type { SessionPluginInfo } from "@/services/api.js";
import { findImageGeneratorRuntimeId } from "../image-plugin-panels/actions.js";

function plugin(
  runtimes: NonNullable<SessionPluginInfo["runtimes"]>,
): SessionPluginInfo {
  return {
    id: "openai-image-gen",
    displayName: "Image generation",
    isActive: true,
    runtimes,
  };
}

describe("image runtime discovery", () => {
  it("prefers the explicit image-generator capability", () => {
    expect(
      findImageGeneratorRuntimeId(
        plugin([
          {
            id: "openai-image-gen/prompt-generator",
            capabilities: ["image-prompt"],
          },
          {
            id: "openai-image-gen/image-generator",
            capabilities: ["image-generation", "image-generator"],
          },
        ]),
      ),
    ).toBe("openai-image-gen/image-generator");
  });

  it("keeps retries working for sessions with the legacy image tag", () => {
    expect(
      findImageGeneratorRuntimeId(
        plugin([
          {
            id: "openai-image-gen/prompt-generator",
            capabilities: ["image-prompt"],
          },
          {
            id: "openai-image-gen/image-generator",
            capabilities: ["image-generation"],
          },
        ]),
      ),
    ).toBe("openai-image-gen/image-generator");
  });

  it("returns null when no plugin runtime can generate images", () => {
    expect(findImageGeneratorRuntimeId(undefined)).toBeNull();
    expect(
      findImageGeneratorRuntimeId(
        plugin([
          {
            id: "openai-image-gen/prompt-generator",
            capabilities: ["image-prompt"],
          },
        ]),
      ),
    ).toBeNull();
  });
});
