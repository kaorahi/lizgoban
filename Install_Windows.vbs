command_electron = "npm config set ELECTRON_MIRROR http://npm.taobao.org/mirrors/electron/"

command_chinesenpm = "npm --registry https://registry.npm.taobao.org install"

LangId = CreateObject("wscript.Shell").RegRead("HKEY_CURRENT_USER\Control Panel\International\Locale")

If LangId = "00000804" Then ' Accelerate and simplify for Chinese Mainland users.
    CreateObject("WScript.Shell").Run command_electron, 0, true
    CreateObject("WScript.Shell").Run command_chinesenpm, 1
Else
    CreateObject("WScript.Shell").Run "npm install", 1
End If

'00000804 Chinese (PRC)
'00000404 Chinese (Taiwan)
'00000c04 Chinese (Hong Kong SAR, PRC)
'00001004 Chinese (Singapore)

'00000411 Japanese

'00000409 English (United States)
'00000809 English (United Kingdom)
'00000c09 English (Australian)
'00001009 English (Canadian)
'00001409 English (New Zealand)
'00001809 English (Ireland)
'00001c09 English (South Africa)
'00002009 English (Jamaica)
'00002409 English (Caribbean)
'00002809 English (Belize)
'00002c09 English (Trinidad)
