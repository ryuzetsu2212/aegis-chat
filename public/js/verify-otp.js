// Auto-fill email from registration
const pendingEmail = sessionStorage.getItem('pending_email');
if (pendingEmail) {
  document.getElementById('email').value = pendingEmail;
} else {
  window.location.href = '/';
}

document.getElementById('verifyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  const otp = document.getElementById('otp').value.trim();
  
  const errorDiv = document.getElementById('errorMsg');
  const successDiv = document.getElementById('successMsg');
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  try {
    const response = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp })
    });
    
    const data = await response.json();
    
    if (data.success) {
      successDiv.textContent = 'Email verified! Redirecting to login...';
      successDiv.style.display = 'block';
      
      sessionStorage.removeItem('pending_email');
      
      setTimeout(() => {
        window.location.href = '/login';
      }, 1500);
    } else {
      errorDiv.textContent = data.error || 'Invalid OTP';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  }
});