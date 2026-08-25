// Auth check
const userData = localStorage.getItem('aegis_user');
if (!userData) {
  window.location.href = '/login';
}
const currentUser = JSON.parse(userData);

document.getElementById('currentUsername').textContent = currentUser.username;

// F-04: escape semua string dari DB/klien sebelum masuk innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ponytail: createIcons scan seluruh dokumen tiap render — cukup utk skala ini; ganti scoped render jika berat
function refreshIcons() { if (window.lucide) lucide.createIcons(); }
refreshIcons();

// Avatar = ikon dari koleksi avatars.js
document.getElementById('navAvatar').textContent = getAvatar(currentUser.avatar);

// WebSocket connection
const socket = io();
let selectedPartner = null;
let selectedPartnerId = null;
let selectedGroup = null; // object {id, name} = group mode, null = DM mode
let allMessages = [];
let contactsMap = new Map();
let pendingFile = null;
let loadedGroups = []; // cached from last loadGroups() — group info modal reads this

// Bulk delete mode
let bulkDeleteMode = false;
let selectedMessageIds = new Set();

// Message search
let searchTerm = '';
let allMessagesBackup = [];

// Join chat — F-06: identitas dari cookie sesi via handshake, bukan payload
socket.on('connect_error', (err) => {
  if (/unauthorized/i.test(err.message)) window.location.href = '/login';
});

// Update local time
function updateTime() {
  const now = new Date();
  const t = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('timeDisplay').textContent = t;
}
setInterval(updateTime, 1000);
updateTime();

// Track online users
let onlineUsernames = new Set();

// Load contacts
async function loadContacts() {
  try {
    const response = await fetch(`/api/chat/users/${currentUser.id}`);
    console.log('[Contacts] Response status:', response.status);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log('[Contacts] Data received:', data);
    if (data.success && data.users && data.users.length > 0) {
      data.users.forEach(user => {
        contactsMap.set(user.username, user);
      });
      renderContactsListModal(data.users);
    } else {
      document.getElementById('contactsListModal').innerHTML = '<div style="text-align:center; color:#9ca3af; padding:20px;">No contacts yet. Use Add Contact to send a request.</div>';
    }
  } catch (err) {
    console.error('[Contacts] Load error:', err);
    document.getElementById('contactsListModal').innerHTML = `<div style="text-align:center; color:#ff6b6b; padding:20px;">Error loading contacts: ${err.message}</div>`;
  }
}

