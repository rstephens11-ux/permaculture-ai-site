// assets/js/config.js — the one place the API's address lives.
//
// Empty string = same origin. That's correct when this Mac serves the whole thing (node server/dev.mjs),
// which is how it runs locally and how it should run over the tunnel.
//
// If the pages are hosted somewhere static (GitHub Pages) and the GPU lives at home, set this to the
// tunnel hostname, e.g. "https://api.permacultureai.com". Nothing secret goes here — it's just an address.

window.PA_CONFIG = {
  apiBase: ""
};
