export function replacementHeaders(headers = []) {
  // Retain CORS, cookies and security policy; invalidate original representation metadata.
  const removed = new Set(['content-type','content-length','content-encoding','transfer-encoding','etag','last-modified','content-md5','digest','content-digest','repr-digest','content-range','accept-ranges','location','cache-control','expires']);
  return [...headers.filter(h => !removed.has(h.name.toLowerCase())),
    { name: 'Content-Type', value: 'application/javascript; charset=utf-8' },
    { name: 'Cache-Control', value: 'no-store' }];
}
