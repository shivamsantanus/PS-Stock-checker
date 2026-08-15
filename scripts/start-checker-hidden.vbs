' ---------------------------------------------------------------------------
' Launches run-checker.cmd with no visible console window.
'
' A copy of this file lives in the user's Startup folder so the checker comes
' back automatically after a reboot - the admin-free stand-in for the Scheduled
' Task that install-windows-task.ps1 registers (that needs elevation).
'
' Run 0 = hidden window, False = don't wait for it to finish.
' ---------------------------------------------------------------------------
Dim shell, fso, here
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run """" & here & "\run-checker.cmd""", 0, False
