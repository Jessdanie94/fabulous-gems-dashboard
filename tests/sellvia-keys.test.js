import test from "node:test";
import assert from "node:assert/strict";
import { maskKey, getSellviaApiKey, sellviaRequest, rotateSellviaKey, rotateKeyHandler, _resetForTests } from "../src/sellvia-keys.js";

const quiet = () => { const o = console.log, w = console.warn, e = console.error; console.log = console.warn = console.error = () => {}; return () => { console.log = o; console.warn = w; console.error = e; }; };
const resp = (status) => ({ status, ok: status >= 200 && status < 300 });

test("maskKey hides middle", () => {
  assert.equal(maskKey("sel_abcdef971234"), "sel_****1234");
  assert.equal(maskKey("short"), "****");
});

test("falls back to old key on 401", async () => {
  const restore = quiet();
  _resetForTests();
  process.env.SELLVIA_API_KEY = "sel_newkey00001111";
  process.env.SELLVIA_OLD_API_KEY = "sel_oldkey00002222";
  const seen = [];
  const f = async (_u, init) => { seen.push(init.headers.Authorization); return resp(init.headers.Authorization.includes("newkey") ? 401 : 200); };
  const res = await sellviaRequest("/x", {}, { fetchImpl: f });
  restore();
  assert.equal(res.status, 200);
  assert.equal(seen.length, 2);
  delete process.env.SELLVIA_API_KEY; delete process.env.SELLVIA_OLD_API_KEY;
});

test("rotate validates then swaps; rejects bad key", async () => {
  const restore = quiet();
  _resetForTests();
  process.env.SELLVIA_API_KEY = "sel_current000011";
  const bad = await rotateSellviaKey("sel_badbadbad99", { fetchImpl: async () => resp(401) });
  assert.equal(bad.swapped, false);
  assert.equal(getSellviaApiKey(), "sel_current000011");
  const ok = await rotateSellviaKey("sel_goodgood9999", { fetchImpl: async () => resp(200) });
  restore();
  assert.equal(ok.swapped, true);
  assert.equal(getSellviaApiKey(), "sel_goodgood9999");
  assert.ok(!JSON.stringify(ok).includes("goodgood"));
  delete process.env.SELLVIA_API_KEY;
  _resetForTests();
});

test("admin handler requires X-Admin-Key", async () => {
  process.env.ADMIN_API_KEY = "admin-secret-1";
  const mk = () => { const r = { code: 0, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  const h = rotateKeyHandler({ fetchImpl: async () => resp(200) });
  const r1 = mk();
  await h({ get: () => "wrong", body: {} }, r1);
  assert.equal(r1.code, 401);
  const restore = quiet();
  const r2 = mk();
  await h({ get: () => "admin-secret-1", body: { new_api_key: "sel_validkey12345" } }, r2);
  restore();
  assert.equal(r2.code, 200);
  delete process.env.ADMIN_API_KEY;
  _resetForTests();
});
