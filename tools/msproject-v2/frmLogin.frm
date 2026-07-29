VERSION 5.00
Begin {C62A69F0-16DC-11CE-9E98-00AA00574A4F} frmLogin 
   Caption         =   "SSB LOGON"
   ClientHeight    =   3210
   ClientLeft      =   120
   ClientTop       =   465
   ClientWidth     =   5700
   OleObjectBlob   =   "frmLogin.frx":0000
   StartUpPosition =   1  'CenterOwner
End
Attribute VB_Name = "frmLogin"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Private Sub cmdCancel_Click()
Me.Hide
End Sub

Private Sub cmdLogin_Click()
Dim ok As Boolean, uname As String, msg As String
      lblStatus.Caption = "Memverifikasi..."
      Me.Repaint
      ok = MsTryLogin(Trim$(txtUsername.text), txtPassword.text, uname, msg)
      If ok Then
          gCurrentUser = uname
          Me.Hide
          MsgBox "Berhasil login sebagai: " & uname, vbInformation, "Login"
      Else
          lblStatus.Caption = msg
          txtPassword.text = ""
          txtPassword.SetFocus
      End If
End Sub

Private Sub UserForm_Initialize()
      lblStatus.Caption = ""
      If Len(gCurrentUser) > 0 Then txtUsername.text = gCurrentUser
  End Sub
