// Routes one API base URL to the jobs mock (8391, project …a1) and the comparison mock (8294, project …d1). Fixtures only.
import http from "node:http";
const PORT = Number(process.env.PORT ?? 8300);
const TARGET = (path) => (path.includes("00000000-0000-4000-8000-0000000000d1") ? 8294 : 8391);
http.createServer((req, res) => {
  const upstream = http.request({ host: "127.0.0.1", port: TARGET(req.url ?? ""), path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  upstream.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(PORT, "127.0.0.1", () => console.log("release-0019 proxy on", PORT));
