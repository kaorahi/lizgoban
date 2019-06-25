' Accelerate and simplify for Chinese users.
command_npm = "npm config set registry https://registry.npm.taobao.org"
command_electron = "npm config set ELECTRON_MIRROR http://npm.taobao.org/mirrors/electron/"
command_install = "npm install"

WS = CreateObject("WScript.Shell")

WS.Run command_npm, 0, true
WS.Run command_electron, 0, true
WS.Run command_install, 1
