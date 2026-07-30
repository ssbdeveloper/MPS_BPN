Attribute VB_Name = "ms_ui"
Option Explicit

' =============================================================================
' ms_ui - UserForm front-end untuk pemilihan project (ADITIF).
'
' Ms_OpenFromServerForm : versi UserForm (tabel) dari Ms_OpenFromServer.
'   Meniru pola fetch+import ms_sync.Ms_OpenFromServer, tetapi menampilkan
'   daftar project di frmProjectPicker.lstProjects (bukan InputBox bernomor).
'
' Modul ini TIDAK mengubah ms_sync - Ms_OpenFromServer (versi InputBox) tetap
' ada dan tetap berfungsi. Keduanya berdiri sendiri.
'
' Kontrak frmProjectPicker (dicocokkan dari code-behind frmProjectPicker.frm):
'   - ListBox    : lstProjects
'   - Public     : Confirmed As Boolean, SelectedProjectId As String
'   - Kolom 5    : project_id (tersembunyi) - cmdOpen_Click meng-set
'                  SelectedProjectId = lstProjects.List(ListIndex, 5)
'   - Form pakai Me.Hide (bukan Unload) saat Open/Cancel/X, sehingga properti
'     Confirmed & SelectedProjectId masih terbaca setelah .Show kembali.
'
' Helper Public yang dipakai (di modul lain):
'   MsHttpGet / MsParseSuccess (ms_http), MsImportProjectPackage (ms_import).
' =============================================================================

Public Sub Ms_OpenFromServerForm()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim data As Object
    Dim item As Object
    Dim i As Long
    Dim lockText As String
    Dim projectId As String

    Set root = MsParseSuccess(MsHttpGet("/projects?limit=30"))
    Set data = root("data")
    If data.Count = 0 Then
        MsgBox "Belum ada project tersimpan di server." & vbCrLf & _
               "Gunakan Ms_PublishNewProject untuk menyimpan file aktif.", vbExclamation
        Exit Sub
    End If

    Dim frm As frmProjectPicker
    Set frm = New frmProjectPicker
    frm.Confirmed = False
    frm.SelectedProjectId = ""

    ' --- Populate tabel. Kolom 5 = project_id (tersembunyi), sesuai
    '     kontrak cmdOpen_Click di frmProjectPicker. ColumnCount/ColumnWidths
    '     ditegakkan di sini agar kolom tersembunyi konsisten walau file .frx
    '     desainer berbeda.
    With frm.lstProjects
        .Clear
        .ColumnCount = 6
        .ColumnWidths = "30 pt;230 pt;55 pt;95 pt;130 pt;0 pt" ' kolom 5 = 0 pt (hidden)
        For i = 1 To data.Count
            Set item = data(i)

            lockText = ""
            If item.Exists("checked_out_by") Then
                If Not IsNull(item("checked_out_by")) Then
                    If Len(CStr(item("checked_out_by"))) > 0 Then
                        lockText = "LOCK: " & CStr(item("checked_out_by"))
                    End If
                End If
            End If

            .AddItem CStr(i)                                    ' kolom 0: nomor
            .List(.ListCount - 1, 1) = CStr(item("project_name"))         ' kolom 1: nama
            .List(.ListCount - 1, 2) = "rev " & CStr(item("revision_no")) ' kolom 2: revisi
            .List(.ListCount - 1, 3) = CStr(item("status"))              ' kolom 3: status
            .List(.ListCount - 1, 4) = lockText                          ' kolom 4: lock
            .List(.ListCount - 1, 5) = CStr(item("project_id"))          ' kolom 5: project_id (hidden)
        Next i
    End With

    frm.Show vbModal   ' modal; form pakai Me.Hide -> properti masih terbaca setelah ini

    If Not frm.Confirmed Then
        Unload frm
        Set frm = Nothing
        Exit Sub
    End If

    ' Confirmed: SelectedProjectId sudah diisi form dari kolom tersembunyi 5.
    projectId = frm.SelectedProjectId
    Unload frm
    Set frm = Nothing

    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong dari pilihan form.", vbExclamation
        Exit Sub
    End If

    MsImportProjectPackage projectId
    Exit Sub
