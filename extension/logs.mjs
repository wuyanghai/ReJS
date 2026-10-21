export function appendLog(logs, entry, now = Date.now()) {
  const previous = logs.find(l => l.tabId === entry.tabId);
  if (previous && previous.message === entry.message && previous.url === entry.url && previous.level === entry.level && now - previous.timestamp < 2000) {
    entry = { ...entry, count: (previous.count || 1) + 1 };
    logs = logs.filter(l => l !== previous);
  }
  const counts = new Map();
  return [{ ...entry, timestamp: now, time: new Date(now).toLocaleTimeString(), count: entry.count || 1 }, ...logs]
    .filter(l => { const n = (counts.get(l.tabId) || 0) + 1; counts.set(l.tabId, n); return n <= 100; }).slice(0, 500);
}
