VERSION 5.00
Begin {C62A69F0-16DC-11CE-9E98-00AA00574A4F} frmProjectPicker 
   Caption         =   "LIST PROJECT"
   ClientHeight    =   6585
   ClientLeft      =   120
   ClientTop       =   465
   ClientWidth     =   15585
   OleObjectBlob   =   "frmProjectPicker.frx":0000
   StartUpPosition =   1  'CenterOwner
End
Attribute VB_Name = "frmProjectPicker"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False
Option Explicit

  Public Confirmed As Boolean
  Public SelectedProjectId As String

  Private Sub cmdOpen_Click()
      If lstProjects.ListIndex < 0 Then
          MsgBox "Pilih satu project dulu.", vbExclamation
          Exit Sub
      End If
      SelectedProjectId = CStr(lstProjects.List(lstProjects.ListIndex, 5)) ' kolom tersembunyi =  project_id
      Confirmed = True
      Me.Hide
  End Sub

  Private Sub cmdCancel_Click()
      Confirmed = False
      Me.Hide
  End Sub

Private Sub Label3_Click()

End Sub

  Private Sub lstProjects_DblClick(ByVal Cancel As MSForms.ReturnBoolean)
      cmdOpen_Click            ' double-click baris = Buka
  End Sub

Private Sub TextBox1_Change()

End Sub

  Private Sub UserForm_QueryClose(Cancel As Integer, CloseMode As Integer)
      If CloseMode = vbFormControlMenu Then   ' tombol X = batal
          Confirmed = False
          Cancel = True
          Me.Hide                              ' Hide, BUKAN Unload, agar caller bisa baca properti
      End If
  End Sub
