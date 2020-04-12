const electron = require('electron')
const version = electron.remote.app.getVersion()
function open_ext(url) {electron.shell.openExternal(url)}
function for_class(name, proc) {
  Array.prototype.forEach.call(document.getElementsByClassName(name), proc)
}
window.onload = () => {
  for_class('ver', z => z.textContent = version)
  for_class('ext', z => {z.onclick = () => open_ext(z.dataset.url)})
}