// Render contacts list in modal with online status
function renderContactsListModal(users) {
  const contactsHTML = users.map(user => {
    const isOnline = onlineUsernames.has(user.username);
    const avatarEmoji = getAvatar(user.avatar);
    
    // Check if blocked
    const isBlockedByMe = user.is_blocked_by_me === 1;
    const hasBlockedMe = user.has_blocked_me === 1;
    
    let statusText = isOnline ? 'Online' : 'Offline';
    let statusClass = isOnline ? 'online' : 'offline';
    
    if (isBlockedByMe) {
      statusText = '🚫 Blocked';
      statusClass = 'blocked';
    } else if (hasBlockedMe) {
      statusText = '🚫 Blocked you';
      statusClass = 'blocked';
    }
    
    return `
      <div class="contact ${isBlockedByMe || hasBlockedMe ? 'contact-blocked' : ''}" 
           data-user="${esc(user.username)}" 
           data-userid="${user.id}" 
           data-email="${esc(user.email)}" 
           data-avatar="${esc(user.avatar || 'avatar1')}"
           data-blocked="${isBlockedByMe ? '1' : '0'}"
           data-has-blocked-me="${hasBlockedMe ? '1' : '0'}">
        <div class="contact-avatar">${avatarEmoji}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(user.username)}</div>
          <div class="contact-status">
            <span class="status-dot ${statusClass}"></span>${statusText}
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  document.getElementById('contactsListModal').innerHTML = contactsHTML;
  updateUnreadUI(); // badge pesan belum dibaca selamat melewati re-render daftar
  
  // Add click handlers
  document.querySelectorAll('#contactsListModal .contact').forEach(c => {
    c.addEventListener('click', () => {
      selectContact(c);
      closeContactsModal(); // Close modal after selecting
    });
  });
}

// ===== GROUPS =====
async function loadGroups() {
  try {
    const response = await fetch(`/api/chat/groups/${currentUser.id}`);
    const data = await response.json();
    renderGroupsList(data.groups || []);
  } catch (err) {
    console.error('[Groups] Load error:', err);
  }
}

function renderGroupsList(groups) {
  loadedGroups = groups;
  const el = document.getElementById('groupsList');
  if (!el) return;
  if (groups.length === 0) {
    el.innerHTML = '<div class="groups-empty">No groups yet</div>';
    return;
  }
  el.innerHTML = groups.map(g => `
    <div class="contact group-item ${selectedGroup && selectedGroup.id === g.id ? 'active' : ''}"
         data-groupid="${g.id}"
         data-groupname="${esc(g.name)}"
         data-members="${(g.members || []).length}">
      <div class="contact-avatar"><i data-lucide="users"></i></div>
      <div class="contact-info">
        <div class="contact-name">${esc(g.name)}</div>
        <div class="contact-status">${(g.members || []).length} members</div>
      </div>
    </div>`).join('');
  updateUnreadUI(); // badge pesan belum dibaca
  refreshIcons();
  el.querySelectorAll('.group-item').forEach(item => {
    item.addEventListener('click', () => {
      selectGroup(item);
      closeContactsModal();
    });
  });
}

async function selectGroup(groupEl) {
  document.querySelectorAll('#contactsListModal .contact').forEach(c => c.classList.remove('active'));
  groupEl.classList.add('active');

  selectedGroup = { id: Number(groupEl.getAttribute('data-groupid')), name: groupEl.getAttribute('data-groupname') };
  selectedPartner = null;
  selectedPartnerId = null;
  localStorage.removeItem('aegis_last_chat');
  localStorage.setItem('aegis_last_group', selectedGroup.id);
  clearUnread('group:' + selectedGroup.id);

  // Reset bulk delete mode
  bulkDeleteMode = false;
  selectedMessageIds.clear();
  document.getElementById('toggleBulkMode').style.display = 'inline-block';
  document.getElementById('bulkDeleteBtn').style.display = 'none';
  document.getElementById('cancelBulkMode').style.display = 'none';

  // Header: name + member count, no online dot for groups
  document.getElementById('chatPartnerName').textContent = selectedGroup.name;
  document.getElementById('chatPartnerName').style.cursor = 'pointer';
  document.getElementById('chatPartnerStatus').textContent = `${groupEl.getAttribute('data-members')} members`;
  const dot = document.getElementById('chatPartnerDot');
  dot.className = 'status-dot offline';
  dot.style.display = 'none';
  document.getElementById('chatPartnerAvatar').innerHTML = '<i data-lucide="users"></i>';
  refreshIcons();

  // Enable input
  ['msgInput', 'encryptBtn'].forEach(id => {
    const el = document.getElementById(id);
    el.disabled = false;
    el.style.opacity = '1';
  });
  document.getElementById('fileInput').disabled = false;
  document.getElementById('msgInput').placeholder = 'Type your message...';

  await loadGroupMessages();
}

async function loadGroupMessages() {
  if (!selectedGroup) return;
  try {
    const response = await fetch(`/api/chat/group-messages/${selectedGroup.id}`);
    const data = await response.json();
    if (data.success) {
      allMessages = data.messages || [];
      renderMessages();
    }
  } catch (err) {
    console.error('[Groups] Message load error:', err);
  }
}

// ===== GROUP INFO / LEAVE =====
// ponytail: member list dari cache loadedGroups (refresh saat modal kontak dibuka) — live refresh perlu socket event
function openGroupInfo() {
  if (!selectedGroup) return;
  const g = loadedGroups.find(x => x.id === selectedGroup.id);
  const members = (g && g.members) || [];
  const isAdmin = members.some(m => m.id === currentUser.id && m.role === 'admin');
  document.getElementById('groupInfoName').textContent = g ? g.name : selectedGroup.name;
  document.getElementById('groupInfoCount').textContent = `${members.length} members`;
  document.getElementById('groupMembersList').innerHTML = members.map(m => `
    <div class="contact" style="cursor:default;">
      <div class="contact-avatar">${getAvatar(m.avatar)}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(m.username)}${m.role === 'admin' ? ' <span style="color:var(--primary); font-size:11px; font-weight:700;">(admin)</span>' : ''}${m.id === currentUser.id ? ' <span style="color:#6b7280; font-size:11px;">(you)</span>' : ''}</div>
        <div class="contact-status"><span class="status-dot ${onlineUsernames.has(m.username) ? 'online' : 'offline'}"></span>${onlineUsernames.has(m.username) ? 'Online' : 'Offline'}</div>
      </div>
      ${isAdmin && m.role !== 'admin' ? `<button class="icon-btn sm danger" data-kick="${m.id}" title="Keluarkan anggota"><i data-lucide="user-x"></i></button>` : ''}
    </div>`).join('');
  document.getElementById('adminGroupActions').style.display = isAdmin ? '' : 'none';
  document.getElementById('dissolveGroupBtn').style.display = isAdmin ? '' : 'none';
  document.getElementById('addMemberPick').style.display = 'none';
  document.getElementById('adminLeavePick').style.display = 'none';
  document.getElementById('groupInfoOverlay').classList.add('active');
  refreshIcons();
}

function closeGroupInfo() {
  document.getElementById('groupInfoOverlay').classList.remove('active');
}

document.getElementById('groupInfoClose').addEventListener('click', closeGroupInfo);
document.getElementById('groupInfoOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeGroupInfo();
});

// Reset chat pane after leaving/dissolving the selected group
function resetChatPane() {
  closeGroupInfo();
  selectedGroup = null;
  allMessages = [];
  document.getElementById('chatPartnerName').textContent = 'Select a contact';
  document.getElementById('chatPartnerStatus').textContent = 'Open Contacts menu to select a chat partner';
  document.getElementById('chatPartnerAvatar').textContent = '?';
  document.getElementById('chatMessages').innerHTML = '<div class="empty-state"><i data-lucide="lock"></i><p>End-to-end encrypted conversation. Send the first message.</p></div>';
  refreshIcons();
}

// Admin with remaining members must appoint a successor before leaving
function showAdminSuccessorPicker(others) {
  const pick = document.getElementById('adminLeavePick');
  pick.innerHTML = `<div class="groups-label">Pilih admin baru sebelum keluar</div>` +
    others.map(m => `
    <div class="member-pick" data-successor="${m.id}" style="cursor:pointer;"><span>${esc(m.username)}</span></div>`).join('') +
    `<button class="ghost-btn" id="cancelSuccessorPick" style="width:100%; justify-content:center; margin-top:8px;">Batal</button>`;
  pick.style.display = '';
}

document.getElementById('leaveGroupBtn').addEventListener('click', async () => {
  if (!selectedGroup) return;
  const g = loadedGroups.find(x => x.id === selectedGroup.id);
  const members = (g && g.members) || [];
  const me = members.find(m => m.id === currentUser.id);
  const others = members.filter(m => m.id !== currentUser.id);

  if (me && me.role === 'admin' && others.length > 0) {
    showAdminSuccessorPicker(others);
    return;
  }

  // Konfirmasi wajib — keluar grup tidak bisa dibatalkan, butuh di-add ulang untuk join kembali
  if (!(await appConfirm(`Kamu harus di-add ulang untuk bergabung lagi.`, `Keluar dari grup "${selectedGroup.name}"?`, { danger: true }))) return;
  try {
    const res = await fetch('/api/chat/groups/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: selectedGroup.id, userId: currentUser.id })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to leave group');
    resetChatPane();
    loadGroups();
  } catch (err) {
    console.error('[Groups] Leave error:', err);
    appAlert(err.message);
  }
});

// Successor picked -> transfer admin then leave
document.getElementById('adminLeavePick').addEventListener('click', async (e) => {
  if (e.target.closest('#cancelSuccessorPick')) {
    document.getElementById('adminLeavePick').style.display = 'none';
    return;
  }
  const row = e.target.closest('[data-successor]');
  if (!row || !selectedGroup) return;
  const successorId = Number(row.dataset.successor);
  const g = loadedGroups.find(x => x.id === selectedGroup.id);
  const successor = ((g && g.members) || []).find(m => m.id === successorId);
  if (!(await appConfirm(`${successor ? successor.username : 'Anggota ini'} menjadi admin baru, lalu kamu keluar dari grup.`, 'Transfer Admin', { danger: true }))) return;
  try {
    const res = await fetch('/api/chat/groups/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: selectedGroup.id, userId: currentUser.id, newAdminId: successorId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to leave group');
    document.getElementById('adminLeavePick').style.display = 'none';
    resetChatPane();
    loadGroups();
  } catch (err) {
    appAlert(err.message);
  }
});

loadContacts();
loadGroups();

// Admin: kick a member (button on member rows)
document.getElementById('groupMembersList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-kick]');
  if (!btn || !selectedGroup) return;
  const uid = Number(btn.dataset.kick);
  const g = loadedGroups.find(x => x.id === selectedGroup.id);
  const target = ((g && g.members) || []).find(m => m.id === uid);
  if (!(await appConfirm(`Keluarkan ${target ? target.username : 'anggota ini'} dari grup?`, 'Keluarkan Anggota', { danger: true }))) return;
  try {
    const res = await fetch('/api/chat/groups/remove-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: selectedGroup.id, requesterId: currentUser.id, userId: uid })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to remove member');
    await loadGroups();
    openGroupInfo(); // re-render list from refreshed cache, modal stays open
  } catch (err) {
    appAlert(err.message);
  }
});

// Admin: toggle add-member picker (contacts not yet in group)
document.getElementById('addMemberBtn').addEventListener('click', () => {
  const pick = document.getElementById('addMemberPick');
  if (pick.style.display !== 'none') { pick.style.display = 'none'; return; }
  const g = loadedGroups.find(x => x.id === selectedGroup.id);
  const memberIds = new Set(((g && g.members) || []).map(m => m.id));
  const candidates = Array.from(contactsMap.values()).filter(u => !memberIds.has(u.id));
  pick.innerHTML = candidates.map(u => `
    <div class="member-pick" data-add="${u.id}" style="cursor:pointer;"><span>${esc(u.username)}</span></div>`).join('')
    || '<div style="color:#9ca3af;padding:8px 0;">Semua kontak sudah jadi anggota</div>';
  pick.style.display = '';
});

document.getElementById('addMemberPick').addEventListener('click', async (e) => {
  const row = e.target.closest('[data-add]');
  if (!row || !selectedGroup) return;
  try {
    const res = await fetch('/api/chat/groups/add-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: selectedGroup.id, requesterId: currentUser.id, userId: Number(row.dataset.add) })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to add member');
    appAlert('Undangan dikirim — menunggu persetujuan.');
    await loadGroups();
    openGroupInfo();
  } catch (err) {
    appAlert(err.message);
  }
});

// Admin: dissolve the whole group
document.getElementById('dissolveGroupBtn').addEventListener('click', async () => {
  if (!selectedGroup) return;
  // Konfirmasi wajib — pembubaran permanen: semua pesan grup terhapus
  if (!(await appConfirm(`Semua pesan grup hilang permanen dan tidak bisa dikembalikan.`, `Bubarkan grup "${selectedGroup.name}"?`, { danger: true }))) return;
  try {
    const res = await fetch('/api/chat/groups/dissolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: selectedGroup.id, requesterId: currentUser.id })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || 'Failed to dissolve group');
    resetChatPane();
    loadGroups();
  } catch (err) {
    appAlert(err.message);
  }
});

// Logo click = refresh + selalu mendarat di halaman Beranda
function refreshFromLogo() {
  document.getElementById('logoBtn').classList.add('refreshing');
  localStorage.setItem('aegis_active_tab', 'home'); // restoreLastState akan buka Beranda setelah reload
  setTimeout(() => location.reload(), 150); // brief spin feedback before reload
}
document.getElementById('logoBtn').addEventListener('click', refreshFromLogo);
document.getElementById('logoBtn').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); refreshFromLogo(); }
});

// Restore last state after page load
async function restoreLastState() {
  const lastTab = localStorage.getItem('aegis_active_tab');

  console.log('[State] Restoring - lastTab:', lastTab);

  // Wait for contacts to load
  await new Promise(resolve => setTimeout(resolve, 500));

  // Cek tab DULU sebelum memulihkan obrolan — supaya refresh di Beranda
  // tidak membuka obrolan terakhir lagi
  if (lastTab === 'profile') {
    document.getElementById('navProfile').click();
    return;
  }
  if (lastTab === 'home') {
    document.getElementById('navHome').click();
    return;
  }

  // Tab Chat/Contacts/default: pulihkan obrolan terakhir
  const lastGroupId = Number(localStorage.getItem('aegis_last_group'));
  if (lastGroupId) {
    await loadGroups();
    const groupEl = document.querySelector(`#groupsList .group-item[data-groupid="${lastGroupId}"]`);
    if (groupEl) {
      await selectGroup(groupEl);
      console.log('[State] Restored group:', lastGroupId);
      return;
    }
  }

  // Restore last chat partner if exists
  const lastChat = localStorage.getItem('aegis_last_chat');
  if (lastChat) {
    const contactEl = document.querySelector(`#contactsListModal .contact[data-user="${lastChat}"]`);
    if (contactEl) {
      await selectContact(contactEl);
      console.log('[State] Restored chat with:', lastChat);
    }
  }
}

// Call restore after a short delay to ensure DOM is ready
setTimeout(restoreLastState, 100);



// Contacts modal functions
function openContactsModal() {
  document.getElementById('contactsModalOverlay').classList.add('active');
  loadContacts();       // fresh list every open (ponytail: polling saat modal dibuka, bukan socket event)
  loadContactRequests();
  loadGroupInvites();
}

function closeContactsModal() {
  document.getElementById('contactsModalOverlay').classList.remove('active');
}

// Search contacts functionality in modal
document.getElementById('searchContactsModal').addEventListener('input', (e) => {
  const searchTerm = e.target.value.toLowerCase().trim();
  const allUsers = Array.from(contactsMap.values());
  
  if (searchTerm === '') {
    // Show all contacts if search is empty
    renderContactsListModal(allUsers);
  } else {
    // Filter contacts by username
    const filteredUsers = allUsers.filter(user => 
      user.username.toLowerCase().includes(searchTerm)
    );
    renderContactsListModal(filteredUsers);
  }
});

// Contacts modal event listeners
document.getElementById('navContacts').addEventListener('click', (e) => {
  e.preventDefault();
  
  // Save active tab
  localStorage.setItem('aegis_active_tab', 'contacts');
  
  openContactsModal();
});

document.getElementById('contactsModalClose').addEventListener('click', closeContactsModal);

document.getElementById('contactsModalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeContactsModal();
});

