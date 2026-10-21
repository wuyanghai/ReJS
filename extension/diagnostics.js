(() => {
  function report(kind, url, directive) {
    chrome.runtime.sendMessage({ type: 'diagnostic', kind, url: String(url || '').startsWith('data:') ? 'data:' : String(url || '').slice(0, 2000), directive }).catch(() => {});
  }
  document.addEventListener('securitypolicyviolation', event => {
    if (event.effectiveDirective.startsWith('script-src') || event.effectiveDirective === 'connect-src') report('csp', event.blockedURI, event.effectiveDirective);
  }, true);
  for (const kind of ['error']) document.addEventListener(kind, event => {
    if (event.target instanceof HTMLScriptElement && event.target.src) report(kind, event.target.src);
  }, true);
})();
