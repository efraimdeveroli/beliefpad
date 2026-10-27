const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isPubkey = (s) => typeof s === 'string' && B58.test(s);

const MIMES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
export const MAX_IMAGE = 2 * 1024 * 1024;

function sniff(buf) {
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const url = (s, hosts) => {
  s = clean(s, 200); if (!s) return '';
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); if (!['http:', 'https:'].includes(u.protocol)) return null;
    if (hosts && !hosts.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))) return null; return u.toString(); } catch { return null; }
};

export function parseLaunch(body) {
  const errors = {};
  const name = clean(body.name, 32);
  const symbol = clean(body.symbol, 10).replace(/^\$/, '').toUpperCase();
  const description = clean(body.description, 500);
  if (name.length < 1) errors.name = 'Add a name (up to 32 characters).';
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) errors.symbol = 'Ticker: 1 to 10 letters or numbers.';
  const twitter = url(body.twitter, ['x.com', 'twitter.com']);
  const telegram = url(body.telegram, ['t.me', 'telegram.me']);
  const website = url(body.website);
  if (twitter === null) errors.twitter = 'Use an x.com link.';
  if (telegram === null) errors.telegram = 'Use a t.me link.';
  if (website === null) errors.website = 'Use a full web link.';
  if (!isPubkey(body.creator)) errors.creator = 'Connect your wallet first.';
  let buySol = Number(body.buySol || 0);
  if (!Number.isFinite(buySol) || buySol < 0 || buySol > 10) errors.buySol = 'First buy: 0 to 10 SOL.';

  let image = null;
  const m = /^data:([\w/+.-]+);base64,(.+)$/.exec(String(body.image || ''));
  if (!m) errors.image = 'Add an image.';
  else {
    const buf = Buffer.from(m[2], 'base64');
    const real = sniff(buf);
    if (buf.length > MAX_IMAGE) errors.image = 'Image is over 2 MB.';
    else if (!real || !MIMES[real]) errors.image = 'Use a PNG, JPG, GIF or WebP image.';
    else image = { buf, mime: real, ext: MIMES[real] };
  }
  return { ok: !Object.keys(errors).length, errors, value: { name, symbol, description, twitter, telegram, website, creator: body.creator, buySol, image } };
}
