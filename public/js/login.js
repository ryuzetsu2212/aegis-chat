// Check if already logged in
const user = localStorage.getItem('aegis_user');
if (user) {
  window.location.href = '/chat';
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  const errorDiv = document.getElementById('errorMsg');
  errorDiv.style.display = 'none';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (data.success) {
      // Clear old data first
      localStorage.removeItem('aegis_user');
      // Set new user data
      localStorage.setItem('aegis_user', JSON.stringify(data.user));
      window.location.href = '/chat';
    } else {
      errorDiv.textContent = data.error || 'Invalid credentials';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  }
});

// Clear cache button (dipindah dari atribut onclick agar lolos CSP)
document.getElementById('clearCacheBtn').addEventListener('click', async () => {
  localStorage.clear();
  await appAlert('Cache cleared!');
  location.reload();
});