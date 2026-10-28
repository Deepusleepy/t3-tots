// Shared thread lookup for t3ctl and t3listen. Both install flat into the tools folder and require("./thread-match").
// Contract: exact id, else an id prefix of 8+ characters, else one exact title, else one title containing the words
// (newest updatedAt first). Several matches: AMBIGUOUS, never a guess. A short hex-like prefix says it needs 8+ characters.
// NOT_FOUND names t3q.py. strongMatch is an id, an 8+ prefix, or an exact title, so a partial title still checks the archive.
// lookupThread asks loadArchived() (an array of threads) only when the first list has no strong match.
// A failed read is appended to NOT_FOUND; a weak match already in hand is kept; AMBIGUOUS is left as it is.
"use strict";
const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim();
const idLike = (q) => /^[A-Za-z0-9_:-]{8,}$/.test(String(q)); // no whitespace, 8+ chars; colons allowed (thread:project:…)
const strongMatch = (t, q) => { q = String(q); return t.id === q || (q.length >= 8 && String(t.id).startsWith(q)) || norm(t.title) === norm(q); };
function pickThread(all, q) {
  q = String(q);
  const list = (m) => m.slice(0, 8).map((t) => `${t.id}  ${t.title}`).join("\n  ");
  const amb = (m) => { throw new Error(`AMBIGUOUS: ${m.length} threads match "${q}". Pass the full id:\n  ${list(m)}`); };
  const exact = all.find((t) => t.id === q); if (exact) return exact;
  if (q.length >= 8) { const pre = all.filter((t) => String(t.id).startsWith(q)); if (pre.length === 1) return pre[0]; if (pre.length > 1) amb(pre); }
  const same = all.filter((t) => norm(t.title) === norm(q)); if (same.length === 1) return same[0]; if (same.length > 1) amb(same);
  const m = all.filter((t) => norm(t.title).includes(norm(q))).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  if (!m.length) throw new Error(`NOT_FOUND: no thread matches "${q}"${/^[0-9a-f-]{1,7}$/i.test(q) ? " (an id prefix needs 8 or more characters)" : ""}. Find it with: T3_Q='<words>' python3 t3q.py thread`);
  if (m.length > 1) amb(m);
  return m[0];
}
// NOT_FOUND from the lists we could read, plus why the archived list was skipped. Any other error is returned unchanged.
function archiveUnchecked(err, readErr) {
  if (!err || !/^NOT_FOUND/.test(String(err.message))) return err;
  const why = String(readErr && readErr.message != null ? readErr.message : readErr).slice(0, 160);
  return new Error(`${err.message} (T3's archived threads couldn't be checked: ${why})`);
}
async function lookupThread(q, listed, loadArchived) {
  q = String(q);
  let hit = null, miss = null;
  try { hit = pickThread(listed, q); if (strongMatch(hit, q)) return hit; } catch (e) { miss = e; }
  let archived;
  try { archived = await loadArchived(); } catch (err) {
    if (hit) return hit;
    throw archiveUnchecked(miss, err);
  }
  return pickThread([...listed, ...(archived || [])], q);
}
module.exports = { norm, idLike, strongMatch, pickThread, archiveUnchecked, lookupThread };
