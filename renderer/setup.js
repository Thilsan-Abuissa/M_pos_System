const form = document.getElementById('setupForm');
const passwordInput = document.getElementById('password');
const confirmPasswordInput = document.getElementById('confirmPassword');
const setupButton = document.getElementById('setupButton');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const usernameInput = document.getElementById('username');

// Password validation
passwordInput.addEventListener('input', () => {
  const password = passwordInput.value;
  const lengthReq = document.getElementById('req-length');
  const letterReq = document.getElementById('req-letter');
  const numberReq = document.getElementById('req-number');

  // Check length
  if (password.length >= 6) {
    lengthReq.classList.add('valid');
  } else {
    lengthReq.classList.remove('valid');
  }

  // Check for letter
  if (/[a-zA-Z]/.test(password)) {
    letterReq.classList.add('valid');
  } else {
    letterReq.classList.remove('valid');
  }

  // Check for number
  if (/[0-9]/.test(password)) {
    numberReq.classList.add('valid');
  } else {
    numberReq.classList.remove('valid');
  }

  validateForm();
});

confirmPasswordInput.addEventListener('input', validateForm);

function validateForm() {
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;
  const fullName = document.getElementById('fullName').value;
  const username = document.getElementById('username').value;

  const hasLength = password.length >= 6;
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && confirmPassword !== '';
  const allFilled = fullName && username && password && confirmPassword;

  setupButton.disabled = !(hasLength && hasLetter && hasNumber && passwordsMatch && allFilled);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const fullName = document.getElementById('fullName').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  // Validate
  if (password !== confirmPassword) {
    showError('Passwords do not match');
    return;
  }

  if (password.length < 6) {
    showError('Password must be at least 6 characters');
    return;
  }

  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    showError('Password must contain both letters and numbers');
    return;
  }

  // Disable button
  setupButton.disabled = true;
  setupButton.textContent = 'Creating Account...';

  try {
    // Create admin user
    const result = await window.api.createFirstAdmin({
      fullName,
      username,
      password
    });

    if (result.success) {
      // Show success message
      errorMessage.style.display = 'none';
      successMessage.style.display = 'block';
      form.style.display = 'none';

      // Redirect to login after 2 seconds
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 2000);
    } else {
      showError(result.message || 'Failed to create admin account');
      setupButton.disabled = false;
      setupButton.textContent = 'Complete Setup';
    }
  } catch (error) {
    showError('An error occurred during setup');
    setupButton.disabled = false;
    setupButton.textContent = 'Complete Setup';
  }
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
  setTimeout(() => {
    errorMessage.style.display = 'none';
  }, 5000);
}
