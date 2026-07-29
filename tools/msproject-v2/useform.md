Langkah 1 — Buat UserForm di VBE

  1. Alt+F11 → Insert → UserForm.
  2. F4 (Properties) set form: (Name) = frmProjectPicker, Caption = "Open from Server", Width ≈ 380,
  Height ≈ 270.
  3. Dari Toolbox tarik ListBox, set:
    - (Name) = lstProjects
    - ColumnCount = 6
    - ColumnWidths = 24;180;34;64;92;0  ← angka terakhir 0 menyembunyikan kolom project_id
    - ColumnHeads = False (header pakai Label di bawah)
  4. Tarik 5 Label sejajar di atas ListBox sebagai header: No, Project, Rev, Status, Lock (posisikan
  pas di atas tiap kolom).
  5. Tarik 2 CommandButton:
    - (Name) = cmdOpen, Caption "Buka", Default = True
    - (Name) = cmdCancel, Caption "Batal", Cancel = True

  Langkah 2 — Kode di BALIK form (double-click form → tempel)

  vba
  Option Explicit

  Public Confirmed As Boolean
  Public SelectedProjectId As String

  Private Sub cmdOpen_Click()
      If lstProjects.ListIndex < 0 Then
          MsgBox "Pilih satu project dulu.", vbExclamation
          Exit Sub
      End If
      SelectedProjectId = CStr(lstProjects.List(lstProjects.ListIndex, 5)) ' kolom tersembunyi =
  project_id
      Confirmed = True
      Me.Hide
  End Sub

  Private Sub cmdCancel_Click()
      Confirmed = False
      Me.Hide
  End Sub

  Private Sub lstProjects_DblClick(ByVal Cancel As MSForms.ReturnBoolean)
      cmdOpen_Click            ' double-click baris = Buka
  End Sub

  Private Sub UserForm_QueryClose(Cancel As Integer, CloseMode As Integer)
      If CloseMode = vbFormControlMenu Then   ' tombol X = batal
          Confirmed = False
          Cancel = True
          Me.Hide                              ' Hide, BUKAN Unload, agar caller bisa baca properti
      End If
  End Sub

  Langkah 3 — Modul baru ms_ui.bas (Insert → Module, tempel)

  vba
  Attribute VB_Name = "ms_ui"
  Option Explicit

  ' Aditif — TIDAK mengubah ms_sync.bas. Reuse MsHttpGet/MsParseSuccess/MsImportProjectPackage.
  Public Sub Ms_OpenFromServerForm()
      On Error GoTo ErrHandler
      Dim root As Object, data As Object, item As Object
      Dim i As Long, lockInfo As String
      Dim frm As frmProjectPicker
      Dim chosenId As String

      Set root = MsParseSuccess(MsHttpGet("/projects?limit=30"))
      Set data = root("data")
      If data.Count = 0 Then
          MsgBox "Belum ada project tersimpan di server." & vbCrLf & _
                 "Gunakan Ms_PublishNewProject untuk menyimpan file aktif.", vbExclamation
          Exit Sub
      End If

      Set frm = New frmProjectPicker
      frm.lstProjects.Clear
      For i = 1 To data.Count
          Set item = data(i)
          lockInfo = ""
          If item.Exists("checked_out_by") Then
              If Not IsNull(item("checked_out_by")) Then lockInfo = CStr(item("checked_out_by"))
          End If
          frm.lstProjects.AddItem CStr(i)
          frm.lstProjects.List(frm.lstProjects.ListCount - 1, 1) = CStr(item("project_name"))
          frm.lstProjects.List(frm.lstProjects.ListCount - 1, 2) = CStr(item("revision_no"))
          frm.lstProjects.List(frm.lstProjects.ListCount - 1, 3) = CStr(item("status"))
          frm.lstProjects.List(frm.lstProjects.ListCount - 1, 4) = lockInfo
          frm.lstProjects.List(frm.lstProjects.ListCount - 1, 5) = CStr(item("project_id"))
      Next i

      frm.Show                                   ' modal
      If frm.Confirmed And Len(frm.SelectedProjectId) > 0 Then
          chosenId = frm.SelectedProjectId
          Unload frm
          MsImportProjectPackage chosenId        ' <-- jalur import SAMA dengan Ms_OpenFromServer
      Else
          Unload frm
      End If
      Exit Sub

  ErrHandler:
      MsgBox "Open from server (form) gagal: " & Err.Description, vbCritical
  End Sub

  Langkah 4 — Jalankan & rollback

  - Jalankan Ms_OpenFromServerForm → tabel muncul, pilih baris → Buka (atau double-click) → import
  jalan.
  - Rollback kapan pun: klik kanan frmProjectPicker → Remove, dan ms_ui → Remove. Ms_OpenFromServer
  lama tetap ada.

  Setelah teruji → baru masuk repo

  Kalau sudah oke, export dari VBE (frmProjectPicker → File → Export → simpan .frm+.frx; ms_ui →
  Export .bas) ke tools/msproject-v2/, lalu bilang — aku commit ketiganya sekaligus (form butuh .frx
  biner yang cuma bisa dihasilkan VBE, tak bisa kubuat manual). Sampai itu, ms_sync.bas yang committed
  tetap jadi versi aman-mu.