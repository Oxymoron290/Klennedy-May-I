import { app, BrowserWindow } from 'electron'
import path from 'path'

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools()
  }

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => app.quit())