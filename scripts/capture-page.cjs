// Chromium puede perder la superficie de captura al redimensionar una ventana offscreen.
module.exports = async function capturePage(webContents) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await webContents.capturePage()
    } catch (error) {
      if (attempt >= 2 || error.message !== 'UnknownVizError') throw error
      webContents.invalidate()
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}
