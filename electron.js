const { app, BrowserWindow, Menu, Tray, nativeImage, dialog, Notification, ipcMain } = require("electron");
const path = require("path");
const isDev = process.argv.includes("--dev") || !app.isPackaged;

// Get server URL - Supports both domain and IP addresses
// Priority: ELECTRON_SERVER_URL > ELECTRON_SERVER_DOMAIN > ELECTRON_SERVER_IP
// For production domain: Set ELECTRON_SERVER_URL=https://task.ocslive.com
// For LAN deployment: Set ELECTRON_SERVER_IP and ELECTRON_SERVER_PORT
function getServerURL() {
  // 1. Check full URL environment variable first (highest priority - for production domain)
  if (process.env.ELECTRON_SERVER_URL) {
    const url = process.env.ELECTRON_SERVER_URL.trim();
    // Ensure URL ends with /
    return url.endsWith('/') ? url : `${url}/`;
  }
  
  // 2. Check for domain name (for production HTTPS)
  if (process.env.ELECTRON_SERVER_DOMAIN) {
    const domain = process.env.ELECTRON_SERVER_DOMAIN.trim();
    const protocol = process.env.ELECTRON_SERVER_PROTOCOL || 'https';
    // Remove protocol if already included
    const cleanDomain = domain.replace(/^https?:\/\//, '');
    return `${protocol}://${cleanDomain}/`;
  }
  
  // 3. Use configurable server IP and port (for LAN deployments)
  const serverIP = process.env.ELECTRON_SERVER_IP || "192.168.90.177";
  const port = process.env.ELECTRON_SERVER_PORT || "5000";
  const protocol = process.env.ELECTRON_SERVER_PROTOCOL || "http";
  
  // Warn if using default hardcoded IP (should be set via environment variable in production)
  if (!process.env.ELECTRON_SERVER_IP && !process.env.ELECTRON_SERVER_URL && !process.env.ELECTRON_SERVER_DOMAIN) {
    console.warn('⚠️ No server URL configured. Using default IP. For production, set:');
    console.warn('   ELECTRON_SERVER_URL=https://task.ocslive.com');
    console.warn('   OR');
    console.warn('   ELECTRON_SERVER_DOMAIN=task.ocslive.com');
  }
  
  // Return server URL
  return `${protocol}://${serverIP}:${port}/`;
}

const SERVER_URL = getServerURL();

// ============================================
// HELPER FUNCTION: Get icon path (centralized)
// ============================================
// This function searches for icons in order of preference
// Returns the first valid icon path found, or null if none exist
function getIconPath() {
  const fs = require("fs");
  const possiblePaths = [
    path.join(__dirname, "icon.png"),
    path.join(__dirname, "icon.ico"),
    path.join(__dirname, "..", "public", "favicon.ico"),
    path.join(__dirname, "..", "build", "favicon.ico")
  ];
  
  for (const iconPath of possiblePaths) {
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }
  
  return null; // No icon found
}

// Initialize electron-store for persistent token storage (Asana-style)
let store = null;
try {
  const Store = require("electron-store");
  store = new Store({
    name: "ocs-taskmanager",
    defaults: {
      token: null,
      accessToken: null,
      user: null,
      workspaceId: null,
      workspaceSlug: null
    }
  });
  console.log("✅ Electron store initialized for persistent token storage");
} catch (error) {
  console.warn("⚠️ electron-store not available:", error.message);
  console.warn("⚠️ Token will only be stored in localStorage (may not persist)");
}

// Try to load electron-updater, but don't crash if it's not available
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
} catch (error) {
  console.warn("⚠️ electron-updater not available:", error.message);
  console.warn("⚠️ Auto-update functionality will be disabled");
}

let mainWindow;
let tray = null;

