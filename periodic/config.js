// Address of the EDGAR relay (the same Cloudflare Worker the S-1 Dissector uses, in _s1-dissector-worker/).
// Visitors can override it with ?api=<url>.
window.PX_CONFIG = {
  api: 'https://s1-dissector-edgar.anant-nanocorp.workers.dev'
};
