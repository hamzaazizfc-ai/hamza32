// خادم مستقل بدون مكتبات: node server.js
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");
const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_FILE || path.join(__dirname, "data.json");
const PASS = process.env.ADMIN_PASSWORD || "hamza123";
if (PASS === "hamza123") console.warn("⚠️  كود البائع الافتراضي مستخدم. يمكنك تغييره عبر ADMIN_PASSWORD=...");

function seed() {
  const m = (o, n, f, e, cat, p, d, x) => [`menu/m${o}`, { n, f, e, cat, p, d, o, on: true, stock: null, x: x || [] }];
  return Object.fromEntries([
    m(1, "برجر لحم", "Burger boeuf", "🍔", "burgers", 8, "لحم بقري، جبن، خس وطماطم", [{ n: "جبن إضافي", p: 1 }, { n: "بيكون", p: 1.5 }]),
    m(2, "برجر دجاج", "Burger poulet", "🥪", "burgers", 7, "دجاج مقرمش مع صلصة خاصة", [{ n: "جبن إضافي", p: 1 }]),
    m(3, "دجاج مقرمش", "Poulet croustillant", "🍗", "chicken", 9, "٤ قطع دجاج مع صلصة", [{ n: "صلصة حارة", p: 0.5 }]),
    m(4, "ناجتس", "Nuggets", "🥡", "chicken", 7, "١٠ قطع ناجتس"),
    m(5, "بيتزا مارجريتا", "Pizza Margherita", "🍕", "pizza", 11, "جبن موزاريلا وصلصة طماطم", [{ n: "زيتون", p: 1 }, { n: "فطر", p: 1.5 }]),
    m(6, "ساندويتش شاورما", "Sandwich shawarma", "🌯", "burgers", 6, "شاورما دجاج بالثوم"),
    m(7, "بطاطس مقلية", "Frites", "🍟", "sides", 3, "حصة كبيرة مقرمشة", [{ n: "جبن ذائب", p: 1 }]),
    m(8, "هوت دوج", "Hot-dog", "🌭", "sides", 5, "سجق مع خردل وكاتشب"),
    m(9, "مشروب غازي", "Soda", "🥤", "drinks", 2, "كوب كبير بارد"),
    m(10, "عصير برتقال", "Jus d'orange", "🍊", "drinks", 3, "عصير طبيعي طازج"),
    ["zones/z1", { name: "وسط المدينة", fee: 2 }], ["zones/z2", { name: "الأحياء القريبة", fee: 3.5 }], ["zones/z3", { name: "أطراف المدينة", fee: 5 }],
    ["coupons/c1", { code: "WELCOME10", pct: 10, pub: true, on: true }],
  ]);
}
const UP = path.join(path.dirname(DATA), "uploads");
try { fs.mkdirSync(UP, { recursive: true }); } catch (e) {}
const MIME = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
function sniff(b) {
  if (b.length > 12 && b[0] === 0xFF && b[1] === 0xD8) return "jpg";
  if (b.length > 8 && b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return "png";
  if (b.length > 12 && b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return "webp";
  return null;
}
const upOf = d => { const m = d && typeof d.img === "string" && /^\/uploads\/([a-f0-9]{24}\.(?:jpg|png|webp))$/.exec(d.img); return m ? m[1] : null; };
function dropUnused(oldD, newD) { const o = upOf(oldD); if (o && o !== upOf(newD)) fs.unlink(path.join(UP, o), () => {}); }
try { fs.mkdirSync(path.dirname(DATA), { recursive: true }); } catch (e) {}
let db; try { db = JSON.parse(fs.readFileSync(DATA, "utf8")); } catch (e) { db = seed(); }
let timer = null;
function save() { clearTimeout(timer); timer = setTimeout(() => fs.writeFile(DATA + ".tmp", JSON.stringify(db), e => { if (!e) fs.rename(DATA + ".tmp", DATA, () => {}); }), 200); }
save();
const tokens = new Set(), tries = new Map();
const list = col => { const pre = col + "/", out = []; for (const k in db) if (k.startsWith(pre) && !k.slice(pre.length).includes("/")) out.push(Object.assign({ id: k.slice(pre.length) }, db[k])); return out; };

function can(p, op, cid, seller) {
  if (seller) return true;
  const s = p.split("/"), r = s[0];
  if (["menu", "zones", "coupons"].includes(r)) return op === "read";
  if (r === "ratings") return op === "read" || (s.length === 2 && s[1] === cid);
  if (r === "orders") return !!cid && s.length === 2 && s[1] === cid && op !== "delete";
  if (r === "data" && s[1] === "users") return !!cid && s[2] === cid;
  return false;
}
const near = (a, b) => Math.abs(a - b) < 0.011;
function checkNew(o) {
  if (!o || o.status !== 0 || !/^o[a-z0-9]{3,20}$/.test(o.id || "")) return "طلب غير صالح";
  if (!String(o.name || "").trim() || String(o.phone || "").replace(/\D/g, "").length < 6 || !String(o.addr || "").trim()) return "بيانات ناقصة";
  if (!Array.isArray(o.items) || !o.items.length || o.items.length > 50) return "سلة غير صالحة";
  let sub = 0;
  for (const i of o.items) {
    const m = db["menu/" + i.id];
    if (!m || m.on === false || !Number.isInteger(i.q) || i.q < 1 || i.q > 50) return "وجبة غير صالحة";
    if (m.stock != null && i.q > m.stock) return "نفد المخزون: " + m.n;
    let unit = m.p;
    for (const n of (i.x ? String(i.x).split("، ") : [])) { const e = (m.x || []).find(x => x.n === n); if (!e) return "إضافة غير صالحة"; unit += e.p; }
    if (!near(unit, i.p)) return "سعر غير صحيح";
    sub += unit * i.q;
  }
  const zs = list("zones"); let fee = 0;
  if (zs.length) { const z = zs.find(z => z.name === o.zoneN); if (!z) return "منطقة غير صالحة"; fee = Number(z.fee) || 0; }
  let disc = 0;
  if (o.coupon) { const c = list("coupons").find(c => String(c.code).toUpperCase() === String(o.coupon).toUpperCase() && c.on !== false); if (!c) return "كود غير صالح"; disc = Math.round(sub * c.pct) / 100; }
  if (!near(o.sub, sub) || !near(o.fee, fee) || !near(o.disc || 0, disc) || !near(o.total, Math.max(0, sub - disc) + fee)) return "المجموع غير صحيح";
  o.ts = Date.now(); return null;
}
function checkOrders(old, nw) {
  const ol = (old && old.orders) || [], nl = nw && nw.orders;
  if (!Array.isArray(nl) || nl.length < ol.length || nl.length > ol.length + 1 || nl.length > 300) return "غير مسموح";
  for (let i = 0; i < ol.length; i++) if (JSON.stringify(nl[i]) !== JSON.stringify(ol[i])) return "غير مسموح";
  return nl.length > ol.length ? checkNew(nl[nl.length - 1]) : null;
}
function checkRatings(d) {
  for (const k in d) { if (!db["menu/" + k] || !Number.isInteger(d[k]) || d[k] < 1 || d[k] > 5) return "تقييم غير صالح"; }
  return null;
}
function readBody(req, max) {
  max = max || 200000;
  return new Promise((ok, no) => { let b = ""; req.on("data", c => { b += c; if (b.length > max) { req.destroy(); no(new Error("big")); } }); req.on("end", () => { try { ok(JSON.parse(b || "{}")); } catch (e) { no(e); } }); });
}
async function api(req, res, u) {
  const send = (c, o) => { res.writeHead(c, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
  const cidH = req.headers["x-cid"], cid = /^[\w-]{8,64}$/.test(cidH || "") ? cidH : null;
  const seller = tokens.has(req.headers["x-token"]);
  const route = u.pathname.slice(5);
  try {
    if (route === "me") return send(200, { seller });
    if (route === "logout") { tokens.delete(req.headers["x-token"]); return send(200, {}); }
    if (route === "login" && req.method === "POST") {
      const ip = req.socket.remoteAddress, t = tries.get(ip) || { n: 0, t: Date.now() };
      if (Date.now() - t.t > 600000) { t.n = 0; t.t = Date.now(); }
      if (t.n >= 8) return send(429, { error: "محاولات كثيرة" });
      t.n++; tries.set(ip, t);
      const { password } = await readBody(req);
      const a = crypto.createHash("sha256").update(String(password || "")).digest(), b = crypto.createHash("sha256").update(PASS).digest();
      if (!crypto.timingSafeEqual(a, b)) return send(401, { error: "كلمة المرور خاطئة" });
      const tok = crypto.randomBytes(24).toString("hex"); tokens.add(tok); tries.delete(ip); return send(200, { token: tok });
    }
    if (route === "upload" && req.method === "POST") {
      if (!seller) return send(403, { error: "denied" });
      const { data } = await readBody(req, 4000000);
      const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
      const buf = m ? Buffer.from(m[1], "base64") : null, ext = buf && sniff(buf);
      if (!ext || buf.length > 2500000) return send(400, { error: "صورة غير صالحة" });
      const name = crypto.randomBytes(12).toString("hex") + "." + ext;
      await fs.promises.writeFile(path.join(UP, name), buf);
      return send(200, { url: "/uploads/" + name });
    }
    const p = u.searchParams.get("path") || "";
    if (!/^[\w-]+(\/[\w.@+~:-]+)*$/.test(p)) return send(400, { error: "path" });
    const odd = p.split("/").length % 2 === 1;
    if (route === "col" && req.method === "GET") {
      if (!odd || !can(p, "read", cid, seller)) return send(403, { error: "denied" });
      return send(200, { docs: list(p).map(d => { const { id, ...rest } = d; return { id, data: rest }; }) });
    }
    if (route !== "doc" || odd) return send(404, { error: "not found" });
    const op = req.method === "GET" ? "read" : req.method === "DELETE" ? "delete" : "write";
    if (!can(p, op, cid, seller)) return send(403, { error: "denied" });
    if (op === "read") return send(200, db[p] ? { exists: true, data: db[p] } : { exists: false });
    if (op === "delete") { if (p.startsWith("menu/")) dropUnused(db[p], null); delete db[p]; save(); return send(200, {}); }
    if (req.method !== "PUT" && req.method !== "PATCH") return send(405, {});
    const body = await readBody(req);
    if (!body || typeof body !== "object" || Array.isArray(body)) return send(400, { error: "body" });
    const data = req.method === "PATCH" ? Object.assign({}, db[p] || {}, body) : body;
    if (!seller) {
      const r = p.split("/")[0]; let e = null;
      if (r === "orders") e = checkOrders(db[p], data); else if (r === "ratings") e = checkRatings(data);
      if (e) return send(400, { error: e });
    }
    if (seller && p.startsWith("menu/")) dropUnused(db[p], data);
    db[p] = data; save(); return send(200, {});
  } catch (e) { return send(400, { error: "bad request" }); }
}
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) return api(req, res, u);
  const um = u.pathname.match(/^\/uploads\/([a-f0-9]{24}\.(jpg|png|webp))$/);
  if (um) return fs.readFile(path.join(UP, um[1]), (e, b) => {
    if (e) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": MIME[um[2]], "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" }); res.end(b);
  });
  fs.readFile(path.join(__dirname, "index.html"), (e, b) => {
    if (e) { res.writeHead(500); return res.end("missing index.html"); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" }); res.end(b);
  });
}).listen(PORT, () => console.log("الموقع يعمل على http://localhost:" + PORT));
