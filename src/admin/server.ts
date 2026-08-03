import http from "http";
import fs from "fs";
import path from "path";
import {
  PincodeEntry,
  loadPincodeEntries,
  savePincodeEntries,
  generateId,
  validatePincodeInput,
} from "../pincodeStore";

const PORT = parseInt(process.env.ADMIN_PORT || "4321", 10);
const PUBLIC_DIR = path.join(__dirname, "public");

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

function entryFromBody(body: any): { pincode: string; city: string; searchText: string; quickCommerce: boolean; relianceDigital: boolean } {
  return {
    pincode: typeof body.pincode === "string" ? body.pincode.trim() : body.pincode,
    city: typeof body.city === "string" ? body.city.trim() : body.city,
    searchText: typeof body.searchText === "string" ? body.searchText.trim() : "",
    quickCommerce: Boolean(body.quickCommerce),
    relianceDigital: Boolean(body.relianceDigital),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);
    const { pathname } = url;

    if (req.method === "GET" && pathname === "/") {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (pathname === "/api/pincodes" && req.method === "GET") {
      sendJson(res, 200, await loadPincodeEntries());
      return;
    }

    if (pathname === "/api/pincodes" && req.method === "POST") {
      const body = await readJsonBody(req);
      const fields = entryFromBody(body);
      const errors = validatePincodeInput(fields);
      if (errors.length > 0) {
        sendError(res, 400, errors.map((e) => e.message).join("; "));
        return;
      }

      const entries = await loadPincodeEntries();
      const existingIds = new Set(entries.map((e) => e.id));
      const entry: PincodeEntry = { id: generateId(fields.pincode, fields.city, existingIds), ...fields };
      entries.push(entry);
      await savePincodeEntries(entries);
      sendJson(res, 201, entry);
      return;
    }

    const idMatch = pathname.match(/^\/api\/pincodes\/([^/]+)$/);
    if (idMatch && (req.method === "PUT" || req.method === "DELETE")) {
      const id = decodeURIComponent(idMatch[1]);
      const entries = await loadPincodeEntries();
      const index = entries.findIndex((e) => e.id === id);
      if (index === -1) {
        sendError(res, 404, "Pincode not found");
        return;
      }

      if (req.method === "DELETE") {
        entries.splice(index, 1);
        await savePincodeEntries(entries);
        sendJson(res, 200, { ok: true });
        return;
      }

      const body = await readJsonBody(req);
      const fields = entryFromBody(body);
      const errors = validatePincodeInput(fields);
      if (errors.length > 0) {
        sendError(res, 400, errors.map((e) => e.message).join("; "));
        return;
      }

      entries[index] = { id, ...fields };
      await savePincodeEntries(entries);
      sendJson(res, 200, entries[index]);
      return;
    }

    sendError(res, 404, "Not found");
  } catch (err) {
    sendError(res, 500, err instanceof Error ? err.message : "Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`Pincode admin UI running at http://localhost:${PORT}`);
  console.log("Edits write to data/pincodes.json - commit & push that file for GitHub Actions to pick them up.");
});