// New group form
document.getElementById('newGroupBtn').addEventListener('click', () => {
  const form = document.getElementById('newGroupForm');
  const pick = document.getElementById('groupMembersPick');
  pick.innerHTML = Array.from(contactsMap.values()).map(u => `
    <label class="member-pick"><input type="checkbox" value="${u.id}"> <span>${esc(u.username)}</span></label>`).join('')
    || '<div style="color:#9ca3af;padding:8px 0;">No contacts to add</div>';
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('cancelGroupBtn').addEventListener('click', () => {
  document.getElementById('newGroupForm').style.display = 'none';
});

document.getElementById('createGroupBtn').addEventListener('click', async () => {
  const name = document.getElementById('groupNameInput').value.trim();
  const ids = Array.from(document.querySelectorAll('#groupMembersPick input:checked')).map(cb => Number(cb.value));

  if (!name) { appAlert('Enter a group name'); return; }
  if (ids.length === 0) { appAlert('Select at least one member'); return; }

  try {
    const response = await fetch('/api/chat/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, creatorId: currentUser.id, memberIds: ids })
    });
    const data = await response.json();
    if (data.success) {
      document.getElementById('newGroupForm').style.display = 'none';
      document.getElementById('groupNameInput').value = '';
      appAlert(`✓ Group "${name}" created`);
      loadGroups();
    } else {
      appAlert(data.error || 'Failed to create group');
    }
  } catch (err) {
    console.error('[Groups] Create error:', err);
    appAlert('Failed to create group');
  }
});

// ===== FRIEND REQUESTS =====
async function loadContactRequests() {
  try {
    const response = await fetch(`/api/chat/contacts/requests/${currentUser.id}`);
    const data = await response.json();
    renderContactRequests(data.incoming || []);
  } catch (err) {
    console.error('[Contacts] Requests load error:', err);
  }
}

function renderContactRequests(incoming) {
  const label = document.getElementById('requestsLabel');
  const el = document.getElementById('requestsList');
  if (!label || !el) return;
  label.style.display = incoming.length ? '' : 'none';
  el.innerHTML = incoming.map(r => `
    <div class="contact" data-requestid="${r.id}">
      <div class="contact-avatar">${getAvatar(r.requester_avatar || 'avatar1')}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(r.requester_username)}</div>
        <div class="contact-status">wants to connect</div>
      </div>
      <div style="margin-left:auto; display:flex; gap:6px;">
        <button class="ghost-btn req-accept" style="padding:4px 10px;">Accept</button>
        <button class="ghost-btn danger req-reject" style="padding:4px 10px;">Reject</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('.req-accept').forEach(b => b.addEventListener('click', () => respondRequest(b, 'accept')));
  el.querySelectorAll('.req-reject').forEach(b => b.addEventListener('click', () => respondRequest(b, 'reject')));
}

async function respondRequest(btn, action) {
  const requestId = Number(btn.closest('.contact').getAttribute('data-requestid'));
  try {
    const response = await fetch('/api/chat/contacts/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, userId: currentUser.id, action })
    });
    const data = await response.json();
    if (data.success) {
      loadContactRequests();
      if (action === 'accept') loadContacts();
      refreshInviteBadge();
    } else {
      appAlert(data.error || 'Failed to update request');
    }
  } catch (err) {
    appAlert('Connection error. Please try again.');
  }
}

// ===== GROUP INVITES (admin invite -> target must accept) =====
async function loadGroupInvites() {
  try {
    const response = await fetch(`/api/chat/invites/${currentUser.id}`);
    const data = await response.json();
    renderGroupInvites(data.invites || []);
  } catch (err) {
    console.error('[Groups] Invites load error:', err);
  }
}

function renderGroupInvites(invites) {
  const label = document.getElementById('groupInvitesLabel');
  const el = document.getElementById('groupInvitesList');
  if (!label || !el) return;
  label.style.display = invites.length ? '' : 'none';
  el.innerHTML = invites.map(inv => `
    <div class="contact" data-inviteid="${inv.id}">
      <div class="contact-avatar">${getAvatar(inv.inviter_avatar || 'avatar1')}</div>
      <div class="contact-info">
        <div class="contact-name">${esc(inv.group_name)}</div>
        <div class="contact-status">Invited by ${esc(inv.inviter_username)}</div>
      </div>
      <div style="margin-left:auto; display:flex; gap:6px;">
        <button class="ghost-btn gi-accept" style="padding:4px 10px;">Join</button>
        <button class="ghost-btn danger gi-decline" style="padding:4px 10px;">Decline</button>
      </div>
    </div>`).join('');
  el.querySelectorAll('.gi-accept').forEach(b => b.addEventListener('click', () => respondInvite(b, 'accept')));
  el.querySelectorAll('.gi-decline').forEach(b => b.addEventListener('click', () => respondInvite(b, 'decline')));
}

async function respondInvite(btn, action) {
  const inviteId = Number(btn.closest('.contact').getAttribute('data-inviteid'));
  try {
    const response = await fetch('/api/chat/invites/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteId, userId: currentUser.id, action })
    });
    const data = await response.json();
    if (data.success) {
      loadGroupInvites();
      if (action === 'accept') loadGroups();
      refreshInviteBadge();
    } else {
      appAlert(data.error || 'Failed to update invite');
      loadGroupInvites();
    }
  } catch (err) {
    appAlert('Connection error. Please try again.');
  }
}

// ===== INVITE BADGE (real-time: socket ping -> refetch counts, bukan polling) =====
let lastInviteTotal = null; // utk deteksi kenaikan (toast), bukan penurunan
async function refreshInviteBadge() {
  try {
    const [r, g] = await Promise.all([
      fetch(`/api/chat/contacts/requests/${currentUser.id}`).then(x => x.json()),
      fetch(`/api/chat/invites/${currentUser.id}`).then(x => x.json())
    ]);
    const n = ((r.incoming || []).length) + ((g.invites || []).length);
    if (lastInviteTotal !== null && n > lastInviteTotal) {
      showToast('AegisChat', 'Ada permintaan kontak / undangan grup baru', () => openContactsModal());
    }
    lastInviteTotal = n;
    const b = document.getElementById('inviteBadge');
    if (!b) return;
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = n === 0;
  } catch (err) {
    console.error('[Badge] Invite badge error:', err);
  }
}

socket.on('invites_changed', () => {
  refreshInviteBadge();
  // modal kontak sedang terbuka? sekalian refresh daftar undangannya
  if (document.getElementById('contactsModalOverlay').classList.contains('active')) {
    loadContactRequests();
    loadGroupInvites();
  }
});
refreshInviteBadge();

// ===== ADD CONTACT PANEL =====
document.getElementById('addContactBtn').addEventListener('click', () => {
  const form = document.getElementById('addContactForm');
  document.getElementById('newGroupForm').style.display = 'none';
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form.style.display === 'block') document.getElementById('addContactInput').focus();
});

let userSearchTimeout;
document.getElementById('addContactInput').addEventListener('input', (e) => {
  clearTimeout(userSearchTimeout);
  const q = e.target.value.trim();
  if (!q) { document.getElementById('addContactResults').innerHTML = ''; return; }
  userSearchTimeout = setTimeout(() => searchUsers(q), 300);
});

async function searchUsers(q) {
  try {
    const response = await fetch(`/api/chat/contacts/search/${currentUser.id}?q=${encodeURIComponent(q)}`);
    const data = await response.json();
    const results = data.users || [];
    const el = document.getElementById('addContactResults');
    if (results.length === 0) {
      el.innerHTML = '<div style="color:#9ca3af;padding:8px 0;">No users found</div>';
      return;
    }
    el.innerHTML = results.map(u => {
      let action;
      if (u.relation === 'contacts') action = '<span style="color:#00d4aa;font-size:11px;">Already contacts</span>';
      else if (u.relation === 'pending_out') action = '<span style="color:#9ca3af;font-size:11px;">Request sent</span>';
      else if (u.relation === 'pending_in') action = '<span style="color:#f59e0b;font-size:11px;">Sent you a request</span>';
      else action = `<button class="ghost-btn add-contact-send" data-username="${esc(u.username)}" style="padding:4px 10px;">Add</button>`;
      return `
        <div class="member-pick" style="display:flex; align-items:center; gap:8px;">
          <span>${getAvatar(u.avatar || 'avatar1')}</span>
          <span>${esc(u.username)}</span>
          <span style="margin-left:auto;">${action}</span>
        </div>`;
    }).join('');
    el.querySelectorAll('.add-contact-send').forEach(b =>
      b.addEventListener('click', () => sendContactRequest(b.getAttribute('data-username')))
    );
  } catch (err) {
    console.error('[Contacts] Search error:', err);
  }
}

async function sendContactRequest(username) {
  try {
    const response = await fetch('/api/chat/contacts/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requesterId: currentUser.id, username })
    });
    const data = await response.json();
    if (data.success) {
      appAlert(`Friend request sent to ${username}`);
      searchUsers(document.getElementById('addContactInput').value.trim());
    } else {
      appAlert(data.error || 'Failed to send request');
    }
  } catch (err) {
    appAlert('Connection error. Please try again.');
  }
}

// Guide modal functions
function openGuideModal() {
  document.getElementById('guideModalOverlay').classList.add('active');
}

function closeGuideModal() {
  document.getElementById('guideModalOverlay').classList.remove('active');
}

document.getElementById('navGuide').addEventListener('click', (e) => {
  e.preventDefault();
  openGuideModal();
});

document.getElementById('guideModalClose').addEventListener('click', closeGuideModal);

document.getElementById('guideModalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeGuideModal();
});

// Search contacts functionality (old - removed)
// document.getElementById('searchContacts').addEventListener('input', (e) => {
// Search contacts functionality (old - removed)
// document.getElementById('searchContacts').addEventListener('input', (e) => {
//   const searchTerm = e.target.value.toLowerCase().trim();
//   const allUsers = Array.from(contactsMap.values());
//   
//   if (searchTerm === '') {
//     // Show all contacts if search is empty
//     renderContactsList(allUsers);
//   } else {
//     // Filter contacts by username
//     const filteredUsers = allUsers.filter(user => 
//       user.username.toLowerCase().includes(searchTerm)
//     );
//     renderContactsList(filteredUsers);
//   }
// });

// Select contact
async function selectContact(contactEl) {
  // Remove active class from all contacts & groups in modal
  document.querySelectorAll('#contactsListModal .contact').forEach(c => c.classList.remove('active'));
  contactEl.classList.add('active');
  
  // Exit group mode
  selectedGroup = null;
  document.getElementById('chatPartnerDot').style.display = '';
  
  selectedPartner = contactEl.getAttribute('data-user');
  selectedPartnerId = contactEl.getAttribute('data-userid');
  clearUnread('dm:' + selectedPartner);
  
  // Save to localStorage for persistence
  localStorage.setItem('aegis_last_chat', selectedPartner);
  localStorage.removeItem('aegis_last_group');
  const email = contactEl.getAttribute('data-email');
  const avatarKey = contactEl.getAttribute('data-avatar');
  const avatarEmoji = getAvatar(avatarKey);
  const isBlocked = contactEl.getAttribute('data-blocked') === '1';
  const hasBlockedMe = contactEl.getAttribute('data-has-blocked-me') === '1';
  
  // Reset bulk delete mode
  bulkDeleteMode = false;
  selectedMessageIds.clear();
  document.getElementById('toggleBulkMode').style.display = 'inline-block';
  document.getElementById('bulkDeleteBtn').style.display = 'none';
  document.getElementById('cancelBulkMode').style.display = 'none';
  searchTerm = ''; // Keep for backward compatibility but not used
  
  const isOnline = onlineUsernames.has(selectedPartner);
  let statusText = isOnline ? 'Online' : 'Offline';
  let dotClass = isOnline ? 'online' : 'offline';

  // Update status if blocked
  if (isBlocked) {
    statusText = '🚫 Blocked';
    dotClass = 'blocked';
  } else if (hasBlockedMe) {
    statusText = '🚫 Blocked you';
    dotClass = 'blocked';
  }

  document.getElementById('chatPartnerName').textContent = selectedPartner;
  document.getElementById('chatPartnerStatus').textContent = statusText;
  document.getElementById('chatPartnerDot').className = 'status-dot ' + dotClass;
  document.getElementById('chatPartnerAvatar').textContent = avatarEmoji;
  
  // Make chat partner name clickable
  document.getElementById('chatPartnerName').style.cursor = 'pointer';
  
  // Profile sidebar removed - now using full-screen profile page
  // Profile data updated when user clicks Profile nav or chat partner name
  
  // Disable/Enable input based on block status
  const chatInput = document.getElementById('msgInput');
  const encryptBtn = document.getElementById('encryptBtn');
  const fileInput = document.getElementById('fileInput');
  
  if (isBlocked || hasBlockedMe) {
    chatInput.disabled = true;
    chatInput.placeholder = isBlocked 
      ? 'You have blocked this user' 
      : 'This user has blocked you';
    encryptBtn.disabled = true;
    fileInput.disabled = true;
    chatInput.style.opacity = '0.5';
    encryptBtn.style.opacity = '0.5';
  } else {
    chatInput.disabled = false;
    chatInput.placeholder = 'Type your message...';
    encryptBtn.disabled = false;
    fileInput.disabled = false;
    chatInput.style.opacity = '1';
    encryptBtn.style.opacity = '1';
  }
  
  // Show profile sidebar - removed auto-open, user must click Profile
  
  // Load chat history
  await loadMessages();
  
  // Mark received messages as read
  markMessagesAsRead();
}

// Load chat history
async function loadMessages() {
  if (!selectedPartner || !selectedPartnerId) return;
  
  try {
    const response = await fetch(`/api/chat/messages/${currentUser.id}/${selectedPartnerId}`);
    const data = await response.json();
    
    if (data.success) {
      allMessages = data.messages || [];
      renderMessages();
    }
  } catch (err) {
    console.error('[Messages] Load error:', err);
  }
}

// Parse SQLite UTC datetime ("YYYY-MM-DD HH:MM:SS", no TZ marker) as UTC; ISO strings pass through
function parseDbDate(s) {
  if (!s) return new Date(NaN);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
  return new Date(s);
}

function renderMessages() {
  const messagesContainer = document.getElementById('chatMessages');

  // Filter messages by search term
  let messagesToRender = allMessages;
  if (searchTerm) {
    messagesToRender = allMessages.filter(msg => {
      return msg.ciphertext.toLowerCase().includes(searchTerm.toLowerCase());
    });
  }

  if (messagesToRender.length === 0) {
    messagesContainer.innerHTML = '<div class="empty-state"><i data-lucide="lock"></i><p>End-to-end encrypted conversation. Send the first message.</p></div>';
    refreshIcons();
    return;
  }

  const messagesHTML = messagesToRender.map(msg => {
    const isSent = msg.sender_username === currentUser.username;
    const time = parseDbDate(msg.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    
    // Check if message can be deleted (within 24 hours and is own message)
    const messageTime = parseDbDate(msg.created_at).getTime();
    const now = Date.now();
    const hoursDiff = (now - messageTime) / (1000 * 60 * 60);
    const canDelete = isSent && hoursDiff < 24;

    // Read receipt indicator (check = terkirim, check-check = dibaca, warna primary)
    const readReceipt = isSent ? `<span class="receipt ${msg.read_at ? 'read' : 'unread'}"><i data-lucide="${msg.read_at ? 'check-check' : 'check'}"></i></span>` : '';

    // Bulk mode checkbox
    const checkbox = bulkDeleteMode && canDelete ? `<input type="checkbox" class="message-checkbox" data-msgid="${msg.id}" ${selectedMessageIds.has(msg.id) ? 'checked' : ''}>` : '';
    
    // Highlight search results
    const highlightClass = searchTerm && msg.ciphertext.toLowerCase().includes(searchTerm.toLowerCase()) ? 'highlighted' : '';

    // Group mode: show sender name above received bubbles
    const senderLabel = (!isSent && selectedGroup && msg.sender_username)
      ? `<div class="sender-name">${esc(msg.sender_username)}</div>` : '';

    if (msg.type === 'file') {
      return renderFileMessage(msg, isSent, time, canDelete, readReceipt, checkbox, highlightClass, senderLabel);
    }

    // Aksi hover: decrypt + hapus (Trash2), sesuai design.md
    const actions = bulkDeleteMode ? '' : `
      <div class="bubble-actions">
        <button class="icon-btn sm" data-action="decrypt-msg" title="Decrypt"><i data-lucide="lock-open"></i></button>
        ${canDelete ? `<button class="icon-btn sm danger" data-action="delete-msg" data-id="${msg.id}" title="Delete message"><i data-lucide="trash-2"></i></button>` : ''}
      </div>`;

    return `
      <div class="message ${isSent ? 'sent' : 'received'} ciphertext ${bulkDeleteMode ? 'bulk-mode' : ''} ${highlightClass}" data-cipher="${esc(msg.ciphertext)}" data-msgid="${msg.id}">
        ${checkbox}
        ${senderLabel}
        <div class="msg-cipher">${esc(msg.ciphertext)}</div>
        ${actions}
        <span class="msg-meta">${time}${readReceipt}</span>
      </div>
    `;
  }).join('');

  messagesContainer.innerHTML = messagesHTML;
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  refreshIcons();

  // Add checkbox event listeners
  if (bulkDeleteMode) {
    document.querySelectorAll('.message-checkbox').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const msgId = parseInt(e.target.dataset.msgid);
        if (e.target.checked) {
          selectedMessageIds.add(msgId);
        } else {
          selectedMessageIds.delete(msgId);
        }
        updateBulkDeleteButton();
      });
    });
  }
}

// Mark messages as read
function markMessagesAsRead() {
  if (!selectedPartner || !selectedPartnerId) return;
  
  const unreadMessages = allMessages.filter(msg => 
    msg.sender_username === selectedPartner && !msg.read_at
  );
  
  if (unreadMessages.length === 0) return;
  
  const messageIds = unreadMessages.map(msg => msg.id);
  socket.emit('mark_read', { messageIds });
}

// Update bulk delete button text
function updateBulkDeleteButton() {
  const btn = document.getElementById('bulkDeleteBtn');
  if (selectedMessageIds.size > 0) {
    btn.textContent = `Delete (${selectedMessageIds.size})`;
  } else {
    btn.textContent = 'Delete Selected';
  }
}


// Encrypt and send message
let typingTimeout;
document.getElementById('encryptBtn').addEventListener('click', async () => {
  const plaintext = document.getElementById('msgInput').value.trim();
  const secretKey = document.getElementById('secretKey').value;
  
  if (!plaintext) {
    appAlert('Please enter a message');
    return;
  }
  
  if (!secretKey) {
    appAlert('Please enter a secret key for encryption');
    return;
  }
  
  const ciphertext = await encryptMessage(plaintext, secretKey);
  
  if (ciphertext) {
    document.getElementById('msgInput').value = '[ENCRYPTED] Ready to send';
    document.getElementById('msgInput').dataset.ciphertext = ciphertext;
  }
});

// Typing indicator on input
document.getElementById('msgInput').addEventListener('input', (e) => {
  if (!selectedPartner) return;
  
  // Send typing event
  socket.emit('typing', {
    username: currentUser.username,
    recipientUsername: selectedPartner
  });
  
  // Clear previous timeout
  clearTimeout(typingTimeout);
  
  // Stop typing after 2 seconds of inactivity
  typingTimeout = setTimeout(() => {
    socket.emit('stop_typing', {
      username: currentUser.username,
      recipientUsername: selectedPartner
    });
  }, 2000);
});

document.getElementById('sendBtn').addEventListener('click', () => {
  const input = document.getElementById('msgInput');
  const ciphertext = input.dataset.ciphertext;

  if (!selectedPartner && !selectedGroup) {
    appAlert('Please select a contact or group');
    return;
  }

  // Group send path
  if (selectedGroup) {
    if (pendingFile) {
      socket.emit('send_group_message', {
        sender: currentUser.username,
        groupId: selectedGroup.id,
        ciphertext: pendingFile.ciphertext,
        type: 'file',
        fileName: pendingFile.fileName,
        fileSize: pendingFile.fileSize,
        mimeType: pendingFile.mimeType
      });
      // Clear file indicator - restore paperclip icon
      document.getElementById('fileLabel').innerHTML = '<i data-lucide="paperclip"></i>';
      refreshIcons();
      document.getElementById('msgInput').placeholder = 'Type your message...';
      pendingFile = null;
      input.focus();
      return;
    }

    if (!ciphertext) {
      appAlert('Please encrypt the message first');
      return;
    }

    socket.emit('send_group_message', {
      sender: currentUser.username,
      groupId: selectedGroup.id,
      ciphertext: ciphertext,
      type: 'text'
    });

    input.value = '';
    delete input.dataset.ciphertext;
    return;
  }

  // Check for pending file
  if (pendingFile) {
    socket.emit('send_message', {
      sender: currentUser.username,
      receiver: selectedPartner,
      ciphertext: pendingFile.ciphertext,
      type: 'file',
      fileName: pendingFile.fileName,
      fileSize: pendingFile.fileSize,
      mimeType: pendingFile.mimeType
    });
    console.log('[Send] File sent, clearing...');
    // Clear file indicator - restore paperclip icon
    document.getElementById('fileLabel').innerHTML = '<i data-lucide="paperclip"></i>';
    refreshIcons();
    document.getElementById('msgInput').placeholder = 'Type your message...';
    pendingFile = null;
    input.focus();
    return;
  }

  if (!ciphertext) {
    appAlert('Please encrypt the message first');
    return;
  }

  socket.emit('send_message', {
    sender: currentUser.username,
    receiver: selectedPartner,
    ciphertext: ciphertext,
    type: 'text'
  });

  input.value = '';
  delete input.dataset.ciphertext;
  
  // Stop typing indicator
  socket.emit('stop_typing', {
    username: currentUser.username,
    recipientUsername: selectedPartner
  });
});

// Listen to online users updates
socket.on('online_users', (users) => {
  console.log('[Socket] Online users update:', users);
  
  // Update online users set
  onlineUsernames.clear();
  users.forEach(user => {
    onlineUsernames.add(user.username);
  });
  
  // Re-render contacts list with updated status
  const allUsers = Array.from(contactsMap.values());
  if (allUsers.length > 0) {
    renderContactsListModal(allUsers);
  }
  
  // Update chat header and profile if contact is selected
  if (selectedPartner) {
    const isOnline = onlineUsernames.has(selectedPartner);
    document.getElementById('chatPartnerStatus').textContent = isOnline ? 'Online' : 'Offline';
    document.getElementById('chatPartnerDot').className = 'status-dot ' + (isOnline ? 'online' : 'offline');
    // profileStatus removed - sidebar no longer exists
  }
});

// ===== UNREAD MESSAGE NOTIFICATION (badge baris kontak/grup + angka di title tab) =====
const unreadMap = new Map(); // key 'dm:<username>' | 'group:<id>' -> jumlah pesan belum dibaca
const BASE_TITLE = document.title;

// ponytail: unread dipersist ke localStorage biar badge selamat reload;
// upgrade path: hitung dari read_at server per percakapan
try {
  Object.entries(JSON.parse(localStorage.getItem('aegis_unread') || '{}'))
    .forEach(([k, v]) => unreadMap.set(k, Number(v) || 0));
} catch (_) { /* korup -> mulai kosong */ }
const persistUnread = () => localStorage.setItem('aegis_unread', JSON.stringify(Object.fromEntries(unreadMap)));

function totalUnread() {
  let n = 0;
  unreadMap.forEach(v => { n += v; });
  return n;
}

function updateUnreadUI() {
  const n = totalUnread();
  document.title = n > 0 ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
  document.querySelectorAll('#contactsListModal .contact[data-user]').forEach(row => {
    setRowBadge(row, unreadMap.get('dm:' + row.getAttribute('data-user')) || 0);
  });
  document.querySelectorAll('#groupsList .group-item[data-groupid]').forEach(row => {
    setRowBadge(row, unreadMap.get('group:' + row.getAttribute('data-groupid')) || 0);
  });
  // Baris preview di Beranda
  document.querySelectorAll('#homeChatList .home-chat-item').forEach(row => {
    const key = row.dataset.type === 'dm' ? 'dm:' + row.dataset.user : 'group:' + row.dataset.id;
    setRowBadge(row, unreadMap.get(key) || 0);
  });
}

function setRowBadge(row, count) {
  let b = row.querySelector('.msg-badge');
  if (count > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'msg-badge'; row.appendChild(b); }
    b.textContent = count > 99 ? '99+' : count;
  } else if (b) {
    b.remove();
  }
}

// Toast pop-up: notifikasi yang kelihatan langsung di layar
function showToast(title, body, onClick) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  const titleEl = document.createElement('div');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;
  const bodyEl = document.createElement('div');
  bodyEl.className = 'toast-body';
  bodyEl.textContent = body;
  t.appendChild(titleEl);
  t.appendChild(bodyEl);
  t.addEventListener('click', () => { t.remove(); if (onClick) onClick(); });
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// Klik toast -> buka obrolan terkait
function openChatFromKey(key) {
  if (key.startsWith('dm:')) {
    const el = document.querySelector(`#contactsListModal .contact[data-user="${key.slice(3)}"]`);
    if (el) selectContact(el);
  } else {
    const el = document.querySelector(`#groupsList .group-item[data-groupid="${key.slice(6)}"]`);
    if (el) selectGroup(el);
  }
}

function bumpUnread(key, label) {
  unreadMap.set(key, (unreadMap.get(key) || 0) + 1);
  persistUnread();
  updateUnreadUI();
  if (label) {
    showToast(
      'Pesan baru',
      `${label} (${unreadMap.get(key)} belum dibaca)`,
      () => openChatFromKey(key)
    );
  }
}

function clearUnread(key) {
  if (unreadMap.delete(key)) { persistUnread(); updateUnreadUI(); }
}

// Receive messages
socket.on('receive_message', (data) => {
  console.log('[Socket] Received message:', data);
  if (data.sender === currentUser.username || data.receiver === currentUser.username) {
    allMessages.push({
      id: data.id,
      sender_username: data.sender,
      ciphertext: data.ciphertext,
      created_at: data.timestamp,
      type: data.type || 'text',
      file_name: data.fileName,
      file_size: data.fileSize,
      mime_type: data.mimeType
    });
    
    if (selectedPartner === data.sender || selectedPartner === data.receiver) {
      renderMessages();
    }

    // Pesan masuk tapi chat tidak terbuka / tab sedang di belakang -> notifikasi
    if (data.sender !== currentUser.username && (selectedPartner !== data.sender || document.hidden)) {
      bumpUnread('dm:' + data.sender, data.sender);
    }
  }
});

// Receive group messages
socket.on('group_message', (data) => {
  console.log('[Socket] Received group message:', data);
  const isMyGroup = loadedGroups.some(g => g.id === data.groupId);
  if (!isMyGroup) return;
  const isOpen = selectedGroup && data.groupId === selectedGroup.id;

  if (isOpen) {
    allMessages.push({
      id: data.id,
      sender_username: data.sender,
      ciphertext: data.ciphertext,
      created_at: data.timestamp,
      type: data.type || 'text',
      file_name: data.fileName,
      file_size: data.fileSize,
      mime_type: data.mimeType
    });
    renderMessages();
    // chat grup terbuka tapi tab di belakang -> tetap notifikasi
    if (data.sender !== currentUser.username && document.hidden) {
      bumpUnread('group:' + data.groupId);
    }
  } else if (data.sender !== currentUser.username) {
    // grup tidak sedang dibuka -> hitung pesan belum dibaca
    bumpUnread('group:' + data.groupId);
  }
});

// Typing indicator listeners
socket.on('user_typing', (data) => {
  if (data.username === selectedPartner && data.recipientUsername === currentUser.username) {
    document.getElementById('chatPartnerStatus').textContent = 'typing...';
  }
});

socket.on('user_stop_typing', (data) => {
  if (data.username === selectedPartner) {
    const isOnline = onlineUsernames.has(selectedPartner);
    document.getElementById('chatPartnerStatus').textContent = isOnline ? 'Online' : 'Offline';
  }
});

// Message deleted listener
socket.on('message_deleted', (data) => {
  const index = allMessages.findIndex(m => m.id === data.messageId);
  if (index !== -1) {
    allMessages.splice(index, 1);
    renderMessages();
  }
});

// Message blocked listener
socket.on('message_blocked', (data) => {
  appAlert(`✓Cannot send message: This user has blocked you or you have blocked this user.`);
  console.log('[Socket] Message blocked:', data);
});

// Delete error listener
socket.on('delete_error', (data) => {
  appAlert(data.error);
});

// Delete message function
window.deleteMessage = async function(messageId) {
  if (!(await appConfirm('Delete this message? This action cannot be undone.', 'Delete Message'))) {
    return;
  }
  
  socket.emit('delete_message', {
    messageId: messageId,
    username: currentUser.username
  });
};

// Secret key modal (replaces native prompt() - oversized on mobile)
let keyModalResolve = null;
function askSecretKey(label) {
  return new Promise(resolve => {
    keyModalResolve = resolve;
    document.getElementById('keyModalLabel').textContent = label;
    const input = document.getElementById('keyModalInput');
    input.value = '';
    document.getElementById('keyModalOverlay').classList.add('active');
    setTimeout(() => input.focus(), 50);
  });
}
function closeKeyModal(value) {
  document.getElementById('keyModalOverlay').classList.remove('active');
  if (keyModalResolve) { keyModalResolve(value); keyModalResolve = null; }
}
document.getElementById('keyModalOk').addEventListener('click', () => closeKeyModal(document.getElementById('keyModalInput').value));
document.getElementById('keyModalCancel').addEventListener('click', () => closeKeyModal(null));
document.getElementById('keyModalInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') closeKeyModal(e.target.value);
});

