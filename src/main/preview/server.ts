/**
 * The live preview's server (`docs/design.md`, "Live preview"): a project's folder at a private
 * loopback address, so HTML an agent writes opens in the chat's browser tab with its relative
 * CSS, images, scripts and ES modules, and the agent can drive the same page.
 *
 * Bound to 127.0.0.1 on a port the system picks. Each folder gets an unguessable token as its first
 * path segment; a request names a token and a path inside that folder, and is answered only when
 * the file, after its links are resolved, is still inside the folder. Nothing is cached, so a
 * reload shows the agent's latest save.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  wasm: "application/wasm",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
};

export class PreviewServer {
  private server: http.Server | null = null;
  private starting: Promise<number> | null = null;
  private readonly roots = new Map<string, string>(); // token -> real folder
  private readonly tokens = new Map<string, string>(); // real folder -> token

  /** The address of `relativePath` inside `root`; the server starts on first use. */
  async urlFor(root: string, relativePath: string): Promise<string> {
    const port = await this.start();
    const real = await fs.realpath(root);
    let token = this.tokens.get(real);
    if (!token) {
      token = randomBytes(16).toString("hex");
      this.tokens.set(real, token);
      this.roots.set(token, real);
    }
    const encoded = relativePath.split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join("/");
    return `http://127.0.0.1:${port}/${token}/${encoded}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.starting = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private start(): Promise<number> {
    this.starting ??= new Promise<number>((resolve, reject) => {
      const server = http.createServer((request, response) => void this.handle(request, response));
      server.on("error", reject);
      // Not a reason to keep the app alive on quit.
      server.unref();
      server.listen(0, "127.0.0.1", () => {
        this.server = server;
        resolve((server.address() as AddressInfo).port);
      });
    });
    return this.starting;
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const refuse = () => {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      response.end("Not found");
    };
    if (request.method !== "GET" && request.method !== "HEAD") return refuse();
    let segments: string[];
    try {
      segments = new URL(request.url ?? "/", "http://127.0.0.1").pathname.split("/").slice(1).map(decodeURIComponent);
    } catch {
      return refuse();
    }
    const root = this.roots.get(segments[0] ?? "");
    if (!root || segments.slice(1).some((segment) => segment === ".." || segment.includes("/") || segment.includes("\\"))) return refuse();
    let file = path.join(root, ...segments.slice(1));
    try {
      let real = await fs.realpath(file);
      if (real !== root && !real.startsWith(root + path.sep)) return refuse();
      if ((await fs.stat(real)).isDirectory()) {
        file = path.join(real, "index.html");
        real = await fs.realpath(file);
        if (!real.startsWith(root + path.sep)) return refuse();
      }
      const body = await fs.readFile(real);
      const extension = path.extname(real).slice(1).toLowerCase();
      response.writeHead(200, {
        "content-type": TYPES[extension] ?? "application/octet-stream",
        "content-length": body.length,
        "cache-control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      refuse();
    }
  }
}

/** The app's one preview server. */
export const previewServer = new PreviewServer();
