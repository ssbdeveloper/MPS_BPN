Attribute VB_Name = "ms_sync"
Option Explicit

' =============================================================================
' ms_sync v2 — alur utama planner (6 macro + koneksi):
'
'   Ms_CheckConnection    : tes koneksi API.
'   Ms_OpenFromServer     : pilih project dari daftar bernomor -> import package.
'   Ms_CheckOut           : ambil lock edit (wajib sebelum SaveToServer).
'   Ms_SaveToServer       : sync metadata + upload .mpp (dulu Ms_SyncExistingProject).
'   Ms_CheckIn            : lepas lock (dulu Ms_CheckInCurrentProject).
'   Ms_PublishNewProject  : file baru -> project baru di server.
'   Ms_PublishCurrentRevision : tandai revisi DB sebagai published.
'   Ms_CloneAsNewProject  : bersihkan UUID agar file copy bisa dipublish baru.
'
' Macro debug/lanjutan pindah ke modul ms_debug.
' =============================================================================

Public Sub Ms_CheckConnection()
    On Error GoTo ErrHandler
    Dim root As Object
    Set root = MsParseSuccess(MsHttpGet("/health"))
    MsgBox "MS Project API connected." & vbCrLf & _
           "Service: " & CStr(root("data")("service")) & vbCrLf & _
           "Database: " & CStr(root("data")("database")) & vbCrLf & _
           "Base URL: " & MsCfgBaseUrl(), vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Connection failed: " & Err.Description & vbCrLf & _
           "Base URL: " & MsCfgBaseUrl(), vbCritical
End Sub

' --- Open from Server: daftar bernomor -> import ------------------------------
Public Sub Ms_OpenFromServer()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim data As Object
    Dim item As Object
    Dim i As Long
    Dim listText As String
    Dim answer As String
    Dim choice As Long
    Dim lockInfo As String

    Set root = MsParseSuccess(MsHttpGet("/projects?limit=30"))
    Set data = root("data")
    If data.Count = 0 Then
        MsgBox "Belum ada project tersimpan di server." & vbCrLf & _
               "Gunakan Ms_PublishNewProject untuk menyimpan file aktif.", vbExclamation
        Exit Sub
    End If

    listText = "Project di server (terbaru dulu):" & vbCrLf & vbCrLf
    For i = 1 To data.Count
        Set item = data(i)
        lockInfo = ""
        If item.Exists("checked_out_by") Then
            If Not IsNull(item("checked_out_by")) Then
                If Len(CStr(item("checked_out_by"))) > 0 Then
                    lockInfo = " [LOCK: " & CStr(item("checked_out_by")) & "]"
                End If
            End If
        End If
        listText = listText & CStr(i) & ". " & CStr(item("project_name")) & _
                   "  (rev " & CStr(item("revision_no")) & ", " & CStr(item("status")) & ")" & _
                   lockInfo & vbCrLf
    Next i
    listText = listText & vbCrLf & "Masukkan NOMOR project yang mau dibuka:"

    answer = InputBox(listText, "Open from Server")
    If Len(Trim$(answer)) = 0 Then Exit Sub
    If Not IsNumeric(answer) Then
        MsgBox "Input harus nomor dari daftar.", vbExclamation
        Exit Sub
    End If
    choice = CLng(answer)
    If choice < 1 Or choice > data.Count Then
        MsgBox "Nomor di luar daftar.", vbExclamation
        Exit Sub
    End If

    MsImportProjectPackage CStr(data(choice)("project_id"))
    Exit Sub
ErrHandler:
    MsgBox "Open from server gagal: " & Err.Description, vbCritical
End Sub

' --- Helper objek generik ------------------------------------------------------
Private Function MsSyncObjText(ByVal obj As Object, ByVal propertyName As String, Optional ByVal fallback As String = "") As String
    On Error Resume Next
    Dim value As Variant
    value = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Or IsNull(value) Or IsEmpty(value) Then
        Err.Clear
        MsSyncObjText = fallback
    Else
        MsSyncObjText = CStr(value)
    End If
    On Error GoTo 0
End Function

Private Function MsSyncObjObject(ByVal obj As Object, ByVal propertyName As String) As Object
    On Error Resume Next
    Set MsSyncObjObject = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Then
        Err.Clear
        Set MsSyncObjObject = Nothing
    End If
    On Error GoTo 0
