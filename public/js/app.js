/* ═══════════════════════════════════════════════════════════════════════
   Friends Messenger v2 — Client Application
   Modules: Config · State · API · Socket · Auth · Friends · DMs · Rooms
            Search · UI · Particles · Init
═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════
  // CONFIG
  // ══════════════════════════════════════════════════════════════════════
  const EMOJIS = [
    '😀','😂','🥰','😎','🤩','😭','😤','🥳','👍','👎','❤️','🔥',
    '✨','🎉','💯','🙏','😮','😴','🤔','😅','😜','🤗','😇','🫠',
    '🍕','🍔','🎮','🎵','⚽','🚀','💎','🌟','🌈','☀️','🌙','💀',
    '👻','🦄','🐶','🐱','🐼','🦊','🐸','🦋','🌸','👏','🤝','🫶',
  ];

  const AVATAR_COLORS = [
    '#007BA7','#C04C8E','#E0702F','#2E9E60','#8B5CF6',
    '#D97706','#DC2626','#0891B2','#059669','#7C3AED',
    '#B45309','#BE185D','#0284C7','#16A34A','#9333EA',
  ];

  // ══════════════════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════════════════
  const S = {
    token: null,
    user: null,            // { _id, username, displayName, avatarColor, bio }
    friends: [],           // [{ _id, username, displayName, avatarColor, online }]
    friendRequests: [],    // [{ _id, from: {...}, createdAt }]
    rooms: [],
    currentChat: null,     // { type:'dm'|'room', id, name, avatarColor, recipientId? }
    dmLastMessages: {},    // friendId -> last message text
    unreadDMs: {},         // friendId -> count
    typingUsers: new Set(),
    typingTimer: null,
    isTyping: false,
    currentTab: 'dms',
    emojiOpen: false,
    lastRenderDate: null,
    lastRenderUser: null,
  };

  // ══════════════════════════════════════════════════════════════════════
  // DOM UTILITIES
  // ══════════════════════════════════════════════════════════════════════
  const $ = id => document.getElementById(id);
  const qs = (sel, ctx = document) => ctx.querySelector(sel);

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    children.flat().forEach(c => {
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function linkify(text) {
    return escHtml(text).replace(
      /(https?:\/\/[^\s<>"']+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  function fmtTime(date) {
    return new Date(date).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  }
  function fmtDate(date) {
    const d = new Date(date), now = new Date();
    const yest = new Date(now); yest.setDate(now.getDate()-1);
    if (d.toDateString()===now.toDateString()) return 'Today';
    if (d.toDateString()===yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'});
  }
  function fmtJoined(date) {
    return new Date(date).toLocaleDateString([],{month:'long',year:'numeric'});
  }

  function getColor(name) {
    let h=0; for(let c of String(name)) h=c.charCodeAt(0)+((h<<5)-h);
    return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length];
  }
  function initials(name) { return String(name).trim().slice(0,2).toUpperCase(); }

  function setAvatar(el, name, color) {
    el.textContent = initials(name);
    el.style.background = color || getColor(name);
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120)+'px';
  }

  // ══════════════════════════════════════════════════════════════════════
  // TOAST
  // ══════════════════════════════════════════════════════════════════════
  function toast(msg, type='info', dur=3500) {
    const icons = {info:'ℹ️',success:'✅',error:'❌'};
    const el = h('div',{class:`toast ${type}`},
      h('span',{},icons[type]||'ℹ️'),
      h('span',{},msg)
    );
    $('toasts').appendChild(el);
    setTimeout(() => {
      el.style.animation='toastOut 0.3s ease forwards';
      setTimeout(()=>el.remove(),300);
    }, dur);
  }

  // ══════════════════════════════════════════════════════════════════════
  // API MODULE
  // ══════════════════════════════════════════════════════════════════════
  const API = {
    async req(path, opts={}) {
      const hdrs = {'Content-Type':'application/json'};
      if (S.token) hdrs['Authorization'] = `Bearer ${S.token}`;
      const res = await fetch(path, { ...opts, headers:{...hdrs,...(opts.headers||{})} });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
      return data;
    },
    register: (u,d,p) => API.req('/api/auth/register',{method:'POST',body:JSON.stringify({username:u,displayName:d,password:p})}),
    login:    (u,p)   => API.req('/api/auth/login',{method:'POST',body:JSON.stringify({username:u,password:p})}),
    me:       ()      => API.req('/api/auth/me'),
    search:   (q)     => API.req(`/api/users/search?q=${encodeURIComponent(q)}`),
    friends:  ()      => API.req('/api/friends'),
    sendReq:  (id)    => API.req('/api/friends/request',{method:'POST',body:JSON.stringify({targetId:id})}),
    respondReq:(rid,action)=>API.req('/api/friends/respond',{method:'POST',body:JSON.stringify({requestId:rid,action})}),
    removeFriend:(id) => API.req(`/api/friends/${id}`,{method:'DELETE'}),
    updateProfile:(data)=> API.req('/api/auth/profile',{method:'PUT',body:JSON.stringify(data)}),
    dmHistory:(id)    => API.req(`/api/dm/${id}`),
    rooms:    ()      => API.req('/api/rooms'),
    createRoom:(d)    => API.req('/api/rooms',{method:'POST',body:JSON.stringify(d)}),
    roomMsgs: (r)     => API.req(`/api/messages/${r}`),
  };

  // ══════════════════════════════════════════════════════════════════════
  // SOCKET MODULE
  // ══════════════════════════════════════════════════════════════════════
  let socket = null;

  function initSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth:{ token: S.token } });

    socket.on('connect_error', err => {
      if (err.message.includes('auth') || err.message.includes('token')) {
        toast('Session expired — please log in again', 'error');
        Auth.logout();
      }
    });

    socket.on('receive_dm', msg => {
      const otherId = msg.senderId === S.user._id
        ? String(msg.recipientId)
        : String(msg.senderId);

      // Update last message preview in friends list
      S.dmLastMessages[otherId] = msg.text;
      Friends.renderList();

      // If this is the active chat, append
      if (S.currentChat?.type==='dm' && S.currentChat.recipientId===otherId) {
        Messages.append(msg, true);
      } else if (msg.senderId !== S.user._id) {
        // Unread badge
        S.unreadDMs[otherId] = (S.unreadDMs[otherId]||0)+1;
        Friends.renderList();
        updateDMBadge();
        const friend = S.friends.find(f=>String(f._id)===otherId);
        if (friend) toast(`${friend.displayName}: ${msg.text.slice(0,50)}`, 'info', 4000);
      }
    });

    socket.on('friend_request_received', req => {
      if (!req || !req.from) return;
      if (!S.friendRequests.some(r => String(r._id) === String(req._id))) {
        S.friendRequests.push(req);
      }
      Friends.renderRequests();
      updateRequestBadge();
      toast(`${req.from.displayName} sent you a friend request!`, 'info', 5000);
    });

    socket.on('friend_accepted', ({by}) => {
      if (!S.friends.find(f=>String(f._id)===String(by._id))) {
        S.friends.push({ ...by, online: true });
        Friends.renderList();
      }
      toast(`${by.displayName} accepted your friend request! 🎉`, 'success');
    });

    socket.on('friend_online', ({userId}) => {
      const f = S.friends.find(f=>String(f._id)===String(userId));
      if (f) {
        f.online = true;
        Friends.updateOnlineStatus(String(userId), true);
        if (S.currentChat?.recipientId===String(userId)) updateChatStatus(true);
      }
    });

    socket.on('friend_offline', ({userId}) => {
      const f = S.friends.find(f=>String(f._id)===String(userId));
      if (f) {
        f.online = false;
        Friends.updateOnlineStatus(String(userId), false);
        if (S.currentChat?.recipientId===String(userId)) updateChatStatus(false);
      }
    });

    // Group room events
    socket.on('message_history', msgs => Messages.renderAll(msgs));
    socket.on('receive_message', msg => {
      if (S.currentChat?.type==='room') Messages.append(msg, true);
    });
    socket.on('online_users', users => {
      if (S.currentChat?.type==='room') {
        $('chat-header-sub').textContent = `${users.length} online`;
      }
    });
    socket.on('user_typing', ({username}) => {
      if (username !== S.user.displayName) showTyping(username);
    });
    socket.on('user_stop_typing', ({username}) => hideTyping(username));

    socket.on('friend_typing', ({username}) => {
      if (S.currentChat?.type==='dm') showTyping(username);
    });
    socket.on('friend_stop_typing', () => {
      S.typingUsers.clear(); updateTypingBar();
    });

    socket.on('user_joined', ({username}) => {
      Messages.appendSystem(`${username} joined`);
    });
    socket.on('user_left', ({username}) => {
      Messages.appendSystem(`${username} left`);
    });
    socket.on('room_created', room => {
      if (!S.rooms.find(r=>r._id===room._id)) { S.rooms.push(room); Rooms.render(); }
    });
  }

  function updateChatStatus(online) {
    const dot = $('chat-status-dot');
    const sub = $('chat-header-sub');
    if (dot) dot.className = `status-dot${online?' online':''}`;
    if (sub && S.currentChat?.type==='dm') sub.textContent = online ? 'Online' : 'Offline';
    const pdot = $('profile-status-dot');
    const ptxt = $('profile-status-text');
    if (pdot) pdot.className = `status-dot lg${online?' online':''}`;
    if (ptxt) { ptxt.textContent = online?'Online':'Offline'; ptxt.className=`profile-status-text${online?' online':''}`; }
  }

  function showTyping(name) {
    S.typingUsers.add(name); updateTypingBar();
  }
  function hideTyping(name) {
    S.typingUsers.delete(name); updateTypingBar();
  }
  function updateTypingBar() {
    const bar = $('typing-bar'), txt = $('typing-text');
    const users = [...S.typingUsers];
    if (!users.length) { bar.classList.remove('visible'); return; }
    txt.textContent = `${users.slice(0,2).join(', ')} ${users.length===1?'is':'are'} typing…`;
    bar.classList.add('visible');
  }

  function updateDMBadge() {
    const total = Object.values(S.unreadDMs).reduce((a,b)=>a+b,0);
    const badge = $('badge-dms');
    badge.classList.toggle('hidden', total===0);
    badge.textContent = total;
  }
  function updateRequestBadge() {
    const n = S.friendRequests.length;
    const badge = $('badge-requests');
    badge.classList.toggle('hidden', n===0);
    badge.textContent = n;
  }

  // ══════════════════════════════════════════════════════════════════════
  // AUTH MODULE
  // ══════════════════════════════════════════════════════════════════════
  const Auth = {
    init() {
      // Restore session
      const saved = localStorage.getItem('fm_token');
      if (saved) { S.token = saved; this.restoreSession(); }
      else this.showAuth();

      // Tab switching
      $('tab-login-btn').onclick = () => this.switchTab('login');
      $('tab-register-btn').onclick = () => this.switchTab('register');
      $('go-register').onclick = () => this.switchTab('register');
      $('go-login').onclick = () => this.switchTab('login');

      // Toggle password visibility
      document.querySelectorAll('.toggle-pw').forEach(btn => {
        btn.onclick = () => {
          const inp = $(btn.dataset.target);
          inp.type = inp.type==='password' ? 'text' : 'password';
        };
      });

      // Forms
      $('form-login').onsubmit = e => { e.preventDefault(); this.login(); };
      $('form-register').onsubmit = e => { e.preventDefault(); this.register(); };
    },

    switchTab(tab) {
      $('tab-login-btn').classList.toggle('active', tab==='login');
      $('tab-register-btn').classList.toggle('active', tab==='register');
      $('tab-indicator').classList.toggle('right', tab==='register');
      $('pane-login').classList.toggle('active', tab==='login');
      $('pane-register').classList.toggle('active', tab==='register');
    },

    async login() {
      const u = $('login-username').value.trim();
      const p = $('login-password').value;
      const err = $('login-error');
      err.classList.add('hidden');
      if (!u||!p) { err.textContent='Please fill in all fields'; err.classList.remove('hidden'); return; }
      const btn = $('btn-login');
      btn.disabled=true; qs('.btn-label',btn).textContent='Signing in…';
      try {
        const { token, user } = await API.login(u, p);
        this.onSuccess(token, user);
      } catch(e) {
        err.textContent = e.message; err.classList.remove('hidden');
        btn.disabled=false; qs('.btn-label',btn).textContent='Sign In';
      }
    },

    async register() {
      const dn = $('reg-displayname').value.trim();
      const u  = $('reg-username').value.trim();
      const p  = $('reg-password').value;
      const err = $('reg-error');
      err.classList.add('hidden');
      if (!dn||!u||!p) { err.textContent='Please fill in all fields'; err.classList.remove('hidden'); return; }
      if (p.length<6) { err.textContent='Password must be at least 6 characters'; err.classList.remove('hidden'); return; }
      const btn = $('btn-register');
      btn.disabled=true; qs('.btn-label',btn).textContent='Creating account…';
      try {
        const { token, user } = await API.register(u, dn, p);
        this.onSuccess(token, user);
        toast(`Welcome, ${user.displayName}! 🎉`, 'success');
      } catch(e) {
        err.textContent = e.message; err.classList.remove('hidden');
        btn.disabled=false; qs('.btn-label',btn).textContent='Create Account';
      }
    },

    async restoreSession() {
      try {
        const user = await API.me();
        this.onSuccess(S.token, user, true);
      } catch {
        localStorage.removeItem('fm_token');
        S.token = null;
        this.showAuth();
      }
    },

    onSuccess(token, user, restored=false) {
      S.token = token; S.user = user;
      localStorage.setItem('fm_token', token);
      this.showApp();
      if (!restored) toast(`Welcome back, ${user.displayName}!`, 'success');
    },

    showAuth() {
      $('view-auth').classList.add('active');
      $('view-auth').removeAttribute('aria-hidden');
      $('view-app').classList.remove('active');
      $('view-app').setAttribute('aria-hidden','true');
    },

    showApp() {
      $('view-auth').classList.remove('active');
      $('view-auth').setAttribute('aria-hidden','true');
      $('view-app').classList.add('active');
      $('view-app').removeAttribute('aria-hidden');
      App.init();
    },

    logout() {
      localStorage.removeItem('fm_token');
      S.token=null; S.user=null; S.friends=[]; S.friendRequests=[];
      S.currentChat=null; S.dmLastMessages={}; S.unreadDMs={};
      if (socket) { socket.disconnect(); socket=null; }
      this.showAuth();
      toast('Signed out successfully', 'info', 2500);
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // APP INIT (after login)
  // ══════════════════════════════════════════════════════════════════════
  const App = {
    async init() {
      // Set up user avatar in rail
      setAvatar($('rail-avatar'), S.user.displayName, S.user.avatarColor);
      $('welcome-name').textContent = S.user.displayName;

      initSocket();
      initNav();
      initChatInput();
      initEmojiPicker();
      initRoomModal();
      initProfileModal();
      $('btn-logout').onclick = () => Auth.logout();
      $('btn-close-profile').onclick = () => $('right-panel').classList.add('hidden');
      $('empty-find-btn').onclick = () => switchTab('search');
      $('empty-rooms-btn').onclick = () => switchTab('rooms');
      $('rail-user-btn').onclick = () => showMyProfile();
      if ($('rail-edit-btn')) $('rail-edit-btn').onclick = () => openEditProfileModal();
      $('btn-mobile-back').onclick = () => {
        $('chat-active').classList.add('hidden');
        $('chat-empty').style.display='';
      };

      // Load data
      await Promise.all([ Friends.load(), Rooms.load() ]);
      Nav.switchTab('dms');
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // NAV
  // ══════════════════════════════════════════════════════════════════════
  function initNav() {
    document.querySelectorAll('.rail-btn[data-tab]').forEach(btn => {
      btn.onclick = () => Nav.switchTab(btn.dataset.tab);
    });
  }

  const Nav = {
    switchTab(tab) {
      S.currentTab = tab;
      document.querySelectorAll('.rail-btn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab===tab));
      document.querySelectorAll('.panel-tab').forEach(p => p.classList.toggle('active', p.id===`tab-${tab}`));
      // Clear search when leaving
      if (tab!=='search') { $('user-search-input').value=''; }
      if (tab==='rooms') Rooms.render();
    },
  };

  function switchTab(tab) { Nav.switchTab(tab); }

  // ══════════════════════════════════════════════════════════════════════
  // FRIENDS MODULE
  // ══════════════════════════════════════════════════════════════════════
  const Friends = {
    async load() {
      try {
        const { friends, requests } = await API.friends();
        S.friends = friends;
        S.friendRequests = requests;
        this.renderList();
        this.renderRequests();
        updateRequestBadge();
      } catch(e) { toast('Could not load friends', 'error'); }
    },

    renderList() {
      const list = $('dms-list');
      const flist = $('friends-list');
      const empty = $('friends-empty');
      $('friends-count-pill').textContent = S.friends.length;
      empty.style.display = S.friends.length ? 'none' : '';

      // Helper render single friend item
      const makeItem = (f, forDMs=false) => {
        const wrap = h('div',{class:`conv-item${S.currentChat?.recipientId===String(f._id)?' active':''}`});
        wrap.dataset.friendId = String(f._id);

        const avWrap = h('div',{class:'conv-avatar-wrap'});
        const av = h('span',{class:'avatar-circle sm'});
        setAvatar(av, f.displayName, f.avatarColor);
        const dot = h('span',{class:`status-dot${f.online?' online':''}`});
        avWrap.append(av, dot);

        const meta = h('div',{class:'conv-meta'});
        const name = h('div',{class:'conv-name'},f.displayName);
        const preview = h('div',{class:'conv-preview'},
          forDMs ? (S.dmLastMessages[String(f._id)] || `@${f.username}`) : `@${f.username}`
        );
        meta.append(name, preview);

        const right = h('div',{class:'conv-right'});
        if (forDMs && S.unreadDMs[String(f._id)]) {
          right.appendChild(h('span',{class:'unread-badge'},String(S.unreadDMs[String(f._id)])));
        }

        wrap.append(avWrap, meta, right);
        wrap.onclick = () => openDM(f);
        return wrap;
      };

      // DM list
      list.innerHTML='';
      if (!S.friends.length) {
        list.appendChild(h('div',{class:'search-hint'},[
          h('p',{},'Your friends will appear here')
        ]));
      } else {
        // Sort: online first, then by name
        const sorted = [...S.friends].sort((a,b)=>(b.online?1:0)-(a.online?1:0)||(a.displayName.localeCompare(b.displayName)));
        sorted.forEach((f,i) => {
          const item = makeItem(f, true);
          item.style.animationDelay = `${i*0.04}s`;
          list.appendChild(item);
        });
      }

      // Friends tab list
      flist.innerHTML='';
      S.friends.forEach((f,i) => {
        const item = makeItem(f, false);
        item.style.animationDelay = `${i*0.04}s`;
        // right-click / hover button for profile
        const profileBtn = h('button',{class:'icon-btn',title:'View profile',style:'margin-left:auto'},[
          h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'2',width:'14',height:'14'},[
            h('circle',{cx:'12',cy:'8',r:'4'}),
            h('path',{d:'M4 20c0-4 3.6-7 8-7s8 3 8 7'}),
          ])
        ]);
        profileBtn.onclick = (e) => { e.stopPropagation(); showFriendProfile(f); };
        item.appendChild(profileBtn);
        flist.appendChild(item);
      });
    },

    renderRequests() {
      const sec = $('requests-section');
      const list = $('requests-list');
      const badge = $('req-count-badge');
      const pending = S.friendRequests.filter(r=>r.status==='pending'||!r.status);
      sec.classList.toggle('hidden', pending.length===0);
      badge.textContent = pending.length;
      updateRequestBadge();

      list.innerHTML='';
      pending.forEach((req,i) => {
        const from = req.from;
        const av = h('span',{class:'avatar-circle sm'});
        setAvatar(av, from.displayName, from.avatarColor);

        const meta = h('div',{class:'request-meta'},[
          h('div',{class:'request-name'},from.displayName),
          h('div',{class:'request-sub'},`@${from.username} wants to be friends`),
        ]);

        const acceptBtn = h('button',{class:'req-accept-btn',title:'Accept'},'✓');
        const declineBtn = h('button',{class:'req-decline-btn',title:'Decline'},'✕');

        acceptBtn.onclick = () => this.respond(req._id, 'accept', from);
        declineBtn.onclick = () => this.respond(req._id, 'decline', from);

        const item = h('div',{class:'request-item'},[av, meta, h('div',{class:'request-actions'},[acceptBtn, declineBtn])]);
        item.style.animationDelay = `${i*0.06}s`;
        list.appendChild(item);
      });
    },

    async respond(reqId, action, from) {
      try {
        const { friend } = await API.respondReq(reqId, action);
        S.friendRequests = S.friendRequests.filter(r => {
          const rIdStr = String(r._id);
          const rFromIdStr = r.from ? String(r.from._id || r.from) : '';
          const targetStr = String(reqId);
          return rIdStr !== targetStr && rFromIdStr !== targetStr;
        });
        if (action === 'accept' && friend) {
          if (!S.friends.find(f => String(f._id) === String(friend._id))) S.friends.push(friend);
          toast(`You and ${from?.displayName || friend.displayName} are now friends! 🎉`, 'success');
        } else {
          toast(`Request from ${from?.displayName || 'user'} declined`, 'info', 2000);
        }
        this.renderList();
        this.renderRequests();
        const q = $('user-search-input')?.value.trim();
        if (q) runSearch(q);
      } catch(e) { toast(e.message, 'error'); }
    },

    updateOnlineStatus(userId, online) {
      document.querySelectorAll(`[data-friend-id="${userId}"] .status-dot`).forEach(dot => {
        dot.className = `status-dot${online?' online':''}`;
      });
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // DM MODULE
  // ══════════════════════════════════════════════════════════════════════
  function openDM(friend) {
    S.currentChat = {
      type: 'dm',
      id: String(friend._id),
      recipientId: String(friend._id),
      name: friend.displayName,
      avatarColor: friend.avatarColor,
    };

    // Clear unread
    delete S.unreadDMs[String(friend._id)];
    updateDMBadge();
    Friends.renderList();

    // Update header
    setAvatar($('chat-avatar'), friend.displayName, friend.avatarColor);
    $('chat-header-name').textContent = friend.displayName;
    $('chat-status-dot').className = `status-dot${friend.online?' online':''}`;
    $('chat-header-sub').textContent = friend.online ? 'Online' : 'Offline';

    // Show/hide profile btn
    $('btn-show-profile').onclick = () => showFriendProfile(friend);

    showChatView();
    Messages.clear();
    S.lastRenderDate=null; S.lastRenderUser=null;

    // Load history
    API.dmHistory(String(friend._id)).then(msgs => Messages.renderAll(msgs)).catch(()=>{});

    // Highlight in list
    document.querySelectorAll('.conv-item').forEach(el => {
      el.classList.toggle('active', el.dataset.friendId===String(friend._id));
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // ROOMS MODULE
  // ══════════════════════════════════════════════════════════════════════
  const Rooms = {
    async load() {
      try { S.rooms = await API.rooms(); this.render(); }
      catch { toast('Could not load rooms','error'); }
    },
    render() {
      const list = $('rooms-list');
      list.innerHTML='';
      S.rooms.forEach((room,i) => {
        const icon = h('div',{class:'room-icon'},room.displayName.charAt(0).toUpperCase());
        const meta = h('div',{class:'room-item-meta'},[
          h('div',{class:'room-item-name'},`#${room.displayName}`),
          h('div',{class:'room-item-desc'},room.description||''),
        ]);
        const item = h('div',{class:`room-item${S.currentChat?.id===room.name?' active':''}`},[icon,meta]);
        item.style.animationDelay=`${i*0.05}s`;
        item.onclick = () => this.join(room);
        list.appendChild(item);
      });
    },
    join(room) {
      S.currentChat = { type:'room', id:room.name, name:room.displayName, avatarColor:'#007BA7' };
      S.lastRenderDate=null; S.lastRenderUser=null;

      setAvatar($('chat-avatar'), room.displayName, '#007BA7');
      $('chat-header-name').textContent = `#${room.displayName}`;
      $('chat-header-sub').textContent = room.description||'';
      $('chat-status-dot').className = 'status-dot hidden';
      $('btn-show-profile').onclick = null;

      showChatView();
      Messages.clear();
      socket.emit('join_room', { room: room.name });
      this.render();

      document.querySelectorAll('.room-item').forEach(el => {
        el.classList.toggle('active', el.querySelector('.room-item-name')?.textContent===`#${room.displayName}`);
      });
    },
  };

  function initRoomModal() {
    $('btn-create-room-open').onclick = () => $('modal-create-room').classList.remove('hidden');
    $('btn-close-modal').onclick = () => $('modal-create-room').classList.add('hidden');
    $('modal-create-room').onclick = e => { if(e.target===$('modal-create-room')) $('modal-create-room').classList.add('hidden'); };
    $('form-create-room').onsubmit = async e => {
      e.preventDefault();
      const name = $('room-name-input').value.trim();
      const desc = $('room-desc-input').value.trim();
      if (!name) return;
      try {
        const room = await API.createRoom({ displayName:name, description:desc });
        if (!S.rooms.find(r=>r._id===room._id)) S.rooms.push(room);
        Rooms.render();
        $('modal-create-room').classList.add('hidden');
        $('room-name-input').value=''; $('room-desc-input').value='';
        toast(`Room #${name} created!`,'success');
        Rooms.join(room);
        switchTab('rooms');
      } catch(e) { toast(e.message,'error'); }
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // SEARCH MODULE
  // ══════════════════════════════════════════════════════════════════════
  function initSearch() {
    let timer;
    $('user-search-input').oninput = () => {
      clearTimeout(timer);
      const q = $('user-search-input').value.trim();
      if (!q) { $('search-results').innerHTML='<div class="search-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="36" height="36"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg><p>Type a username to find friends</p></div>'; return; }
      $('search-results').innerHTML='<div class="search-hint"><div class="spinner"></div></div>';
      timer = setTimeout(() => runSearch(q), 400);
    };
  }

  async function runSearch(q) {
    try {
      const results = await API.search(q);
      renderSearchResults(results, q);
    } catch(e) { $('search-results').innerHTML=`<p style="color:var(--red-error);padding:16px">${e.message}</p>`; }
  }

  function renderSearchResults(results, q) {
    const container = $('search-results');
    if (!results.length) {
      container.innerHTML=`<div class="search-hint"><p>No users found for "<strong>${escHtml(q)}</strong>"</p></div>`;
      return;
    }
    container.innerHTML='';
    results.forEach((user,i) => {
      const av = h('span',{class:'avatar-circle sm'});
      setAvatar(av, user.displayName, user.avatarColor);

      const meta = h('div',{class:'search-result-meta'},[
        h('div',{class:'search-result-name',title:user.displayName},user.displayName),
        h('div',{class:'search-result-username'},`@${user.username}`),
      ]);

      let addLabel='Add Friend', addClass='add-btn';
      if (user.isFriend) { addLabel='Friends ✓'; addClass='add-btn friend'; }
      else if (user.requestSent) { addLabel='Sent ✓'; addClass='add-btn sent'; }
      else if (user.requestReceived) { addLabel='Accept Request'; addClass='add-btn received'; }

      const addBtn = h('button',{class:addClass},addLabel);
      if (user.isFriend) {
        addBtn.onclick = () => {
          const f = S.friends.find(f=>String(f._id)===String(user._id));
          if (f) openDM(f); switchTab('dms');
        };
      } else if (user.requestReceived) {
        addBtn.onclick = async () => {
          addBtn.disabled = true; addBtn.textContent = 'Accepting…';
          try {
            const pendingReq = S.friendRequests.find(r => r.from && String(r.from._id || r.from) === String(user._id));
            const reqId = pendingReq ? pendingReq._id : String(user._id);
            await Friends.respond(reqId, 'accept', user);
            addBtn.textContent = 'Friends ✓'; addBtn.className = 'add-btn friend';
          } catch(e) { toast(e.message, 'error'); addBtn.disabled = false; addBtn.textContent = addLabel; }
        };
      } else if (!user.requestSent) {
        addBtn.onclick = async () => {
          addBtn.disabled=true; addBtn.textContent='Sending…';
          try {
            const res = await API.sendReq(String(user._id));
            if (res.isFriend) {
              addBtn.textContent='Friends ✓'; addBtn.className='add-btn friend';
              toast(`You and ${user.displayName} are now friends! 🎉`, 'success');
              await Friends.load();
            } else {
              addBtn.textContent='Sent ✓'; addBtn.className='add-btn sent';
              toast(`Friend request sent to ${user.displayName}!`, 'success');
            }
          } catch(e) { toast(e.message,'error'); addBtn.disabled=false; addBtn.textContent=addLabel; }
        };
      }

      const item = h('div',{class:'search-result-item'},[av,meta,addBtn]);
      item.style.animationDelay=`${i*0.05}s`;
      container.appendChild(item);
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // PROFILE PANEL & EDIT PROFILE MODAL
  // ══════════════════════════════════════════════════════════════════════
  function showFriendProfile(friend) {
    const panel = $('right-panel');
    setAvatar($('profile-avatar'), friend.displayName, friend.avatarColor);
    $('profile-name').textContent = friend.displayName;
    $('profile-username').textContent = `@${friend.username}`;
    $('profile-bio').textContent = friend.bio||'';
    $('profile-joined').textContent = fmtJoined(friend.createdAt||new Date());

    const online = friend.online;
    $('profile-status-dot').className = `status-dot lg${online?' online':''}`;
    $('profile-status-text').textContent = online?'Online':'Offline';
    $('profile-status-text').className = `profile-status-text${online?' online':''}`;

    const actions = $('profile-actions');
    actions.innerHTML='';
    const dmBtn = h('button',{class:'btn-accent'},'Send Message');
    dmBtn.onclick = () => { openDM(friend); switchTab('dms'); };
    const removeBtn = h('button',{class:'btn-danger'},'Remove Friend');
    removeBtn.onclick = async () => {
      if (!confirm(`Remove ${friend.displayName} from friends?`)) return;
      try {
        await API.removeFriend(String(friend._id));
        S.friends = S.friends.filter(f=>String(f._id)!==String(friend._id));
        Friends.renderList();
        panel.classList.add('hidden');
        toast(`${friend.displayName} removed from friends`, 'info');
      } catch(e) { toast(e.message,'error'); }
    };
    actions.append(dmBtn, removeBtn);
    panel.classList.remove('hidden');
  }

  function showMyProfile() {
    const u = S.user;
    setAvatar($('profile-avatar'), u.displayName, u.avatarColor);
    $('profile-name').textContent = u.displayName;
    $('profile-username').textContent = `@${u.username}`;
    $('profile-bio').textContent = u.bio||'';
    $('profile-joined').textContent = fmtJoined(u.createdAt||new Date());
    $('profile-status-dot').className = 'status-dot lg online';
    $('profile-status-text').textContent = 'Online';
    $('profile-status-text').className = 'profile-status-text online';
    
    const actions = $('profile-actions');
    actions.innerHTML='';
    const editBtn = h('button', { class: 'btn-edit-profile' }, [
      h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', width: '16', height: '16' }, [
        h('path', { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' }),
        h('path', { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' }),
      ]),
      'Edit Profile'
    ]);
    editBtn.onclick = () => openEditProfileModal();
    actions.appendChild(editBtn);

    $('right-panel').classList.remove('hidden');
  }

  let selectedAvatarColor = '#007BA7';

  function initProfileModal() {
    const modal = $('modal-edit-profile');
    if (!modal) return;
    $('btn-close-profile-modal').onclick = () => modal.classList.add('hidden');
    modal.onclick = e => { if (e.target === modal) modal.classList.add('hidden'); };

    $('form-edit-profile').onsubmit = async e => {
      e.preventDefault();
      const dn = $('edit-displayname').value.trim();
      const un = $('edit-username').value.trim().toLowerCase();
      const bio = $('edit-bio').value.trim();
      const err = $('edit-profile-error');
      err.classList.add('hidden');

      if (!dn || !un) {
        err.textContent = 'Display name and username are required';
        err.classList.remove('hidden');
        return;
      }

      const btn = $('btn-save-profile');
      btn.disabled = true;
      qs('.btn-label', btn).textContent = 'Saving…';

      try {
        const res = await API.updateProfile({
          displayName: dn,
          username: un,
          bio,
          avatarColor: selectedAvatarColor
        });

        S.user = res.user;
        if (res.token) {
          S.token = res.token;
          localStorage.setItem('fm_token', res.token);
          initSocket();
        }

        setAvatar($('rail-avatar'), res.user.displayName, res.user.avatarColor);
        $('welcome-name').textContent = res.user.displayName;
        showMyProfile();
        Friends.renderList();

        modal.classList.add('hidden');
        toast('Profile updated successfully! ✨', 'success');
      } catch (e) {
        err.textContent = e.message;
        err.classList.remove('hidden');
      } finally {
        btn.disabled = false;
        qs('.btn-label', btn).textContent = 'Save Changes';
      }
    };
  }

  function openEditProfileModal() {
    const u = S.user;
    $('edit-displayname').value = u.displayName || '';
    $('edit-username').value = u.username || '';
    $('edit-bio').value = u.bio || '';
    selectedAvatarColor = u.avatarColor || '#007BA7';

    const grid = $('edit-color-picker');
    grid.innerHTML = '';
    AVATAR_COLORS.forEach(c => {
      const swatch = h('div', {
        class: `color-swatch${c === selectedAvatarColor ? ' active' : ''}`,
        style: `background:${c}`
      });
      swatch.onclick = () => {
        grid.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        selectedAvatarColor = c;
      };
      grid.appendChild(swatch);
    });

    $('edit-profile-error').classList.add('hidden');
    $('modal-edit-profile').classList.remove('hidden');
  }

  // ══════════════════════════════════════════════════════════════════════
  // MESSAGES MODULE
  // ══════════════════════════════════════════════════════════════════════
  const Messages = {
    clear() {
      $('messages-inner').innerHTML='';
      S.lastRenderDate=null; S.lastRenderUser=null;
    },
    renderAll(msgs) {
      this.clear();
      msgs.forEach(m => this.append(m, false));
      this.scrollToBottom();
    },
    append(msg, scroll=true) {
      const inner = $('messages-inner');
      const isSelf = String(msg.senderId)===String(S.user._id) || msg.senderName===S.user.displayName;
      const dateLabel = fmtDate(msg.createdAt||Date.now());

      if (dateLabel !== S.lastRenderDate) {
        inner.appendChild(h('div',{class:'date-divider'},dateLabel));
        S.lastRenderDate = dateLabel;
        S.lastRenderUser = null;
      }

      const showHeader = msg.senderName !== S.lastRenderUser;
      const group = h('div',{class:'msg-group'});

      if (showHeader) {
        const header = h('div',{class:`msg-header${isSelf?' self':''}`});
        const av = h('span',{class:'avatar-circle sm'});
        setAvatar(av, msg.senderName, isSelf ? S.user.avatarColor : null);
        const uname = h('span',{class:'msg-username'}, isSelf?'You':msg.senderName);
        const time  = h('span',{class:'msg-time'}, fmtTime(msg.createdAt||Date.now()));
        isSelf ? header.append(time, uname, av) : header.append(av, uname, time);
        group.appendChild(header);
      }

      const row = h('div',{class:`msg-row${isSelf?' self':''}`});
      if (!showHeader) {
        const sp = h('span',{class:'avatar-spacer'});
        if (!isSelf) row.appendChild(sp);
      }
      const bubble = h('div',{class:`msg-bubble ${isSelf?'self':'other'}`});
      bubble.innerHTML = linkify(msg.text);
      row.appendChild(bubble);
      if (isSelf && !showHeader) row.appendChild(h('span',{class:'avatar-spacer'}));
      group.appendChild(row);

      inner.appendChild(group);
      S.lastRenderUser = msg.senderName;
      if (scroll) this.scrollToBottom();
    },
    appendSystem(text) {
      const inner = $('messages-inner');
      const placeholder = inner.querySelector('.messages-placeholder');
      if (placeholder) placeholder.remove();
      inner.appendChild(h('div',{class:'msg-system'},text));
      this.scrollToBottom();
    },
    scrollToBottom() {
      const w = $('messages-wrap');
      w.scrollTo({ top:w.scrollHeight, behavior:'smooth' });
    },
  };

  // ══════════════════════════════════════════════════════════════════════
  // CHAT INPUT
  // ══════════════════════════════════════════════════════════════════════
  function initChatInput() {
    const input = $('msg-input');

    $('msg-form').onsubmit = e => { e.preventDefault(); sendMsg(); };
    input.addEventListener('keydown', e => {
      if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
    });
    input.addEventListener('input', () => {
      autoGrow(input);
      handleTyping();
    });
  }

  function sendMsg() {
    const input = $('msg-input');
    const text = input.value.trim();
    if (!text || !S.currentChat || !socket) return;

    if (S.currentChat.type==='dm') {
      socket.emit('send_dm', { recipientId: S.currentChat.recipientId, text });
    } else {
      socket.emit('send_message', { room: S.currentChat.id, text });
    }

    input.value=''; input.style.height='auto';
    stopTyping();
    closeEmoji();
  }

  function handleTyping() {
    if (!socket || !S.currentChat) return;
    if (!S.isTyping) {
      S.isTyping=true;
      if (S.currentChat.type==='dm') {
        socket.emit('typing_dm', { recipientId: S.currentChat.recipientId });
      } else {
        socket.emit('typing', { room: S.currentChat.id });
      }
    }
    clearTimeout(S.typingTimer);
    S.typingTimer = setTimeout(stopTyping, 2000);
  }
  function stopTyping() {
    if (!S.isTyping || !socket || !S.currentChat) return;
    S.isTyping=false;
    if (S.currentChat.type==='dm') {
      socket.emit('stop_typing_dm', { recipientId: S.currentChat.recipientId });
    } else {
      socket.emit('stop_typing', { room: S.currentChat.id });
    }
  }

  function showChatView() {
    $('chat-empty').style.display='none';
    $('chat-active').classList.remove('hidden');
  }

  // ══════════════════════════════════════════════════════════════════════
  // EMOJI PICKER
  // ══════════════════════════════════════════════════════════════════════
  function initEmojiPicker() {
    const picker = $('emoji-picker');
    const grid = h('div',{class:'emoji-grid'});
    EMOJIS.forEach(em => {
      const btn = h('button',{type:'button',class:'e-btn'},em);
      btn.onclick = () => {
        const inp=$('msg-input'), pos=inp.selectionStart;
        inp.value=inp.value.slice(0,pos)+em+inp.value.slice(pos);
        inp.focus(); inp.selectionStart=inp.selectionEnd=pos+em.length;
        autoGrow(inp); closeEmoji();
      };
      grid.appendChild(btn);
    });
    picker.appendChild(grid);

    $('btn-emoji').onclick = e => { e.stopPropagation(); S.emojiOpen?closeEmoji():openEmoji(); };
    document.addEventListener('click', e => { if (!picker.contains(e.target)&&e.target!==$('btn-emoji')) closeEmoji(); });
  }
  function openEmoji() {
    const picker=$('emoji-picker'), btn=$('btn-emoji'), rect=btn.getBoundingClientRect();
    picker.classList.remove('hidden');
    picker.style.bottom=(window.innerHeight-rect.top+10)+'px';
    picker.style.left=Math.max(8,rect.left-80)+'px';
    S.emojiOpen=true;
    $('btn-emoji').setAttribute('aria-expanded','true');
  }
  function closeEmoji() {
    $('emoji-picker').classList.add('hidden');
    S.emojiOpen=false;
    $('btn-emoji').setAttribute('aria-expanded','false');
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3D TILT PHYSICS & MOUSE PARALLAX
  // ══════════════════════════════════════════════════════════════════════
  function apply3DTilt(el, maxTilt = 10) {
    if (!el || el.dataset.tiltInit) return;
    el.dataset.tiltInit = 'true';
    el.style.transformStyle = 'preserve-3d';

    el.addEventListener('mousemove', e => {
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const rotX = (((y / rect.height) - 0.5) * -maxTilt).toFixed(2);
      const rotY = (((x / rect.width) - 0.5) * maxTilt).toFixed(2);
      el.style.transform = `perspective(1000px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.02, 1.02, 1.02)`;
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
    });
  }

  function init3DElements() {
    const selector = '.auth-card, .modal, .conv-item, .search-result-item, .request-item, .room-item';
    document.querySelectorAll(selector).forEach(el => apply3DTilt(el));
  }

  // ══════════════════════════════════════════════════════════════════════
  // PARTICLES
  // ══════════════════════════════════════════════════════════════════════
  function initParticles() {
    const canvas = $('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    function spawn(n) {
      particles = [];
      const colors = ['#00F0FF', '#A855F7', '#EC4899', '#38BDF8'];
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          r: Math.random() * 2 + 0.8,
          c: colors[Math.floor(Math.random() * colors.length)],
          alpha: Math.random() * 0.5 + 0.2
        });
      }
    }
    spawn(70);

    function frame() {
      ctx.clearRect(0, 0, W, H);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = p.alpha;
        ctx.shadowBlur = 10;
        ctx.shadowColor = p.c;
        ctx.fill();

        for (let j = i + 1; j < particles.length; j++) {
          const p2 = particles[j];
          const dx = p.x - p2.x;
          const dy = p.y - p2.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 110) {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.strokeStyle = '#00F0FF';
            ctx.globalAlpha = (1 - dist / 110) * 0.2;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      requestAnimationFrame(frame);
    }
    frame();
  }

  // ══════════════════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    initParticles();
    initSearch();
    Auth.init();
    setInterval(init3DElements, 1000);
  });
})();
