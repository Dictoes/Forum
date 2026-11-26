import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const API = "http://hyeumine.com";
const PAGE_SIZE = 20;
const SESSION_KEY = "forum.user";
const LEGACY_SESSION_KEYS = ["connect.forum.user", "gather.forum.user"];

function readUser() {
  try {
    const storedValue = localStorage.getItem(SESSION_KEY) ||
      LEGACY_SESSION_KEYS.map((key) => localStorage.getItem(key)).find(Boolean);
    const savedUser = JSON.parse(storedValue || "null");
    if (savedUser && savedUser.id != null && savedUser.username && !localStorage.getItem(SESSION_KEY)) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(savedUser));
      LEGACY_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
    }
    return savedUser && savedUser.id != null && savedUser.username ? savedUser : null;
  } catch (error) {
    console.error("Could not read the saved forum session:", error);
    return null;
  }
}

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error("Could not reach the forum API. Check your connection and try again.");
  }
  if (!response.ok) throw new Error(`The forum API returned an error (${response.status}).`);

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The forum API returned an unreadable response.");
  }
}

function formBody(values) {
  return new URLSearchParams(values).toString();
}

function isSuccessful(result) {
  if (result === true || result === 1 || result === "true") return true;
  if (!result || result === false || result === 0 || result === "false") return false;
  return typeof result === "object" &&
    (result.success === true || result.success === 1 || result.success === "true" || getUserId(result) != null);
}

function getUserId(result) {
  if (!result || typeof result !== "object") return null;
  const nestedUser = result.user && typeof result.user === "object" ? result.user : {};
  return result.id ?? result.uid ?? result.user_id ?? result.userid ?? nestedUser.id ?? nestedUser.uid ?? null;
}

function getUsername(result, fallback) {
  if (!result || typeof result !== "object") return fallback;
  if (typeof result.username === "string" && result.username.trim()) return result.username.trim();
  if (typeof result.user === "string" && result.user.trim()) return result.user.trim();
  if (result.user && typeof result.user === "object" && typeof result.user.username === "string") {
    return result.user.username.trim() || fallback;
  }
  return fallback;
}

function initials(value) {
  const words = String(value || "?").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("") || "?";
}

function formatDate(value) {
  if (!value) return "Just now";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Avatar({ name, small = false }) {
  return <span className={`avatar${small ? " small" : ""}`}>{initials(name)}</span>;
}

function TopBar({ user, onAuth, onNotice, onLogout, search, onSearch }) {
  return (
    <header className="topbar">
      <div className="topbar-brand"><span className="brand-mark">F</span> Forum</div>
      <label className="search" aria-label="Search threads"><span aria-hidden="true">⌕</span><input type="search" placeholder="Search threads" value={search} onChange={(event) => onSearch(event.target.value)} /></label>
      <div className="top-actions">
        {user
          ? <>
            <button className="profile-button" type="button" onClick={() => onNotice(`You’re signed in as ${user.username}.`)} aria-label={`Profile for ${user.username}`}>
              <Avatar name={user.username} small /><span className="profile-label">Profile</span><span className="user-label">{user.username}</span>
            </button>
            <button className="logout-button" type="button" onClick={onLogout}>Log out</button>
          </>
          : <button className="auth-button" type="button" onClick={() => onAuth("login")}>Sign in</button>}
      </div>
    </header>
  );
}

function Composer({ user, onAuth, onSubmit, busy }) {
  const [text, setText] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (!user) {
      onAuth("login");
      return;
    }
    const content = text.trim();
    if (!content) return;
    const succeeded = await onSubmit(content);
    if (succeeded) setText("");
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="composer-row">
        <Avatar name={user?.username || "G"} />
        <textarea id="postText" maxLength={2000} placeholder="What’s on your mind?" aria-label="Write a post" required value={text} onChange={(event) => setText(event.target.value)} />
      </div>
      <div className="composer-footer">
        <span className="composer-hint">{user ? "Share a thought with the community" : "Sign in to join the conversation"}</span>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sharing…" : "Share thread ↗"}</button>
      </div>
    </form>
  );
}

