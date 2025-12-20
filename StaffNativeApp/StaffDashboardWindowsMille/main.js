//C:\Users\ASUS\Documents\GitHub\newest-qr-menu\StaffNativeApp\MilleStaffDashboardWindows\main.js

const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL("https://13e-menu.netlify.app/mille-staff.html");
}

app.whenReady().then(createWindow);
