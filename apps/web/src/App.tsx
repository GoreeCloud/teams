import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Hash, LockKeyhole, LogOut, Menu, MessageCircle, MoreHorizontal, Plus, Reply, Search, Send, ShieldCheck, Smile, Sparkles, Trash2, UserPlus, Users, X, Pencil } from "lucide-react";
import { api, connectEvents, type Channel, type Event, type Message, type User, type Workspace } from "./api";

const shortTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const errorMessage = (err: unknown) => err instanceof Error ? err.message : "Something went wrong";

function Avatar({ name, size = "normal" }: { name: string; size?: "normal" | "small" }) {
  return <span className={"avatar " + (size === "small" ? "avatar-sm" : "")} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>;
}
function Welcome({ bootstrap, onLogin }: { bootstrap: boolean; onLogin: () => void }) {
  const [register, setRegister] = useState(bootstrap);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await api("/auth/" + (register ? "register" : "login"), "POST",
        register ? { username, displayName, password, invite: invite || undefined } : { username, password });
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
function MessageRow({ message, me, onReply, onReaction, onEdit, onDelete }: {
  message: Message; me: User; onReply: (message: Message) => void; onReaction: (message: Message, emoji: string) => void;
  onEdit: (message: Message) => void; onDelete: (message: Message) => void;
}) {
  return <article className="message" aria-label={"Message from " + message.author}>
    <Avatar name={message.author}/>
    <div className="message-content"><div className="message-head"><strong>{message.author}</strong><time dateTime={message.createdAt}>{shortTime(message.createdAt)}</time>{message.editedAt && <span className="edited">edited</span>}</div>
      {message.deletedAt ? <p className="deleted">Message deleted</p> : <p className="message-body">{message.body}</p>}
      <div className="reaction-row">{message.reactions.map(reaction =>
        <button key={reaction.emoji} className="reaction" onClick={() => onReaction(message, reaction.emoji)} aria-label={"Toggle " + reaction.emoji + " reaction"}>{reaction.emoji} {reaction.count}</button>)}
      </div>
    </div>
    {!message.deletedAt && <div className="message-actions">
      <button title="React with thumbs up" aria-label="React with thumbs up" onClick={() => onReaction(message, "👍")}><Smile size={17}/></button>
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
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState<Workspace|null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [dms, setDms] = useState<Channel[]>([]);
  const [channel, setChannel] = useState<Channel|null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [thread, setThread] = useState<Message|null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Message[]|null>(null);
  const [notice, setNotice] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showNewDm, setShowNewDm] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const refreshSession = useCallback(async () => {
    try { const r = await api<{user:User}>("/me"); setUser(r.user); }
    catch { setUser(null); const r = await api<{bootstrapAvailable:boolean}>("/config"); setBootstrap(r.bootstrapAvailable); }
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
    setChannel(null); setChannels([]); setDms([]); setSearchResults(null);
    void Promise.all([
      api<Channel[]>("/workspaces/" + workspace.id + "/channels"),
      api<Channel[]>("/workspaces/" + workspace.id + "/dms")
    ]).then(([channelData, dmData]) => {
      if (!active) return;
      setChannels(channelData); setDms(dmData);
      setChannel(channelData.find(x => x.name === "general") || channelData[0] || dmData[0] || null);
    }).catch(err => { if (active) setNotice(errorMessage(err)); });
    return () => { active = false; };
  }, [workspace]);
  const refreshMessages = useCallback(async () => {
    if (!channel) return;
    const data = await api<Message[]>("/channels/" + channel.id + "/messages");
    setMessages(data);
  }, [channel]);
  useEffect(() => { setMessages([]); setThread(null); void refreshMessages().catch(err => setNotice(errorMessage(err))); }, [refreshMessages]);
  useEffect(() => {
    if (!thread) return;
    void api<Message[]>("/channels/" + thread.channelId + "/messages?parentId=" + thread.id).then(setReplies).catch(err => setNotice(errorMessage(err)));
  }, [thread]);
  useEffect(() => { if (!searchResults) scrollAnchor.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, searchResults]);
  useEffect(() => {
    if (!user) return;
    return connectEvents((event: Event) => {
      if (event.type === "dm.created" && event.conversation?.kind === "dm" && event.workspaceId === workspace?.id) {
        const conversation = event.conversation;
        setDms(previous => [conversation, ...previous.filter(dm => dm.id !== conversation.id)]);
        return;
      }
      if (!event.message || event.channelId !== channel?.id) return;
      const m = event.message;
      const apply = (list: Message[]) => event.type === "message.created"
        ? list.some(item => item.id === m.id) ? list : [...list, m]
        : list.map(item => item.id === m.id ? m : item);
      if (m.parentId) setReplies(prev => apply(prev));
      else setMessages(prev => apply(prev));
      if (thread?.id === m.id) setThread(m);
    });
  }, [user, workspace?.id, channel?.id, thread?.id]);
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
    try { const updated = await api<Message>("/messages/" + m.id, "DELETE"); if (m.parentId) setReplies(prev => prev.map(x => x.id === m.id ? updated : x)); else setMessages(prev => prev.map(x => x.id === m.id ? updated : x)); }
    catch (err) { setNotice(errorMessage(err)); }
  };
  const doSearch = async (e: React.FormEvent) => {
    e.preventDefault(); if (!workspace || search.trim().length < 2) return;
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
  const invite = async () => {
    if (!workspace) return;
    try { const r = await api<{invite:string}>("/workspaces/" + workspace.id + "/invites", "POST", { role: "member" }); setInviteCode(r.invite); }
    catch (err) { setNotice(errorMessage(err)); }
  };
  const logout = async () => { try { await api("/auth/logout", "POST"); } finally { setUser(null); setWorkspace(null); setWorkspaces([]); setChannel(null); } };
  if (loading) return <main className="boot"><span className="brand-symbol">✳</span> GoreeCloud Teams</main>;
  if (!user) return <Welcome bootstrap={bootstrap} onLogin={refreshSession}/>;
  return <div className="shell">
    <nav className="activity-rail" aria-label="Main navigation"><div className="rail-mark" title="GoreeCloud Teams">✳</div>
      <button className="rail-action active" aria-label="Messages"><MessageCircle size={22}/><span>Messages</span></button>
      <button className="rail-action" aria-label="Search messages" onClick={() => document.getElementById("search-input")?.focus()}><Search size={22}/><span>Search</span></button>
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
          onClick={() => { setChannel(ch); setSearchResults(null); setSidebarOpen(false); }}>{ch.isPrivate ? <LockKeyhole size={17}/> : <Hash size={18}/>} <span>{ch.name}</span></button>)}</div>
        <div className="section-head dm-section"><span>Direct messages</span><button aria-label="Start direct message" onClick={() => setShowNewDm(true)}><Plus size={18}/></button></div>
        <div className="channel-list">{dms.map(dm => <button key={dm.id} className={"channel-link " + (channel?.id === dm.id ? "selected" : "")}
          onClick={() => { setChannel(dm); setThread(null); setSearchResults(null); setSidebarOpen(false); }}>
          <MessageCircle size={17}/> <span>{dm.peerName || dm.name}</span></button>)}
          {dms.length === 0 && <p className="dm-empty">Start a private conversation with a teammate.</p>}
        </div>
        <div className="sidebar-label second-label">WORKSPACE TOOLS</div>
        {workspace?.role !== "member" && <button className="tool-link" onClick={() => { setShowInvite(true); setInviteCode(""); }}><UserPlus size={18}/> Invite a teammate</button>}
      </div>
      <div className="sidebar-foot"><div className="online-dot"/><span>Signed in as <strong>{user.displayName}</strong></span></div>
    </aside>
    <main className="main-panel">
      <header className="topbar"><button className="mobile-menu" aria-label="Open sidebar" onClick={() => setSidebarOpen(true)}><Menu size={22}/></button>
        <div className="breadcrumb"><strong>{workspace?.name || "Workspace"}</strong><span>/</span><span>{searchResults ? "Search" : channel?.name || "Choose a channel"}</span></div>
        <form className="searchbox" onSubmit={doSearch}><Search size={17}/><input id="search-input" aria-label="Search messages" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search conversations…" minLength={2}/><kbd>↵</kbd></form>
        <button className="topbar-icon" aria-label="Clear search" onClick={() => { setSearch(""); setSearchResults(null); }}><X size={18}/></button>
        <Avatar name={user.displayName} size="small"/>
      </header>
      {notice && <div className="notice" role="alert">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice"><X size={16}/></button></div>}
      {searchResults ? <div className="content"><header className="channel-header"><button className="back-button" onClick={() => setSearchResults(null)}><ArrowLeft size={20}/> Back to channel</button><h1>Search results</h1><p>{searchResults.length} messages found for “{search}”</p></header>
        <div className="message-scroll">{searchResults.length ? searchResults.map(m => <MessageRow key={m.id} message={m} me={user} onReply={setThread} onReaction={react} onEdit={edit} onDelete={remove}/>) : <p className="empty">Nothing matched your search.</p>}</div></div>
      : channel ? <div className="content">
        <header className="channel-header"><div className="channel-heading"><div className="channel-identity"><div className="channel-heading-icon">{channel.kind === "dm" ? <MessageCircle size={24}/> : channel.isPrivate ? <LockKeyhole size={24}/> : <Hash size={26}/>}</div>
          <div><h1>{channel.kind === "dm" ? channel.peerName || channel.name : channel.name}</h1><p>{channel.kind === "dm" ? "Private conversation · visible only to participants" : channel.isPrivate ? "Private channel" : "Open to everyone in this workspace"}</p></div></div><div className="channel-members"><Users size={18}/><span>Team space</span></div></div></header>
        <div className="message-scroll" role="log" aria-label={"Messages in " + channel.name}>
          <div className="channel-intro"><span className="intro-icon">{channel.kind === "dm" ? <MessageCircle size={26}/> : <Hash size={26}/>}</span><h2>{channel.kind === "dm" ? "Conversation with " + (channel.peerName || channel.name) : "Welcome to #" + channel.name}</h2><p>{channel.kind === "dm" ? "Only you and this teammate can see this conversation. Messages are stored on your Teams server." : "This is the beginning of the conversation. Share updates, ask questions, and keep moving forward together."}</p></div>
          {messages.map(m => <MessageRow key={m.id} message={m} me={user} onReply={setThread} onReaction={react} onEdit={edit} onDelete={remove}/>)}
          <div ref={scrollAnchor} />
        </div>
        <div className="composer-wrap"><Composer key={channel.id} channelName={channel.peerName || channel.name} direct={channel.kind === "dm"} onSend={body => send(body)}/></div>
      </div> : <div className="empty-workspace"><Sparkles size={35}/><h2>Choose a channel</h2><p>Your conversations will appear here.</p></div>}
    </main>
    {thread && <aside className="thread-panel" aria-label="Thread">
      <header><strong>Thread</strong><button aria-label="Close thread" onClick={() => setThread(null)}><X size={20}/></button></header>
      <div className="thread-scroll"><MessageRow message={thread} me={user} onReply={() => {}} onReaction={react} onEdit={edit} onDelete={remove}/>
        <div className="replies-caption">{replies.length} {replies.length === 1 ? "reply" : "replies"}</div>
        {replies.map(m => <MessageRow key={m.id} message={m} me={user} onReply={() => {}} onReaction={react} onEdit={edit} onDelete={remove}/>)}
      </div><div className="composer-wrap"><Composer key={thread.id} channelName={channel?.name || ""} parent onSend={body => send(body, thread.id)}/></div></aside>}
    {showNewDm && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setShowNewDm(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Start direct message">
        <header><h2>New direct message</h2><button aria-label="Close dialog" onClick={() => setShowNewDm(false)}><X size={20}/></button></header>
        <form onSubmit={newDirectMessage}><p className="muted">Choose an existing member of your workspace. Only the two of you can access this conversation.</p>
          <label>Teammate username<input name="username" required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_.-]{3,32}" autoFocus placeholder="teammate" autoComplete="off"/></label>
          <button className="primary-button" type="submit">Start conversation</button>
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