End Function

Private Function MsSyncAssignmentLocalUid(ByVal a As Object, ByVal taskObj As Object, ByVal resourceObj As Object) As String
    MsSyncAssignmentLocalUid = MsAssignmentLocalUid(a)
    If Len(MsSyncAssignmentLocalUid) = 0 Then
        MsSyncAssignmentLocalUid = MsSyncObjText(taskObj, "UniqueID") & "-" & MsSyncObjText(resourceObj, "UniqueID")
    End If
    If Len(MsSyncAssignmentLocalUid) = 1 Then MsSyncAssignmentLocalUid = ""
End Function

Private Function MsBuildTaskLocalUidIndex() As Object
    Dim index As Object
    Dim t As Task
    Dim localUid As String

    Set index = CreateObject("Scripting.Dictionary")
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            localUid = MsSyncObjText(t, "UniqueID")
            If Len(localUid) > 0 Then
                If Not index.Exists(localUid) Then index.Add localUid, t
            End If
        End If
    Next t

    Set MsBuildTaskLocalUidIndex = index
End Function

Private Function MsBuildAssignmentLocalUidIndex() As Object
    Dim index As Object
    Dim t As Task
    Dim a As Object
    Dim taskAssignments As Object
    Dim taskObj As Object
    Dim resourceObj As Object
    Dim localUid As String

    Set index = CreateObject("Scripting.Dictionary")
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            Set taskAssignments = MsSyncObjObject(t, "Assignments")
            If Not taskAssignments Is Nothing Then
                For Each a In taskAssignments
                    If Not a Is Nothing Then
                        Set taskObj = MsSyncObjObject(a, "Task")
                        If taskObj Is Nothing Then Set taskObj = t
                        Set resourceObj = MsSyncObjObject(a, "Resource")
                        If Not resourceObj Is Nothing Then
                            localUid = MsSyncAssignmentLocalUid(a, taskObj, resourceObj)
                            If Len(localUid) > 0 Then
                                If Not index.Exists(localUid) Then index.Add localUid, a
                            End If
                        End If
                    End If
                Next a
            End If
        End If
    Next t

    Set MsBuildAssignmentLocalUidIndex = index
End Function

Private Sub MsApplySyncResponse(ByVal root As Object)
    Dim data As Object
    Dim item As Variant
    Dim t As Task
    Dim a As Object
    Dim projectId As String
    Dim taskByLocalUid As Object
    Dim assignmentByLocalUid As Object
    Dim localUid As String

    Set data = root("data")
    projectId = CStr(data("project_id"))
    MsSetProjectId projectId
    MsSetProjectRevisionNo data("revision_no")
    MsSetProjectMode MS_MODE_SINGLE_PROJECT
    Set taskByLocalUid = MsBuildTaskLocalUidIndex()

    If data.Exists("task_mappings") Then
        For Each item In data("task_mappings")
            If Not item Is Nothing Then
                localUid = CStr(item("local_task_uid"))
                If taskByLocalUid.Exists(localUid) Then
                    Set t = taskByLocalUid(localUid)
                    MsSetTaskId t, CStr(item("task_id"))
                    MsSetTaskProjectId t, projectId
                End If
            End If
        Next item
    End If
    Set assignmentByLocalUid = MsBuildAssignmentLocalUidIndex()

    If data.Exists("assignment_mappings") Then
        For Each item In data("assignment_mappings")
            If Not item Is Nothing Then
                localUid = CStr(item("local_assignment_uid"))
                If assignmentByLocalUid.Exists(localUid) Then
                    Set a = assignmentByLocalUid(localUid)
                    MsSetAssignmentId a, CStr(item("assignment_id"))
                End If
            End If
        Next item
    End If
End Sub

Private Sub MsApplyLockResponse(ByVal root As Object)
    Dim data As Object
    Set data = root("data")
    If data.Exists("lock_token") Then MsSetProjectLockToken CStr(data("lock_token"))
    If data.Exists("revision_no") Then MsSetProjectRevisionNo data("revision_no")
    MsSetProjectMode MS_MODE_SINGLE_PROJECT
End Sub

Private Sub MsDebugLog(ByVal message As String)
    Debug.Print Format$(Now, "yyyy-mm-dd hh:nn:ss") & " | " & message
