import { z } from "zod";
import type {
  GeneratedImageSource,
  ImageGenerationParams,
  ImageGenerationResult,
  ImageWire,
} from "./types.js";
import type { ProviderConfig } from "../types.js";
import {
  assertSuccess,
  getJson,
  isRetriableStatus,
  parseJson,
  parseRetryAfterMs,
  postJson,
  sleepWithAbort,
} from "../adapters/http.js";

/** DashScope-style "1024*1024" → OpenAI "1024x1024". */
function normalizeSize(size: string): string {
  return size.trim().replace("*", "x").toLowerCase();
}

type FixedResolutionTier = 1 | 2 | 4;

const DEFAULT_ASYNC_POLL_MS = 3_000;
const MAX_ASYNC_POLL_MS = 10_000;

function fixedResolutionTier(model: string): FixedResolutionTier | null {
  const match = /-(1k|2k|4k)$/i.exec(model.trim());
  if (match?.[1] === "1k") return 1;
  if (match?.[1] === "2k") return 2;
  if (match?.[1] === "4k") return 4;
  return null;
}

function sizeForFixedTier(
  requestedSize: string | undefined,
  tier: FixedResolutionTier,
): string {
  const normalized = requestedSize ? normalizeSize(requestedSize) : "";
  const dimensions = /^(\d+)x(\d+)$/.exec(normalized);
  const orientation = dimensions
    ? Number(dimensions[1]) > Number(dimensions[2])
      ? "landscape"
      : Number(dimensions[1]) < Number(dimensions[2])
        ? "portrait"
        : "square"
    : "square";

  if (tier === 1) return "1024x1024";
  if (tier === 2) {
    if (orientation === "landscape") return "2048x1152";
    if (orientation === "portrait") return "1152x2048";
    return "2048x2048";
  }
  if (orientation === "landscape") return "3840x2160";
  if (orientation === "portrait") return "2160x3840";
  return "4096x4096";
}

function pollInterval(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(MAX_ASYNC_POLL_MS, Math.floor(value))
    : DEFAULT_ASYNC_POLL_MS;
}

const BARE_B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

const ImageEntrySchema = z
  .object({
    b64_json: z.string().optional(),
    url: z.string().optional(),
    image: z.string().optional(),
    mime: z.string().optional(),
    mimeType: z.string().optional(),
    mediaType: z.string().optional(),
  })
  .passthrough();

