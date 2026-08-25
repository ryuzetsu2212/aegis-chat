document.getElementById('forgotPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  
  const errorDiv = document.getElementById('errorMsg');
  const successDiv = document.getElementById('successMsg');
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (data.success) {
      successDiv.textContent = data.message || 'OTP sent to your email!';
      successDiv.style.display = 'block';
      
      // Store email in sessionStorage for reset page
      sessionStorage.setItem('reset_email', email);
      
      setTimeout(() => {
        window.location.href = '/reset-password';
      }, 2000);
    } else {
      errorDiv.textContent = data.error || 'Failed to send OTP';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  }
});