End Sub

Private Function MsUploadCopyPath() As String
    MsUploadCopyPath = Environ$("TEMP") & "\mps-upload-" & _
        MsGetProjectId() & "-" & Format$(Now, "yyyymmddhhnnss") & ".mpp"
End Function

' Public: dipakai juga oleh ms_debug.
Public Function MsCurrentMppFilePath() As String
    On Error Resume Next
    Dim filePath As String
    Dim projectPath As String
    Dim projectName As String

    filePath = ActiveProject.FullName
    If Err.Number <> 0 Then
        Err.Clear
        filePath = ""
    End If

    If Len(Trim$(filePath)) = 0 Then
        projectPath = ActiveProject.Path
        projectName = ActiveProject.Name
        If Err.Number <> 0 Then
            Err.Clear
            projectPath = ""
            projectName = ""
        End If
        If Len(Trim$(projectPath)) > 0 And Len(Trim$(projectName)) > 0 Then
            filePath = projectPath & "\" & projectName
        End If
    End If

    On Error GoTo 0

    filePath = Trim$(filePath)
    If Len(filePath) >= 4 Then
        If LCase$(Right$(filePath, 4)) = ".mpp" Then
            MsCurrentMppFilePath = filePath
        End If
    End If
End Function

' Public: dipakai juga oleh ms_debug.
Public Function MsSaveCurrentProjectForUpload() As String
    Dim filePath As String
    Dim uploadPath As String
    Dim fso As Object

    filePath = MsCurrentMppFilePath()
    If Len(filePath) > 0 Then
        Set fso = CreateObject("Scripting.FileSystemObject")
        If Not fso.FileExists(filePath) Then
            MsDebugLog "File .mpp aktif tidak ditemukan: " & filePath
            Err.Raise vbObjectError + 9204, "MsSaveCurrentProjectForUpload", _
                "File .mpp aktif tidak ditemukan." & vbCrLf & _
                "Path: " & filePath
        End If

        MsDebugLog "File .mpp siap upload: " & filePath
        uploadPath = MsUploadCopyPath()
        On Error Resume Next
        fso.CopyFile filePath, uploadPath, True
        If Err.Number <> 0 Then
            Dim copyErrNo As Long
            Dim copyErrSource As String
            Dim copyErrDescription As String
            copyErrNo = Err.Number
            copyErrSource = Err.Source
            copyErrDescription = Err.Description
            Err.Clear
            On Error GoTo 0
            MsDebugLog "Copy file .mpp untuk upload gagal: " & copyErrDescription
            Err.Raise copyErrNo, copyErrSource, copyErrDescription & vbCrLf & _
                "Source file: " & filePath & vbCrLf & _
                "Upload copy: " & uploadPath
        End If
        On Error GoTo 0

        MsDebugLog "Upload copy siap: " & uploadPath
        MsSaveCurrentProjectForUpload = uploadPath
        Exit Function
    End If

    MsDebugLog "File aktif belum punya path .mpp"
    Err.Raise vbObjectError + 9205, "MsSaveCurrentProjectForUpload", _
        "File aktif belum punya path .mpp." & vbCrLf & _
        "Silakan Save As manual dulu ke file .mpp lokal, lalu jalankan Save to Server lagi."
End Function

' Public: dipakai juga oleh ms_debug (retry upload).
Public Sub MsSaveAndUploadCurrentProjectFile()
    Dim projectId As String
    Dim filePath As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        Err.Raise vbObjectError + 9202, "MsSaveAndUploadCurrentProjectFile", "Project ID kosong"
    End If

    filePath = MsSaveCurrentProjectForUpload()
    Set root = MsParseSuccess(MsHttpUploadFile("/projects/" & projectId & "/file", "file", filePath))
End Sub

' Public: dipakai juga oleh ms_debug (heartbeat).
Public Function MsProjectLockPayload(Optional ByVal includeRevision As Boolean = False) As String
    Dim json As String
    json = "{""project"":{"
    json = json & """project_id"":" & MsJsonString(MsGetProjectId()) & ","
    If includeRevision Then json = json & """last_known_revision_no"":" & CStr(MsGetProjectRevisionNo()) & ","
    json = json & """lock_token"":" & MsJsonString(MsGetProjectLockToken()) & ","
    json = json & """updated_by"":" & MsJsonString(MsCurrentActor())
    json = json & "},"
    json = json & """actor"":" & MsJsonString(MsCurrentActor()) & ","
    json = json & """lock_token"":" & MsJsonString(MsGetProjectLockToken())
    json = json & "}"
    MsProjectLockPayload = json
