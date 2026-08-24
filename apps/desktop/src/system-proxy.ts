/** Convert Electron/Chromium proxy resolution tokens into an Undici URL. */
export function parseElectronProxyResult(result: string): string | undefined {
  for (const entry of result.split(";")) {
    const [rawKind, ...addressParts] = entry.trim().split(/\s+/);
    const kind = rawKind?.toUpperCase();
    const address = addressParts.join("").trim();
    if (!kind || kind === "DIRECT" || !address) continue;
    const scheme =
      kind === "PROXY" || kind === "HTTP"
        ? "http"
        : kind === "HTTPS"
          ? "https"
          : kind === "SOCKS" || kind === "SOCKS5"
            ? "socks5"
            : undefined;
    if (!scheme) continue;
    try {
      return new URL(`${scheme}://${address}`).href.replace(/\/$/, "");
    } catch {
      // Try the next Chromium fallback entry.
    }
  }
  return undefined;
}