function createWindow() {
  // Get icon path using centralized helper
  const iconPath = getIconPath();

  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    title: "OCS Task Manager",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,  // Disabled to fix notification click events
      webSecurity: true,
      preload: path.join(__dirname, "preload.js")
    },
    show: false, // Don't show until ready
    backgroundColor: "#ffffff"
  });

  // Show window when ready to prevent visual flash
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Function to get user's workspace URL
  const getUserWorkspaceURL = () => {
    try {
      // Try to read localStorage from a preload script or use a default
      // For now, we'll let the React app handle the redirect
      // But we can try to load directly to workspace if available
      return null; // Let React app handle routing
    } catch (error) {
      return null;
    }
  };

  // Load the app
  if (isDev) {
    // Development: Try React dev server first, fallback to backend-served app
    const devURL = process.env.ELECTRON_DEV_URL || "http://localhost:3000";
    mainWindow.loadURL(devURL);
    console.log(`🔧 Development mode: Loading from ${devURL}`);
    console.log("💡 Make sure your React dev server is running: npm start");
    console.log("💡 Or set ELECTRON_DEV_URL to load from a different URL");
    
    // Handle dev server not ready
    mainWindow.webContents.on("did-fail-load", (event, errorCode, errorDescription) => {
      if (errorCode === -106) {
        console.log("⚠️ Dev server not ready. Trying backend-served app...");
        mainWindow.loadURL(`${SERVER_URL}`);
      }
    });
  } else {
    // Production: Load from built files
    const buildPath = path.join(__dirname, "..", "build", "index.html");
    if (require("fs").existsSync(buildPath)) {
      mainWindow.loadFile(buildPath);
      console.log("📦 Production mode: Loading from build files");
      console.log(`🌐 Server URL: ${SERVER_URL}`);
      
      // Inject server URL into the page so React app can use it
      mainWindow.webContents.on("did-finish-load", () => {
        mainWindow.webContents.executeJavaScript(`
          (function() {
            const correctServerURL = "${SERVER_URL}";
            window.ELECTRON_SERVER_URL = correctServerURL;
            if (window.localStorage) {
              // Always update to the correct server URL (overwrites any cached wrong IP)
              window.localStorage.setItem('ELECTRON_SERVER_URL', correctServerURL);
              console.log('🌐 Server URL set to:', correctServerURL);
            }
          })();
        `).catch(err => console.error("Error injecting server URL:", err));
      });
    } else {
      // Fallback: Load from backend server
      console.log("⚠️ Build files not found. Loading from backend server...");
      console.log(`🌐 Server URL: ${SERVER_URL}`);
      mainWindow.loadURL(`${SERVER_URL}`);
    }
  }

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require("electron").shell.openExternal(url);
    return { action: "deny" };
  });

}

// Create system tray
function createTray() {
  try {
    // Get icon path using centralized helper
    const iconPath = getIconPath();
    
    let icon;
    if (iconPath) {
      icon = nativeImage.createFromPath(iconPath);
    } else {
      icon = nativeImage.createEmpty();
    }
    
    // Create tray with icon (or empty if none found)
    tray = new Tray(icon);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Open OCS Task Manager",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          } else {
            createWindow();
          }
        }
      },
      {
        label: "Quit",
        click: () => {
          app.quit();
        }
      }
    ]);

    tray.setToolTip("OCS Task Manager");
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      } else {
        createWindow();
      }
    });
  } catch (error) {
    console.log("⚠️ System tray not available:", error.message);
  }
}

// App event handlers
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

app.on("window-all-closed", () => {
  // On macOS, keep app running even when all windows are closed
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Security: Prevent new window creation
app.on("web-contents-created", (event, contents) => {
  contents.on("new-window", (navigationEvent, navigationURL) => {
    navigationEvent.preventDefault();
    require("electron").shell.openExternal(navigationURL);
  });
});

// ============================================
// IPC HANDLERS FOR PERSISTENT TOKEN STORAGE
// ============================================
// These handlers allow the renderer process to save/load tokens
// in electron-store, which persists across app restarts

// Save token to persistent storage
ipcMain.handle("save-token", (event, token) => {
  try {
    if (store) {
      store.set("token", token);
      store.set("accessToken", token); // Also save as accessToken for compatibility
      console.log("✅ Token saved to persistent storage");
      return { success: true };
    } else {
      console.warn("⚠️ Store not available, token not persisted");
      return { success: false, error: "Store not available" };
    }
  } catch (error) {
    console.error("❌ Error saving token:", error);
    return { success: false, error: error.message };
  }
});

// Get token from persistent storage
ipcMain.handle("get-token", () => {
  try {
    if (store) {
      const token = store.get("token") || store.get("accessToken");
      return { success: true, token };
    } else {
      return { success: false, token: null };
    }
  } catch (error) {
    console.error("❌ Error getting token:", error);
    return { success: false, token: null, error: error.message };
  }
});

// Save user data to persistent storage
ipcMain.handle("save-user", (event, userData) => {
  try {
    if (store) {
      store.set("user", userData);
      if (userData.token) {
        store.set("token", userData.token);
        store.set("accessToken", userData.token);
      }
      if (userData.workspaceId) {
        store.set("workspaceId", userData.workspaceId);
      }
      if (userData.workspaceSlug) {
        store.set("workspaceSlug", userData.workspaceSlug);
      }
      console.log("✅ User data saved to persistent storage");
      return { success: true };
    } else {
      return { success: false, error: "Store not available" };
    }
  } catch (error) {
    console.error("❌ Error saving user:", error);
    return { success: false, error: error.message };
  }
});

// Get user data from persistent storage
ipcMain.handle("get-user", () => {
  try {
    if (store) {
      const user = store.get("user");
      return { success: true, user };
    } else {
      return { success: false, user: null };
    }
  } catch (error) {
    console.error("❌ Error getting user:", error);
    return { success: false, user: null, error: error.message };
  }
});

// Clear all stored data (logout)
ipcMain.handle("clear-storage", () => {
  try {
    if (store) {
      store.clear();
      console.log("✅ Storage cleared");
      return { success: true };
    } else {
      return { success: false, error: "Store not available" };
    }
  } catch (error) {
    console.error("❌ Error clearing storage:", error);
    return { success: false, error: error.message };
  }
});

// Auto-updater configuration (only if available)
if (autoUpdater) {
  // Remove trailing slash from SERVER_URL for update URL construction
  const baseUrl = SERVER_URL.endsWith('/') ? SERVER_URL.slice(0, -1) : SERVER_URL;
  const updateUrl = `${baseUrl}/desktop/updates`;
  
  // ⚠️ WARNING: Electron auto-updater requires HTTPS
  // HTTP (LAN IP) will cause silent failures
  if (!updateUrl.startsWith('https://')) {
    console.warn('⚠️ Auto-updater requires HTTPS. Current URL is HTTP:', updateUrl);
    console.warn('⚠️ Auto-updates will fail silently. Use HTTPS or disable auto-updater.');
  }
  
  autoUpdater.setFeedURL({
    provider: "generic",
    url: updateUrl
  });

// Auto-updater events
autoUpdater.on("checking-for-update", () => {
  console.log("🔍 Checking for updates...");
});

autoUpdater.on("update-available", (info) => {
  console.log("✅ Update available:", info.version);
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Available",
      message: `A new version (${info.version}) is available.`,
      detail: "The update will be downloaded in the background. You'll be notified when it's ready to install.",
      buttons: ["OK"]
    });
  }
});

