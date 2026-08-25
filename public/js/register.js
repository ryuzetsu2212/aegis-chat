// Render avatar options
document.getElementById('avatarGrid').innerHTML = generateAvatarOptions();

// Handle avatar selection
let selectedAvatar = 'avatar1';
document.querySelectorAll('.avatar-option').forEach(option => {
  option.addEventListener('click', function() {
    document.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
    this.classList.add('selected');
    selectedAvatar = this.getAttribute('data-avatar');
    document.getElementById('selectedAvatar').value = selectedAvatar;
  });
});

// Set default avatar as selected
document.querySelector('.avatar-option[data-avatar="avatar1"]').classList.add('selected');

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const avatar = document.getElementById('selectedAvatar').value;
  
  const errorDiv = document.getElementById('errorMsg');
  const successDiv = document.getElementById('successMsg');
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password, avatar })
    });
    
    const data = await response.json();
    
    if (data.success) {
      successDiv.textContent = 'Registration successful! OTP sent to your email.';
      successDiv.style.display = 'block';
      
      // Store email for verification page
      sessionStorage.setItem('pending_email', email);
      
      setTimeout(() => {
        window.location.href = '/verify';
      }, 1500);
    } else {
      errorDiv.textContent = data.error || 'Registration failed';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  }
});