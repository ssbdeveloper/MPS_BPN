Attribute VB_Name = "ms_resources"
Option Explicit

Private Function MsDictText(ByVal item As Object, ByVal key As String, Optional ByVal fallback As String = "") As String
    On Error Resume Next
    If Not item Is Nothing Then
        If item.Exists(key) Then MsDictText = CStr(item(key))
    End If
    If Len(MsDictText) = 0 Then MsDictText = fallback
    On Error GoTo 0
End Function

Private Function MsDictNumber(ByVal item As Object, ByVal key As String, Optional ByVal fallback As Double = 1) As Double
    On Error Resume Next
    MsDictNumber = fallback
    If Not item Is Nothing Then
        If item.Exists(key) Then
            If IsNumeric(item(key)) Then MsDictNumber = CDbl(item(key))
        End If
    End If
    On Error GoTo 0
End Function

Public Function MsEnsureResourceFromApi(ByVal item As Object) As Resource
    Dim resourceId As String
    Dim resourceCode As String
    Dim resourceName As String
    Dim category As String
    Dim displayName As String
    Dim r As Resource

    resourceId = MsDictText(item, "resource_id")
    resourceCode = MsDictText(item, "resource_code", resourceId)
    resourceName = MsDictText(item, "resource_name", resourceCode)
    category = MsDictText(item, "resource_category")
    displayName = resourceCode

    If Len(resourceId) = 0 Then Exit Function

    Set r = MsFindResourceById(resourceId)
    If r Is Nothing Then Set r = MsFindResourceByName(displayName)
    If r Is Nothing Then Set r = ActiveProject.Resources.Add(displayName)

    r.Name = displayName
    r.Initials = Left$(resourceCode, 20)
    r.Group = category
    r.Notes = resourceName
    On Error Resume Next
    r.MaxUnits = MsDictNumber(item, "max_units", 1)
    On Error GoTo 0
    MsSetResourceId r, resourceId

    Set MsEnsureResourceFromApi = r
End Function

Public Sub MsLoadProjectTeamToResourceSheet(Optional ByVal projectId As String = "")
    On Error GoTo ErrHandler

    If Len(projectId) = 0 Then projectId = MsGetProjectId()
    If Len(projectId) = 0 Then
        MsgBox "Project ID kosong. Import atau publish project dulu.", vbExclamation
        Exit Sub
    End If

    Dim responseText As String
    Dim root As Object
    Dim data As Object
    Dim item As Variant
    Dim countLoaded As Long

    responseText = MsHttpGet("/projects/" & projectId & "/resources")
    Set root = MsParseSuccess(responseText)
    Set data = root("data")

    For Each item In data
        If Not item Is Nothing Then
            Call MsEnsureResourceFromApi(item)
            countLoaded = countLoaded + 1
        End If
    Next item

    MsgBox "Project team loaded ke Resource Sheet: " & countLoaded & " resource.", vbInformation
    Exit Sub

ErrHandler:
    MsgBox "Load Project Team gagal: " & Err.Description, vbCritical
End Sub

Public Function MsResourceJsonArrayFromSheet() As String
    Dim r As Resource
    Dim json As String
    Dim first As Boolean
    Dim resourceId As String

    first = True
    json = "["

    For Each r In ActiveProject.Resources
        If Not r Is Nothing Then
            resourceId = MsResourceId(r)
            If Len(resourceId) > 0 Then
                If Not first Then json = json & ","
                json = json & "{""resource_id"":" & MsJsonString(resourceId) & "}"
                first = False
            End If
        End If
    Next r

    json = json & "]"
    MsResourceJsonArrayFromSheet = json
End Function