autoUpdater.on("update-not-available", (info) => {
  console.log("✅ App is up to date:", info.version);
});

autoUpdater.on("error", (err) => {
  console.error("❌ Update error:", err);
  // Don't show error to user in production - just log it
  if (isDev) {
    if (mainWindow) {
      dialog.showErrorBox("Update Error", err.message || "An error occurred while checking for updates.");
    }
  }
});

autoUpdater.on("download-progress", (progressObj) => {
  const percent = Math.round(progressObj.percent);
  console.log(`📥 Download progress: ${percent}%`);
  // You can send this to the renderer process to show a progress bar
  if (mainWindow) {
    mainWindow.webContents.send("update-download-progress", percent);
  }
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("✅ Update downloaded:", info.version);
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Update Ready",
      message: "Update downloaded successfully!",
      detail: `Version ${info.version} is ready to install. The app will restart to apply the update.`,
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        // User clicked "Restart Now"
        autoUpdater.quitAndInstall(false, true);
      }
    });
  } else {
    // If window is closed, install on next app start
    autoUpdater.quitAndInstall(false, true);
  }
});

// Check for updates on app start (only in production)
if (!isDev && app.isPackaged) {
  // Check immediately
  autoUpdater.checkForUpdates();
  
  // Then check every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 4 * 60 * 60 * 1000); // 4 hours
  }
} else {
  console.log("ℹ️ Auto-updater is disabled (electron-updater not available)");
}

// ============================================
// NOTIFICATION DEDUPLICATION
// ============================================
// Prevents duplicate notifications from both new and legacy APIs
const recentNotifications = new Map(); // tag -> timestamp
const DEDUP_WINDOW_MS = 2000; // 2 seconds

function isDuplicateNotification(tag) {
  if (!tag) return false;
  const now = Date.now();
  const lastShown = recentNotifications.get(tag);
  
  if (lastShown && (now - lastShown) < DEDUP_WINDOW_MS) {
    return true; // Duplicate within time window
  }
  
  // Update timestamp
  recentNotifications.set(tag, now);
  
  // Cleanup old entries (keep map from growing)
  if (recentNotifications.size > 100) {
    const cutoff = now - DEDUP_WINDOW_MS * 2;
    for (const [key, timestamp] of recentNotifications.entries()) {
      if (timestamp < cutoff) {
        recentNotifications.delete(key);
      }
    }
  }
  
  return false;
}

