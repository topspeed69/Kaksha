import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { safeFetch } from "@/server/safe-fetch";

let server: http.Server;
let origin = "";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/ok" });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("pinned safe fetch", () => {
  it("allows loopback providers only when explicitly enabled", async () => {
    const previous = process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
    try {
      delete process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
      await expect(safeFetch(`${origin}/ok`, {}, { kind: "provider" })).rejects.toThrow();
      process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = "1";
      const response = await safeFetch(`${origin}/ok`, {}, { kind: "provider" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, path: "/ok" });
    } finally {
      if (previous === undefined) delete process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
      else process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = previous;
    }
  });

  it("never allows loopback for material ingestion", async () => {
    const previous = process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
    try {
      process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = "1";
      await expect(safeFetch(`${origin}/ok`, {}, { kind: "material" })).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
      else process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = previous;
    }
  });

  it("rejects provider redirects and cloud metadata targets", async () => {
    const previous = process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
    try {
      process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = "1";
      await expect(
        safeFetch(`${origin}/redirect`, { redirect: "error" }, { kind: "provider" }),
      ).rejects.toThrow(/redirect/i);
      await expect(
        safeFetch("http://169.254.169.254/latest/meta-data", {}, { kind: "provider" }),
      ).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
      else process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = previous;
    }
  });

  it("resolves a hostname through the pinned lookup", async () => {
    const previous = process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
    try {
      process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = "1";
      const port = (server.address() as AddressInfo).port;
      const response = await safeFetch(`http://localhost:${port}/ok`, {}, { kind: "provider" });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, path: "/ok" });
    } finally {
      if (previous === undefined) delete process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS;
      else process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS = previous;
    }
  });
});