// Swap lock/unlock button on a bubble after toggling its state
function swapLockButton(messageDiv, fromTitle, toTitle, icon) {
  const btn = messageDiv.querySelector(`.bubble-actions button[title="${fromTitle}"]`);
  if (!btn) return;
  btn.title = toTitle;
  btn.innerHTML = `<i data-lucide="${icon}"></i>`;
  btn.onclick = () => toTitle === 'Encrypt' ? window.encryptThisMessage(btn) : window.decryptThisMessage(btn);
  refreshIcons();
}

// Decrypt individual message
window.decryptThisMessage = async function(btn) {
  const secretKey = await askSecretKey('Enter your secret key to decrypt this message:');
  if (!secretKey) return;
  
  const messageDiv = btn.closest('.message');
  const ciphertext = messageDiv.dataset.cipher;
  
  const plaintext = await decryptMessage(ciphertext, secretKey);
  
  if (plaintext) {
    messageDiv.querySelector('.msg-cipher').textContent = plaintext;
    messageDiv.classList.remove('ciphertext');
    swapLockButton(messageDiv, 'Decrypt', 'Encrypt', 'lock');
  }
};

// Re-lock a decrypted message: restore the original ciphertext kept in data-cipher
window.encryptThisMessage = function(btn) {
  const messageDiv = btn.closest('.message');
  const cipher = messageDiv.dataset.cipher;
  if (!cipher) return;
  messageDiv.querySelector('.msg-cipher').textContent = cipher;
  messageDiv.classList.add('ciphertext');
  swapLockButton(messageDiv, 'Encrypt', 'Decrypt', 'lock-open');
};

