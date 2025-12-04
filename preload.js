// Preload script for Electron - exposes safe APIs to renderer
const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Open external URLs
  openExternal: (url) => {
    ipcRenderer.invoke('open-external', url);
  },
  
  // Show desktop notification (new simplified API)
  sendDesktopNotification: (data) => {
    return ipcRenderer.invoke('show-desktop-notification', data);
  },
  
  // Show desktop notification (legacy API - kept for backward compatibility)
  showNotification: async (options, onClick) => {
    const result = await ipcRenderer.invoke('show-notification', options);
    if (result && onClick) {
      onClick();
    }
    return result;
  },
  
  // Listen for notification click events from main process
  onNotificationClicked: (callback) => {
    ipcRenderer.on('notification-clicked', (_event, data) => {
      callback(data);
    });
  },
  
  // Remove notification click listener
  removeNotificationClickedListener: () => {
    ipcRenderer.removeAllListeners('notification-clicked');
  },
  
  // ============================================
  // PERSISTENT TOKEN STORAGE (Asana-style)
  // ============================================
  // These methods save tokens to electron-store, which persists
  // across app restarts, unlike localStorage which can be cleared
  
  // Save token to persistent storage
  // CENTRALIZED: Only save to electron-store, sync to localStorage for compatibility
  saveToken: async (token) => {
    try {
      const result = await ipcRenderer.invoke('save-token', token);
      // Sync to localStorage for compatibility (React app may read from localStorage)
      if (result.success && token) {
        localStorage.setItem('token', token);
        localStorage.setItem('accessToken', token);
      }
      return result;
    } catch (error) {
      console.error('Error saving token:', error);
      // Fallback to localStorage only if IPC fails
      if (token) {
        localStorage.setItem('token', token);
        localStorage.setItem('accessToken', token);
      }
      return { success: false, error: error.message };
    }
  },
  
  // Get token from persistent storage
  // CENTRALIZED: Read from electron-store first, fallback to localStorage
  getToken: async () => {
    try {
      const result = await ipcRenderer.invoke('get-token');
      if (result.success && result.token) {
        // Sync to localStorage for compatibility (React app may read from localStorage)
        localStorage.setItem('token', result.token);
        localStorage.setItem('accessToken', result.token);
        return result.token;
      }
      // Fallback to localStorage if electron-store is empty
      const localToken = localStorage.getItem('token') || localStorage.getItem('accessToken');
      if (localToken) {
        // Sync back to electron-store if found in localStorage
        await ipcRenderer.invoke('save-token', localToken);
      }
      return localToken || null;
    } catch (error) {
      console.error('Error getting token:', error);
      // Fallback to localStorage
      return localStorage.getItem('token') || localStorage.getItem('accessToken') || null;
    }
  },
  
  // Save user data to persistent storage
  // CENTRALIZED: Only save to electron-store, sync to localStorage for compatibility
  saveUser: async (userData) => {
    try {
      const result = await ipcRenderer.invoke('save-user', userData);
      // Sync to localStorage for compatibility (React app may read from localStorage)
      if (result.success && userData) {
        localStorage.setItem('ocs_user', JSON.stringify(userData));
        if (userData.token) {
          localStorage.setItem('token', userData.token);
          localStorage.setItem('accessToken', userData.token);
        }
        if (userData.workspaceId) {
          localStorage.setItem('workspaceId', String(userData.workspaceId));
        }
        if (userData.workspaceSlug) {
          localStorage.setItem('workspaceSlug', userData.workspaceSlug);
        }
      }
      return result;
    } catch (error) {
      console.error('Error saving user:', error);
      // Fallback to localStorage only if IPC fails
      if (userData) {
        localStorage.setItem('ocs_user', JSON.stringify(userData));
        if (userData.token) {
          localStorage.setItem('token', userData.token);
          localStorage.setItem('accessToken', userData.token);
        }
      }
      return { success: false, error: error.message };
    }
  },
  
  // Get user data from persistent storage
  // CENTRALIZED: Read from electron-store first, fallback to localStorage
  getUser: async () => {
    try {
      const result = await ipcRenderer.invoke('get-user');
      if (result.success && result.user) {
        // Sync to localStorage for compatibility (React app may read from localStorage)
        localStorage.setItem('ocs_user', JSON.stringify(result.user));
        return result.user;
      }
      // Fallback to localStorage if electron-store is empty
      const userStr = localStorage.getItem('ocs_user');
      if (userStr) {
        const user = JSON.parse(userStr);
        // Sync back to electron-store if found in localStorage
        await ipcRenderer.invoke('save-user', user);
        return user;
      }
      return null;
    } catch (error) {
      console.error('Error getting user:', error);
      // Fallback to localStorage
      const userStr = localStorage.getItem('ocs_user');
      return userStr ? JSON.parse(userStr) : null;
    }
  },
  
  // Clear all stored data (logout)
  clearStorage: async () => {
    try {
      const result = await ipcRenderer.invoke('clear-storage');
      // Also clear localStorage
      localStorage.clear();
      return result;
    } catch (error) {
      console.error('Error clearing storage:', error);
      // Fallback: clear localStorage
      localStorage.clear();
      return { success: false, error: error.message };
    }
  },
  
  // Check if running in Electron
  isElectron: true
});

// No code should be here - everything is inside contextBridge above
