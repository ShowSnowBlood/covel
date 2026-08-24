import assert from "node:assert/strict";
import { parseElectronProxyResult } from "./system-proxy.js";

assert.equal(
  parseElectronProxyResult("PROXY 127.0.0.1:7890; DIRECT"),
  "http://127.0.0.1:7890",
);
assert.equal(
  parseElectronProxyResult("SOCKS5 127.0.0.1:7891; DIRECT"),
  "socks5://127.0.0.1:7891",
);
assert.equal(parseElectronProxyResult("DIRECT"), undefined);
