import { lookup as dnsLookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { checkUrl, isBlockedIp, isMetadataIp } from "@/server/ingest/ssrf";

export type SafeFetchKind = "material" | "provider";

function headersFrom(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init) return out;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      out[key] = value;
    });
  } else if (Array.isArray(init)) {
    for (const [key, value] of init) out[key] = value;
  } else {
    Object.assign(out, init);
  }
  return out;
}

function bodyFrom(body: BodyInit | Buffer | null | undefined): Buffer | null {
  if (body === null || body === undefined) return null;
  if (typeof body === "string") return Buffer.from(body, "utf8");
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
  throw new Error("Unsupported request body for safe fetch");
}

/**
 * Fetch with DNS pinning. The custom lookup revalidates every address at
 * connection time, closing the check-then-fetch rebinding window. TLS still
 * verifies the original hostname; only the resolved address is pinned.
 */
export async function safeFetch(
  input: string | URL,
  init: Omit<RequestInit, "body"> & { body?: BodyInit | Buffer | null } = {},
  options: { kind?: SafeFetchKind } = {},
): Promise<Response> {
  const kind = options.kind ?? "provider";
  const raw = typeof input === "string" ? input : input.href;
  const checked = await checkUrl(raw, {
    allowLocalProviders: kind === "provider" && process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS === "1",
  });
  if (!checked.ok) throw new Error(checked.reason);
  const url = checked.url;
  const allowLocal = kind === "provider" && process.env.KAKSHA_ALLOW_LOCAL_PROVIDERS === "1";

  const pinnedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
    if (isIP(hostname)) {
      if (isMetadataIp(hostname) || (!allowLocal && isBlockedIp(hostname))) {
        callback(new Error("Blocked address"), "", 0);
        return;
      }
      const family = isIP(hostname);
      if (lookupOptions.all) {
        callback(null, [{ address: hostname, family }]);
        return;
      }
      callback(null, hostname, family);
      return;
    }
    dnsLookup(hostname, { all: true, family: lookupOptions.family }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const safe = addresses.filter(
        (entry) => !isMetadataIp(entry.address) && (allowLocal || !isBlockedIp(entry.address)),
      );
      if (!safe.length) {
        callback(new Error("No safe address for host"), "", 0);
        return;
      }
      // The caller asks for every address when it has its own family picker,
      // and for one address otherwise. Returning the wrong shape breaks it.
      if (lookupOptions.all) {
        callback(null, safe);
        return;
      }
      callback(null, safe[0].address, safe[0].family);
    });
  };

  const body = bodyFrom(init.body);
  const headers = headersFrom(init.headers);
  if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
    headers["content-length"] = String(body.byteLength);
  }
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init.method ?? "GET",
        headers,
        lookup: pinnedLookup,
        servername: url.hostname,
      },
      (response) => {
        const status = response.statusCode ?? 502;
        if (init.redirect === "error" && status >= 300 && status < 400) {
          response.resume();
          reject(new Error("Provider redirects are not allowed"));
          return;
        }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => responseHeaders.append(key, item));
          else if (value !== undefined) responseHeaders.set(key, String(value));
        }
        const hasBody = status !== 204 && status !== 304 && init.method !== "HEAD";
        resolve(
          new Response(
            hasBody ? (Readable.toWeb(response) as ReadableStream<Uint8Array>) : null,
            { status, statusText: response.statusMessage, headers: responseHeaders },
          ),
        );
      },
    );
    request.on("error", reject);
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error("Request aborted"));
        reject(new Error("Request aborted"));
        return;
      }
      signal.addEventListener("abort", () => request.destroy(new Error("Request aborted")), {
        once: true,
      });
    }
    if (body) request.write(body);
    request.end();
  });
}
