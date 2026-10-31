// Address of your EDGAR relay (the Cloudflare Worker in _s1-dissector-worker/).
// After the first deploy, replace the value below with the URL the GitHub Action prints,
// e.g. "https://s1-dissector-edgar.yourname.workers.dev". Visitors can also override it with ?api=<url>.
window.S1X_CONFIG = {
     api: 'https://s1-dissector-edgar.anant-nanocorp.workers.dev'
};
