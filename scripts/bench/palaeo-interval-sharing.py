#!/usr/bin/env python3
"""Measure cross-interval geometry reuse in shipped EHPR v1 palaeo-coastline payloads.

Read-only. For each surface class and each consecutive published map interval pair
(24 Cao intervals in age order, `lgm` excluded), hash every piece by
(binding entry index, exact ring vertex sequence after int16 quantisation, holes included)
and report shared / unique pieces, a cumulative unique-piece pool, and the same under a
tolerant match (same binding, same ring signature, every vertex within 1 quantisation step).
"""
import hashlib, json, os, statistics, struct, sys

ROOT = "/Volumes/EksternalHome/Koding/HTML/EarthHistory"
BASE = os.path.join(ROOT, "public/data/reconstruction/cao-v2.4/palaeo-coastlines")
CLASSES = ("lm", "sm", "m")
HDR = 32
PIECE_REC = 12
RING_REC = 2
VERT_REC = 4


def piece_bytes(ring_count, vert_count):
    """Bytes this piece contributes to an EHPR payload (piece + ring + vertex records)."""
    return PIECE_REC + RING_REC * ring_count + VERT_REC * vert_count


def load(path):
    with open(path, "rb") as fh:
        buf = fh.read()
    magic, ver, hdr, npieces, nrings, nverts, cls, ivl = struct.unpack_from("<4sHHIIIHH", buf, 0)
    assert magic == b"EHPR" and ver == 1 and hdr == HDR, path
    expect = HDR + PIECE_REC * npieces + RING_REC * nrings + VERT_REC * nverts
    assert expect == len(buf), (path, expect, len(buf))
    ring_off = HDR + PIECE_REC * npieces
    vert_off = ring_off + RING_REC * nrings
    rings = struct.unpack_from("<%dH" % nrings, buf, ring_off)
    verts = struct.unpack_from("<%dh" % (nverts * 2), buf, vert_off)
    pieces, ri, vi = [], 0, 0
    for p in range(npieces):
        _chart, binding, _ev, _lc, _flags, rc = struct.unpack_from("<6H", buf, HDR + PIECE_REC * p)
        sig, coords, pv = [], [], 0
        for _ in range(rc):
            rec = rings[ri]; ri += 1
            n = rec & 0x7FFF
            hole = 1 if rec & 0x8000 else 0
            sig.append((n, hole))
            coords.append(verts[vi * 2:(vi + n) * 2])
            vi += n
            pv += n
        h = hashlib.blake2b(digest_size=16)
        h.update(struct.pack("<H", binding))
        for (n, hole), c in zip(sig, coords):
            h.update(struct.pack("<HH", n, hole))
            h.update(struct.pack("<%dh" % len(c), *c))
        bb = (min(coords[0][0::2]), max(coords[0][0::2]),
              min(coords[0][1::2]), max(coords[0][1::2])) if coords else (0, 0, 0, 0)
        pieces.append({"binding": binding, "sig": tuple(sig), "coords": coords,
                       "verts": pv, "rings": rc, "hash": h.digest(),
                       "bytes": piece_bytes(rc, pv), "bb": bb})
    return {"pieces": pieces, "file_bytes": len(buf), "verts": nverts, "npieces": npieces}


def close(a, b):
    """Every vertex within 1 int16 quantisation step, index-aligned, same ring signature."""
    for ca, cb in zip(a["coords"], b["coords"]):
        for x, y in zip(ca, cb):
            if x - y > 1 or y - x > 1:
                return False
    return True


def bucket_key(p):
    return (p["binding"], p["sig"])


def tolerant_index(pieces):
    idx = {}
    for i, p in enumerate(pieces):
        idx.setdefault(bucket_key(p), []).append(i)
    return idx


def tolerant_match(p, prev_pieces, prev_idx, used):
    """Nearest tolerant candidate in prev interval, or None. Bounding-box prefilter first."""
    for j in prev_idx.get(bucket_key(p), ()):
        if j in used:
            continue
        q = prev_pieces[j]
        bb, qb = p["bb"], q["bb"]
        if abs(bb[0] - qb[0]) > 1 or abs(bb[1] - qb[1]) > 1 or abs(bb[2] - qb[2]) > 1 or abs(bb[3] - qb[3]) > 1:
            continue
        if close(p, q):
            return j
    return None


