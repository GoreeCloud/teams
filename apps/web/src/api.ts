export type User = { id: string; username: string; displayName: string };
export type Workspace = { id: string; name: string; role: "owner"|"admin"|"member" };
export type Member = User & { role: "owner"|"admin"|"member" };
export type SessionInfo = { id:string; createdAt:number|null; expiresAt:number; current:boolean };
export type UnreadInfo = { channelId:string; count:number };
export type Channel = { id: string; name: string; workspaceId: string; isPrivate: number; kind?: "channel"|"dm"|"group_dm"; peerName?: string; peerId?: string; memberCount?: number };
export type Reaction = { emoji: string; count: number };
export type Message = { id: string; channelId: string; authorId: string; author: string; body: string; parentId: string|null; createdAt: string; editedAt: string|null; deletedAt: string|null; reactions: Reaction[] };
export type Event = { type: string; channelId?: string; channel?: Channel; message?: Message; workspaceId?: string; conversation?: Channel };
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
export function connectEvents(onEvent: (event: Event) => void, onSessionRevoked?: () => void): () => void {
  const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/events");
  socket.onmessage = (event) => { try { onEvent(JSON.parse(event.data)); } catch { /* ignore malformed events */ } };
  // A 1008 policy-close from the server signals session revocation/expiry.
  // Ignore ordinary navigation/unmount closures and network interruptions.
  socket.onclose = event => { if (event.code === 1008) onSessionRevoked?.(); };
  return () => socket.close();
}
