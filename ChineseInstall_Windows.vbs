' Accelerate and simplify for Chinese users.
command_electron = "npm config set ELECTRON_MIRROR http://npm.taobao.org/mirrors/electron/"
command_chinesenpm = "npm --registry https://registry.npm.taobao.org install"

CreateObject("WScript.Shell").Run command_electron, 0, true
CreateObject("WScript.Shell").Run command_chinesenpm, 1