// Logout
function handleLogout() {
  // F-01: hapus sesi HttpOnly cookie di server
  fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  localStorage.removeItem('aegis_user');
  localStorage.clear(); // Force clear all localStorage
  window.location.href = '/login';
}

// F-09/CSP: dipindah dari atribut onclick
document.querySelector('.icon-btn.logout').addEventListener('click', handleLogout);

// Hamburger menu toggle for mobile navbar
document.getElementById('hamburgerBtn').addEventListener('click', () => {
  const navLinks = document.getElementById('navLinks');
  navLinks.classList.toggle('show');
});

// Close mobile menu when clicking a link
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    const navLinks = document.getElementById('navLinks');
    if (navLinks.classList.contains('show')) {
      navLinks.classList.remove('show');
    }
  });
});

// Navigation handlers
document.getElementById('navHome').addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  e.target.classList.add('active');

  // Save active tab
  localStorage.setItem('aegis_active_tab', 'home');

  // Tutup profile page, tampilkan halaman beranda (daftar preview percakapan)
  document.getElementById('profilePage').style.display = 'none';
  document.getElementById('homePage').style.display = 'flex';
  selectedPartner = null;
  selectedPartnerId = null;
  resetChatPane();
  loadHomeConversations();
});

function hideHomePage() {
  document.getElementById('homePage').style.display = 'none';
}

