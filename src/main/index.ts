import { app, BrowserWindow } from 'electron'
import { initSocketServer } from '@main/socketServer'  // We'll add later

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: './preload/index.js',
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools()
  }

  // Load renderer (Vite dev or built)
  const url = process.env.VITE_DEV_SERVER_URL || `file://${__dirname}/../renderer/index.html`
  win.loadURL(url as string)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())