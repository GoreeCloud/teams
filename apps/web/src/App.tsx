import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, Hash, LockKeyhole, LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Bookmark, Reply, Search, Send, ShieldCheck, Smile, Sparkles, Trash2, UserPlus, Users, X, Pencil, Pin, PinOff } from "lucide-react";
import { api, connectEvents, reconcileRecentMessages, type Channel, type Event, type Member, type Message, type SessionInfo, type SavedEntry, type UnreadInfo, type User, type Workspace } from "./api";

const shortTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const errorMessage = (err: unknown) => err instanceof Error ? err.message : "Something went wrong";

function Avatar({ name, size = "normal" }: { name: string; size?: "normal" | "small" }) {
  return <span className={"avatar " + (size === "small" ? "avatar-sm" : "")} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}
function Welcome({ bootstrap, requireOwnerToken, onLogin }: { bootstrap: boolean; requireOwnerToken: boolean; onLogin: () => void }) {
  const [register, setRegister] = useState(bootstrap);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [ownerToken, setOwnerToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await api("/auth/" + (register ? "register" : "login"), "POST",
        register ? { username, displayName, password, invite: invite || undefined, bootstrapToken: bootstrap ? ownerToken : undefined } : { username, password });
      onLogin();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return <main className="auth-layout"><div className="auth-ambient" />
    <section className="auth-card">
      <div className="auth-mark"><Sparkles size={24}/></div>
      <p className="eyebrow">A calmer way to work together</p>
      <h1>{register ? (bootstrap ? "Create your space." : "Join your team.") : "Welcome back."}</h1>
      <p className="muted">One place for conversations, clarity, and everything your team is building.</p>
      <form onSubmit={submit} className="auth-form">
        <label>Username<input autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={e => setUsername(e.target.value)} placeholder="yourname" /></label>
        {register && <label>Display name<input autoComplete="name" required maxLength={80} value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="How your team sees you" /></label>}
        <label>Password<input type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 12 : undefined} required value={password} onChange={e => setPassword(e.target.value)} placeholder={register ? "At least 12 characters" : "Your password"} /></label>
        {register && bootstrap && requireOwnerToken && <label>Owner setup token<input type="password" autoComplete="off" required minLength={32} maxLength={256} value={ownerToken} onChange={e => setOwnerToken(e.target.value)} placeholder="Private operator token from server configuration" /></label>}
        {register && !bootstrap && <label>Invitation code<input required value={invite} onChange={e => setInvite(e.target.value)} placeholder="Paste an invitation code" /></label>}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"} <span aria-hidden="true">→</span></button>
      </form>
      {!bootstrap && <button className="text-button" onClick={() => { setRegister(!register); setError(""); }}>{register ? "Already have an account? Sign in" : "Have an invite? Create an account"}</button>}
      <div className="auth-footer"><ShieldCheck size={15}/> Self-hosted by you · Private by design</div>
    </section>
    <aside className="auth-side"><div className="brand-lockup"><span className="brand-symbol">✳</span> GoreeCloud <strong>Teams</strong></div>
      <div className="auth-message"><span className="pill">GOOD WORK HAPPENS HERE</span><h2>Less noise.<br/>More momentum.</h2><p>Channels, conversations, and shared context — thoughtfully connected, always under your control.</p></div>
      <div className="auth-side-foot">The workspace belongs to you.</div>
    </aside>
  </main>;
}
function MessageRow({ message, me, onReply, onReaction, onEdit, onDelete, onSave, saved, saving, onPin, canModerate = false }: {
  message: Message; me: User; onReply: (message: Message) => void; onReaction: (message: Message, emoji: string) => void;
  onEdit: (message: Message) => void; onDelete: (message: Message) => void;
  onSave: (message: Message) => void; saved: boolean; saving: boolean;
  onPin?: (message: Message) => void; canModerate?: boolean;
}) {
  return <article className="message" tabIndex={0} aria-label={"Message from " + message.author}>
    <Avatar name={message.author}/>
    <div className="message-content"><div className="message-head"><strong>{message.author}</strong><time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>{message.editedAt && <span className="edited">edited</span>}{message.pinnedBy && <span className="pinned-indicator"><Pin size={12}/> Pinned</span>}</div>
      {message.deletedAt ? <p className="deleted">Message deleted</p> : <p className="message-body">{message.body}</p>}
      <div className="reaction-row">{message.reactions.map(reaction =>
        <button key={reaction.emoji} className="reaction" onClick={() => onReaction(message, reaction.emoji)} aria-label={"Toggle " + reaction.emoji + " reaction"}>{reaction.emoji} {reaction.count}</button>)}
      </div>
    </div>
    {!message.deletedAt && <div className="message-actions">
      <button title={saved ? "Remove from saved" : "Save for later"} aria-label={saved ? "Remove saved message" : "Save message for later"} aria-pressed={saved} disabled={saving} onClick={() => onSave(message)}><Bookmark size={17} fill={saved ? "currentColor" : "none"}/></button>
      <button title="React with thumbs up" aria-label="React with thumbs up" onClick={() => onReaction(message, "👍")}><Smile size={17}/></button>
      {onPin && (!message.pinnedBy || message.pinnedBy === me.id || canModerate) &&
        <button title={message.pinnedBy ? "Unpin message" : "Pin message"} aria-label={message.pinnedBy ? "Unpin message" : "Pin message"} onClick={() => onPin(message)}>{message.pinnedBy ? <PinOff size={16}/> : <Pin size={16}/>}</button>}
      {!message.parentId && <button title="Reply in thread" aria-label="Reply in thread" onClick={() => onReply(message)}><Reply size={17}/></button>}
      {message.authorId === me.id && <button title="Edit message" aria-label="Edit message" onClick={() => onEdit(message)}><Pencil size={16}/></button>}
      {message.authorId === me.id && <button title="Delete message" aria-label="Delete message" onClick={() => onDelete(message)}><Trash2 size={16}/></button>}
    </div>}
  </article>;
}
function Composer({ channelName, onSend, parent, direct }: { channelName: string; parent?: boolean; direct?: boolean; onSend: (value: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!text.trim() || busy) return; setBusy(true);
    try { await onSend(text.trim()); setText(""); } finally { setBusy(false); }
  }
  return <div className="composer"><textarea aria-label={parent ? "Write a thread reply" : "Write a message"} rows={2} value={text} maxLength={4000}
    placeholder={parent ? "Reply in thread…" : direct ? "Message " + channelName : "Message #" + channelName}
    onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}/>
    <div className="composer-footer"><span>↵ to send · Shift + ↵ for a new line</span><button aria-label="Send message" onClick={() => void send()} disabled={!text.trim() || busy}><Send size={18}/></button></div>
  </div>;
}
export default function App() {
  const [user, setUser] = useState<User|null>(null);
  const [bootstrap, setBootstrap] = useState(false);
  const [requireOwnerToken, setRequireOwnerToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace|null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Channel[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [channel, setChannel] = useState<Channel|null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [thread, setThread] = useState<Message|null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [hasOlderReplies, setHasOlderReplies] = useState(false);
  const [loadingOlderReplies, setLoadingOlderReplies] = useState(false);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]|null>(null);
  const [showPins, setShowPins] = useState(false);
  const [pins, setPins] = useState<Message[]>([]);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [unreadCounts, setUnreadCounts] = useState<Record<string,number>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedEntries, setSavedEntries] = useState<SavedEntry[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [hasOlderSaved, setHasOlderSaved] = useState(false);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savingMessageId, setSavingMessageId] = useState<string|null>(null);
  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [channelMembers, setChannelMembers] = useState<Member[]>([]);
  const [channelMemberBusy, setChannelMemberBusy] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const scrollViewport = useRef<HTMLDivElement>(null);
  const threadViewport = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<{height:number;top:number}|null>(null);
  const pendingThreadScroll = useRef<{height:number;top:number}|null>(null);
  const skipBottomScroll = useRef(false);
  const currentChannelId = useRef<string|null>(null);
  const currentWorkspaceId = useRef<string|null>(null);
  const unreadRequestGeneration = useRef(0);
  const searchIsOpen = useRef(false);
  const savedVisible = useRef(false);
  savedVisible.current = showSaved;
  searchIsOpen.current = searchResults !== null || showSaved;
  currentChannelId.current = channel?.id || null;
  currentWorkspaceId.current = workspace?.id || null;
  const conversationVisible = () => document.visibilityState === "visible" && document.hasFocus();
  const refreshUnread = (workspaceId: string) => {
    const generation = ++unreadRequestGeneration.current;
    void api<UnreadInfo[]>("/workspaces/" + workspaceId + "/unread")
      .then(rows => {
        if (currentWorkspaceId.current === workspaceId && generation === unreadRequestGeneration.current) {
          setUnreadCounts(Object.fromEntries(rows.map(row => [row.channelId,row.count])));
        }
      })
      .catch(() => { /* Keep the prior counts until the next authenticated fetch. */ });
  };
  const acknowledgeRead = (channelId: string, messageId: string) => {
    void api("/channels/" + channelId + "/read", "POST", { messageId })
      .then(() => {
        if (currentChannelId.current === channelId && currentWorkspaceId.current) {
          refreshUnread(currentWorkspaceId.current);
        }
      })
      .catch(() => { /* Never advertise read success when the server rejected it. */ });
  };
  const refreshSavedIds = (workspaceId: string) => {
    void api<string[]>("/workspaces/" + workspaceId + "/saved-ids")
      .then(ids => {
        if (currentWorkspaceId.current === workspaceId) setSavedIds(new Set(ids));
      }).catch(() => { /* Preserve the prior state across transient transport errors. */ });
  };
  const refreshSavedEntries = async (workspaceId: string) => {
    setSavedLoading(true);
    try {
      const list = await api<SavedEntry[]>("/workspaces/" + workspaceId + "/saved");
      if (currentWorkspaceId.current === workspaceId) {
        setSavedEntries(list); setHasOlderSaved(list.length === 50);
      }
    } catch (err) {
      if (currentWorkspaceId.current === workspaceId) setNotice(errorMessage(err));
    } finally {
      if (currentWorkspaceId.current === workspaceId) setSavedLoading(false);
    }
  };
  const showSavedMessages = () => {
    if (!workspace) return;
    setShowSaved(true); setSidebarOpen(false); setSearchResults(null); setThread(null);
    void refreshSavedEntries(workspace.id);
    refreshSavedIds(workspace.id);
  };
  const loadOlderSaved = async () => {
    if (!workspace || !hasOlderSaved || savedLoading || savedEntries.length === 0) return;
    const id = workspace.id, cursor = savedEntries[savedEntries.length-1].message.id;
    setSavedLoading(true);
    try {
      const older = await api<SavedEntry[]>("/workspaces/" + id + "/saved?before=" + encodeURIComponent(cursor));
      if (currentWorkspaceId.current === id) {
        setSavedEntries(previous => [...previous,
          ...older.filter(item => !previous.some(p => p.message.id === item.message.id))]);
        setHasOlderSaved(older.length === 50);
      }
    } catch (err) {
      if (currentWorkspaceId.current === id) setNotice(errorMessage(err));
    } finally {
      if (currentWorkspaceId.current === id) setSavedLoading(false);
    }
  };
  const toggleSaved = async (message: Message) => {
    if (!workspace || savingMessageId || message.deletedAt) return;
    const id = workspace.id, isSaved = savedIds.has(message.id);
    setSavingMessageId(message.id);
    try {
      await api("/messages/" + message.id + "/save", isSaved ? "DELETE" : "POST");
      if (currentWorkspaceId.current !== id) return;
      setSavedIds(previous => {
        const next = new Set(previous);
        if (isSaved) next.delete(message.id); else next.add(message.id);
        return next;
      });
      if (savedVisible.current) void refreshSavedEntries(id);
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setSavingMessageId(null); }
  };
  const openSavedConversation = (saved: SavedEntry) => {
    const target = [...channels,...dms].find(ch => ch.id === saved.message.channelId);
    if (!target) {
      setNotice("This conversation is no longer available. Your saved list will be refreshed.");
      if (workspace) void refreshSavedEntries(workspace.id);
      return;
    }
    setChannel(target); setThread(null); setSearchResults(null); setShowSaved(false);
  };
  const refreshSession = useCallback(async () => {
    try {
      const r = await api<{user:User}>("/me");
      setUser(r.user);
      // A successful account session proves initial owner setup completed.
      // Do not offer the first-owner form after sign-out in this same tab.
      setBootstrap(false);
      setRequireOwnerToken(false);
    } catch {
      setUser(null);
      const r = await api<{bootstrapAvailable:boolean;bootstrapTokenRequired:boolean}>("/config");
      setBootstrap(r.bootstrapAvailable);
      setRequireOwnerToken(r.bootstrapTokenRequired);
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    if (!user) return;
    void api<Workspace[]>("/workspaces").then(data => { setWorkspaces(data); setWorkspace(current => data.find(x => x.id === current?.id) || data[0] || null); }).catch(err => setNotice(errorMessage(err)));
  }, [user]);
  useEffect(() => {
    if (!workspace) return;
    let active = true;
    setChannel(null); setChannels([]); setDms([]); setMembers([]); setSearchResults(null);
    setUnreadCounts({}); refreshUnread(workspace.id);
    setSavedIds(new Set()); setSavedEntries([]); setHasOlderSaved(false);
    setShowSaved(false); refreshSavedIds(workspace.id);
    void Promise.all([
      api<Channel[]>("/workspaces/" + workspace.id + "/channels"),
      api<Channel[]>("/workspaces/" + workspace.id + "/dms"),
      api<Member[]>("/workspaces/" + workspace.id + "/members")
    ]).then(([channelData, dmData, memberData]) => {
      if (!active) return;
      setChannels(channelData); setDms(dmData); setMembers(memberData);
      setChannel(channelData.find(x => x.name === "general") || channelData[0] || dmData[0] || null);
    }).catch(err => { if (active) setNotice(errorMessage(err)); });
    return () => { active = false; };
  }, [workspace]);
  useEffect(() => { setShowAddMember(false); setChannelMembers([]); }, [channel?.id]);
  useEffect(() => {
    let active = true;
    setMessages([]); setThread(null); setHasOlder(false); setLoadingOlder(false); setShowPins(false); setPins([]);
    if (channel) {
      void api<Message[]>("/channels/" + channel.id + "/messages")
        .then(data => {
          if (active) {
            setMessages(data); setHasOlder(data.length === 50);
            if (data.length && conversationVisible() && !searchIsOpen.current) {
              acknowledgeRead(channel.id, data[data.length-1].id);
            }
          }
        })
        .catch(err => { if (active) setNotice(errorMessage(err)); });
    }
    return () => { active = false; };
  }, [channel?.id]);
  useEffect(() => {
    if (!channel || !messages.length) return;
    const id = channel.id, latest = messages[messages.length-1].id;
    const markOnReturn = () => {
      if (currentChannelId.current === id && conversationVisible() && !searchIsOpen.current) {
        acknowledgeRead(id, latest);
      }
    };
    window.addEventListener("focus", markOnReturn);
    document.addEventListener("visibilitychange", markOnReturn);
    return () => {
      window.removeEventListener("focus", markOnReturn);
      document.removeEventListener("visibilitychange", markOnReturn);
    };
  }, [channel?.id, messages[messages.length-1]?.id]);
  useEffect(() => {
    if (searchResults === null && !showSaved && channel && messages.length && conversationVisible()) {
      acknowledgeRead(channel.id, messages[messages.length-1].id);
    }
  }, [searchResults, showSaved]);
  useEffect(() => {
    let active = true;
    setReplies([]); setHasOlderReplies(false); setLoadingOlderReplies(false);
    if (thread) {
      void api<Message[]>("/channels/" + thread.channelId + "/messages?parentId=" + thread.id)
        .then(data => { if (active) { setReplies(data); setHasOlderReplies(data.length === 50); } })
        .catch(err => { if (active) setNotice(errorMessage(err)); });
    }
    return () => { active = false; };
  }, [thread?.id]);
  useLayoutEffect(() => {
    if (pendingScroll.current && scrollViewport.current) {
      const previous = pendingScroll.current, el = scrollViewport.current;
      el.scrollTop = previous.top + (el.scrollHeight - previous.height);
      pendingScroll.current = null;
    }
  }, [messages]);
  useLayoutEffect(() => {
    if (pendingThreadScroll.current && threadViewport.current) {
      const previous = pendingThreadScroll.current, el = threadViewport.current;
      el.scrollTop = previous.top + (el.scrollHeight - previous.height);
      pendingThreadScroll.current = null;
    }
  }, [replies]);
  useEffect(() => {
    if (skipBottomScroll.current) { skipBottomScroll.current = false; return; }
    if (!searchResults) scrollAnchor.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, searchResults]);
  const loadOlder = async () => {
    if (!channel || !hasOlder || loadingOlder || !messages.length) return;
    const id = channel.id, before = messages[0].id;
    setLoadingOlder(true);
    try {
      const older = await api<Message[]>("/channels/" + id + "/messages?before=" + encodeURIComponent(before));
      if (currentChannelId.current !== id) return;
      setHasOlder(older.length === 50);
      if (older.length) {
        const el = scrollViewport.current;
        if (el) pendingScroll.current = {height:el.scrollHeight,top:el.scrollTop};
        skipBottomScroll.current = true;
        setMessages(previous => [...older.filter(item => !previous.some(m => m.id === item.id)),...previous]);
      }
    } catch (err) { if (currentChannelId.current === id) setNotice(errorMessage(err)); }
    finally { if (currentChannelId.current === id) setLoadingOlder(false); }
  };
  const loadOlderReplies = async () => {
    if (!thread || !hasOlderReplies || loadingOlderReplies || !replies.length) return;
    const id = thread.id, channelId = thread.channelId, before = replies[0].id;
    setLoadingOlderReplies(true);
    try {
      const older = await api<Message[]>("/channels/" + channelId + "/messages?parentId=" + id + "&before=" + encodeURIComponent(before));
      if (currentChannelId.current !== channelId) return;
      setHasOlderReplies(older.length === 50);
      if (older.length) {
        const el = threadViewport.current;
        if (el) pendingThreadScroll.current = {height:el.scrollHeight,top:el.scrollTop};
        setReplies(previous => [...older.filter(item => !previous.some(m => m.id === item.id)),...previous]);
      }
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setLoadingOlderReplies(false); }
  };
  useEffect(() => {
    if (!user) return;
    let active = true;
    const disconnect = connectEvents((event: Event) => {
      const activeWorkspaceId = workspace?.id;
      if (event.type === "saved.changed" && activeWorkspaceId && event.workspaceId === activeWorkspaceId && event.messageId) {
        const messageId = event.messageId;
        setSavedIds(previous => {
          const next = new Set(previous);
          if (event.saved) next.add(messageId); else next.delete(messageId);
          return next;
        });
        if (savedVisible.current) void refreshSavedEntries(activeWorkspaceId);
        return;
      }
      if (event.type === "unread.updated" && activeWorkspaceId && event.workspaceId === activeWorkspaceId) {
        refreshUnread(activeWorkspaceId);
        return;
      }
      if (event.type === "message.created" && event.channelId && event.message?.parentId === null) {
        if (event.channelId === currentChannelId.current && conversationVisible() && !searchIsOpen.current) {
          acknowledgeRead(event.channelId, event.message.id);
        } else if (workspace) refreshUnread(workspace.id);
      }
      if (event.type === "dm.created" && (event.conversation?.kind === "dm" || event.conversation?.kind === "group_dm") && event.workspaceId === workspace?.id) {
        const conversation = event.conversation;
        setDms(previous => [conversation, ...previous.filter(dm => dm.id !== conversation.id)]);
        if (activeWorkspaceId) refreshUnread(activeWorkspaceId);
        return;
      }
      if (event.type === "channel.added" && event.channel && event.workspaceId === workspace?.id) {
        const added = event.channel;
        setChannels(previous => [...previous.filter(ch => ch.id !== added.id), added]);
        if (activeWorkspaceId) refreshUnread(activeWorkspaceId);
        return;
      }
      if (event.type === "channel.removed" && event.channelId && event.workspaceId === workspace?.id) {
        const removedId = event.channelId;
        setChannels(previous => previous.filter(ch => ch.id !== removedId));
        setUnreadCounts(previous => { const next = {...previous}; delete next[removedId]; return next; });
        setSavedEntries(previous => previous.filter(entry => entry.message.channelId !== removedId));
        if (activeWorkspaceId) refreshSavedIds(activeWorkspaceId);
        if (currentChannelId.current === removedId) {
          setChannel(null);
          setThread(null); setSearchResults(null); setShowAddMember(false); setChannelMembers([]);
        }
        return;
      }
      if (event.type === "channel.membership_updated" && event.channelId === channel?.id) {
        const id = event.channelId;
        void api<Member[]>("/channels/" + id + "/members")
          .then(data => { if (currentChannelId.current === id) setChannelMembers(data); })
          .catch(() => {});
        return;
      }
      if (event.type === "message.updated" && event.message?.deletedAt) {
        const deletedId = event.message.id;
        setSavedIds(previous => { const next = new Set(previous); next.delete(deletedId); return next; });
        setSavedEntries(previous => previous.filter(item => item.message.id !== deletedId));
      }
      if (!event.message || event.channelId !== channel?.id) return;
      const m = event.message;
      const apply = (list: Message[]) => event.type === "message.created"
        ? list.some(item => item.id === m.id) ? list : [...list, m]
        : list.map(item => item.id === m.id ? m : item);
      if (m.parentId) setReplies(prev => apply(prev));
      else setMessages(prev => apply(prev));
      if (event.type === "message.updated") {
        setPins(previous => {
          const present = previous.some(item => item.id === m.id);
          if (present && !m.pinnedBy) return previous.filter(item => item.id !== m.id);
          if (present) return previous.map(item => item.id === m.id ? m : item);
          return m.pinnedBy ? [m, ...previous].slice(0,50) : previous;
        });
      }
      if (thread?.id === m.id) setThread(m);
    }, () => {
      if (!active) return;
      setShowSessions(false); setChannel(null); setWorkspace(null); setWorkspaces([]);
      void refreshSession();
    }, () => {
      // The server has no durable WebSocket event queue. On reconnect, fetch
      // fresh navigation and a contiguous recent page for the selected view.
      if (!active) return;
      const scopeId = workspace?.id;
      if (scopeId) {
        refreshUnread(scopeId);
        refreshSavedIds(scopeId);
        if (savedVisible.current) void refreshSavedEntries(scopeId);
        void Promise.all([
          api<Channel[]>("/workspaces/" + scopeId + "/channels"),
          api<Channel[]>("/workspaces/" + scopeId + "/dms"),
          api<Member[]>("/workspaces/" + scopeId + "/members")
        ]).then(([recentChannels, recentDms, recentMembers]) => {
          if (!active) return;
          setChannels(recentChannels); setDms(recentDms); setMembers(recentMembers);
          if (channel && ![...recentChannels,...recentDms].some(entry => entry.id === channel.id)) {
            setChannel(recentChannels[0] || recentDms[0] || null);
            setThread(null);
          }
        }).catch(() => { if (active) setNotice("Connection restored, but the workspace could not be refreshed."); });
      }
      if (channel) {
        const requestedChannelId = channel.id;
        const rootPage = api<Message[]>("/channels/" + requestedChannelId + "/messages");
        const threadPage = thread
          ? api<Message[]>("/channels/" + requestedChannelId + "/messages?parentId=" + thread.id)
          : Promise.resolve(null);
        void Promise.all([rootPage,threadPage]).then(([roots,threadReplies]) => {
          if (!active || currentChannelId.current !== requestedChannelId) return;
          setMessages(previous => reconcileRecentMessages(previous,roots));
          setHasOlder(roots.length === 50); setLoadingOlder(false);
          if (roots.length && conversationVisible() && !searchIsOpen.current) {
            acknowledgeRead(requestedChannelId, roots[roots.length-1].id);
          }
          if (threadReplies) {
            setReplies(previous => reconcileRecentMessages(previous,threadReplies));
            setHasOlderReplies(threadReplies.length === 50); setLoadingOlderReplies(false);
          }
          setNotice("Connection restored. Recent messages refreshed; load earlier history as needed.");
        }).catch(() => {
          if (active) setNotice("Connection restored, but message history could not be refreshed.");
        });
      } else {
        setNotice("Realtime connection restored.");
      }
    }, () => {
      if (active) setNotice("Realtime connection interrupted. Reconnecting automatically…");
    });
    return () => { active = false; disconnect(); };
  }, [user, workspace?.id, channel?.id, thread?.id, refreshSession]);
  const send = async (body: string, parentId?: string) => {
    if (!channel) return;
    try {
      const m = await api<Message>("/channels/" + channel.id + "/messages", "POST", { body, parentId });
      if (parentId) setReplies(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
      else setMessages(prev => prev.some(x => x.id === m.id) ? prev : [...prev, m]);
    } catch (err) { setNotice(errorMessage(err)); throw err; }
  };
  const react = async (m: Message, emoji: string) => {
    try {
      const updated = await api<Message>("/messages/" + m.id + "/reactions", "POST", { emoji });
      if (m.parentId) setReplies(prev => prev.map(x => x.id === m.id ? updated : x));
      else setMessages(prev => prev.map(x => x.id === m.id ? updated : x));
    } catch (err) { setNotice(errorMessage(err)); }
  };
  const edit = async (m: Message) => {
    const body = window.prompt("Edit your message", m.body);
    if (!body || !body.trim() || body === m.body) return;
    try { const updated = await api<Message>("/messages/" + m.id, "PATCH", { body }); if (m.parentId) setReplies(prev => prev.map(x => x.id === m.id ? updated : x)); else setMessages(prev => prev.map(x => x.id === m.id ? updated : x)); }
    catch (err) { setNotice(errorMessage(err)); }
  };
  const remove = async (m: Message) => {
    if (!window.confirm("Delete this message?")) return;
    try {
      const updated = await api<Message>("/messages/" + m.id, "DELETE");
      if (m.parentId) setReplies(prev => prev.map(x => x.id === m.id ? updated : x));
      else setMessages(prev => prev.map(x => x.id === m.id ? updated : x));
      setSavedIds(previous => { const next = new Set(previous); next.delete(m.id); return next; });
      if (workspace && savedVisible.current) void refreshSavedEntries(workspace.id);
    }
    catch (err) { setNotice(errorMessage(err)); }
  };
  const canModeratePins = workspace?.role === "owner" || workspace?.role === "admin";
  const togglePin = async (message: Message) => {
    try {
      const updated = await api<Message>("/messages/" + message.id + "/pin", message.pinnedBy ? "DELETE" : "POST");
      setMessages(previous => previous.map(item => item.id === updated.id ? updated : item));
      setReplies(previous => previous.map(item => item.id === updated.id ? updated : item));
      setSearchResults(previous => previous?.map(item => item.id === updated.id ? updated : item) || null);
      setThread(previous => previous?.id === updated.id ? updated : previous);
      if (currentChannelId.current === updated.channelId) {
        setPins(previous => updated.pinnedBy
          ? [updated, ...previous.filter(item => item.id !== updated.id)].sort((a,b) => (b.pinnedAt || "").localeCompare(a.pinnedAt || "")).slice(0,50)
          : previous.filter(item => item.id !== updated.id));
      }
    } catch (err) { setNotice(errorMessage(err)); }
  };
  const openPins = async () => {
    if (!channel) return;
    const id = channel.id;
    setShowPins(true); setPinsLoading(true); setPins([]);
    try {
      const data = await api<Message[]>("/channels/" + id + "/pins");
      if (currentChannelId.current === id) setPins(data);
    } catch (err) { if (currentChannelId.current === id) setNotice(errorMessage(err)); }
    finally { if (currentChannelId.current === id) setPinsLoading(false); }
  };
  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspace || search.trim().length < 2) return;
    setShowSaved(false);
    try { setSearchResults(await api<Message[]>("/workspaces/" + workspace.id + "/search?q=" + encodeURIComponent(search.trim()))); }
    catch (err) { setNotice(errorMessage(err)); }
  };
  const newChannel = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!workspace) return;
    const form = new FormData(e.currentTarget);
    try {
      const ch = await api<Channel>("/workspaces/" + workspace.id + "/channels", "POST", { name: form.get("name"), isPrivate: form.get("private") === "on" });
      setChannels(prev => [...prev, ch].sort((a, b) => a.name.localeCompare(b.name))); setChannel(ch); setShowNewChannel(false);
    } catch (err) { setNotice(errorMessage(err)); }
  };
  const openChannelMembers = async () => {
    if (!channel || !workspace || !channel.isPrivate || workspace.role === "member") return;
    const id = channel.id;
    setChannelMemberBusy(true);
    try {
      const data = await api<Member[]>("/channels/" + id + "/members");
      if (currentChannelId.current === id) { setChannelMembers(data); setShowAddMember(true); }
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setChannelMemberBusy(false); }
  };
  const addChannelMember = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!channel || !workspace || (channel.kind && channel.kind !== "channel") || !channel.isPrivate || workspace.role === "member") return;
    const id = channel.id;
    const form = e.currentTarget;
    const username = String(new FormData(form).get("username") || "");
    setChannelMemberBusy(true);
    try {
      await api("/channels/" + id + "/members", "POST", { username });
      const updated = await api<Member[]>("/channels/" + id + "/members");
      if (currentChannelId.current === id) { setChannelMembers(updated); form.reset(); }
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setChannelMemberBusy(false); }
  };
  const removeChannelMember = async (person: Member) => {
    if (!channel || !window.confirm("Remove @" + person.username + " from this private channel? Their access to its history ends immediately.")) return;
    const id = channel.id;
    setChannelMemberBusy(true);
    try {
      await api("/channels/" + id + "/members/" + person.id, "DELETE");
      if (currentChannelId.current === id) setChannelMembers(previous => previous.filter(item => item.id !== person.id));
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setChannelMemberBusy(false); }
  };
  const newDirectMessage = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!workspace) return;
    const username = String(new FormData(e.currentTarget).get("username") || "").trim();
    try {
      const conversation = await api<Channel>("/workspaces/" + workspace.id + "/dms", "POST", { username });
      setDms(previous => [conversation, ...previous.filter(dm => dm.id !== conversation.id)]);
      setChannel(conversation); setThread(null); setSearchResults(null);
      setShowNewDm(false); setSidebarOpen(false);
    } catch (err) { setNotice(errorMessage(err)); }
  };
  const newGroupConversation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (!workspace) return;
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title") || "").trim();
    const usernames = form.getAll("participant").map(String);
    if (usernames.length < 2 || usernames.length > 29) {
      setNotice("Select between 2 and 29 teammates for a group conversation.");
      return;
    }
    try {
      const conversation = await api<Channel>("/workspaces/" + workspace.id + "/group-dms", "POST", { title, usernames });
      setDms(previous => [conversation, ...previous.filter(dm => dm.id !== conversation.id)]);
      setChannel(conversation); setThread(null); setSearchResults(null);
      setShowNewGroup(false); setSidebarOpen(false);
    } catch (err) { setNotice(errorMessage(err)); }
  };
  const invite = async () => {
    if (!workspace) return;
    try { const r = await api<{invite:string}>("/workspaces/" + workspace.id + "/invites", "POST", { role: "member" }); setInviteCode(r.invite); }
    catch (err) { setNotice(errorMessage(err)); }
  };
  const openSessions = async () => {
    setShowSessions(true); setSessionBusy(true);
    try { setSessions(await api<SessionInfo[]>("/auth/sessions")); }
    catch (err) { setNotice(errorMessage(err)); }
    finally { setSessionBusy(false); }
  };
  const revokeSession = async (session: SessionInfo) => {
    if (!window.confirm(session.current ? "Sign out this session now?" : "Sign out the selected session?")) return;
    setSessionBusy(true);
    try {
      const result = await api<{ok:boolean;current:boolean}>("/auth/sessions/" + session.id, "DELETE");
      if (result.current) {
        setShowSessions(false); setUser(null); setWorkspace(null); setWorkspaces([]); setChannel(null);
      } else setSessions(previous => previous.filter(item => item.id !== session.id));
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setSessionBusy(false); }
  };
  const revokeOtherSessions = async () => {
    if (!window.confirm("Sign out all other sessions?")) return;
    setSessionBusy(true);
    try {
      await api("/auth/sessions/revoke-others", "POST");
      setSessions(previous => previous.filter(session => session.current));
    } catch (err) { setNotice(errorMessage(err)); }
    finally { setSessionBusy(false); }
  };
  const logout = async () => { try { await api("/auth/logout", "POST"); } finally { setUser(null); setWorkspace(null); setWorkspaces([]); setChannel(null); setShowSessions(false); } };
  if (loading) return <main className="boot"><span className="brand-symbol">✳</span> GoreeCloud Teams</main>;
  if (!user) return <Welcome bootstrap={bootstrap} requireOwnerToken={requireOwnerToken} onLogin={refreshSession}/>;
  return <div className="shell">
    <nav className="activity-rail" aria-label="Main navigation"><div className="rail-mark" title="GoreeCloud Teams">✳</div>
      <button className={"rail-action " + (!showSaved ? "active" : "")} aria-label="Messages" onClick={() => setShowSaved(false)}><MessageCircle size={22}/><span>Messages</span></button>
      <button className={"rail-action " + (showSaved ? "active" : "")} aria-label="Saved messages" onClick={showSavedMessages}><Bookmark size={22}/><span>Saved</span></button>
      <button className="rail-action" aria-label="Search messages" onClick={() => { setShowSaved(false); document.getElementById("search-input")?.focus(); }}><Search size={22}/><span>Search</span></button>
      <div className="rail-space"/>
      <button className="rail-action" title="Sign out" aria-label="Sign out" onClick={() => void logout()}><LogOut size={21}/><span>Sign out</span></button>
      <Avatar name={user.displayName} size="small"/>
    </nav>
    <aside className={"sidebar " + (sidebarOpen ? "open" : "")} aria-label="Workspace navigation">
      <div className="workspace-title"><span className="workspace-icon">G</span><select aria-label="Workspace" value={workspace?.id || ""} onChange={e => setWorkspace(workspaces.find(w => w.id === e.target.value) || null)}>
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select><button aria-label="Close sidebar" className="mobile-close" onClick={() => setSidebarOpen(false)}><X size={20}/></button></div>
      <div className="sidebar-scroll"><div className="sidebar-label">YOUR SPACE <MoreHorizontal size={16}/></div>
        <div className="section-head"><span>Channels</span>{workspace && workspace.role !== "member" && <button aria-label="Create channel" onClick={() => setShowNewChannel(true)}><Plus size={18}/></button>}</div>
        <div className="channel-list">{channels.map(ch => <button key={ch.id} className={"channel-link " + (channel?.id === ch.id ? "selected" : "")}
          onClick={() => { setShowSaved(false); setChannel(ch); setSearchResults(null); setSidebarOpen(false); }}>{ch.isPrivate ? <LockKeyhole size={17}/> : <Hash size={18}/>} <span>{ch.name}</span>
          {!!unreadCounts[ch.id] && <span className="unread-count" aria-label={unreadCounts[ch.id] + " unread messages"}>{unreadCounts[ch.id] > 99 ? "99+" : unreadCounts[ch.id]}</span>}
        </button>)}</div>
        <div className="section-head dm-section"><span>Conversations</span><div className="conversation-actions">
          <button aria-label="Start direct message" title="New direct message" onClick={() => setShowNewDm(true)}><Plus size={18}/></button>
          <button aria-label="Start group conversation" title="New group conversation" onClick={() => setShowNewGroup(true)}><Users size={18}/></button>
        </div></div>
        <div className="channel-list">{dms.map(dm => <button key={dm.id} className={"channel-link " + (channel?.id === dm.id ? "selected" : "")}
          onClick={() => { setShowSaved(false); setChannel(dm); setThread(null); setSearchResults(null); setSidebarOpen(false); }}>
          {dm.kind === "group_dm" ? <Users size={17}/> : <MessageCircle size={17}/>} <span>{dm.peerName || dm.name}</span>
          {!!unreadCounts[dm.id] && <span className="unread-count" aria-label={unreadCounts[dm.id] + " unread messages"}>{unreadCounts[dm.id] > 99 ? "99+" : unreadCounts[dm.id]}</span>}
        </button>)}
          {dms.length === 0 && <p className="dm-empty">Start a private one-to-one or group conversation.</p>}
        </div>
        <div className="sidebar-label second-label">WORKSPACE TOOLS</div>
        <button className="tool-link" aria-pressed={showSaved} onClick={showSavedMessages}><Bookmark size={18}/> Saved for later</button>
        {workspace?.role !== "member" && <button className="tool-link" onClick={() => { setShowInvite(true); setInviteCode(""); }}><UserPlus size={18}/> Invite a teammate</button>}
        <button className="tool-link" onClick={() => void openSessions()}><ShieldCheck size={18}/> Manage sessions</button>
      </div>
      <div className="sidebar-foot"><div className="online-dot"/><span>Signed in as <strong>{user.displayName}</strong></span></div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><button className="mobile-menu" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu size={22}/></button>
        <div className="breadcrumb"><strong>{workspace?.name || "Workspace"}</strong><span>/</span><span>{showSaved ? "Saved messages" : searchResults ? "Search" : channel?.name || "Choose a channel"}</span></div>
        <form className="searchbox" onSubmit={doSearch}><Search size={17}/><input id="search-input" aria-label="Search messages" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…" minLength={2}/><kbd>↵</kbd></form>
        <button className="topbar-icon" aria-label="Clear search" onClick={() => { setSearch(""); setSearchResults(null); }}><X size={18}/></button>
        <Avatar name={user.displayName} size="small"/>
      </header>
      {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16}/></button></div>}
      {showSaved ? <div className="content saved-view">
        <header className="channel-header"><div className="channel-heading">
          <div className="channel-identity"><div className="channel-heading-icon"><Bookmark size={24}/></div>
            <div><h1>Saved for later</h1><p>Only you can see your saved messages. Removing channel access removes them from this view.</p></div>
          </div>
          <button className="add-channel-member" onClick={() => { if (workspace) void refreshSavedEntries(workspace.id); }} disabled={savedLoading}>Refresh</button>
        </div></header>
        <div className="message-scroll saved-list" aria-label="Your saved messages">
          {savedEntries.length === 0 && <div className="saved-empty"><Bookmark size={38}/><h2>No saved messages yet</h2>
            <p>Save messages from conversations to find them here later.</p></div>}
          {savedEntries.map(item => <article className="saved-card" key={item.message.id}>
            <div className="saved-card-meta"><span>{[...channels,...dms].find(ch => ch.id === item.message.channelId)?.peerName ||
              [...channels,...dms].find(ch => ch.id === item.message.channelId)?.name || item.channelName}</span>
              <span>Saved {new Date(item.savedAt).toLocaleDateString()}</span></div>
            <strong>{item.message.author}</strong>
            <p>{item.message.body}</p>
            <div className="saved-card-actions">
              <button onClick={() => openSavedConversation(item)}>Open conversation</button>
              <button disabled={savingMessageId === item.message.id} onClick={() => void toggleSaved(item.message)}>
                <Bookmark size={16} fill="currentColor"/> Remove saved
              </button>
            </div>
          </article>)}
          {hasOlderSaved && <button className="load-older" type="button" disabled={savedLoading}
            onClick={() => void loadOlderSaved()}>{savedLoading ? "Loading saved messages…" : "Load more saved messages"}</button>}
          {savedLoading && <p className="muted" role="status">Updating saved messages…</p>}
        </div>
      </div> : searchResults ? <div className="content"><header className="channel-header"><button className="back-button" onClick={() => setSearchResults(null)}><ArrowLeft size={20}/> Back to channel</button><h1>Search results</h1><p>{searchResults.length} messages found for “{search}”</p></header>
        <div className="message-scroll">{searchResults.length ? searchResults.map(m => <MessageRow key={m.id} message={m} me={user} onReply={setThread} onReaction={react} onEdit={edit} onDelete={remove} onSave={m => void toggleSaved(m)} saved={savedIds.has(m.id)} saving={savingMessageId === m.id}/>) : <p className="empty">Nothing matched your search.</p>}</div></div>
      : channel ? <div className="content">
        <header className="channel-header"><div className="channel-heading"><div className="channel-identity"><div className="channel-heading-icon">{channel.kind === "group_dm" ? <Users size={24}/> : channel.kind === "dm" ? <MessageCircle size={24}/> : channel.isPrivate ? <LockKeyhole size={24}/> : <Hash size={26}/>}</div>
          <div><h1>{channel.kind === "dm" ? channel.peerName || channel.name : channel.name}</h1><p>{channel.kind === "group_dm" ? "Private group conversation · fixed membership" : channel.kind === "dm" ? "Private conversation · visible only to participants" : channel.isPrivate ? "Private channel" : "Open to everyone in this workspace"}</p></div></div><div className="channel-members">
          {channel.isPrivate && (!channel.kind || channel.kind === "channel") && workspace?.role !== "member"
            ? <button className="add-channel-member" disabled={channelMemberBusy} onClick={() => void openChannelMembers()}><UserPlus size={18}/> Manage members</button>
            : <><Users size={18}/><span>{channel.kind === "group_dm" ? (channel.memberCount || 3) + " participants" : channel.kind === "dm" ? "Two participants" : "Team space"}</span></>}
          <button type="button" className="view-pins" aria-label="View pinned messages" onClick={() => void openPins()}><Pin size={17}/> Pins</button>
        </div></div></header>
        <div className="message-scroll" ref={scrollViewport} role="log" aria-label={"Messages in " + channel.name}>
          {hasOlder && <button className="load-older" type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}</button>}
          <div className="channel-intro"><span className="intro-icon">{channel.kind === "group_dm" ? <Users size={26}/> : channel.kind === "dm" ? <MessageCircle size={26}/> : <Hash size={26}/>}</span><h2>{channel.kind === "group_dm" ? channel.name : channel.kind === "dm" ? "Conversation with " + (channel.peerName || channel.name) : "Welcome to #" + channel.name}</h2><p>{channel.kind === "group_dm" ? "Only the invited group members can see these messages. Group membership is fixed in this development preview." : channel.kind === "dm" ? "Only you and this teammate can see this conversation. Messages are stored on your Teams server." : "This is the beginning of the conversation. Share updates, ask questions, and keep moving forward together."}</p></div>
          {messages.map(m => <MessageRow key={m.id} message={m} me={user} onReply={setThread} onReaction={react} onEdit={edit} onDelete={remove} onSave={m => void toggleSaved(m)} saved={savedIds.has(m.id)} saving={savingMessageId === m.id} onPin={togglePin} canModerate={canModeratePins}/>) }
          <div ref={scrollAnchor} />
        </div>
        <div className="composer-wrap"><Composer key={channel.id} channelName={channel.peerName || channel.name} direct={channel.kind === "dm" || channel.kind === "group_dm"} onSend={body => send(body)}/></div>
      </div> : <div className="empty-workspace"><Sparkles size={35}/><h2>Choose a channel</h2><p>Your conversations will appear here.</p></div>}
    </main>
    {thread && !showSaved && <aside className="thread-panel" aria-label="Thread">
      <header><strong>Thread</strong><button aria-label="Close thread" onClick={() => setThread(null)}><X size={20}/></button></header>
      <div className="thread-scroll" ref={threadViewport}><MessageRow message={thread} me={user} onReply={() => {}} onReaction={react} onEdit={edit} onDelete={remove} onSave={m => void toggleSaved(m)} saved={savedIds.has(thread.id)} saving={savingMessageId === thread.id} onPin={togglePin} canModerate={canModeratePins}/>
        <div className="replies-caption">{replies.length} loaded {replies.length === 1 ? "reply" : "replies"}</div>
        {hasOlderReplies && <button className="load-older" type="button" disabled={loadingOlderReplies} onClick={() => void loadOlderReplies()}>{loadingOlderReplies ? "Loading earlier replies…" : "Load earlier replies"}</button>}
        {replies.map(m => <MessageRow key={m.id} message={m} me={user} onReply={() => {}} onReaction={react} onEdit={edit} onDelete={remove} onSave={m => void toggleSaved(m)} saved={savedIds.has(m.id)} saving={savingMessageId === m.id} onPin={togglePin} canModerate={canModeratePins}/>) }
      </div><div className="composer-wrap"><Composer key={thread.id} channelName={channel?.name || ""} parent onSend={body => send(body, thread.id)}/></div></aside>}
    {showPins && channel && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowPins(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Pinned messages">
        <header><h2>Pinned messages</h2><button aria-label="Close dialog" onClick={() => setShowPins(false)}><X size={20}/></button></header>
        <p className="muted">Up to 50 messages can be pinned in this conversation. Only the pinner or a workspace administrator can remove someone else's pin.</p>
        {pinsLoading && <p className="muted" aria-live="polite">Loading pins…</p>}
        <div className="pins-list">{pins.map(item => <div className="pinned-entry" key={item.id}>
          <div><strong>{item.author}</strong><p>{item.body}</p></div>
          {(item.pinnedBy === user.id || canModeratePins) && <button type="button" title="Unpin message" aria-label={"Unpin message by " + item.author} onClick={() => void togglePin(item)}><PinOff size={16}/></button>}
        </div>)}
        {!pinsLoading && pins.length === 0 && <p className="empty">No pinned messages yet.</p>}
        </div>
      </div>
    </div>}
    {showSessions && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowSessions(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Your active sessions">
        <header><h2>Account sessions</h2><button aria-label="Close dialog" onClick={() => setShowSessions(false)}><X size={20}/></button></header>
        <p className="muted">These are active sign-ins to your account. Session records do not store device fingerprints, IP addresses, or User-Agent strings.</p>
        {sessionBusy && <p aria-live="polite" className="muted">Updating sessions…</p>}
        <div className="session-list">
          {sessions.map(item => <div key={item.id} className="session-item">
            <div><strong>{item.current ? "This session" : "Other session"}</strong>
              <p className="muted">{item.createdAt ? "Started " + new Date(item.createdAt).toLocaleString() : "Started before session history was available"}</p>
              <p className="muted">Expires {new Date(item.expiresAt).toLocaleString()}</p>
            </div>
            <button type="button" disabled={sessionBusy} onClick={() => void revokeSession(item)}>{item.current ? "Sign out" : "Revoke"}</button>
          </div>)}
        </div>
        <button className="primary-button" type="button" disabled={sessionBusy || !sessions.some(item => !item.current)}
          onClick={() => void revokeOtherSessions()}>Sign out other sessions</button>
      </div>
    </div>}
    {showAddMember && channel && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowAddMember(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Manage private channel members">
        <header><h2>Members of #{channel.name}</h2><button aria-label="Close dialog" onClick={() => setShowAddMember(false)}><X size={20}/></button></header>
        <p className="muted">Only listed members can read this private channel. Removing someone immediately revokes their access to its history.</p>
        <div className="session-list">
          {channelMembers.map(person => <div key={person.id} className="session-item">
            <div><strong>{person.displayName}</strong><p className="muted">@{person.username} · {person.role}</p></div>
            {person.id !== user.id && person.role !== "owner" && <button type="button" disabled={channelMemberBusy}
              onClick={() => void removeChannelMember(person)}>Remove</button>}
          </div>)}
        </div>
        <form onSubmit={addChannelMember}>
          <label>Add workspace teammate<select name="username" defaultValue="" required>
            <option value="" disabled>Select a teammate</option>
            {members.filter(m => !channelMembers.some(current => current.id === m.id)).map(m =>
              <option key={m.id} value={m.username}>{m.displayName} (@{m.username})</option>)}
          </select></label>
          <button className="primary-button" type="submit"
            disabled={channelMemberBusy || !members.some(m => !channelMembers.some(existing => existing.id === m.id))}>Add member</button>
        </form>
      </div>
    </div>}
    {showNewGroup && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowNewGroup(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Start group conversation">
        <header><h2>New group conversation</h2><button aria-label="Close dialog" onClick={() => setShowNewGroup(false)}><X size={20}/></button></header>
        <form onSubmit={newGroupConversation}>
          <p className="muted">Choose at least two teammates. Membership is fixed; participants can read group history.</p>
          <label>Group name<input name="title" required minLength={1} maxLength={80} placeholder="Project planning"/></label>
          <fieldset className="group-members"><legend>Teammates (choose 2–29)</legend>
            {members.filter(m => m.id !== user.id).map(m =>
              <label className="checkbox" key={m.id}><input type="checkbox" name="participant" value={m.username}/> {m.displayName} (@{m.username})</label>)}
          </fieldset>
          <button className="primary-button" type="submit" disabled={members.filter(m => m.id !== user.id).length < 2}>Create private group</button>
        </form>
      </div>
    </div>}
    {showNewDm && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowNewDm(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Start direct message">
        <header><h2>New direct message</h2><button aria-label="Close dialog" onClick={() => setShowNewDm(false)}><X size={20}/></button></header>
        <form onSubmit={newDirectMessage}><p className="muted">Choose an existing member of your workspace. Only the two of you can access this conversation.</p>
          <label>Teammate<select name="username" required defaultValue="" autoFocus>
            <option value="" disabled>Select a teammate</option>
            {members.filter(m => m.id !== user.id).map(m => <option key={m.id} value={m.username}>{m.displayName} (@{m.username})</option>)}
          </select></label>
          <button className="primary-button" type="submit" disabled={!members.some(m => m.id !== user.id)}>Start conversation</button>
        </form>
      </div>
    </div>}
    {(showNewChannel || showInvite) && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) { setShowNewChannel(false); setShowInvite(false); } }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={showNewChannel ? "Create channel" : "Invite teammate"}><header><h2>{showNewChannel ? "Create a channel" : "Invite a teammate"}</h2><button onClick={() => { setShowNewChannel(false); setShowInvite(false); }} aria-label="Close dialog"><X size={20}/></button></header>
        {showNewChannel ? <form onSubmit={newChannel}><p className="muted">Give your team a place to keep an ongoing conversation.</p><label>Channel name<input name="name" required pattern="[a-zA-Z0-9_-]{2,40}" placeholder="design-updates" /></label><label className="checkbox"><input name="private" type="checkbox"/> Private channel (invite members separately)</label><button className="primary-button">Create channel</button></form>
        : <div><p className="muted">Create a single-use invitation, valid for 24 hours.</p>{inviteCode ? <><input readOnly aria-label="Invitation code" value={inviteCode} onFocus={e => e.currentTarget.select()}/><p className="hint">Share this code privately. It will not be displayed again.</p><button className="primary-button" onClick={() => void navigator.clipboard?.writeText(inviteCode)}>Copy invitation code</button></> : <button className="primary-button" onClick={() => void invite()}>Generate invitation</button>}</div>}
      </div></div>}
  </div>;
}