function Reply({ reply, user, onDelete }) {
  const own = user && String(reply.uid) === String(user.id);
  return (
    <div className="reply-item">
      <Avatar name={reply.user} small />
      <div className="reply-content">
        <span className="reply-meta">{reply.user || "Someone"}<time>{formatDate(reply.date)}</time></span>
        {reply.reply || ""}
        {own && <button className="delete-reply" type="button" aria-label="Delete your reply" onClick={() => onDelete(reply.id)}>×</button>}
      </div>
    </div>
  );
}

function PostCard({ post, user, onAuth, onReply, onDeletePost, onDeleteReply, onNotice }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const replies = Array.isArray(post.reply) ? post.reply : [];
  const own = user && String(post.uid) === String(user.id);

  async function submitReply(event) {
    event.preventDefault();
    if (!user) {
      onAuth("login");
      return;
    }
    const content = reply.trim();
    if (!content) return;
    setBusy(true);
    const succeeded = await onReply(post.id, content);
    setBusy(false);
    if (succeeded) setReply("");
  }

  return (
    <article className="post-card">
      <div className="post-head">
        <Avatar name={post.user} />
        <div className="post-author"><strong>{post.user || "Someone"}</strong><time className="post-date">{formatDate(post.date)}</time></div>
        {own && <button className="post-menu" type="button" aria-label="Delete your post" title="Delete post" onClick={() => onDeletePost(post.id)}>•••</button>}
      </div>
      <div className="post-body">{post.post || ""}</div>
      <div className="post-actions">
        <button className="text-action" type="button" onClick={() => {
          if (!user) onAuth("login");
          else document.getElementById(`reply-${post.id}`)?.focus();
        }}>↩ &nbsp;{replies.length ? `${replies.length} replies` : "Reply"}</button>
      </div>
      {replies.length > 0 && <div className="reply-list">{replies.map((item) => <Reply key={item.id} reply={item} user={user} onDelete={onDeleteReply} />)}</div>}
      <form className="reply-form" onSubmit={submitReply}>
        <input id={`reply-${post.id}`} maxLength={1000} name="reply" placeholder={user ? "Write a reply…" : "Sign in to reply"} aria-label="Write a reply" required disabled={!user || busy} value={reply} onChange={(event) => setReply(event.target.value)} />
        <button type="submit" disabled={!user || busy}>{busy ? "Sending…" : "Reply"}</button>
      </form>
    </article>
  );
}

