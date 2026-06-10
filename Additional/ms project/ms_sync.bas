Attribute VB_Name = "ms_sync"
Option Explicit

Public Sub Ms_CheckConnection()
    On Error GoTo ErrHandler
    Dim root As Object
    Set root = MsParseSuccess(MsHttpGet("/health"))
    MsgBox "MS Project API connected." & vbCrLf & _
           "Service: " & CStr(root("data")("service")) & vbCrLf & _
           "Database: " & CStr(root("data")("database")), vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Connection failed: " & Err.Description, vbCritical
End Sub

Public Sub Ms_ListProjects()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim item As Variant
    Dim msg As String

    Set root = MsParseSuccess(MsHttpGet("/projects?limit=20"))
    msg = "Projects:" & vbCrLf
    For Each item In root("data")
        msg = msg & CStr(item("project_id")) & " | " & CStr(item("project_name")) & _
              " | rev " & CStr(item("revision_no")) & vbCrLf
    Next item
    Debug.Print msg
    MsgBox msg, vbInformation
    Exit Sub
ErrHandler:
    MsgBox "List projects gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_ImportLatestTrialProject()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim data As Object
    Set root = MsParseSuccess(MsHttpGet("/projects?status=TRIAL&limit=1"))
    Set data = root("data")
    If data.Count = 0 Then
        MsgBox "Tidak ada project TRIAL di API.", vbExclamation
        Exit Sub
    End If
    MsImportProjectPackage CStr(data(1)("project_id"))
    Exit Sub
ErrHandler:
    MsgBox "Import latest trial gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_ImportProjectById()
    Dim projectId As String
    projectId = InputBox("Masukkan project_id:", "Import MS Project Package", MsGetProjectId())
    If Len(Trim$(projectId)) = 0 Then Exit Sub
    MsImportProjectPackage Trim$(projectId)
End Sub

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

