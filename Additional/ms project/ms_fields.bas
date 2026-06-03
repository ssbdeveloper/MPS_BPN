Attribute VB_Name = "ms_fields"
Option Explicit

Public Function MsGetProjectId() As String
    On Error Resume Next
    MsGetProjectId = Trim$(ActiveProject.ProjectSummaryTask.Text30)
    On Error GoTo 0
End Function

Public Sub MsSetProjectId(ByVal projectId As String)
    ActiveProject.ProjectSummaryTask.Text30 = projectId
End Sub

Public Function MsGetProjectRevisionNo() As Long
    On Error Resume Next
    MsGetProjectRevisionNo = CLng(Val(ActiveProject.ProjectSummaryTask.Text29))
    On Error GoTo 0
End Function

Public Sub MsSetProjectRevisionNo(ByVal revisionNo As Variant)
    ActiveProject.ProjectSummaryTask.Text29 = CStr(revisionNo)
End Sub

Public Function MsGetProjectMode() As String
    On Error Resume Next
    MsGetProjectMode = Trim$(ActiveProject.ProjectSummaryTask.Text28)
    On Error GoTo 0
End Function

Public Sub MsSetProjectMode(ByVal modeValue As String)
    ActiveProject.ProjectSummaryTask.Text28 = modeValue
End Sub

Public Function MsTaskId(ByVal t As Task) As String
    On Error Resume Next
    MsTaskId = Trim$(t.Text10)
    On Error GoTo 0
End Function

Public Sub MsSetTaskId(ByVal t As Task, ByVal taskId As String)
    t.Text10 = taskId
End Sub

Public Sub MsSetTaskProjectId(ByVal t As Task, ByVal projectId As String)
    t.Text11 = projectId
End Sub

Public Sub MsSetTaskParentId(ByVal t As Task, ByVal parentTaskId As String)
    t.Text12 = parentTaskId
End Sub

Public Function MsResourceId(ByVal r As Resource) As String
    On Error Resume Next
    MsResourceId = Trim$(r.Text9)
    On Error GoTo 0
End Function

Public Sub MsSetResourceId(ByVal r As Resource, ByVal resourceId As String)
    r.Text9 = resourceId
End Sub

Public Function MsAssignmentId(ByVal a As Object) As String
    On Error Resume Next
    MsAssignmentId = Trim$(CStr(CallByName(a, "Text10", VbGet)))
    On Error GoTo 0
End Function

Public Sub MsSetAssignmentId(ByVal a As Object, ByVal assignmentId As String)
    On Error Resume Next
    CallByName a, "Text10", VbLet, assignmentId
    On Error GoTo 0
End Sub

Public Function MsFindTaskByLocalUid(ByVal localUid As String) As Task
    Dim t As Task
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            If CStr(t.UniqueID) = CStr(localUid) Then
                Set MsFindTaskByLocalUid = t
                Exit Function
            End If
        End If
    Next t
End Function

Public Function MsFindTaskById(ByVal taskId As String) As Task
    Dim t As Task
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            If MsTaskId(t) = taskId Then
                Set MsFindTaskById = t
                Exit Function
            End If
        End If
    Next t
End Function

Public Function MsFindResourceById(ByVal resourceId As String) As Resource
    Dim r As Resource
    For Each r In ActiveProject.Resources
        If Not r Is Nothing Then
            If MsResourceId(r) = resourceId Then
                Set MsFindResourceById = r
                Exit Function
            End If
        End If
    Next r
End Function

Public Function MsFindResourceByName(ByVal resourceName As String) As Resource
    Dim r As Resource
    For Each r In ActiveProject.Resources
        If Not r Is Nothing Then
            If StrComp(r.Name, resourceName, vbTextCompare) = 0 Then
                Set MsFindResourceByName = r
                Exit Function
            End If
        End If
    Next r
End Function

Public Function MsAssignmentLocalUid(ByVal a As Object) As String
    On Error Resume Next
    MsAssignmentLocalUid = CStr(CallByName(a, "UniqueID", VbGet))
    If Len(MsAssignmentLocalUid) = 0 Then
        MsAssignmentLocalUid = CStr(a.Task.UniqueID) & "-" & CStr(a.Resource.UniqueID)
    End If
    On Error GoTo 0
End Function

Public Sub MsClearAllDatabaseIds()
    Dim t As Task
    Dim r As Resource
    Dim a As Object

    MsSetProjectId ""
    MsSetProjectRevisionNo ""

    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            t.Text10 = ""
            t.Text11 = ""
            t.Text12 = ""
        End If
    Next t

    For Each r In ActiveProject.Resources
        If Not r Is Nothing Then r.Text9 = ""
    Next r

    For Each a In ActiveProject.Assignments
        If Not a Is Nothing Then MsSetAssignmentId a, ""
    Next a
End Sub

Public Function MsIsMasterPortfolioView() As Boolean
    Dim ids As Object
    Dim t As Task
    Set ids = CreateObject("Scripting.Dictionary")

    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            If Len(Trim$(t.Text11)) > 0 Then ids(Trim$(t.Text11)) = True
        End If
    Next t

    MsIsMasterPortfolioView = (ids.Count > 1 Or MsGetProjectMode() = MS_MODE_MASTER_PORTFOLIO)
End Function