// ===== BERANDA: daftar preview percakapan =====
async function loadHomeConversations() {
  const list = document.getElementById('homeChatList');
  try {
    const response = await fetch('/api/chat/conversations');
    const data = await response.json();
    if (!data.success) throw new Error(data.error || 'Failed to load conversations');

    const items = data.conversations || [];
    if (items.length === 0) {
      list.innerHTML = '<div class="contact-empty"><i data-lucide="message-circle"></i><p>Belum ada percakapan. Tambahkan kontak lewat menu Contacts.</p></div>';
      refreshIcons();
      return;
    }

    list.innerHTML = items.map(c => {
      const isGroup = c.type === 'group';
      const avatarHtml = isGroup ? '<i data-lucide="users"></i>' : esc(getAvatar(c.avatar));
      // E2EE: server cuma punya ciphertext — preview cuma penanda, isi pesan tak bisa ditampilkan
      const preview = c.last_ciphertext ? '🔒 Pesan terenkripsi' : '<i>Belum ada pesan</i>';
      const d = parseDbDate(c.last_created_at);
      const time = c.last_created_at && !isNaN(d)
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
        : '';
      return `
        <div class="home-chat-item" data-type="${c.type}" data-id="${c.id}" data-user="${esc(c.username)}">
          <div class="contact-avatar">${avatarHtml}</div>
          <div class="home-chat-info">
            <div class="home-chat-name">${esc(c.username)}</div>
            <div class="home-chat-preview">${preview}</div>
          </div>
          <div class="home-chat-meta">${time}</div>
        </div>`;
    }).join('');
    updateUnreadUI(); // pasang badge pesan belum dibaca di baris preview
    refreshIcons();
  } catch (err) {
    console.error('[Home] Load conversations error:', err);
    list.innerHTML = '<div style="color:var(--text-muted); font-size:13px;">Gagal memuat percakapan.</div>';
  }
}

// Klik item preview -> buka chat penuh (DM atau grup)
document.getElementById('homeChatList').addEventListener('click', async (e) => {
  const item = e.target.closest('.home-chat-item');
  if (!item) return;

  hideHomePage();
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('navChat').classList.add('active');
  localStorage.setItem('aegis_active_tab', 'chat');

  if (item.dataset.type === 'dm') {
    await loadContacts(); // pastikan elemen kontak sudah dirender
    const contactEl = document.querySelector(`#contactsListModal .contact[data-userid="${item.dataset.id}"]`);
    if (contactEl) await selectContact(contactEl);
  } else {
    await loadGroups();
    const groupEl = document.querySelector(`#groupsList .group-item[data-groupid="${item.dataset.id}"]`);
    if (groupEl) await selectGroup(groupEl);
  }
});

document.getElementById('navChat').addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  e.target.classList.add('active');

  // Save active tab
  localStorage.setItem('aegis_active_tab', 'chat');

  // Hide profile & home pages
  document.getElementById('profilePage').style.display = 'none';
  hideHomePage();

  // Belum ada obrolan terbuka? buka kembali obrolan terakhir
  if (!selectedPartner && !selectedGroup) {
    const lastGroupId = Number(localStorage.getItem('aegis_last_group'));
    const groupEl = lastGroupId
      ? document.querySelector(`#groupsList .group-item[data-groupid="${lastGroupId}"]`)
      : null;
    if (groupEl) {
      selectGroup(groupEl);
      return;
    }
    const lastChat = localStorage.getItem('aegis_last_chat');
    const contactEl = lastChat
      ? document.querySelector(`#contactsListModal .contact[data-user="${lastChat}"]`)
      : null;
    if (contactEl) selectContact(contactEl);
  }
});

document.getElementById('navProfile').addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  e.target.classList.add('active');
  
  // Save active tab
  localStorage.setItem('aegis_active_tab', 'profile');
  
  // Hide home page, show own profile page
  hideHomePage();
  showProfilePage(currentUser.username, true);
});

// Click on contact name to view their profile
document.getElementById('chatPartnerName').addEventListener('click', () => {
  if (selectedGroup) {
    openGroupInfo();
    return;
  }
  if (selectedPartner && selectedPartner !== currentUser.username) {
    // Show contact's profile page
    showProfilePage(selectedPartner, false);
  }
});

// Show Profile Page (Full Screen)
function showProfilePage(username, isOwnProfile) {
  const profilePage = document.getElementById('profilePage');
  profilePage.style.display = 'block';
  
  if (isOwnProfile) {
    // Own profile
    const myAvatarEmoji = getAvatar(currentUser.avatar);
    document.getElementById('profilePageAvatar').textContent = myAvatarEmoji;
    document.getElementById('profilePageName').textContent = currentUser.username;
    document.getElementById('profilePageUsername').textContent = '@' + currentUser.username;
    document.getElementById('profilePageEmail').textContent = currentUser.email || 'Not provided';
    document.getElementById('profilePageStatus').textContent = 'Active (You)';
    
    // Show edit buttons, hide block button
    document.getElementById('profileEditActions').style.display = 'flex';
    document.getElementById('profileBlockActions').style.display = 'none';
  } else {
    // Contact profile
    const contact = Array.from(document.querySelectorAll('.contact')).find(
      c => c.getAttribute('data-user') === username
    );
    
    if (contact) {
      const avatarKey = contact.getAttribute('data-avatar');
      const email = contact.getAttribute('data-email');
      const avatarEmoji = getAvatar(avatarKey);
      const isOnline = onlineUsernames.has(username);
      const isBlocked = contact.getAttribute('data-blocked') === '1';
      const hasBlockedMe = contact.getAttribute('data-has-blocked-me') === '1';
      
      document.getElementById('profilePageAvatar').textContent = avatarEmoji;
      document.getElementById('profilePageName').textContent = username;
      document.getElementById('profilePageUsername').textContent = '@' + username;
      document.getElementById('profilePageEmail').textContent = email;
      
      // Update status text
      let statusText = isOnline ? 'Online' : 'Offline';
      if (isBlocked) {
        statusText = '🚫 Blocked by you';
      } else if (hasBlockedMe) {
        statusText = '🚫 Has blocked you';
      }
      document.getElementById('profilePageStatus').textContent = statusText;
      
      // Hide edit buttons, show block/unblock button
      document.getElementById('profileEditActions').style.display = 'none';
      document.getElementById('profileBlockActions').style.display = 'flex';
      
      // Update button text based on block status
      const blockBtn = document.getElementById('blockUserBtn');
      if (isBlocked) {
        blockBtn.textContent = '✓ Unblock User';
        blockBtn.classList.add('unblock-btn');
        blockBtn.classList.remove('profile-block-btn');
      } else if (hasBlockedMe) {
        blockBtn.textContent = '🚫 User Blocked You';
        blockBtn.disabled = true;
        blockBtn.classList.remove('unblock-btn');
        blockBtn.classList.add('profile-block-btn');
      } else {
        blockBtn.textContent = '🚫 Block User';
        blockBtn.disabled = false;
        blockBtn.classList.remove('unblock-btn');
        blockBtn.classList.add('profile-block-btn');
      }
    }
  }
}

