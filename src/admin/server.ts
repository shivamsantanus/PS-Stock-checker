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
import {
  PLATFORMS,
  PlatformSwitches,
  loadPlatformSwitches,
  savePlatformSwitches,
} from "../platformStore";
import { buildAllTargets, countTargetsByPlatform } from "../targets";

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

    // --- Platform on/off switches ------------------------------------------
    // GET returns the PLATFORMS metadata joined with the stored switch and the
    // target count each one contributes, so the UI can render the whole toggle
    // list from one call. Counts come from ALL_TARGETS (see targets.ts), which
    // is why a switched-off platform can still show "14 listings".
    if (pathname === "/api/platforms" && req.method === "GET") {
      const [switches, entries] = await Promise.all([loadPlatformSwitches(), loadPincodeEntries()]);
      // Recounted from the pincode file on every request, so Blinkit's and
      // Reliance Digital's numbers stay right after a pincode is added here.
      const counts = countTargetsByPlatform(buildAllTargets(entries));
      sendJson(res, 200, {
        platforms: PLATFORMS.map((p) => ({
          ...p,
          enabled: switches[p.id],
          targetCount: counts[p.id] ?? 0,
        })),
      });
      return;
    }

    // PUT takes a partial map ({ croma: false }) and merges it over what's
    // stored, so toggling one platform can't clobber a concurrent change to
    // another. platformStore.normalize drops unknown keys and non-booleans.
    if (pathname === "/api/platforms" && req.method === "PUT") {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        sendError(res, 400, "Expected an object of { platformId: boolean }");
        return;
      }

      const known = new Set<string>(PLATFORMS.map((p) => p.id));
      const unknown = Object.keys(body).filter((k) => !known.has(k));
      if (unknown.length > 0) {
        sendError(res, 400, `Unknown platform(s): ${unknown.join(", ")}`);
        return;
      }

      const merged = { ...(await loadPlatformSwitches()), ...body } as PlatformSwitches;
      await savePlatformSwitches(merged);
      sendJson(res, 200, merged);
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
  console.log(`Stock checker admin UI running at http://localhost:${PORT}`);
  console.log("Edits write to data/pincodes.json and data/platforms.json - commit & push both for GitHub Actions to pick them up.");
});