def pct(a, b):
    return 100.0 * a / b if b else 0.0


def main():
    out = []
    w = out.append
    summary = {}
    for cls in CLASSES:
        cat = json.load(open(os.path.join(BASE, cls, "palaeo-%s-catalog.json" % cls)))
        ivls = cat["intervals"]
        pairs = sorted(zip(ivls["intervalIndex"], ivls["intervalId"]))
        order = [iid for _, iid in pairs if iid != "lgm"]
        assert len(order) == 24, (cls, len(order))
        data = [load(os.path.join(BASE, cls, "palaeo-%s-%s.ehpr" % (cls, iid))) for iid in order]

        # global exact pool
        pool_exact, pool_exact_bytes, pool_exact_verts = set(), 0, 0
        # global tolerant pool: representatives bucketed
        pool_tol_idx, pool_tol_reps, pool_tol_bytes, pool_tol_verts = {}, [], 0, 0
        rows = []
        for k, (iid, d) in enumerate(zip(order, data)):
            ps = d["pieces"]
            tot_b = sum(p["bytes"] for p in ps)
            tot_v = d["verts"]
            for p in ps:
                if p["hash"] not in pool_exact:
                    pool_exact.add(p["hash"]); pool_exact_bytes += p["bytes"]; pool_exact_verts += p["verts"]
                bk = bucket_key(p)
                lst = pool_tol_idx.setdefault(bk, [])
                hit = None
                for j in lst:
                    q = pool_tol_reps[j]
                    bb, qb = p["bb"], q["bb"]
                    if abs(bb[0]-qb[0])>1 or abs(bb[1]-qb[1])>1 or abs(bb[2]-qb[2])>1 or abs(bb[3]-qb[3])>1:
                        continue
                    if close(p, q):
                        hit = j; break
                if hit is None:
                    pool_tol_reps.append(p); lst.append(len(pool_tol_reps) - 1)
                    pool_tol_bytes += p["bytes"]; pool_tol_verts += p["verts"]
            if k == 0:
                rows.append({"id": iid, "pieces": len(ps), "bytes": d["file_bytes"], "verts": tot_v,
                             "sh_e": None, "shv_e": None, "un_e": None, "db_e": None,
                             "sh_t": None, "shv_t": None, "un_t": None, "db_t": None,
                             "pool_e_b": pool_exact_bytes, "pool_t_b": pool_tol_bytes})
                continue
            prev = data[k - 1]["pieces"]
            prev_h = {}
            for q in prev:
                prev_h[q["hash"]] = prev_h.get(q["hash"], 0) + 1
            avail = dict(prev_h)
            sh_e = shv_e = 0; unique_e_b = 0
            unmatched = []
            for p in ps:
                if avail.get(p["hash"], 0) > 0:
                    avail[p["hash"]] -= 1; sh_e += 1; shv_e += p["verts"]
                else:
                    unique_e_b += p["bytes"]; unmatched.append(p)
            # tolerant: exact matches count too, then try tolerant on the remainder
            pidx = tolerant_index(prev)
            used = set()
            sh_t, shv_t, unique_t_b = sh_e, shv_e, 0
            for p in unmatched:
                j = tolerant_match(p, prev, pidx, used)
                if j is None:
                    unique_t_b += p["bytes"]
                else:
                    used.add(j); sh_t += 1; shv_t += p["verts"]
            rows.append({"id": iid, "pieces": len(ps), "bytes": d["file_bytes"], "verts": tot_v,
                         "sh_e": sh_e, "shv_e": shv_e, "un_e": len(ps) - sh_e, "db_e": HDR + unique_e_b,
                         "sh_t": sh_t, "shv_t": shv_t, "un_t": len(ps) - sh_t, "db_t": HDR + unique_t_b,
                         "pool_e_b": pool_exact_bytes, "pool_t_b": pool_tol_bytes})

        summed = sum(d["file_bytes"] for d in data)
        de = [pct(r["db_e"], r["bytes"]) for r in rows[1:]]
        dt = [pct(r["db_t"], r["bytes"]) for r in rows[1:]]
        summary[cls] = {
            "summed": summed,
            "pool_e": HDR + pool_exact_bytes, "pool_t": HDR + pool_tol_bytes,
            "pool_e_verts": pool_exact_verts, "pool_t_verts": pool_tol_verts,
            "verts_total": sum(d["verts"] for d in data),
            "pieces_total": sum(d["npieces"] for d in data),
            "pool_e_pieces": len(pool_exact), "pool_t_pieces": len(pool_tol_reps),
            "med_e": statistics.median(de), "med_t": statistics.median(dt),
            "best_e": min(zip(de, [r["id"] for r in rows[1:]])), "worst_e": max(zip(de, [r["id"] for r in rows[1:]])),
            "best_t": min(zip(dt, [r["id"] for r in rows[1:]])), "worst_t": max(zip(dt, [r["id"] for r in rows[1:]])),
            "rows": rows,
        }
        w("\n## class %s  (%d intervals)\n" % (cls, len(order)))
        w("| interval | pieces | KiB | shared(exact) | vtx% | uniq | deltaKiB | %ivl | shared(tol) | vtx% | uniq | deltaKiB | %ivl |")
        w("|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|")
        for r in rows:
            if r["sh_e"] is None:
                w("| %s | %d | %.1f | - | - | - | %.1f | 100.0 | - | - | - | %.1f | 100.0 |" %
                  (r["id"], r["pieces"], r["bytes"]/1024, r["bytes"]/1024, r["bytes"]/1024))
            else:
                w("| %s | %d | %.1f | %d | %.1f | %d | %.1f | %.1f | %d | %.1f | %d | %.1f | %.1f |" % (
                    r["id"], r["pieces"], r["bytes"]/1024,
                    r["sh_e"], pct(r["shv_e"], r["verts"]), r["un_e"], r["db_e"]/1024, pct(r["db_e"], r["bytes"]),
                    r["sh_t"], pct(r["shv_t"], r["verts"]), r["un_t"], r["db_t"]/1024, pct(r["db_t"], r["bytes"])))
    w("\n## summary\n")
    w("| class | summed KiB | exact pool KiB | pool/summed | tol pool KiB | pool/summed | median delta exact | median delta tol | best (exact) | worst (exact) |")
    w("|---|--:|--:|--:|--:|--:|--:|--:|---|---|")
    tS = tE = tT = 0
    for cls in CLASSES:
        s = summary[cls]
        tS += s["summed"]; tE += s["pool_e"]; tT += s["pool_t"]
        w("| %s | %.1f | %.1f | %.1f%% | %.1f | %.1f%% | %.1f%% | %.1f%% | %s %.1f%% | %s %.1f%% |" % (
            cls, s["summed"]/1024, s["pool_e"]/1024, pct(s["pool_e"], s["summed"]),
            s["pool_t"]/1024, pct(s["pool_t"], s["summed"]), s["med_e"], s["med_t"],
            s["best_e"][1], s["best_e"][0], s["worst_e"][1], s["worst_e"][0]))
    w("| **all** | %.1f | %.1f | %.1f%% | %.1f | %.1f%% | | | | |" % (
        tS/1024, tE/1024, pct(tE, tS), tT/1024, pct(tT, tS)))
    w("")
    for cls in CLASSES:
        s = summary[cls]
        w("- %s: pieces %d total -> exact pool %d (%.1f%%), tolerant pool %d (%.1f%%); vertices %d -> %d exact / %d tolerant" % (
            cls, s["pieces_total"], s["pool_e_pieces"], pct(s["pool_e_pieces"], s["pieces_total"]),
            s["pool_t_pieces"], pct(s["pool_t_pieces"], s["pieces_total"]),
            s["verts_total"], s["pool_e_verts"], s["pool_t_verts"]))
        w("  best/worst tolerant crossing: %s %.1f%% / %s %.1f%%" % (
            s["best_t"][1], s["best_t"][0], s["worst_t"][1], s["worst_t"][0]))
    # all-class median across the 23 crossings, bytes-weighted per crossing
    for tag, ke, kb in (("exact", "db_e", "bytes"), ("tolerant", "db_t", "bytes")):
        vals = []
        for k in range(1, 24):
            num = sum(summary[c]["rows"][k][ke] for c in CLASSES)
            den = sum(summary[c]["rows"][k][kb] for c in CLASSES)
            vals.append(pct(num, den))
        w("- all-class per-crossing delta (%s), median %.1f%%, min %.1f%%, max %.1f%%" % (
            tag, statistics.median(vals), min(vals), max(vals)))
    print("\n".join(out))


if __name__ == "__main__":
    main()
