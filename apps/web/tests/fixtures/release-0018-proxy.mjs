// Routes one API base URL to the three presentation-fixture mocks by project id (settings 8292, claims 8293, comparison 8294).
// Fixtures only; used by playwright.release-0018.config.ts so a single `next dev` can serve all three surfaces.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8295);
const TARGET = (path) => {
  if (path.includes("00000000-0000-4000-8000-0000000000a1")) return 8293;
  if (path.includes("00000000-0000-4000-8000-0000000000d1")) return 8294;
  return 8292;
};
http.createServer((req, res) => {
  const upstream = http.request({ host: "127.0.0.1", port: TARGET(req.url ?? ""), path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(PORT, "127.0.0.1", () => console.log("release-0018 proxy on", PORT));
