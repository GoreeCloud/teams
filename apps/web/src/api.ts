export type User = { id: string; username: string; displayName: string };
export type Workspace = { id: string; name: string; role: "owner"|"admin"|"member" };
export type Channel = { id: string; name: string; workspaceId: string; isPrivate: number };
export type Reaction = { emoji: string; count: number };
export type Message = { id: string; channelId: string; authorId: string; author: string; body: string; parentId: string|null; createdAt: string; editedAt: string|null; deletedAt: string|null; reactions: Reaction[] };
export type Event = { type: string; channelId?: string; message?: Message };
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
export function connectEvents(onEvent: (event: Event) => void): () => void {
  const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/events");
  socket.onmessage = (event) => { try { onEvent(JSON.parse(event.data)); } catch { /* ignore malformed events */ } };
  return () => socket.close();
}
