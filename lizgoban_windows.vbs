Const conf = "config.json"
command = "npm start"

Set fso = CreateObject("Scripting.FileSystemObject")
If fso.FileExists(conf) Then
command = command & " -- -c " & conf
End If

CreateObject("WScript.Shell").Run command, 0
