// ===== MESSAGE SEARCH (REMOVED - tidak berguna untuk pesan terenkripsi) =====
// document.getElementById('searchMessages').addEventListener('input', (e) => {
//   searchTerm = e.target.value.trim();
//   renderMessages();
// });

// Tombol Kontak di header chat sudah dihapus, pakai navbar Contacts di atas.

// ===== BULK DELETE MODE =====
document.getElementById('toggleBulkMode').addEventListener('click', () => {
  bulkDeleteMode = true;
  selectedMessageIds.clear();
  document.getElementById('toggleBulkMode').style.display = 'none';
  document.getElementById('bulkDeleteBtn').style.display = 'inline-block';
  document.getElementById('cancelBulkMode').style.display = 'inline-block';
  renderMessages();
});

document.getElementById('cancelBulkMode').addEventListener('click', () => {
  bulkDeleteMode = false;
  selectedMessageIds.clear();
  document.getElementById('toggleBulkMode').style.display = 'inline-block';
  document.getElementById('bulkDeleteBtn').style.display = 'none';
  document.getElementById('cancelBulkMode').style.display = 'none';
  renderMessages();
});

document.getElementById('bulkDeleteBtn').addEventListener('click', async () => {
  if (selectedMessageIds.size === 0) {
    appAlert('No messages selected');
    return;
  }
  
  if (!(await appConfirm(`Delete ${selectedMessageIds.size} message(s)? This action cannot be undone.`, 'Bulk Delete'))) {
    return;
  }
  
  socket.emit('bulk_delete_messages', {
    messageIds: Array.from(selectedMessageIds),
    username: currentUser.username
  });
});

// ===== READ RECEIPTS SOCKET LISTENERS =====
socket.on('messages_read', (data) => {
  const { messageIds } = data;
  
  // Update read status in allMessages
  allMessages.forEach(msg => {
    if (messageIds.includes(msg.id)) {
      msg.read_at = new Date().toISOString();
    }
  });
  
  // Re-render if viewing this conversation
  if (selectedPartner) {
    renderMessages();
  }
});

// ===== BULK DELETE SOCKET LISTENERS =====
socket.on('messages_bulk_deleted', (data) => {
  const { messageIds } = data;
  
  // Remove deleted messages from allMessages
  allMessages = allMessages.filter(msg => !messageIds.includes(msg.id));
  
  // Clear selection
  selectedMessageIds.clear();
  
  // Exit bulk mode
  bulkDeleteMode = false;
  document.getElementById('toggleBulkMode').style.display = 'inline-block';
  document.getElementById('bulkDeleteBtn').style.display = 'none';
  document.getElementById('cancelBulkMode').style.display = 'none';
  
  renderMessages();
});

socket.on('delete_warning', (data) => {
  appAlert(data.message);
});
