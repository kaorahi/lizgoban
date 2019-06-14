'==========================================================================
' VBScript Source File
'==========================================================================

set objshell=createobject("wscript.shell")
If IsExitAFile("config.json") Then
objshell.run("%comspec% /c npx electron src -c config.json"), 0, true
Else objshell.run("%comspec% /c npx electron src"), 0, true
End If

Function IsExitAFile(filespec)
    Dim fso
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.fileExists(filespec) Then
    IsExitAFile = True
    Else IsExitAFile = False
    End If
End Function
