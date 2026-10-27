// Pins the coin image and its metadata JSON to IPFS through Pinata.
const JWT = () => process.env.PINATA_JWT;
const API = 'https://api.pinata.cloud/pinning';
const GATEWAY = process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';

async function pinFetch(path, init) {
  const res = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${JWT()}`, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`Pinata ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function pinImage(buf, mime, name) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: mime }), name);
  const { IpfsHash } = await pinFetch('/pinFileToIPFS', { method: 'POST', body: form });
  return GATEWAY + IpfsHash;
}

export async function pinMetadata(meta, name) {
  const { IpfsHash } = await pinFetch('/pinJSONToIPFS', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataContent: meta, pinataMetadata: { name } }),
  });
  return GATEWAY + IpfsHash;
}
