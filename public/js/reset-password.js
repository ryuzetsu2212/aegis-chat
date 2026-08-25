// Check if email exists in sessionStorage
(async () => {
  const resetEmail = sessionStorage.getItem('reset_email');
  if (!resetEmail) {
    await appAlert('Please request OTP first');
    window.location.href = '/forgot-password';
  } else {
    document.getElementById('email').value = resetEmail;
  }
})();

document.getElementById('resetPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  const otp = document.getElementById('otp').value.trim();
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;
  
  const errorDiv = document.getElementById('errorMsg');
  const successDiv = document.getElementById('successMsg');
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';
  
  // Validation
  if (newPassword !== confirmPassword) {
    errorDiv.textContent = 'Passwords do not match';
    errorDiv.style.display = 'block';
    return;
  }
  
  if (newPassword.length < 6) {
    errorDiv.textContent = 'Password must be at least 6 characters';
    errorDiv.style.display = 'block';
    return;
  }
  
  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, newPassword })
    });
    
    const data = await response.json();
    
    if (data.success) {
      successDiv.textContent = 'Password reset successful! Redirecting...';
      successDiv.style.display = 'block';
      
      // Clear sessionStorage
      sessionStorage.removeItem('reset_email');
      
      setTimeout(() => {
        window.location.href = '/login';
      }, 2000);
    } else {
      errorDiv.textContent = data.error || 'Failed to reset password';
      errorDiv.style.display = 'block';
    }
  } catch (err) {
    errorDiv.textContent = 'Connection error. Please try again.';
    errorDiv.style.display = 'block';
  }
});