export type User = { id: string; username: string; displayName: string };
export type Workspace = { id: string; name: string; role: "owner"|"admin"|"member" };
export type Member = User & { role: "owner"|"admin"|"member" };
export type SessionInfo = { id:string; createdAt:number|null; expiresAt:number; current:boolean };
export type UnreadInfo = { channelId:string; count:number };
export type Channel = { id: string; name: string; workspaceId: string; isPrivate: number; kind?: "channel"|"dm"|"group_dm"; peerName?: string; peerId?: string; memberCount?: number };
export type Reaction = { emoji: string; count: number };
export type Message = { id: string; channelId: string; authorId: string; author: string; body: string; parentId: string|null; createdAt: string; editedAt: string|null; deletedAt: string|null; reactions: Reaction[] };
export type Event = { type: string; channelId?: string; channel?: Channel; message?: Message; workspaceId?: string; conversation?: Channel };
// Recovery always starts with a contiguous recent page, discarding stale
// paginated pages. Keep only WebSocket events newer than that server response
// so messages received while the request was in flight are not lost.
export function reconcileRecentMessages(previous: Message[], recent: Message[]): Message[] {
  if (!recent.length) return [];
  const newest = recent[recent.length - 1];
  const isNewer = (m: Message) => m.createdAt > newest.createdAt ||
    (m.createdAt === newest.createdAt && m.id > newest.id);
  const merged = new Map(recent.map(message => [message.id, message]));
  for (const message of previous.filter(isNewer)) merged.set(message.id, message);
  return [...merged.values()].sort((a,b) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
export async function api<T>(url: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch("/api" + url, {
    method, credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload as T;
}
export function connectEvents(
  onEvent: (event: Event) => void,
  onSessionRevoked?: () => void,
  onRecovered?: () => void,
  onDisconnected?: () => void
): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let needsRecovery = false;
  const url = (location.protocol === "https:" ? "wss://" : "ws://") +
    location.host + "/api/events";
  const scheduleRetry = () => {
    if (stopped || retryTimer !== null) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  };
  const open = () => {
    if (stopped) return;
    try {
      const live = new WebSocket(url);
      socket = live;
      live.onopen = () => {
        if (stopped || socket !== live) return;
        attempts = 0;
        if (needsRecovery) {
          needsRecovery = false;
          onRecovered?.();
        }
      };
      live.onmessage = event => {
        if (stopped || socket !== live) return;
        try { onEvent(JSON.parse(event.data)); }
        catch { /* Malformed optional events cannot disrupt the client. */ }
      };
      // Unexpected transport errors normally lead to close; do not schedule
      // competing retries from both error and close callbacks.
      live.onerror = () => {};
      live.onclose = event => {
        if (stopped || socket !== live) return;
        socket = null;
        if (event.code === 1008) {
          stopped = true;
          onSessionRevoked?.();
          return;
        }
        if (!needsRecovery) onDisconnected?.();
        needsRecovery = true;
        scheduleRetry();
      };
    } catch {
      if (!needsRecovery) onDisconnected?.();
      needsRecovery = true;
      scheduleRetry();
    }
  };
  open();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    const closing = socket;
    socket = null;
    closing?.close();
  };
}
