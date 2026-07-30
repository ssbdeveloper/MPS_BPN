Attribute VB_Name = "ms_debug"
Option Explicit

' =============================================================================
' ms_debug v2 - macro lanjutan/diagnostik. Bukan bagian alur harian planner.
'   Ms_UploadCurrentProjectFile : retry upload .mpp bila metadata sukses tapi file gagal.
'   Ms_HeartbeatCurrentProject  : cek/refresh lock aktif.
'   Ms_CheckResourceConflicts   : cek konflik resource lintas project.
'   Ms_Debug*                   : diagnostik path/save/payload/upload.
' =============================================================================

Private Sub MsDbgLog(ByVal message As String)
    Debug.Print Format$(Now, "yyyy-mm-dd hh:nn:ss") & " | " & message
End Sub

Public Sub Ms_UploadCurrentProjectFile()
    On Error GoTo ErrHandler
    If Len(MsGetProjectId()) = 0 Then
        MsgBox "Project ID kosong. Publish atau open from server dulu.", vbExclamation
        Exit Sub
    End If
    MsSaveAndUploadCurrentProjectFile
    MsgBox "Upload file .mpp sukses.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Upload file .mpp gagal: " & Err.Description, vbCritical
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
    MsgBox "Heartbeat OK. Lock masih aktif.", vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Heartbeat gagal: " & Err.Description, vbCritical
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
           "Detail tersedia di response API/Immediate Window.", vbInformation
    Debug.Print MsHttpGet(path)
    Exit Sub

ErrHandler:
    MsgBox "Check conflicts gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_DebugCurrentMppPath()
    On Error GoTo ErrHandler

    Dim filePath As String
    filePath = MsCurrentMppFilePath()
    If Len(filePath) = 0 Then
        MsDbgLog "Current MPP path tidak ditemukan"
        MsDbgLog "ActiveProject.FullName: " & ActiveProject.FullName
        MsDbgLog "ActiveProject.Path: " & ActiveProject.Path
        MsDbgLog "ActiveProject.Name: " & ActiveProject.Name
        MsgBox "VBA belum menemukan path .mpp aktif." & vbCrLf & _
               "ActiveProject.FullName: " & ActiveProject.FullName & vbCrLf & _
               "ActiveProject.Path: " & ActiveProject.Path & vbCrLf & _
               "ActiveProject.Name: " & ActiveProject.Name, vbExclamation
    Else
        MsDbgLog "Current MPP path: " & filePath
        MsgBox "Path .mpp aktif:" & vbCrLf & filePath, vbInformation
    End If
    Exit Sub

ErrHandler:
    MsDbgLog "Debug path gagal: " & Err.Description & " | Source: " & Err.Source
    MsgBox "Debug path gagal:" & vbCrLf & _
           Err.Description & vbCrLf & vbCrLf & _
           "Source: " & Err.Source, vbCritical
End Sub

Public Sub Ms_DebugSaveCurrentProjectForUpload()
    On Error GoTo ErrHandler

    Dim filePath As String
    Dim fso As Object
    Dim fileSize As Double
    Dim currentPath As String

    currentPath = MsCurrentMppFilePath()
    filePath = MsSaveCurrentProjectForUpload()
    Set fso = CreateObject("Scripting.FileSystemObject")
    If fso.FileExists(filePath) Then fileSize = CDbl(fso.GetFile(filePath).Size)

    MsDbgLog "Save/check .mpp OK"
    MsDbgLog "Path: " & filePath
    MsDbgLog "Size: " & CStr(fileSize) & " bytes"
    MsDbgLog "Current path before save: " & currentPath
    MsgBox "Save .mpp OK." & vbCrLf & _
           "Path: " & filePath & vbCrLf & _
           "Size: " & CStr(fileSize) & " bytes" & vbCrLf & _
           "Current path before save: " & currentPath, vbInformation
    Exit Sub

ErrHandler:
    MsDbgLog "Debug save .mpp gagal: " & Err.Description & " | Source: " & Err.Source
    MsgBox "Debug save .mpp gagal:" & vbCrLf & _
           Err.Description & vbCrLf & vbCrLf & _
           "Source: " & Err.Source, vbCritical
End Sub

Public Sub Ms_DebugUploadCurrentProjectFileOnly()
    On Error GoTo ErrHandler

    Dim projectId As String
    Dim filePath As String
    Dim responseText As String

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Publish atau open from server dulu.", vbExclamation
        Exit Sub
    End If

    filePath = MsSaveCurrentProjectForUpload()
    MsDbgLog "Upload .mpp start"
    MsDbgLog "Project ID: " & projectId
    MsDbgLog "Upload file: " & filePath
    MsDbgLog "URL path: /projects/" & projectId & "/file"
    responseText = MsHttpUploadFile("/projects/" & projectId & "/file", "file", filePath)

    MsDbgLog "Upload .mpp OK"
    MsDbgLog Left$(responseText, 1000)
    MsgBox "Upload .mpp OK." & vbCrLf & _
           "Path: " & filePath & vbCrLf & _
           Left$(responseText, 700), vbInformation
    Exit Sub

ErrHandler:
    MsDbgLog "Debug upload .mpp gagal: " & Err.Description & " | Source: " & Err.Source
    MsgBox "Debug upload .mpp gagal:" & vbCrLf & _
           Err.Description & vbCrLf & vbCrLf & _
           "Source: " & Err.Source, vbCritical
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
