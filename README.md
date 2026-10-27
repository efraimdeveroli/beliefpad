# Belief Pad

Static site (`public/`) plus a small Node API (`server.js`) for launching coins on pump.fun.

## Environment variables (set in Railway, never commit)
- `HELIUS_RPC_URL`  Helius mainnet RPC URL including the api-key
- `PINATA_JWT`      Pinata JWT, used to pin coin images and metadata
- `TREASURY_ADDRESS` Wallet that receives the 30% fee share
- `DATA_DIR`        Folder for coins.json and images. Mount a Railway volume here (e.g. /data)

## Run
`npm install && npm start` (Node 20+). `npm test` runs the API flow against a mock chain.
`MOCK_CHAIN=1` fakes Solana and Pinata for local testing.

## Notes
- On boot the server logs the pump SDK exports (`[sdk] ...`). `lib/pump.js` is the only file that touches the SDK.
- The site HTML in `public/` is built from the `belief-pad` design source.
