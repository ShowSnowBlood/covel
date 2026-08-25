import { describe, it, expect, vi, afterEach } from "vitest";
import { openAiImagesWire } from "../src/image/openai-images-wire.js";

const PNG_B64 = Buffer.from(
  "fakepngbytes-fakepngbytes-fakepngbytes-fakepngbytes-fakepng0000",
).toString("base64");

function mockFetchOnce(status: number, json: unknown) {
  const fn = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Request",
    text: async () => JSON.stringify(json),
  })) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return fn;
}

function mockFetchSequence(responses: Response[]) {
  const fn = vi.fn(async () => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("openai-images wire", () => {
  it("posts to /v1/images/generations with normalized endpoint (base without /v1)", async () => {
    const fn = mockFetchOnce(200, { data: [{ b64_json: PNG_B64 }] });
    await openAiImagesWire.generate(
      { baseUrl: "https://api.example.com/", apiKey: "k" },
      { model: "gpt-image-1", prompt: "a cat" },
    );
    expect(fn).toHaveBeenCalledWith(
      "https://api.example.com/v1/images/generations",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not double the /v1 segment", async () => {
    const fn = mockFetchOnce(200, { data: [{ b64_json: PNG_B64 }] });
    await openAiImagesWire.generate(
      { baseUrl: "https://api.example.com/v1", apiKey: "k" },
      { model: "m", prompt: "p" },
    );
    expect(fn).toHaveBeenCalledWith(
      "https://api.example.com/v1/images/generations",
      expect.anything(),
    );
  });

  it("normalizes size separator and includes optional fields only when set", async () => {
    const fn = mockFetchOnce(200, { data: [{ b64_json: PNG_B64 }] });
    await openAiImagesWire.generate(
      { baseUrl: "https://x.test", apiKey: "k" },
      { model: "m", prompt: "p", size: "1024*1536", quality: "high", n: 2 },
    );
    const body = JSON.parse(
      (fn.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body).toEqual({
      model: "m",
      prompt: "p",
      n: 2,
      size: "1024x1536",
      quality: "high",
    });
  });

  it("uses the async task protocol and remaps fixed 2K model sizes", async () => {
    const fn = mockFetchSequence([
      new Response(JSON.stringify({ task_id: "image-task-1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
      new Response(JSON.stringify({ status: "pending" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "retry-after": "0",
        },
      }),
      new Response(
        JSON.stringify({
          status: "completed",
          result: { data: [{ url: "/v1/images/files/result.png" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]);

    const result = await openAiImagesWire.generate(
      { baseUrl: "https://api.example.com/v1", apiKey: "k" },
      {
        model: "openai/gpt-image-2-2k",
        prompt: "a lighthouse",
        size: "1024x1024",
        n: 3,
        providerRequestMetadata: { imagePollIntervalMs: 1 },
      },
    );

    expect(fn.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.com/v1/images/generations/async",
      "https://api.example.com/v1/images/tasks/image-task-1",
      "https://api.example.com/v1/images/tasks/image-task-1",
    ]);
    expect(
      JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string),
    ).toMatchObject({
      model: "openai/gpt-image-2-2k",
      size: "2048x2048",
      n: 1,
    });
    expect(result.images).toEqual([
      {
        kind: "url",
        url: "https://api.example.com/v1/images/files/result.png",
        mime: "image/png",
      },
    ]);
    expect(result.warnings.join(" ")).toMatch(/remapped to 2048x2048/);
    expect(result.warnings.join(" ")).toMatch(/n=3 remapped to n=1/);
  });

  it("maps fixed tiers to the public OpenAI image size catalog", async () => {
    const fn = mockFetchSequence(
      Array.from(
        { length: 3 },
        () =>
          new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    for (const [model, size] of [
      ["gpt-image-2-1k", "1792x1024"],
      ["gpt-image-2-2k", "1024x1792"],
      ["gpt-image-2-4k", "1024x1024"],
    ] as const) {
      await openAiImagesWire.generate(
        { baseUrl: "https://api.example.com/v1", apiKey: "k" },
        {
          model,
          prompt: "a lighthouse",
          size,
          providerRequestMetadata: { imageAsync: false },
        },
      );
    }

    expect(
      fn.mock.calls.map(([_, init]) =>
        JSON.parse((init as RequestInit).body as string),
      ),
    ).toEqual([
      expect.objectContaining({ size: "1536x864" }),
      expect.objectContaining({ size: "1440x2560" }),
      expect.objectContaining({ size: "2880x2880" }),
    ]);
  });

  it("rejects protocol-relative task images outside the provider origin", async () => {
    mockFetchSequence([
      new Response(JSON.stringify({ task_id: "image-task-1" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          status: "completed",
          result: { data: [{ url: "//attacker.test/result.png" }] },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ]);

    await expect(
      openAiImagesWire.generate(
        { baseUrl: "https://api.example.com/v1", apiKey: "k" },
        {
          model: "gpt-image-2-2k",
          prompt: "a lighthouse",
          providerRequestMetadata: { imagePollIntervalMs: 1 },
        },
      ),
    ).rejects.toThrow(/completed without images/);
  });

  it("falls back to synchronous generation when async tasks are unsupported", async () => {
    const fn = mockFetchSequence([
      new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
      new Response(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);

    const result = await openAiImagesWire.generate(
      { baseUrl: "https://api.example.com/v1", apiKey: "k" },
      {
        model: "gpt-image-2-2k",
        prompt: "a lighthouse",
        size: "2048x1152",
      },
    );

    expect(fn.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.com/v1/images/generations/async",
      "https://api.example.com/v1/images/generations",
    ]);
    expect(result.images[0]).toMatchObject({
      kind: "bytes",
      mime: "image/png",
    });
  });

  it("polls Router tasks and downloads authenticated image artifacts", async () => {
    const artifactBytes = Buffer.from("router-image-bytes");
    const fn = mockFetchSequence([
      new Response(JSON.stringify({ message: "not found" }), { status: 404 }),
      new Response(JSON.stringify({ id: "fftask-1", status: "pending" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
      new Response(
        JSON.stringify({ id: "fftask-1", status: "pending", progress: 30 }),
        {
          status: 200,
          headers: { "content-type": "application/json", "retry-after": "0" },
        },
      ),
      new Response(
        JSON.stringify({
          id: "fftask-1",
          status: "success",
          progress: 100,
          artifacts: [
            {
              id: "ffart-1",
              role: "image",
              media_type: "image/webp",
              url: "/v1/tasks/fftask-1/artifacts/ffart-1",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
      new Response(artifactBytes, {
        status: 200,
        headers: {
          "content-type": "image/webp",
          "content-length": String(artifactBytes.length),
        },
      }),
    ]);

    const result = await openAiImagesWire.generate(
      {
        baseUrl: "https://market.example/v1",
        apiKey: "k",
        headers: { "X-FrostFox-Channel-Id": "image" },
      },
      {
        model: "gpt-image-2-2k",
        prompt: "a lighthouse",
        size: "1792x1024",
        providerRequestMetadata: { imagePollIntervalMs: 1 },
      },
    );

    expect(fn.mock.calls.map(([url]) => url)).toEqual([
      "https://market.example/v1/images/generations/async",
      "https://market.example/v1/images/generations",
      "https://market.example/v1/tasks/fftask-1",
      "https://market.example/v1/tasks/fftask-1",
      "https://market.example/v1/tasks/fftask-1/artifacts/ffart-1",
    ]);
    const submission = fn.mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(submission.body as string)).toMatchObject({
      model: "gpt-image-2-2k",
      n: 1,
      size: "2560x1440",
    });
    expect(submission.headers).toMatchObject({
      "Idempotency-Key": expect.any(String),
      "X-FrostFox-Channel-Id": "image",
    });
    expect(result.images[0]).toMatchObject({
      kind: "bytes",
      mime: "image/webp",
      bytes: artifactBytes,
    });
  });

  it("adds background field and no warning when transparent requested", async () => {
    const fn = mockFetchOnce(200, { data: [{ b64_json: PNG_B64 }] });
    const result = await openAiImagesWire.generate(
      { baseUrl: "https://x.test", apiKey: "k" },
      { model: "m", prompt: "p", background: "transparent" },
    );
    const body = JSON.parse(
      (fn.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.background).toBe("transparent");
    expect(result.warnings).toEqual([]);
  });

  it("parses data[] b64_json and url entries", async () => {
    mockFetchOnce(200, {
      data: [{ b64_json: PNG_B64 }, { url: "https://cdn.test/i.png" }],
      output_format: "png",
    });
    const result = await openAiImagesWire.generate(
      { baseUrl: "https://x.test", apiKey: "k" },
      { model: "m", prompt: "p" },
    );
    expect(result.images).toHaveLength(2);
    expect(result.images[0]).toMatchObject({
      kind: "bytes",
      mime: "image/png",
    });
    expect(result.images[1]).toMatchObject({
      kind: "url",
      url: "https://cdn.test/i.png",
    });
  });

  it("parses choices[].message.content[] shim shape", async () => {
    mockFetchOnce(200, {
      choices: [
        { message: { content: [{ image: PNG_B64, mimeType: "image/webp" }] } },
      ],
    });
    const result = await openAiImagesWire.generate(
      { baseUrl: "https://x.test", apiKey: "k" },
      { model: "m", prompt: "p" },
    );
    expect(result.images[0]).toMatchObject({
      kind: "bytes",
      mime: "image/webp",
    });
  });

  it("throws a structured error with the provider message on !ok", async () => {
    mockFetchOnce(400, { error: { message: "bad prompt" } });
    await expect(
      openAiImagesWire.generate(
        { baseUrl: "https://x.test", apiKey: "k" },
        { model: "m", prompt: "p" },
      ),
    ).rejects.toThrow(/bad prompt/);
  });

  it("throws when response contains zero images", async () => {
    mockFetchOnce(200, { data: [] });
    await expect(
      openAiImagesWire.generate(
        { baseUrl: "https://x.test", apiKey: "k" },
        { model: "m", prompt: "p" },
      ),
    ).rejects.toThrow(/no images/i);
  });

  it("strips wire-control metadata but keeps provider request fields", async () => {
    const fn = mockFetchOnce(200, { data: [{ b64_json: PNG_B64 }] });
    await openAiImagesWire.generate(
      { baseUrl: "https://x.test", apiKey: "k" },
      {
        model: "m",
        prompt: "p",
        providerRequestMetadata: {
          imageWire: "openai-images",
          imageAsync: false,
          imagePollIntervalMs: 1,
          style: "vivid",
        },
      },
    );
    const body = JSON.parse(
      (fn.mock.calls[0]![1] as RequestInit).body as string,
    );
    expect(body.style).toBe("vivid");
    expect(body).not.toHaveProperty("imageWire");
    expect(body).not.toHaveProperty("imageAsync");
    expect(body).not.toHaveProperty("imagePollIntervalMs");
  });

  it("records a warning when negativePrompt is provided (unsupported field)", async () => {
    mockFetchOnce(200, { data: [{ b64_json: PNG_B64 }] });
    const result = await openAiImagesWire.generate(
      { baseUrl: "https://x.test", apiKey: "k" },
      { model: "m", prompt: "p", negativePrompt: "ugly" },
    );
    expect(result.warnings.join(" ")).toMatch(/negative-prompt/i);
  });

  it("throws when baseUrl is empty or missing", async () => {
    await expect(
      openAiImagesWire.generate(
        { baseUrl: "", apiKey: "k" },
        { model: "m", prompt: "p" },
      ),
    ).rejects.toThrow(/baseUrl is required/);
    await expect(
      openAiImagesWire.generate({ apiKey: "k" }, { model: "m", prompt: "p" }),
    ).rejects.toThrow(/baseUrl is required/);
  });

  it("throws on non-JSON response body", async () => {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "oops",
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fn);
    await expect(
      openAiImagesWire.generate(
        { baseUrl: "https://x.test", apiKey: "k" },
        { model: "m", prompt: "p" },
      ),
    ).rejects.toThrow(/non-JSON/);
  });
});
