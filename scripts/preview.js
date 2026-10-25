import http from "node:http";
import { readFile } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const files = new Map([
  ["/", ["demo/index.html", "text/html; charset=utf-8"]],
  ["/thermal-monitor-card.js", ["dist/thermal-monitor-card.js", "text/javascript; charset=utf-8"]],
]);
const server = http.createServer(async (request, response) => {
  const entry = files.get(new URL(request.url, "http://127.0.0.1").pathname);
  if (!entry) { response.writeHead(404); response.end(); return; }
  try {
    const data = await readFile(new URL(entry[0], root));
    response.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(data);
  } catch { response.writeHead(500); response.end("Run npm run build first"); }
});
server.listen(37993, "127.0.0.1", () => console.log("Simulated-data preview: http://127.0.0.1:37993/ — send stop on stdin to close"));
process.stdin.on("data", data => { if (String(data).trim() === "stop") server.close(() => process.exit(0)); });
