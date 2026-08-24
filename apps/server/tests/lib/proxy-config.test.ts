import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readStoredProxyConfig,
  writeStoredProxyConfig,
} from "../../src/lib/proxy-config.js";

let tempHome: string | undefined;

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = undefined;
});

describe("stored proxy TOML", () => {
  it("reads legal single-quoted strings and inline comments", () => {
    tempHome = mkdtempSync(join(tmpdir(), "covel-proxy-config-"));
    writeFileSync(
      join(tempHome, "config.toml"),
      [
        "# operator-authored config",
        "[network] # proxy selection",
        "proxy_mode = 'http' # legal TOML comment",
        "proxy_url = 'http://127.0.0.1:7890'",
        "",
      ].join("\n"),
      "utf-8",
    );

    expect(readStoredProxyConfig(tempHome)).toEqual({
      mode: "http",
      url: "http://127.0.0.1:7890",
    });
  });

  it("updates the network keys without discarding unrelated TOML", () => {
    tempHome = mkdtempSync(join(tmpdir(), "covel-proxy-config-"));
    const file = join(tempHome, "config.toml");
    writeFileSync(file, "[paths]\ndata_root = '/tmp/covel'\n", "utf-8");

    writeStoredProxyConfig(tempHome, {
      mode: "socks",
      url: "socks5://127.0.0.1:7891",
    });

    expect(readFileSync(file, "utf-8")).toContain("data_root = '/tmp/covel'");
    expect(readStoredProxyConfig(tempHome)).toEqual({
      mode: "socks",
      url: "socks5://127.0.0.1:7891",
    });
  });
});
