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

Private Sub MsApplySyncResponse(ByVal root As Object)
    Dim data As Object
    Dim item As Variant
    Dim t As Task
    Dim a As Object
    Dim projectId As String

    Set data = root("data")
    projectId = CStr(data("project_id"))
    MsSetProjectId projectId
    MsSetProjectRevisionNo data("revision_no")
    MsSetProjectMode MS_MODE_SINGLE_PROJECT

    If data.Exists("task_mappings") Then
        For Each item In data("task_mappings")
            If Not item Is Nothing Then
                Set t = MsFindTaskByLocalUid(CStr(item("local_task_uid")))
                If Not t Is Nothing Then
                    MsSetTaskId t, CStr(item("task_id"))
                    MsSetTaskProjectId t, projectId
                End If
            End If
        Next item
    End If

    If data.Exists("assignment_mappings") Then
        For Each item In data("assignment_mappings")
            If Not item Is Nothing Then
                For Each a In ActiveProject.Assignments
                    If Not a Is Nothing Then
                        If MsAssignmentLocalUid(a) = CStr(item("local_assignment_uid")) Then
                            MsSetAssignmentId a, CStr(item("assignment_id"))
                            Exit For
                        End If
                    End If
                Next a
            End If
        Next item
    End If
End Sub

Public Sub Ms_PublishNewProject()
    On Error GoTo ErrHandler

    If Len(MsGetProjectId()) > 0 Then
        MsgBox "Project ini sudah punya project_id. Gunakan Ms_SyncExistingProject atau Ms_CloneAsNewProject.", vbExclamation
        Exit Sub
    End If

    If MsgBox("Publish file aktif sebagai project baru?", vbQuestion + vbYesNo) <> vbYes Then Exit Sub

    Dim payload As String
    Dim root As Object
    payload = MsBuildProjectPayload(True)
    Set root = MsParseSuccess(MsHttpPost("/projects", payload))
    MsApplySyncResponse root

    MsgBox "Publish sukses." & vbCrLf & _
           "Project ID: " & MsGetProjectId() & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Publish gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_SyncExistingProject()
    On Error GoTo ErrHandler

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

    Dim payload As String
    Dim root As Object
    payload = MsBuildProjectPayload(False)
    Set root = MsParseSuccess(MsHttpPut("/projects/" & projectId & "/sync", payload))
    MsApplySyncResponse root

    MsgBox "Sync sukses." & vbCrLf & _
           "Project ID: " & MsGetProjectId() & vbCrLf & _
           "Revision: " & MsGetProjectRevisionNo(), vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Sync gagal: " & Err.Description, vbCritical
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