function AuthScreen({ mode, initialUsername, accountCreated, onBack, onSwitch, onSubmit }) {
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(initialUsername || "");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const signup = mode === "signup";

  useEffect(() => {
    if (mode === "signin" && initialUsername) setUsername(initialUsername);
    setPassword("");
    setAuthError("");
  }, [mode, initialUsername]);

  async function submit(event) {
    event.preventDefault();
    setAuthError("");
    setBusy(true);
    try {
      await onSubmit({ username: username.trim(), password, mode });
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-showcase glass">
        <div className="brand"><span className="brand-mark">F</span> Forum</div>
        <div className="auth-art" aria-hidden="true">
          <div className="auth-orbit orbit-one"></div>
          <div className="auth-orbit orbit-two"></div>
          <div className="auth-preview glass">
            <span className="preview-label">YOUR COMMUNITY</span>
            <h2>Good thoughts<br />find their people.</h2>
            <div className="preview-avatars"><Avatar name="A" /><Avatar name="M" /><Avatar name="J" /><span>+ more</span></div>
            <div className="preview-line"></div>
            <p>Share a thought. Start a conversation.</p>
          </div>
          <span className="art-sparkle sparkle-one">✦</span>
          <span className="art-sparkle sparkle-two">✳</span>
        </div>
        <div className="auth-showcase-copy">
          <p className="eyebrow">A little corner of the internet</p>
          <h1>Make room for<br />better conversations.</h1>
          <p>Ideas, stories, and everyday moments are better when they’re shared.</p>
        </div>
        <span className="auth-footnote">A place to share what matters.</span>
      </section>

      <section className="auth-card glass" aria-labelledby="auth-title">
        <button className="auth-back" type="button" onClick={onBack}>← &nbsp;Back to threads</button>
        <div className="auth-mobile-brand"><span className="brand-mark">F</span> Forum</div>
        <div className="auth-form-heading">
          <p className="eyebrow">{signup ? "JOIN THE COMMUNITY" : "WELCOME BACK"}</p>
          <h2 id="auth-title">{signup ? "Create your account" : "Sign in to Forum"}</h2>
          <p>{signup ? "A username and password are all you need to get started." : "Sign in and pick up where you left off."}</p>
        </div>
        {accountCreated && !signup && <p className="auth-success" role="status">Your account is registered. Sign in with the username below and the password you created.</p>}
        {authError && <p className="auth-error" role="alert">{authError}</p>}
        <form className="auth-form" onSubmit={submit}>
          <label className="auth-field"><span>Username</span><input name="username" autoComplete="username" maxLength={80} placeholder="Your username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label className="auth-field"><span>Password</span><input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} maxLength={120} placeholder="Your password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="primary-button auth-submit" type="submit" disabled={busy}>{busy ? "Please wait…" : signup ? "Create account" : "Sign in"}</button>
        </form>
        <p className="auth-switch">
          <span>{signup ? "Already have an account?" : "New to Forum?"}</span>
          <button type="button" onClick={() => onSwitch(signup ? "signin" : "signup")}>{signup ? "Sign in" : "Create an account"}</button>
        </p>
        <p className="auth-privacy">Your password is only sent to the forum service for authentication.</p>
      </section>
    </main>
  );
}

function App() {
  const [user, setUser] = useState(readUser);
  const [posts, setPosts] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [screen, setScreen] = useState("forum");
  const [newAccountUsername, setNewAccountUsername] = useState("");
  const [posting, setPosting] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  const showNotice = useCallback((message) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const loadPosts = useCallback(async (pageNumber = page) => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await request(`${API}/forumGetPosts.php?page=${encodeURIComponent(pageNumber)}`, { method: "GET" });
      if (!Array.isArray(data)) throw new Error("The forum API did not return a posts list.");
      setPosts(data);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadPosts(page);
  }, [loadPosts, page]);

  function openAuth(mode = "login") {
    if (mode === "signup") setNewAccountUsername("");
    setScreen(mode === "signup" ? "signup" : "signin");
  }

  async function handleAuth({ username, password, mode }) {
    const endpoint = mode === "signup" ? "forumCreateUser.php" : "forumLogin.php";
    const result = await request(`${API}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: formBody({ username, password }),
    });
    const id = getUserId(result);
    if (!isSuccessful(result)) {
      throw new Error(mode === "signup"
        ? "Could not create that account. The username may already be taken."
        : "The forum service rejected those credentials. Check the exact username and password used to create the account. Your account is still registered; you do not need to create another one.");
    }
    if (id == null) throw new Error("The forum service accepted the request but did not return a user ID. Please try again later.");

    const accountUsername = getUsername(result, username);

    if (mode === "signup") {
      setNewAccountUsername(accountUsername);
      setScreen("signin");
      showNotice("Account created. Sign in with the account you just registered.");
      return;
    }

    const loggedInUser = { id: String(id), username: accountUsername };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(loggedInUser));
    } catch (error) {
      console.error("Could not save the forum session:", error);
      throw new Error("You are signed in, but this browser could not save the session. Check its storage settings.");
    }
    setUser(loggedInUser);
    setNewAccountUsername("");
    setScreen("forum");
    showNotice("You're signed in. Welcome back!");
  }

  async function createPost(content) {
    setPosting(true);
    try {
      const result = await request(`${API}/forumNewPost.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: formBody({ id: user.id, post: content }),
      });
      if (!isSuccessful(result)) throw new Error("Your post could not be published.");
      if (page !== 1) setPage(1);
      else await loadPosts(1);
      showNotice("Your thread has been shared.");
      return true;
    } catch (error) {
      showNotice(error.message);
      return false;
    } finally {
      setPosting(false);
    }
  }

  async function createReply(postId, content) {
    try {
      const result = await request(`${API}/forumReplyPost.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: formBody({ user_id: user.id, post_id: postId, reply: content }),
      });
      if (!isSuccessful(result)) throw new Error("Your reply could not be sent.");
      await loadPosts(page);
      showNotice("Reply added.");
      return true;
    } catch (error) {
      showNotice(error.message);
      return false;
    }
  }

  async function deleteItem(endpoint, id, label) {
    if (!window.confirm(`Delete this ${label}? This can’t be undone.`)) return;
    try {
      const result = await request(`${API}/${endpoint}?id=${encodeURIComponent(id)}`, { method: "GET" });
      if (!isSuccessful(result)) throw new Error(`The ${label} could not be deleted.`);
      await loadPosts(page);
      showNotice(`${label[0].toUpperCase()}${label.slice(1)} deleted.`);
    } catch (error) {
      showNotice(error.message);
    }
  }

  function logout() {
    try {
      localStorage.removeItem(SESSION_KEY);
      LEGACY_SESSION_KEYS.forEach((key) => localStorage.removeItem(key));
      setUser(null);
      setNewAccountUsername("");
      setScreen("signin");
      showNotice("You’ve been signed out.");
    } catch (error) {
      console.error("Could not clear the forum session:", error);
      showNotice("Could not clear the saved session from this browser.");
    }
  }

  const query = search.trim().toLocaleLowerCase();
  const visiblePosts = posts.filter((post) => !query ||
    String(post.post || "").toLocaleLowerCase().includes(query) ||
    String(post.user || "").toLocaleLowerCase().includes(query) ||
    (Array.isArray(post.reply) && post.reply.some((reply) => String(reply.reply || "").toLocaleLowerCase().includes(query))));

  if (screen !== "forum") {
    return (
      <>
        <AuthScreen
          mode={screen}
          initialUsername={newAccountUsername}
          accountCreated={Boolean(newAccountUsername)}
          onBack={() => setScreen("forum")}
          onSwitch={setScreen}
          onSubmit={handleAuth}
        />
        <div className={`toast${toast ? " visible" : ""}`} role="status" aria-live="polite">{toast}</div>
      </>
    );
  }

  return (
    <div className="shell">
      <main className="feed-panel glass">
        <TopBar user={user} onAuth={openAuth} onNotice={showNotice} onLogout={logout} search={search} onSearch={setSearch} />
        <section className="feed-content">
          <div className="feed-heading">
            <div><p className="eyebrow">A little corner of the internet</p><h1>Your threads</h1><p className="feed-subtitle">A good place for the thoughts worth sharing.</p></div>
            <span className="sort-pill">◷ &nbsp;Latest</span>
          </div>
          <Composer user={user} onAuth={openAuth} onSubmit={createPost} busy={posting} />
          <div className="post-list" aria-live="polite">
            {loading
              ? <div className="loading-state">Finding the latest threads…</div>
              : loadError
                ? <div className="error-state">{loadError}<br /><button className="page-button" type="button" style={{ marginTop: 12 }} onClick={() => loadPosts(page)}>Try again</button></div>
                : visiblePosts.length
                  ? visiblePosts.map((post) => (
                    <PostCard
                      key={post.id}
                      post={post}
                      user={user}
                      onAuth={openAuth}
                      onReply={createReply}
                      onDeletePost={(id) => deleteItem("forumDeletePost.php", id, "post")}
                      onDeleteReply={(id) => deleteItem("forumDeleteReply.php", id, "reply")}
                      onNotice={showNotice}
                    />
                  ))
                  : <div className="empty-state">{query ? `No threads match “${search.trim()}”. Try another search.` : "No threads here yet. Start the conversation with a post of your own."}</div>}
          </div>
          <div className="pagination">
            <button className="page-button" type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>← Newer</button>
            <span className="sort-pill">Page {page}</span>
            <button className="page-button" type="button" disabled={posts.length < PAGE_SIZE || loading} onClick={() => setPage((current) => current + 1)}>Older →</button>
          </div>
        </section>
      </main>
      <div className={`toast${toast ? " visible" : ""}`} role="status" aria-live="polite">{toast}</div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
