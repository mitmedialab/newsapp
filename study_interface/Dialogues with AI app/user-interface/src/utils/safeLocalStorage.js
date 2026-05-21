// Safe localStorage wrapper to prevent conflicts with Qualtrics
// This prevents the "Cannot read properties of undefined" errors

const SafeLocalStorage = {
  // Namespace prefix to avoid conflicts
  prefix: 'study_app_safe_',
  
  // Check if localStorage is available and safe to use
  isAvailable() {
    try {
      if (typeof Storage === 'undefined') return false;
      if (!window.localStorage) return false;
      
      // Test write/read
      const testKey = this.prefix + 'test';
      localStorage.setItem(testKey, 'test');
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      
      return retrieved === 'test';
    } catch (e) {
      console.warn('localStorage not available:', e.message);
      return false;
    }
  },
  
  // Safe setItem with error handling
  setItem(key, value) {
    try {
      if (!this.isAvailable()) return false;
      
      const safeKey = this.prefix + key;
      localStorage.setItem(safeKey, value);
      return true;
    } catch (e) {
      console.warn('localStorage setItem failed:', e.message);
      return false;
    }
  },
  
  // Safe getItem with error handling
  getItem(key, defaultValue = null) {
    try {
      if (!this.isAvailable()) return defaultValue;
      
      const safeKey = this.prefix + key;
      const value = localStorage.getItem(safeKey);
      return value !== null ? value : defaultValue;
    } catch (e) {
      console.warn('localStorage getItem failed:', e.message);
      return defaultValue;
    }
  },
  
  // Safe removeItem with error handling
  removeItem(key) {
    try {
      if (!this.isAvailable()) return false;
      
      const safeKey = this.prefix + key;
      localStorage.removeItem(safeKey);
      return true;
    } catch (e) {
      console.warn('localStorage removeItem failed:', e.message);
      return false;
    }
  },
  
  // Safe clear (only our namespaced items)
  clear() {
    try {
      if (!this.isAvailable()) return false;
      
      // Only remove items with our prefix
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.prefix)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
      return true;
    } catch (e) {
      console.warn('localStorage clear failed:', e.message);
      return false;
    }
  }
};

// Export the safe wrapper
export default SafeLocalStorage;
