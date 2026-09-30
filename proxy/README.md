# summit-sketch-proxy

A Cloudflare Worker that lets the camping finder read Austria's open 1 m elevation data (BEV ALS DTM and DSM, CC BY 4.0) from the browser. `data.bev.gv.at` answers range requests but sends no CORS header; this worker forwards the ranges and adds the header, for the app's own origins only (`ALLOWED_ORIGINS` in `wrangler.toml`). Only `ALS/DTM/...` and `ALS/DSM/...` GeoTIFFs are forwarded, one closed range of at most 4 MiB per request.

## Deploy

From this folder, with a (free) Cloudflare account:

```
npx wrangler@4 login     # opens the browser once to connect wrangler to the account
npx wrangler@4 deploy    # prints the URL, e.g. https://summit-sketch-proxy.<account>.workers.dev
```

Check it: `curl -H "Origin: https://euatarax.github.io" -H "Range: bytes=0-15" https://summit-sketch-proxy.<account>.workers.dev/bev/ALS/DTM/20240915/ALS_DTM_CRS3035RES50000mN2600000E4400000.tif -i` should answer `206` with `Access-Control-Allow-Origin`.

## Optional: R2 block cache

Without a cache every request goes to the BEV. With an R2 bucket the worker keeps each 1 MiB block it fetched and serves it from R2 afterwards, which is faster for users and gentler on the BEV. (The Cloudflare edge cache does not work on `*.workers.dev`, so R2 is the cache.)

1. Enable R2 in the Cloudflare dashboard (Cloudflare asks for a payment method even for the free tier: 10 GB storage, 1 M writes and 10 M reads per month).
2. `npx wrangler@4 r2 bucket create summit-sketch-bev`
3. Uncomment the `[[r2_buckets]]` block in `wrangler.toml` and deploy again.

## Limits and cost

Free Workers plan: 100,000 requests per day. One analysis of a 2 x 2 km box at 1 m reads the file header and about 64 tiles, so roughly 70-100 requests: about a thousand analyses a day for free. The paid plan (USD 5 a month) raises this to 10 million requests a month. Workers have no bandwidth charges.

The tests of the range and block logic run with the app's tests (`npm test`).
