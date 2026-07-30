Attribute VB_Name = "zImport"
Option Explicit

' =====================================================================================
' zImport.bas - bootstrap import ulang modul MPS2 ke VBE MS Project.
'
' Prasyarat SEKALI: File > Options > Trust Center > Trust Center Settings > Macro Settings
'   -> centang "Trust access to the VBA project object model".
'
' Import ulang semua .bas/.cls (MODUL) dari FOLDER, remove-then-import -> ANTI-DUPLIKAT
' (ms_sync1 dll ikut dibersihkan). Form (.frm) TIDAK disentuh (delikat karena .frx biner) -
' re-import form secara manual bila perlu.
'
' Macro ini melewati dirinya sendiri (zImport), jadi aman disimpan di folder.
' =====================================================================================

Sub ImportAllMpsModules()
    Const FOLDER As String = "D:\website\MPS2\tools\msproject-v2\"   ' <- sesuaikan bila beda
    Dim vbProj As Object, fso As Object, f As Object
    Dim ext As String, baseName As String
    Dim imported As Long, removed As Long

    Set vbProj = Application.VBE.ActiveVBProject
    Set fso = CreateObject("Scripting.FileSystemObject")

    For Each f In fso.GetFolder(FOLDER).Files
        ext = LCase$(fso.GetExtensionName(f.Name))
        If ext = "bas" Or ext = "cls" Then
            baseName = fso.GetBaseName(f.Name)
            If StrComp(baseName, "zImport", vbTextCompare) <> 0 Then   ' jangan hapus diri sendiri
                removed = removed + RemoveLike(vbProj, baseName)        ' hapus baseName + duplikat baseName1..
                vbProj.VBComponents.Import f.Path
                imported = imported + 1
            End If
        End If
    Next f

    MsgBox "Import modul selesai." & vbCrLf & _
           "Diimport: " & imported & "   Komponen lama dihapus: " & removed & vbCrLf & _
           "Folder: " & FOLDER & vbCrLf & vbCrLf & _
           "(Form frmLogin/frmProjectPicker tak disentuh.)" & vbCrLf & _
           "PENTING: re-import mereset state -> jalankan Ms_Login lagi sebelum checkout.", vbInformation
End Sub

' Hapus komponen bernama baseName, ATAU baseName diikuti angka (mis. ms_sync1, ms_sync2).
Private Function RemoveLike(ByVal vbProj As Object, ByVal baseName As String) As Long
    Dim i As Long, c As Object, n As String, tail As String
    For i = vbProj.VBComponents.Count To 1 Step -1   ' mundur: Remove mengubah koleksi
        Set c = vbProj.VBComponents(i)
        n = c.Name
        If StrComp(n, baseName, vbTextCompare) = 0 Then
            vbProj.VBComponents.Remove c
            RemoveLike = RemoveLike + 1
        ElseIf Len(n) > Len(baseName) Then
            If StrComp(Left$(n, Len(baseName)), baseName, vbTextCompare) = 0 Then
                tail = Mid$(n, Len(baseName) + 1)
                If IsNumeric(tail) Then
                    vbProj.VBComponents.Remove c
                    RemoveLike = RemoveLike + 1
                End If
            End If
        End If
    Next i
End Function
