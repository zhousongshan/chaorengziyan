import { describe, expect, it } from "vitest";

import { assertSupportedNodeRuntime, imageWorkerHeartbeatKey } from "../src/runtime.js";

describe("runtime contract", () => {
  it("accepts Node 24 and rejects unsupported major versions", () => {
    expect(() => assertSupportedNodeRuntime("24.19.0")).not.toThrow();
    expect(() => assertSupportedNodeRuntime("26.5.0")).toThrow(/必须使用 Node\.js 24\.x/);
  });

  it("scopes worker heartbeat keys by queue", () => {
    expect(imageWorkerHeartbeatKey("media-generation")).toBe(
      "chaoren:worker:image:media-generation:heartbeat"
    );
  });
});