Private Function MsProjectLockPayload(Optional ByVal includeRevision As Boolean = False) As String
    Dim json As String
    json = "{""project"":{"
    json = json & """project_id"":" & MsJsonString(MsGetProjectId()) & ","
    If includeRevision Then json = json & """last_known_revision_no"":" & CStr(MsGetProjectRevisionNo()) & ","
    json = json & """lock_token"":" & MsJsonString(MsGetProjectLockToken()) & ","
    json = json & """updated_by"":""ms-project-vba"""
    json = json & "},"
    json = json & """actor"":""ms-project-vba"","
    json = json & """lock_token"":" & MsJsonString(MsGetProjectLockToken())
    json = json & "}"
    MsProjectLockPayload = json
End Function

Public Sub Ms_CheckOutCurrentProject()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim payload As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Import atau publish project dulu.", vbExclamation
        Exit Sub
    End If
    If Len(MsGetProjectLockToken()) > 0 Then
        MsgBox "Project ini sudah punya lock token aktif di file.", vbInformation
        Exit Sub
    End If

    payload = "{""actor"":""ms-project-vba"",""lock_minutes"":30}"
    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/checkout", payload))
    MsApplyLockResponse root
    MsgBox "Checkout sukses." & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Checkout gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_HeartbeatCurrentProject()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Or Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout.", vbExclamation
        Exit Sub
    End If

    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/heartbeat", MsProjectLockPayload(False)))
    MsgBox "Heartbeat OK. Lock diperpanjang.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Heartbeat gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_PublishCurrentRevision()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Publish new project atau import package dulu.", vbExclamation
        Exit Sub
    End If
    If Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout. Jalankan Ms_CheckOutCurrentProject dulu.", vbExclamation
        Exit Sub
    End If
    If MsgBox("Publish current DB revision? Jalankan Sync dulu jika ada perubahan schedule di file.", vbQuestion + vbYesNo) <> vbYes Then Exit Sub

    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/publish", MsProjectLockPayload(True)))
    If root("data").Exists("revision_no") Then MsSetProjectRevisionNo root("data")("revision_no")
    MsgBox "Publish revision sukses." & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Publish revision gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_CheckInCurrentProject()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim root As Object

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Or Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout.", vbExclamation
        Exit Sub
    End If

    Set root = MsParseSuccess(MsHttpPost("/projects/" & projectId & "/checkin", MsProjectLockPayload(False)))
    MsSetProjectLockToken ""
    MsgBox "Check-in sukses. Lock dilepas.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Check-in gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_PublishNewProject()
    On Error GoTo ErrHandler
    Dim phase As String
    Dim oldCalculation As Long
    phase = "validasi awal"

    If Len(MsGetProjectId()) > 0 Then
        MsgBox "Project ini sudah punya project_id. Gunakan Ms_SyncExistingProject atau Ms_CloneAsNewProject.", vbExclamation
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
    Application.Calculation = oldCalculation
    Application.ScreenUpdating = True

    MsgBox "Publish sukses." & vbCrLf & _
           "Project ID: " & MsGetProjectId() & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub

ErrHandler:
    On Error Resume Next
    If oldCalculation <> 0 Then Application.Calculation = oldCalculation
    Application.ScreenUpdating = True
    On Error GoTo 0
    MsgBox "Publish gagal di fase [" & phase & "]: " & Err.Description, vbCritical
End Sub

Public Sub Ms_SyncExistingProject()
    On Error GoTo ErrHandler
    Dim phase As String
    Dim oldCalculation As Long
    phase = "validasi awal"

    If MsIsMasterPortfolioView() Then
        MsgBox "Master Portfolio View read-only pada MVP. Sync ditolak.", vbExclamation
        Exit Sub
    End If

    Dim projectId As String
    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Gunakan Ms_PublishNewProject dulu.", vbExclamation
        Exit Sub
    End If
    If MsGetProjectRevisionNo() <= 0 Then
        MsgBox "Revision number kosong. Import ulang package atau cek ProjectSummaryTask.Text29.", vbExclamation
        Exit Sub
    End If
    If Len(MsGetProjectLockToken()) = 0 Then
        MsgBox "Project belum checkout. Jalankan Ms_CheckOutCurrentProject dulu.", vbExclamation
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
    Application.Calculation = oldCalculation
    Application.ScreenUpdating = True

    MsgBox "Sync sukses." & vbCrLf & _
           "Project ID: " & MsGetProjectId() & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub

ErrHandler:
    On Error Resume Next
    If oldCalculation <> 0 Then Application.Calculation = oldCalculation
    Application.ScreenUpdating = True
    On Error GoTo 0
    MsgBox "Sync gagal di fase [" & phase & "]: " & Err.Description, vbCritical
End Sub

Public Sub Ms_DebugBuildPayload()
    On Error GoTo ErrHandler

    Dim payload As String
    payload = MsBuildProjectPayload(False)

    Debug.Print Left$(payload, 2000)
    MsgBox "Build payload OK." & vbCrLf & _
           "Length: " & Len(payload) & " chars" & vbCrLf & _
           "Preview 2000 chars tersedia di Immediate Window.", vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Build payload gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_CloneAsNewProject()
    If MsgBox("Clone as New Project akan menghapus UUID project/task/assignment dari file aktif. Lanjut?", vbQuestion + vbYesNo) <> vbYes Then Exit Sub
    MsClearAllDatabaseIds
    MsSetProjectMode MS_MODE_SINGLE_PROJECT
    MsgBox "UUID lama sudah dihapus. Jalankan Ms_PublishNewProject untuk membuat project baru.", vbInformation
End Sub

Public Sub Ms_LoadProjectTeam()
    MsLoadProjectTeamToResourceSheet
End Sub

Public Sub Ms_CheckResourceConflicts()
    On Error GoTo ErrHandler
    Dim projectId As String
    Dim path As String
    Dim root As Object
    Dim warnings As Object

    projectId = MsGetProjectId()
    path = "/resources/conflicts"
    If Len(projectId) > 0 Then path = path & "?project_id=" & MsUrlEncode(projectId)

    Set root = MsParseSuccess(MsHttpGet(path))
    Set warnings = root("warnings")

    MsgBox "Conflict warnings: " & warnings.Count & vbCrLf & _
           "Detail tersedia di response API/Immediate Window jika ingin dikembangkan ke UserForm.", vbInformation
    Debug.Print MsHttpGet(path)
    Exit Sub

ErrHandler:
    MsgBox "Check conflicts gagal: " & Err.Description, vbCritical
End Sub
