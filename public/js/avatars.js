// Avatar collection - 2D cartoon style using emoji combinations
const AVATARS = {
  avatar1: '😀',
  avatar2: '😎',
  avatar3: '🥳',
  avatar4: '🤓',
  avatar5: '😇',
  avatar6: '🤩',
  avatar7: '🥰',
  avatar8: '😈',
  avatar9: '🤖',
  avatar10: '👽',
  avatar11: '👻',
  avatar12: '🐱',
  avatar13: '🐶',
  avatar14: '🐼',
  avatar15: '🐨',
  avatar16: '🦊',
  avatar17: '🦁',
  avatar18: '🐯',
  avatar19: '🐸',
  avatar20: '🦄'
};

// Get avatar emoji by key
function getAvatar(avatarKey) {
  return AVATARS[avatarKey] || AVATARS.avatar1;
}

// Generate all avatar options HTML
function generateAvatarOptions() {
  return Object.keys(AVATARS).map(key => `
    <div class="avatar-option" data-avatar="${key}">
      <div class="avatar-emoji">${AVATARS[key]}</div>
    </div>
  `).join('');
}
