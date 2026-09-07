import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.EARTHHISTORY_TEST_PORT ?? 4174);
const dist = path.resolve(process.cwd(), "dist");
const mount = "/EarthHistory/";
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (!url.pathname.startsWith(mount)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const relative = decodeURIComponent(url.pathname.slice(mount.length)) || "index.html";
  let target = path.resolve(dist, relative);
  if (!target.startsWith(`${dist}${path.sep}`) && target !== dist) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(target) || !statSync(target).isFile()) {
    if (path.extname(relative)) {
      response.writeHead(404).end("Not found");
      return;
    }
    target = path.join(dist, "index.html");
  }
  response.writeHead(200, {
    "Content-Type": contentTypes[path.extname(target)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(target).pipe(response);
});

server.listen(port, host, () => console.log(`EarthHistory test server listening on ${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
