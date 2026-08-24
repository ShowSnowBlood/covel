import { createServer } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getJson } from "../src/adapters/http.js";
import {
  configureOutboundProxy,
  normalizeOutboundProxyConfig,
  resetOutboundProxyForTests,
} from "../src/outbound-network.js";

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await resetOutboundProxyForTests();
});

describe("outbound network transport", () => {
  it("pairs an npm Undici dispatcher with npm Undici fetch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const incompatibleGlobalFetch = vi.fn().mockRejectedValue(
      new TypeError("fetch failed", {
        cause: new Error("invalid onRequestStart method"),
      }),
    );
    vi.stubGlobal("fetch", incompatibleGlobalFetch);

    const target = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const { port } = target.address() as AddressInfo;

    try {
      const response = await getJson(
        { baseUrl: `http://127.0.0.1:${port}` },
        "/models",
      );
      expect(response.status).toBe(200);
      expect(incompatibleGlobalFetch).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("normalizes the compact HTTP and SOCKS5 settings", () => {
    expect(
      normalizeOutboundProxyConfig({ mode: "http", url: "127.0.0.1:7890" }),
    ).toEqual({ mode: "http", url: "http://127.0.0.1:7890" });
    expect(
      normalizeOutboundProxyConfig({ mode: "socks", url: "127.0.0.1:7891" }),
    ).toEqual({ mode: "socks", url: "socks5://127.0.0.1:7891" });
    expect(
      normalizeOutboundProxyConfig({
        mode: "socks",
        url: "socks://127.0.0.1:7891",
      }),
    ).toEqual({ mode: "socks", url: "socks5://127.0.0.1:7891" });
    expect(() =>
      normalizeOutboundProxyConfig({
        mode: "http",
        url: "socks5://127.0.0.1:7891",
      }),
    ).toThrow(/HTTP/i);
  });

  it("routes core provider requests through an HTTP proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    let proxyConnections = 0;
    const target = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"proxied":true}');
    });
    await new Promise<void>((resolve) =>
      target.listen(0, "127.0.0.1", resolve),
    );
    const targetPort = (target.address() as AddressInfo).port;

    const proxy = createServer();
    proxy.on("connect", (req, clientSocket, head) => {
      proxyConnections += 1;
      const [hostname, rawPort] = (req.url ?? "").split(":");
      const upstream = connect(Number(rawPort), hostname);
      upstream.once("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const proxyPort = (proxy.address() as AddressInfo).port;

    try {
      configureOutboundProxy({
        mode: "http",
        url: `http://127.0.0.1:${proxyPort}`,
      });
      const response = await getJson(
        { baseUrl: `http://127.0.0.1:${targetPort}` },
        "/models",
      );
      expect(await response.json()).toEqual({ proxied: true });
      expect(proxyConnections).toBe(1);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  });

  it("surfaces the nested transport cause", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1"), {
            code: "ECONNREFUSED",
          }),
        }),
      ),
    );

    await expect(
      getJson({ baseUrl: "https://provider.example" }, "/models"),
    ).rejects.toThrow(/ECONNREFUSED.*connect ECONNREFUSED/);
  });
});