// Back button from profile page
document.getElementById('backFromProfile').addEventListener('click', () => {
  // Reset to view mode when closing profile page
  document.getElementById('profileEditMode').style.display = 'none';
  document.getElementById('profileAvatarPicker').style.display = 'none';
  document.getElementById('profileViewMode').style.display = 'block';
  document.getElementById('profilePage').style.display = 'none';
  hideHomePage();
  
  // Switch back to Chat menu
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  document.getElementById('navChat').classList.add('active');
  
  // Update localStorage to prevent returning to Profile on refresh
  localStorage.setItem('aegis_active_tab', 'chat');
});

// Click avatar to change (replaces Edit Avatar button)
document.getElementById('profilePageAvatar').addEventListener('click', function() {
  // Only allow if viewing own profile
  if (document.getElementById('profileEditActions').style.display !== 'none') {
    openAvatarPickerInline();
  }
});

// Edit Profile - toggle inline form
document.getElementById('editProfileBtnPage').addEventListener('click', function() {
  document.getElementById('profileViewMode').style.display = 'none';
  document.getElementById('profileEditMode').style.display = 'block';
  
  // Populate form
  document.getElementById('editUsernameInline').value = currentUser.username || '';
  document.getElementById('editEmailInline').value = currentUser.email || '';
  document.getElementById('editPasswordInline').value = '';
  document.getElementById('editConfirmPasswordInline').value = '';
  document.getElementById('profileFormSection').style.display = 'block';
  document.getElementById('profileOtpSectionInline').style.display = 'none';
  document.getElementById('profileOtpInputInline').value = '';
  document.getElementById('profileOtpErrorInline').style.display = 'none';
});

// Cancel edit profile
document.getElementById('cancelProfileBtnInline').addEventListener('click', function() {
  document.getElementById('profileEditMode').style.display = 'none';
  document.getElementById('profileViewMode').style.display = 'block';
});

// Save Profile - Inline Form
document.getElementById('saveProfileBtnInline').addEventListener('click', async () => {
  const username = document.getElementById('editUsernameInline').value.trim();
  const email = document.getElementById('editEmailInline').value.trim();
  const password = document.getElementById('editPasswordInline').value;
  const confirmPassword = document.getElementById('editConfirmPasswordInline').value;
  
  if (!username || !email) { appAlert('Username and email are required'); return; }
  if (username.length < 3) { appAlert('Username must be at least 3 characters'); return; }
  if (password && password.length < 6) { appAlert('Password must be at least 6 characters'); return; }
  if (password && password !== confirmPassword) { appAlert('Passwords do not match'); return; }
  
  const changes = {};
  if (username !== currentUser.username) changes.username = username;
  if (email !== currentUser.email) changes.email = email;
  if (password) changes.password = password;
  if (Object.keys(changes).length === 0) { 
    appAlert('No changes to save'); 
    document.getElementById('profileEditMode').style.display = 'none';
    document.getElementById('profileViewMode').style.display = 'block';
    return; 
  }

  // Only username change ✓ no OTP needed
  const onlyUsername = Object.keys(changes).length === 1 && changes.username !== undefined;
  if (onlyUsername) {
    try {
      const response = await fetch('/api/auth/update-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser.id, username: changes.username })
      });
      const data = await response.json();
      if (data.success && data.user) {
        const updated = data.user;
        updated.avatar = updated.avatar || currentUser.avatar;
        currentUser.username = updated.username;
        currentUser.email = updated.email;
        currentUser.avatar = updated.avatar;
        currentUser.is_verified = updated.is_verified;
        localStorage.setItem('aegis_user', JSON.stringify(currentUser));
        
        // Update navbar
        document.getElementById('currentUsername').textContent = currentUser.username;
        
        // Update Profile Page
        document.getElementById('profilePageName').textContent = currentUser.username;
        document.getElementById('profilePageUsername').textContent = '@' + currentUser.username;
        document.getElementById('profilePageEmail').textContent = currentUser.email || 'Not provided';
        const avatarEmoji = getAvatar(currentUser.avatar);
        document.getElementById('profilePageAvatar').textContent = avatarEmoji;
        
        // Update contact list if showing self
        document.querySelectorAll('.contact').forEach(c => {
          if (c.dataset.userid == currentUser.id) {
            c.querySelector('.contact-avatar').textContent = avatarEmoji;
            c.querySelector('.contact-name').textContent = currentUser.username;
          }
        });
        
        // Back to view mode
        document.getElementById('profileEditMode').style.display = 'none';
        document.getElementById('profileViewMode').style.display = 'block';
        
        console.log('[Profile] Username updated');
        appAlert('Username updated successfully!');
      } else {
        appAlert(data.error || 'Failed to update username');
      }
    } catch (err) {
      console.error('[Profile] Username update error:', err);
      appAlert('Connection error. Please try again.');
    }
    return;
  }

  // Email or password change ✓ OTP required
  try {
    const response = await fetch('/api/auth/send-profile-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: currentUser.id })
    });
    const data = await response.json();
    if (!data.success) { appAlert('Failed to send OTP: ' + (data.error || 'Unknown error')); return; }
  } catch (err) {
    console.error('[Profile] OTP send error:', err);
    appAlert('Connection error. Please try again.');
    return;
  }
  
  pendingProfileChanges = changes;
  profileOtpSent = true;
  appAlert('OTP sent to ' + currentUser.email);
  document.getElementById('profileFormSection').style.display = 'none';
  document.getElementById('profileOtpSectionInline').style.display = 'block';
});

// Cancel OTP - Inline
document.getElementById('cancelProfileOtpBtnInline').addEventListener('click', () => {
  document.getElementById('profileFormSection').style.display = 'block';
  document.getElementById('profileOtpSectionInline').style.display = 'none';
  document.getElementById('profileOtpInputInline').value = '';
  document.getElementById('profileOtpErrorInline').style.display = 'none';
  pendingProfileChanges = null;
  profileOtpSent = false;
});

// Verify OTP - Inline
document.getElementById('verifyProfileOtpBtnInline').addEventListener('click', async () => {
  const otp = document.getElementById('profileOtpInputInline').value.trim();
  if (!otp || otp.length !== 6) { 
    showProfileOtpErrorInline('Please enter a valid 6-digit OTP'); 
    return; 
  }
  if (!pendingProfileChanges) { 
    showProfileOtpErrorInline('No pending changes'); 
    return; 
  }
  
  try {
    const payload = { userId: currentUser.id, otp: otp, ...pendingProfileChanges };
    const response = await fetch('/api/auth/update-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (data.success && data.user) {
      const updated = data.user;
      updated.avatar = updated.avatar || currentUser.avatar;
      currentUser.username = updated.username;
      currentUser.email = updated.email;
      currentUser.avatar = updated.avatar;
      currentUser.is_verified = updated.is_verified;
      localStorage.setItem('aegis_user', JSON.stringify(currentUser));
      
      // Update navbar
      document.getElementById('currentUsername').textContent = currentUser.username;
      
      // Update Profile Page
      document.getElementById('profilePageName').textContent = currentUser.username;
      document.getElementById('profilePageUsername').textContent = '@' + currentUser.username;
      document.getElementById('profilePageEmail').textContent = currentUser.email || 'Not provided';
      const avatarEmoji = getAvatar(currentUser.avatar);
      document.getElementById('profilePageAvatar').textContent = avatarEmoji;
      
      // Update contact list if showing self
      document.querySelectorAll('.contact').forEach(c => {
        if (c.dataset.userid == currentUser.id) {
          c.querySelector('.contact-avatar').textContent = avatarEmoji;
          c.querySelector('.contact-name').textContent = currentUser.username;
        }
      });
      
      // Back to view mode
      document.getElementById('profileEditMode').style.display = 'none';
      document.getElementById('profileViewMode').style.display = 'block';
      
      console.log('[Profile] Updated successfully');
      appAlert('Profile updated successfully!');
    } else {
      showProfileOtpErrorInline(data.error || 'Failed to update profile');
    }
  } catch (err) {
    console.error('[Profile] Update error:', err);
    showProfileOtpErrorInline('Connection error. Please try again.');
  }
});

// OTP Enter key - Inline
document.getElementById('profileOtpInputInline').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('verifyProfileOtpBtnInline').click();
});

function showProfileOtpErrorInline(msg) {
  const el = document.getElementById('profileOtpErrorInline');
  el.textContent = msg;
  el.style.display = 'block';
}