const ImageResponseSchema = z
  .object({
    output_format: z.string().optional(),
    data: z.array(ImageEntrySchema).optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({ content: z.array(ImageEntrySchema).optional() })
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const AsyncSubmissionSchema = z
  .object({
    task_id: z.string().optional(),
    taskId: z.string().optional(),
  })
  .passthrough();

const TaskErrorSchema = z.union([
  z.string(),
  z
    .object({
      message: z.string().optional(),
      detail: z.string().optional(),
      code: z.string().optional(),
    })
    .passthrough(),
]);

const AsyncTaskSchema = z
  .object({
    status: z.string(),
    result: ImageResponseSchema.optional(),
    image_url: z.string().optional(),
    error: TaskErrorSchema.optional(),
  })
  .passthrough();

type ImageEntry = z.infer<typeof ImageEntrySchema>;
type AsyncTask = z.infer<typeof AsyncTaskSchema>;

function toImageSource(
  value: string,
  mime: string,
  baseUrl?: string,
): GeneratedImageSource | null {
  if (/^https?:\/\//.test(value)) return { kind: "url", url: value, mime };
  if (value.startsWith("/") && baseUrl) {
    try {
      const base = new URL(baseUrl);
      const resolved = new URL(value, base);
      if (resolved.origin !== base.origin) return null;
      return { kind: "url", url: resolved.toString(), mime };
    } catch {
      return null;
    }
  }
  const dataUri = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(value);
  if (dataUri) {
    return {
      kind: "bytes",
      bytes: Buffer.from(dataUri[2]!, "base64"),
      mime: dataUri[1]!,
    };
  }
  if (value.length >= 64 && value.length % 4 === 0 && BARE_B64_RE.test(value)) {
    return { kind: "bytes", bytes: Buffer.from(value, "base64"), mime };
  }
  return null;
}

function mimeOf(record: ImageEntry, fallback: string): string {
  for (const key of ["mime", "mimeType", "mediaType"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.startsWith("image/")) return value;
  }
  return fallback;
}

function collectImages(
  value: Record<string, unknown>,
  baseUrl?: string,
): GeneratedImageSource[] {
  const parsed = ImageResponseSchema.safeParse(value);
  if (!parsed.success) return [];
  const json = parsed.data;
  const fallbackMime = json.output_format
    ? `image/${json.output_format}`
    : "image/png";
  const out: GeneratedImageSource[] = [];

  for (const record of json.data ?? []) {
    const imageValue = record.b64_json ?? record.url;
    if (!imageValue) continue;
    const src = toImageSource(
      imageValue,
      mimeOf(record, fallbackMime),
      baseUrl,
    );
    if (src) out.push(src);
  }
  if (out.length > 0) return out;

  // Third-party shims nest images under chat-completion shapes.
  for (const choice of json.choices ?? []) {
    for (const record of choice.message?.content ?? []) {
      const imageValue = record.image ?? record.url ?? record.b64_json;
      if (!imageValue) continue;
      const src = toImageSource(
        imageValue,
        mimeOf(record, fallbackMime),
        baseUrl,
      );
      if (src) out.push(src);
    }
  }
  return out;
}

function taskError(value: AsyncTask["error"]): string {
  if (typeof value === "string") {
    return value.trim() || "image generation task failed";
  }
  if (value) {
    for (const key of ["message", "detail", "code"] as const) {
      const detail = value[key];
      if (detail) return detail;
    }
  }
  return "image generation task failed";
}

function completedTaskPayload(task: AsyncTask): Record<string, unknown> {
  if (task.result) return task.result;
  if (task.image_url) return { data: [{ url: task.image_url }] };
  return task;
}

async function generateAsync(
  config: ProviderConfig,
  body: Record<string, unknown>,
  intervalMs: number,
  warnings: string[],
): Promise<ImageGenerationResult | null> {
  const submitted = await postJson(config, "/images/generations/async", body);
  if (submitted.status === 404 || submitted.status === 405) {
    await submitted.arrayBuffer().catch(() => undefined);
    return null;
  }

  const submissionPayload = await parseJson(submitted);
  assertSuccess(submitted, submissionPayload, "openai-images");
  const submission = AsyncSubmissionSchema.parse(submissionPayload);
  const taskId = submission.task_id ?? submission.taskId ?? null;
  if (!taskId) {
    throw new Error("openai-images async endpoint returned no task id");
  }

  let delayMs = intervalMs;
  while (true) {
    const response = await getJson(
      config,
      `/images/tasks/${encodeURIComponent(taskId)}`,
    );
    if (!response.ok && isRetriableStatus(response.status)) {
      const retryAfterMs = parseRetryAfterMs(
        response.headers?.get("retry-after") ?? null,
      );
      await response.arrayBuffer().catch(() => undefined);
      await sleepWithAbort(retryAfterMs ?? delayMs, config.signal);
      delayMs = Math.min(MAX_ASYNC_POLL_MS, Math.round(delayMs * 1.5));
      continue;
    }

    const payload = await parseJson(response);
    assertSuccess(response, payload, "openai-images");
    const task = AsyncTaskSchema.parse(payload);
    if (task.status === "completed") {
      const result = completedTaskPayload(task);
      const images = collectImages(result, config.baseUrl);
      if (images.length === 0) {
        throw new Error("openai-images async task completed without images");
      }
      return { images, usage: null, warnings };
    }
    if (task.status === "failed") {
      throw new Error(
        `openai-images async task failed: ${taskError(task.error)}`,
      );
    }

    const retryAfterMs = parseRetryAfterMs(
      response.headers?.get("retry-after") ?? null,
    );
    await sleepWithAbort(retryAfterMs ?? delayMs, config.signal);
    delayMs = Math.min(MAX_ASYNC_POLL_MS, Math.round(delayMs * 1.5));
  }
}

async function generate(
  config: ProviderConfig,
  params: ImageGenerationParams,
): Promise<ImageGenerationResult> {
  // Wire-control metadata is consumed here and never sent to the provider.
  const {
    imageWire: _ignored,
    imageAsync,
    imagePollIntervalMs,
    ...extra
  } = params.providerRequestMetadata ?? {};
  const tier = fixedResolutionTier(params.model);
  const requestedSize = params.size ? normalizeSize(params.size) : undefined;
  const effectiveSize = tier
    ? sizeForFixedTier(requestedSize, tier)
    : requestedSize;
  const requestedCount = params.n ?? 1;
  const effectiveCount = tier ? 1 : requestedCount;
  const warnings: string[] = [];
  if (requestedSize && effectiveSize !== requestedSize) {
    warnings.push(
      `size ${requestedSize} remapped to ${effectiveSize} for fixed ${tier}K model ${params.model}`,
    );
  }
  if (effectiveCount !== requestedCount) {
    warnings.push(`n=${requestedCount} remapped to n=1 for fixed image model`);
  }
  if (params.negativePrompt) {
    warnings.push(
      "openai-images wire has no negative-prompt field; fold it into the prompt",
    );
  }

  const body: Record<string, unknown> = {
    ...extra,
    model: params.model,
    prompt: params.prompt,
    n: effectiveCount,
    ...(effectiveSize ? { size: effectiveSize } : {}),
    ...(params.quality ? { quality: params.quality } : {}),
    ...(params.background ? { background: params.background } : {}),
  };

  const shouldUseAsync =
    imageAsync === true || (imageAsync !== false && tier !== null);
  if (shouldUseAsync) {
    const result = await generateAsync(
      config,
      body,
      pollInterval(imagePollIntervalMs),
      warnings,
    );
    if (result) return result;
  }

  const response = await postJson(config, "/images/generations", body);
  const payload = await parseJson(response);
  assertSuccess(response, payload, "openai-images");

  const images = collectImages(payload, config.baseUrl);
  if (images.length === 0) {
    throw new Error("openai-images wire: response contained no images");
  }
  return { images, usage: null, warnings };
}

export const openAiImagesWire: ImageWire = { id: "openai-images", generate };
