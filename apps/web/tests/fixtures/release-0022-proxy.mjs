// 0.0.22 capture proxy: the 0.0.19 routing (jobs mock 8391, comparison mock 8294) plus GET /v1/projects for the Projects page. Fixtures only.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8300);
const TARGET = (path) => (path.includes("00000000-0000-4000-8000-0000000000d1") ? 8294 : 8391);
const stamp = "2026-11-08T09:00:00Z";
const PROJECTS = ["00000000-0000-4000-8000-0000000000a1", "00000000-0000-4000-8000-0000000000d1"].map((id, i) => ({
  id, organization_id: "00000000-0000-4000-8000-000000000001", name: i ? "Fixture: comparison" : "Fixture: jobs", slug: `fixture-${i}`, role: "owner", created_at: stamp, updated_at: stamp,
}));
http.createServer((req, res) => {
  if (req.method === "GET" && (req.url ?? "").split("?")[0] === "/v1/projects") {
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(PROJECTS));
  }
  const upstream = http.request({ host: "127.0.0.1", port: TARGET(req.url ?? ""), path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(PORT, "127.0.0.1", () => console.log("release-0022 proxy on", PORT));
