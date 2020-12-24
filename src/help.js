let electron; try {electron = require('electron')} catch {}
const version = electron ? electron.ipcRenderer.sendSync('app_version') : ''
const open_ext = electron ? electron.shell.openExternal : window.open
function for_class(name, proc) {
  Array.prototype.forEach.call(document.getElementsByClassName(name), proc)
}
window.onload = () => {
  for_class('ver', z => z.textContent = version)
  for_class('ext', z => {
      z.title = z.dataset.url; z.onclick = () => open_ext(z.dataset.url)
  })
}