// Setup IPC handlers
function setupIPC() {
  console.log('🔧 Setting up IPC handlers...');
  
  // Handle opening external URLs
  ipcMain.handle('open-external', async (event, url) => {
    const { shell } = require('electron');
    await shell.openExternal(url);
    return true;
  });

  // Handle desktop notifications (new simplified API)
  ipcMain.handle('show-desktop-notification', async (event, data) => {
    try {
      console.log('🔔 IPC: show-desktop-notification called with:', {
        title: data.title,
        body: data.body,
        hasData: !!data.data
      });

      if (!Notification.isSupported()) {
        console.log('⚠️ Notifications not supported on this platform');
        return false;
      }

      // Prevent duplicate notifications
      const tag = data.data?.tag || `notification-${data.title}-${data.body}-${Date.now()}`;
      if (isDuplicateNotification(tag)) {
        console.log('⚠️ Duplicate notification prevented:', tag);
        return false;
      }

      // Get icon path using centralized helper
      const iconPath = getIconPath();
      let icon = null;
      if (iconPath) {
        icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          console.log('✅ Found notification icon at:', iconPath);
        }
      }

      // Create notification - always show even if app is open
      const notification = new Notification({
        title: data.title || 'OCS Task Manager',
        body: data.body || '',
        icon: icon || undefined,
        silent: false,
        tag: tag // Use tag for deduplication
      });

      console.log('✅ Notification object created, showing...');

      // Handle notification click - focus window and navigate
      // SINGLE UNIFIED FLOW: Only use IPC, React handles navigation
      notification.on('click', () => {
        console.log('🔔 Notification clicked');
        if (!mainWindow) return;
        
        // Always show and focus the window first
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        
        // Wait for window to be focused, then send navigation data via IPC
        // React App.js will handle the navigation
        setTimeout(() => {
          if (data.data) {
            console.log('📨 Sending notification-clicked event to renderer:', data.data);
            mainWindow.webContents.send('notification-clicked', {
              taskId: data.data.taskId,
              projectId: data.data.projectId,
              roomId: data.data.roomId,
              workspaceSlug: data.data.workspaceSlug,
              type: data.data.type,
              entityType: data.data.entityType,
              entityId: data.data.entityId
            });
          }
        }, 100); // Small delay to ensure window is focused
      });

      // Show notification - this works even when app is open
      notification.show();
      
      console.log('✅ Desktop notification shown successfully:', data.title);
      return true;
    } catch (error) {
      console.error('❌ Error showing notification:', error);
      console.error('❌ Error stack:', error.stack);
      return false;
    }
  });

  // Handle desktop notifications (legacy API - kept for backward compatibility)
  ipcMain.handle('show-notification', async (event, options) => {
    try {
      if (!Notification.isSupported()) {
        console.log('⚠️ Notifications not supported on this platform');
        return false;
      }

      // Prevent duplicate notifications
      const tag = options.tag || `notification-${options.title}-${options.body}-${Date.now()}`;
      if (isDuplicateNotification(tag)) {
        console.log('⚠️ Duplicate notification prevented (legacy API):', tag);
        return false;
      }

      // Get icon path using centralized helper
      const iconPath = getIconPath();
      let icon = null;
      if (iconPath) {
        icon = nativeImage.createFromPath(iconPath);
      }

      // Create notification
      const notification = new Notification({
        title: options.title || 'OCS Task Manager',
        body: options.body || '',
        icon: icon || undefined,
        silent: options.silent || false,
        tag: options.tag || `notification-${Date.now()}`,
        urgency: options.urgency || 'normal'
      });

      // Handle notification click - SINGLE UNIFIED FLOW
      // Only use IPC, React handles navigation (removed executeJavaScript fallback)
      notification.on('click', () => {
        console.log('🔔 Legacy notification clicked');
        if (!mainWindow) return;
        
        // Always show and focus the window first
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.show();
        mainWindow.focus();
        
        // Wait for window to be focused, then send navigation data via IPC
        // React App.js will handle the navigation
        setTimeout(() => {
          if (options.data) {
            console.log('📨 Sending notification-clicked event to renderer:', options.data);
            mainWindow.webContents.send('notification-clicked', {
              taskId: options.data.taskId,
              projectId: options.data.projectId,
              roomId: options.data.roomId,
              workspaceSlug: options.data.workspaceSlug,
              type: options.data.type,
              entityType: options.data.entityType,
              entityId: options.data.entityId
            });
          }
        }, 100); // Small delay to ensure window is focused
      });

      // Show notification
      notification.show();
      
      console.log('🔔 Desktop notification shown:', options.title);
      return true;
    } catch (error) {
      console.error('❌ Error showing notification:', error);
      return false;
    }
  });
  
  console.log('✅ IPC handlers setup complete');
}

// Request notification permission and setup IPC
app.whenReady().then(() => {
  // Setup IPC handlers
  setupIPC();
  
  // Request notification permission (required on macOS)
  if (process.platform === "darwin") {
    if (Notification.isSupported()) {
      console.log("🔔 Desktop notifications supported on macOS");
    }
  } else if (process.platform === "win32") {
    console.log("🔔 Desktop notifications enabled on Windows");
  }
});

