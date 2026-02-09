const form = document.getElementById('setupForm');
const setupButton = document.getElementById('setupButton');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');
const usernameInput = document.getElementById('username');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const fullName = document.getElementById('fullName').value.trim();
  const username = document.getElementById('username').value.trim();

  // Validate
  if (!fullName || !username) {
    showError('Please fill in all fields');
    return;
  }

  if (username.length < 3) {
    showError('Username must be at least 3 characters');
    return;
  }

  // Disable button
  setupButton.disabled = true;
  setupButton.textContent = 'Creating Account...';

  try {
    // Create admin user with no password
    const result = await window.api.createFirstAdmin({
      fullName,
      username,
      password: username // Use username as default password
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

// Virtual Keyboard Setup
let currentKeyboardInput = null;

function setupVirtualKeyboard() {
  const keyboard = document.getElementById('virtualKeyboard');
  const closeKeyboardBtn = document.getElementById('closeKeyboard');
  const keyButtons = document.querySelectorAll('.key-btn');
  let keyboardMode = 'text'; // 'text' | 'numeric'
  
  // Initialize keyboard in lowercase mode
  keyButtons.forEach(btn => {
    const key = btn.dataset.key;
    if (key && key.length === 1 && /[A-Z]/.test(key)) {
      btn.textContent = key.toLowerCase();
    }
  });

  function isNumericKeyboardTarget(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    return inputMode === 'numeric' || inputMode === 'decimal' || inputMode === 'tel' || type === 'number' || type === 'tel';
  }

  function setKeyboardMode(mode) {
    keyboardMode = mode === 'numeric' ? 'numeric' : 'text';

    keyButtons.forEach(btn => {
      const key = btn.dataset.key;
      const isNumberKey = btn.classList.contains('key-number');
      const isBackspace = btn.classList.contains('key-backspace') || key === 'Backspace';
      const isDone = btn.classList.contains('key-done') || key === 'Done';
      const isSpace = btn.classList.contains('key-space') || key === ' ';
      const isSpecial = btn.classList.contains('key-special');
      const isDecimal = key === '.';
      const isLetterKey = !!(key && key.length === 1 && /[A-Z]/.test(key) && !isNumberKey);

      const shouldShow = (keyboardMode === 'numeric')
        ? (isNumberKey || isDecimal || isBackspace || isDone || isSpecial)
        : (isLetterKey || isSpace || isBackspace || isDone || isSpecial);

      btn.style.display = shouldShow ? '' : 'none';
    });

    // Hide empty rows to avoid gaps
    document.querySelectorAll('#virtualKeyboard .keyboard-row').forEach(row => {
      const hasVisibleButton = Array.from(row.querySelectorAll('.key-btn')).some(b => b.style.display !== 'none');
      row.style.display = hasVisibleButton ? '' : 'none';
    });
  }
  
  // Show keyboard when text inputs are focused
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' && 
        (e.target.type === 'text' || e.target.type === 'tel' || e.target.type === 'number')) {
      currentKeyboardInput = e.target;
      setKeyboardMode(isNumericKeyboardTarget(e.target) ? 'numeric' : 'text');
      keyboard.classList.add('active');
    }
  });
  
  // Handle key presses
  keyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      
      if (key === 'Backspace') {
        if (currentKeyboardInput) {
          currentKeyboardInput.value = currentKeyboardInput.value.slice(0, -1);
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else if (key === 'Done') {
        if (currentKeyboardInput) {
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        keyboard.classList.remove('active');
        currentKeyboardInput = null;
      } else {
        if (currentKeyboardInput) {
          const actualKey = btn.textContent === 'SPACE' ? ' ' : btn.textContent;
          if (keyboardMode === 'numeric' && /[a-zA-Z]/.test(actualKey)) return;
          currentKeyboardInput.value += actualKey;
          currentKeyboardInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    });
  });
  
  // Close button
  closeKeyboardBtn.addEventListener('click', () => {
    keyboard.classList.remove('active');
    currentKeyboardInput = null;
  });
  
  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!keyboard.contains(e.target) && 
        e.target.tagName !== 'INPUT' && 
        keyboard.classList.contains('active')) {
      keyboard.classList.remove('active');
      currentKeyboardInput = null;
    }
  });
}

// Initialize keyboard when DOM is ready
setupVirtualKeyboard();