End Function

Private Function MsIsProjectLockInvalidError(ByVal errorText As String) As Boolean
    MsIsProjectLockInvalidError = _
        InStr(1, errorText, "HTTP 423", vbTextCompare) > 0 Or _
        InStr(1, errorText, "PROJECT_LOCK_INVALID", vbTextCompare) > 0 Or _
        InStr(1, errorText, "PROJECT_LOCK_REQUIRED", vbTextCompare) > 0
End Function

' --- Check-out -----------------------------------------------------------------
Public Sub Ms_CheckOut()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim payload As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Jalankan Ms_OpenFromServer atau Ms_PublishNewProject dulu.", vbExclamation
        Exit Sub
    End If
    If Len(MsGetProjectLockToken()) > 0 Then
        On Error Resume Next
        Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/heartbeat", MsProjectLockPayload(False)))
        If Err.Number = 0 Then
            On Error GoTo ErrHandler
            MsgBox "Project ini sudah checkout dan lock masih aktif.", vbInformation
            Exit Sub
        End If

        Dim lockErrDescription As String
        lockErrDescription = Err.Description
        Err.Clear
        On Error GoTo ErrHandler

        If MsIsProjectLockInvalidError(lockErrDescription) Then
            MsSetProjectLockToken ""
        Else
            Err.Raise vbObjectError + 9203, "Ms_CheckOut", lockErrDescription
        End If
    End If

    payload = "{""actor"":" & MsJsonString(MsCurrentActor()) & "}"
    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/checkout", payload))
    MsApplyLockResponse root
    MsgBox "Checkout sukses." & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo() & vbCrLf & vbCrLf & _
           "Silakan edit, lalu Ms_SaveToServer. Selesai semua: Ms_CheckIn.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Checkout gagal: " & Err.Description, vbCritical
End Sub

' --- Save to Server (sync metadata + upload .mpp) --------------------------------
Public Sub Ms_SaveToServer()
    On Error GoTo ErrHandler
    Dim phase As String
    Dim oldCalculation As Long
    phase = "validasi awal"

    If MsIsMasterPortfolioView() Then
        MsgBox "Master Portfolio View read-only. Save to server ditolak.", vbExclamation
        Exit Sub
    End If

    Dim projectId As String
    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Gunakan Ms_PublishNewProject dulu.", vbExclamation
        Exit Sub
    End If
    If MsGetProjectRevisionNo() <= 0 Then
        MsgBox "Revision number kosong. Jalankan Ms_OpenFromServer ulang atau cek ProjectSummaryTask.Text29.", vbExclamation
        Exit Sub
    End If
    If Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout. Jalankan Ms_CheckOut dulu.", vbExclamation
        Exit Sub
    End If

    Dim payload As String
    Dim root As Object
    oldCalculation = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = pjManual

    phase = "build payload"
    payload = MsBuildProjectPayload(False)
    phase = "send API sync"
    Set root = MsParseSuccess(MsHttpPut("/projects/" & projectId & "/sync", payload))
    phase = "apply response"
    MsApplySyncResponse root
    phase = "save and upload mpp file"
    MsSaveAndUploadCurrentProjectFile
    Application.Calculation = oldCalculation
    Application.ScreenUpdating = True

    MsgBox "Save to server sukses." & vbCrLf & _
           "Project ID: " & MsGetProjectId() & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub

ErrHandler:
    Dim syncErrNo As Long
    Dim syncErrSource As String
    Dim syncErrDescription As String

    syncErrNo = Err.Number
    syncErrSource = Err.Source
    syncErrDescription = Err.Description

    On Error Resume Next
    If oldCalculation <> 0 Then Application.Calculation = oldCalculation
    Application.ScreenUpdating = True
    On Error GoTo 0

    If Len(syncErrDescription) = 0 Then syncErrDescription = "Tidak ada detail error dari VBA. Error No: " & CStr(syncErrNo)
    MsgBox "Save to server gagal di fase [" & phase & "]:" & vbCrLf & _
           syncErrDescription & vbCrLf & vbCrLf & _
           "Source: " & syncErrSource, vbCritical