// Block/Unblock User
document.getElementById('blockUserBtn').addEventListener('click', async () => {
  if (!selectedPartner) return;
  
  const blockBtn = document.getElementById('blockUserBtn');
  const isCurrentlyBlocked = blockBtn.textContent.includes('Unblock');
  
  // Determine action
  const action = isCurrentlyBlocked ? 'unblock' : 'block';
  const confirmMsg = isCurrentlyBlocked 
    ? `Are you sure you want to unblock ${selectedPartner}?`
    : `Are you sure you want to block ${selectedPartner}? You will no longer receive messages from this user.`;
  
  const confirmAction = await appConfirm(confirmMsg, action === 'block' ? 'Block User' : 'Unblock User');
  if (!confirmAction) return;
  
  try {
    const response = await fetch(`/api/user/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: currentUser.id,
        [action === 'block' ? 'blockUsername' : 'unblockUsername']: selectedPartner 
      })
    });
    
    // Check if response is ok
    if (!response.ok) {
      const text = await response.text();
      console.error(`[${action}] Server error:`, response.status, text);
      appAlert(`Failed to ${action} user: ${text}`);
      return;
    }
    
    const data = await response.json();
    if (data.success) {
      appAlert(`${selectedPartner} has been ${action}ed.`);
      document.getElementById('profilePage').style.display = 'none';
      
      // Reload contact list to update block status
      loadContacts();
      
      // If unblocked, keep contact selected; if blocked, deselect
      if (action === 'block') {
        selectedPartner = null;
        selectedPartnerId = null;
        document.getElementById('chatPartnerName').textContent = 'Select a contact';
        document.getElementById('chatPartnerStatus').textContent = 'Open Contacts menu';
        document.getElementById('chatMessages').innerHTML = '<div style="text-align:center; color:#9ca3af; padding:40px;">Select a contact to view messages</div>';
      }
    } else {
      appAlert(`Failed to ${action} user: ` + (data.message || 'Unknown error'));
    }
  } catch (err) {
    console.error(`[${action}] Error:`, err);
    appAlert(`Failed to ${action} user: ` + err.message);
  }
});

// ===== EDIT AVATAR (INLINE) =====
let selectedAvatarForProfile = null;

function openAvatarPickerInline() {
  // Hide view mode, show avatar picker
  document.getElementById('profileViewMode').style.display = 'none';
  document.getElementById('profileAvatarPicker').style.display = 'block';
  
  const grid = document.getElementById('profileAvatarGrid');
  grid.innerHTML = generateAvatarOptions();
  selectedAvatarForProfile = currentUser.avatar || 'avatar1';
  
  // Highlight current avatar
  document.querySelectorAll('#profileAvatarGrid .avatar-option').forEach(opt => {
    if (opt.dataset.avatar === selectedAvatarForProfile) {
      opt.classList.add('selected');
    }
    opt.addEventListener('click', function() {
      document.querySelectorAll('#profileAvatarGrid .avatar-option').forEach(o => o.classList.remove('selected'));
      this.classList.add('selected');
      selectedAvatarForProfile = this.dataset.avatar;
    });
  });
}

function closeAvatarPickerInline() {
  document.getElementById('profileAvatarPicker').style.display = 'none';
  document.getElementById('profileViewMode').style.display = 'block';
}

// Save Avatar (Inline)
document.getElementById('saveProfileAvatarBtn').addEventListener('click', async () => {
  if (!selectedAvatarForProfile) return;
  
  try {
    const response = await fetch('/api/auth/update-avatar', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        userId: currentUser.id, 
        avatar: selectedAvatarForProfile 
      })
    });
    
    const data = await response.json();
    if (data.success) {
      currentUser.avatar = selectedAvatarForProfile;
      localStorage.setItem('aegis_user', JSON.stringify(currentUser));
      
      // Update UI
      const avatarEmoji = getAvatar(selectedAvatarForProfile);
      document.getElementById('profilePageAvatar').textContent = avatarEmoji;
      
      // Update contact list if current user shows
      document.querySelectorAll('.contact').forEach(c => {
        if (c.dataset.userid == currentUser.id) {
          c.querySelector('.contact-avatar').textContent = avatarEmoji;
        }
      });
      
      closeAvatarPickerInline();
      console.log('[Avatar] Updated to:', selectedAvatarForProfile);
      appAlert('Avatar updated successfully!');
    } else {
      appAlert('Failed to update avatar: ' + (data.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('[Avatar] Update error:', err);
    appAlert('Connection error. Please try again.');
  }
});

// Cancel Avatar (Inline)
document.getElementById('cancelProfileAvatarBtn').addEventListener('click', closeAvatarPickerInline);

let pendingProfileChanges = null;
let profileOtpSent = false;

// ===== FILE UPLOAD =====

const fileInputEl = document.getElementById('fileInput');
if (fileInputEl) {
  fileInputEl.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;

  // ponytail: 8MB raw -> ~15MB ciphertext, harus muat di maxHttpBufferSize server (17MB)
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  if (file.size > MAX_FILE_BYTES) {
    appAlert(`File too large. Max ${MAX_FILE_BYTES / (1024 * 1024)} MB.`);
    this.value = '';
    return;
  }

  const secretKey = document.getElementById('secretKey').value;
  if (!secretKey) {
    appAlert('Please enter a secret key before attaching a file');
    this.value = '';
    return;
  }

  console.log('[File] Starting encryption...');
  const reader = new FileReader();
  reader.onload = async function(ev) {
    try {
      console.log('[File] File read complete, encrypting...');
      const dataUrl = ev.target.result; // base64 data URL
      const ciphertext = await encryptMessage(dataUrl, secretKey);
      if (!ciphertext) {
        appAlert('File encryption failed');
        return;
      }
      console.log('[File] Encryption complete, setting pendingFile');
      pendingFile = {
        ciphertext: ciphertext,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || 'application/octet-stream'
      };
      const fileSizeKB = (file.size / 1024).toFixed(2);
      document.getElementById('fileLabel').innerHTML = '<i data-lucide="check"></i>';
      refreshIcons();
      document.getElementById('msgInput').placeholder = `📎 ${file.name} (${fileSizeKB} KB) - Press Send to encrypt & send`;
    } catch (err) {
      console.error('[File] Error encrypting:', err);
      appAlert('Failed to encrypt file');
    }
  };
  reader.readAsDataURL(file);
  this.value = ''; // allow re-selecting same file
  });
} else {
  console.error('[File] fileInput element not found!');
}

// ===== FILE MESSAGE RENDER =====
function renderFileMessage(msg, isSent, time, canDelete, readReceipt, checkbox, highlightClass, senderLabel) {
  const sizeStr = msg.file_size ? (msg.file_size / 1024).toFixed(1) + ' KB' : 'Unknown size';
  const fileName = msg.file_name || 'file';
  // Truncate ~24 char sesuai design.md, full name di title attribute
  const shortName = fileName.length > 24 ? fileName.slice(0, 24) + '…' : fileName;
  const actions = (!bulkDeleteMode && canDelete) ? `
    <div class="bubble-actions">
      <button class="icon-btn sm danger" data-action="delete-msg" data-id="${msg.id}" title="Delete message"><i data-lucide="trash-2"></i></button>
    </div>` : '';

  return `
    <div class="message ${isSent ? 'sent' : 'received'} file-message ${bulkDeleteMode ? 'bulk-mode' : ''} ${highlightClass || ''}" data-cipher="${esc(msg.ciphertext)}" data-filename="${esc(fileName)}" data-filesize="${msg.file_size || 0}" data-mimetype="${esc(msg.mime_type || '')}" data-msgid="${msg.id}">
      ${checkbox || ''}
      ${senderLabel || ''}
      <div class="file-card">
        <div class="file-thumb"><i data-lucide="file-lock-2"></i></div>
        <div class="file-meta-col">
          <div class="file-name" title="${esc(fileName)}">${esc(shortName)}</div>
          <div class="file-sub">
            <span>${sizeStr}</span>
            <span class="badge-enc"><i data-lucide="lock"></i>Encrypted</span>
          </div>
        </div>
        <button class="file-decrypt-btn" data-action="decrypt-file"><i data-lucide="lock-open"></i>DECRYPT</button>
      </div>
      ${actions}
      <span class="msg-meta">${time}${readReceipt || ''}</span>
    </div>
  `;
}

// ===== DECRYPT FILE =====
window.decryptFileMessage = async function(btn) {
  const msgDiv = btn.closest('.file-message');
  if (!msgDiv) return;

  const ciphertext = msgDiv.dataset.cipher;
  const fileName = msgDiv.dataset.filename || 'file';
  const mimeType = msgDiv.dataset.mimetype || 'application/octet-stream';
  
  const secretKey = await askSecretKey('Enter your secret key to decrypt this file:');
  if (!secretKey) return;

  const decrypted = await decryptMessage(ciphertext, secretKey);
  if (!decrypted) {
    appAlert('Decryption failed. Wrong key?');
    return;
  }

  // decrypted is base64 data URL
  if (mimeType.startsWith('image/')) {
    // Show image inline
    const img = document.createElement('img');
    img.src = decrypted;
    img.className = 'file-preview';
    // Remove decrypt button and replace with image
    btn.style.display = 'none';
    const fileInfo = msgDiv.querySelector('.file-info');
    if (fileInfo) {
      fileInfo.after(img);
    } else {
      msgDiv.appendChild(img);
    }
  } else {
    // Download as file
    const a = document.createElement('a');
    a.href = decrypted;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
};

// ===== DELEGATED ACTIONS (CSP script-src 'self' melarang event-handler atribut) =====
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn || bulkDeleteMode) return;
  if (btn.dataset.action === 'decrypt-msg') window.decryptThisMessage(btn);
  else if (btn.dataset.action === 'delete-msg') window.deleteMessage(Number(btn.dataset.id));
  else if (btn.dataset.action === 'decrypt-file') window.decryptFileMessage(btn);
});