ErrHandler:
    MsgBox "Open from server (form) gagal: " & Err.Description, vbCritical
End Sub

' Ms_LinkToServerProject: hubungkan file AKTIF ke project server yang SUDAH ADA.
' Untuk file yang kehilangan project_id (mis. hasil download .mpp lama) sehingga
' Ms_CheckOut mengira "project baru". Set project_id + revision_no dari server,
' kosongkan lock token. TIDAK checkout/save otomatis - itu langkah user berikutnya.
Public Sub Ms_LinkToServerProject()
    On Error GoTo ErrHandler
    Dim root As Object, data As Object, item As Object
    Dim i As Long, lockText As String
    Dim frm As frmProjectPicker
    Dim chosenId As String, chosenName As String
    Dim chosenRev As Variant

    If ActiveProject Is Nothing Then
        MsgBox "Buka file MS Project yang mau dihubungkan dulu.", vbExclamation
        Exit Sub
    End If

    Set root = MsParseSuccess(MsHttpGet("/projects?limit=30"))
    Set data = root("data")
    If data.Count = 0 Then
        MsgBox "Belum ada project di server untuk dihubungkan.", vbExclamation
        Exit Sub
    End If

    Set frm = New frmProjectPicker
    frm.Caption = "Link file ini ke project server"
    frm.Confirmed = False
    frm.SelectedProjectId = ""
    With frm.lstProjects
        .Clear
        .ColumnCount = 6
        .ColumnWidths = "30 pt;230 pt;55 pt;95 pt;130 pt;0 pt"
        For i = 1 To data.Count
            Set item = data(i)
            lockText = ""
            If item.Exists("checked_out_by") Then
                If Not IsNull(item("checked_out_by")) Then
                    If Len(CStr(item("checked_out_by"))) > 0 Then lockText = "LOCK: " & CStr(item("checked_out_by"))
                End If
            End If
            .AddItem CStr(i)
            .List(.ListCount - 1, 1) = CStr(item("project_name"))
            .List(.ListCount - 1, 2) = "rev " & CStr(item("revision_no"))
            .List(.ListCount - 1, 3) = CStr(item("status"))
            .List(.ListCount - 1, 4) = lockText
            .List(.ListCount - 1, 5) = CStr(item("project_id"))
        Next i
    End With

    frm.Show vbModal
    chosenId = ""
    If frm.Confirmed Then chosenId = frm.SelectedProjectId
    Unload frm
    Set frm = Nothing
    If Len(chosenId) = 0 Then Exit Sub

    ' ambil nama + revision_no dari project yang dipilih
    chosenName = chosenId
    chosenRev = 1
    For i = 1 To data.Count
        Set item = data(i)
        If StrComp(CStr(item("project_id")), chosenId, vbTextCompare) = 0 Then
            chosenName = CStr(item("project_name"))
            chosenRev = item("revision_no")
            Exit For
        End If
    Next i

    If MsgBox("Hubungkan file AKTIF ke project server:" & vbCrLf & _
              "  " & chosenName & "  (rev " & CStr(chosenRev) & ")?" & vbCrLf & vbCrLf & _
              "project_id file akan di-set ke project itu. Setelah ini Ms_CheckOut / " & _
              "Ms_SaveToServer menuju project tersebut (bukan project baru).", _
              vbQuestion + vbYesNo, "Link to Server Project") <> vbYes Then Exit Sub

    MsSetProjectId chosenId
    MsSetProjectRevisionNo chosenRev
    MsSetProjectLockToken ""

    MsgBox "File terhubung ke: " & chosenName & vbCrLf & _
           "Project ID: " & chosenId & " (rev " & CStr(chosenRev) & ")" & vbCrLf & vbCrLf & _
           "Simpan file (Ctrl+S) agar tautan menetap, lalu Ms_CheckOut untuk mulai edit.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Link to server project gagal: " & Err.Description, vbCritical
End Sub