End Sub

' --- Check-in --------------------------------------------------------------------
Public Sub Ms_CheckIn()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Or Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout.", vbExclamation
        Exit Sub
    End If

    If MsgBox("Sudah jalankan Ms_SaveToServer untuk perubahan terakhir?" & vbCrLf & _
              "Perubahan yang belum di-save TIDAK tersimpan di server setelah check-in.", _
              vbQuestion + vbYesNo) <> vbYes Then Exit Sub

    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/checkin", MsProjectLockPayload(False)))
    MsSetProjectLockToken ""
    MsgBox "Check-in sukses. Lock dilepas.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Check-in gagal: " & Err.Description, vbCritical
End Sub

' --- Publish revisi DB -------------------------------------------------------------
Public Sub Ms_PublishCurrentRevision()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Publish new project atau open from server dulu.", vbExclamation
        Exit Sub
    End If
    If Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout. Jalankan Ms_CheckOut dulu.", vbExclamation
        Exit Sub
    End If
    If MsgBox("Publish current DB revision? Jalankan Ms_SaveToServer dulu jika ada perubahan schedule di file.", vbQuestion + vbYesNo) <> vbYes Then Exit Sub

    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/publish", MsProjectLockPayload(True)))
    If root("data").Exists("revision_no") Then MsSetProjectRevisionNo root("data")("revision_no")
    MsgBox "Publish revision sukses." & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Publish revision gagal: " & Err.Description, vbCritical
End Sub

' --- Publish project baru -----------------------------------------------------------
Public Sub Ms_PublishNewProject()
    On Error GoTo ErrHandler
    Dim phase As String
    Dim oldCalculation As Long
    phase = "validasi awal"

    If Len(MsGetProjectId()) > 0 Then
        MsgBox "Project ini sudah punya project_id. Gunakan Ms_SaveToServer atau Ms_CloneAsNewProject.", vbExclamation
        Exit Sub
    End If

    If MsgBox("Publish file aktif sebagai project baru?", vbQuestion + vbYesNo) <> vbYes Then Exit Sub

    Dim payload As String
    Dim root As Object
    oldCalculation = Application.Calculation
    Application.ScreenUpdating = False
    Application.Calculation = pjManual

    phase = "build payload"
    payload = MsBuildProjectPayload(True)
    phase = "send API publish"
    Set root = MsParseSuccess(MsHttpPost("/projects", payload))
    phase = "apply response"
    MsApplySyncResponse root
    MsSetProjectLockToken ""
    phase = "save and upload mpp file"
    MsSaveAndUploadCurrentProjectFile
    Application.Calculation = oldCalculation
    Application.ScreenUpdating = True

    MsgBox "Publish sukses." & vbCrLf & _
           "Project ID: " & MsGetProjectId() & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub

ErrHandler:
    Dim publishErrNo As Long
    Dim publishErrSource As String
    Dim publishErrDescription As String

    publishErrNo = Err.Number
    publishErrSource = Err.Source
    publishErrDescription = Err.Description

    On Error Resume Next
    If oldCalculation <> 0 Then Application.Calculation = oldCalculation
    Application.ScreenUpdating = True
    On Error GoTo 0

    If Len(publishErrDescription) = 0 Then publishErrDescription = "Tidak ada detail error dari VBA. Error No: " & CStr(publishErrNo)
    MsgBox "Publish gagal di fase [" & phase & "]:" & vbCrLf & _
           publishErrDescription & vbCrLf & vbCrLf & _
           "Source: " & publishErrSource, vbCritical
End Sub

' --- Clone -----------------------------------------------------------------------
Public Sub Ms_CloneAsNewProject()
    If MsgBox("Clone as New Project akan menghapus UUID project/task/assignment dari file aktif. Lanjut?", vbQuestion + vbYesNo) <> vbYes Then Exit Sub
    MsClearAllDatabaseIds
    MsSetProjectMode MS_MODE_SINGLE_PROJECT
    MsgBox "UUID lama sudah dihapus. Jalankan Ms_PublishNewProject untuk membuat project baru.", vbInformation
End Sub

Public Sub Ms_LoadProjectTeam()
    MsLoadProjectTeamToResourceSheet
End Sub
