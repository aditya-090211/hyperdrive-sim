// Bind broadcast identities to ephemeral signing keys. Public room membership
// is still invite-code based; signatures prevent another member impersonating a peer.
const enc = new TextEncoder();
const b64 = (a) => btoa(String.fromCharCode(...new Uint8Array(a)));
const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const fingerprint = async (raw) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map((n) => n.toString(16).padStart(2, '0')).join('');
export class SignedRoom {
  static async create(code) {
    const s = new SignedRoom();
    s.code = code; s.seq = 0; s.seen = new Map();
    s.pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const raw = await crypto.subtle.exportKey('raw', s.pair.publicKey);
    s.key = b64(raw); s.id = await fingerprint(raw);
    return s;
  }
  async sign(event, payload) {
    const body = { event, code: this.code, seq: ++this.seq, key: this.key, payload: { ...payload, from: this.id } };
    const sig = b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.pair.privateKey, enc.encode(JSON.stringify(body))));
    return { body, sig };
  }
  async verify(event, envelope) {
    try {
      if (!envelope || JSON.stringify(envelope).length > 250000) return null;
      const { body, sig } = envelope;
      if (!body || body.event !== event || body.code !== this.code || !Number.isSafeInteger(body.seq) || body.seq < 1 || typeof body.key !== 'string' || body.key.length > 100 || typeof sig !== 'string' || sig.length > 100) return null;
      const raw = un64(body.key), id = await fingerprint(raw);
      if (body.payload?.from !== id) return null;
      const key = await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, un64(sig), enc.encode(JSON.stringify(body)))) return null;
      let rec = this.seen.get(id);
      if (!rec) {
        if (this.seen.size >= 128) return null;
        rec = { high: 0, seqs: new Set() }; this.seen.set(id, rec);
      }
      if (body.seq <= rec.high - 256 || rec.seqs.has(body.seq)) return null;
      rec.high = Math.max(rec.high, body.seq); rec.seqs.add(body.seq);
      for (const n of rec.seqs) if (n <= rec.high - 256) rec.seqs.delete(n);
      return body.payload;
    } catch { return null; }
  }
}
