Attribute VB_Name = "ms_serializer"
Option Explicit

Private Function MsTaskParentLocalUid(ByVal t As Task) As String
    On Error Resume Next
    If t.OutlineLevel > 1 Then MsTaskParentLocalUid = CStr(t.OutlineParent.UniqueID)
    On Error GoTo 0
End Function

Private Function MsTaskParentId(ByVal t As Task) As String
    On Error Resume Next
    If t.OutlineLevel > 1 Then MsTaskParentId = MsTaskId(t.OutlineParent)
    On Error GoTo 0
End Function

Private Function MsNormalizedAssignmentUnits(ByVal a As Object) As Double
    On Error Resume Next
    MsNormalizedAssignmentUnits = CDbl(CallByName(a, "Units", VbGet))
    If MsNormalizedAssignmentUnits <= 0 Then MsNormalizedAssignmentUnits = 1
    If MsNormalizedAssignmentUnits > 10 Then MsNormalizedAssignmentUnits = MsNormalizedAssignmentUnits / 100
    On Error GoTo 0
End Function

Private Function MsTaskJson(ByVal t As Task, ByVal isNewProject As Boolean) As String
    Dim json As String
    Dim taskId As String
    Dim parentId As String

    taskId = MsTaskId(t)
    parentId = MsTaskParentId(t)

    json = "{"
    If Not isNewProject And Len(taskId) > 0 Then json = json & """task_id"":" & MsJsonString(taskId) & ","
    json = json & """local_task_uid"":" & MsJsonString(CStr(t.UniqueID)) & ","
    json = json & """parent_task_id"":" & MsJsonNullableString(parentId) & ","
    json = json & """parent_local_task_uid"":" & MsJsonNullableString(MsTaskParentLocalUid(t)) & ","
    json = json & """task_name"":" & MsJsonString(t.Name) & ","
    json = json & """outline_level"":" & CStr(t.OutlineLevel) & ","
    json = json & """outline_number"":" & MsJsonNullableString(t.OutlineNumber) & ","
    json = json & """order_no"":" & MsJsonNullableString(t.Text1) & ","
    json = json & """operation_no"":" & MsJsonNullableString(t.Text2) & ","
    json = json & """ssbr_id"":" & MsJsonNullableString(t.Text3) & ","
    json = json & """workcenter"":" & MsJsonNullableString(t.Notes) & ","
    json = json & """plan_start"":" & MsJsonNullableDate(t.Start) & ","
    json = json & """plan_finish"":" & MsJsonNullableDate(t.Finish) & ","
    json = json & """duration_minutes"":" & MsJsonNumber(t.Duration, "null") & ","
    json = json & """planned_work_minutes"":" & MsJsonNumber(t.Work, "null") & ","
    json = json & """is_summary"":" & MsJsonBool(t.Summary) & ","
    json = json & """is_active"":true"
    json = json & "}"

    MsTaskJson = json
End Function

Private Function MsTasksJsonArray(ByVal isNewProject As Boolean) As String
    Dim t As Task
    Dim json As String
    Dim first As Boolean

    first = True
    json = "["
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            If Len(t.Name) > 0 Then
                If Not first Then json = json & ","
                json = json & MsTaskJson(t, isNewProject)
                first = False
            End If
        End If
    Next t
    json = json & "]"
    MsTasksJsonArray = json
End Function

Private Function MsAssignmentsJsonArray(ByVal isNewProject As Boolean) As String
    Dim a As Object
    Dim json As String
    Dim first As Boolean
    Dim taskId As String
    Dim resourceId As String
    Dim assignmentId As String

    first = True
    json = "["

    For Each a In ActiveProject.Assignments
        If Not a Is Nothing Then
            On Error Resume Next
            taskId = MsTaskId(a.Task)
            resourceId = MsResourceId(a.Resource)
            assignmentId = MsAssignmentId(a)
            On Error GoTo 0

            If Len(resourceId) > 0 Then
                If Not first Then json = json & ","
                json = json & "{"
                If Not isNewProject And Len(assignmentId) > 0 Then json = json & """assignment_id"":" & MsJsonString(assignmentId) & ","
                json = json & """local_assignment_uid"":" & MsJsonString(MsAssignmentLocalUid(a)) & ","
                json = json & """task_id"":" & MsJsonNullableString(taskId) & ","
                json = json & """local_task_uid"":" & MsJsonString(CStr(a.Task.UniqueID)) & ","
                json = json & """resource_id"":" & MsJsonString(resourceId) & ","
                json = json & """assignment_units"":" & MsJsonNumber(MsNormalizedAssignmentUnits(a), "1") & ","
                json = json & """planned_work_minutes"":" & MsJsonNumber(a.Work, "null") & ","
                json = json & """assignment_start"":" & MsJsonNullableDate(a.Start) & ","
                json = json & """assignment_finish"":" & MsJsonNullableDate(a.Finish) & ","
                json = json & """is_active"":true"
                json = json & "}"
                first = False
            End If
        End If
    Next a

    json = json & "]"
    MsAssignmentsJsonArray = json
End Function

Private Function MsDependenciesJsonArray(ByVal isNewProject As Boolean) As String
    Dim t As Task
    Dim pred As Task
    Dim json As String
    Dim first As Boolean
    Dim key As String

    first = True
    json = "["

    On Error Resume Next
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            For Each pred In t.PredecessorTasks
                If Not pred Is Nothing Then
                    key = CStr(pred.UniqueID) & "|" & CStr(t.UniqueID) & "|FS|0"
                    If Not first Then json = json & ","
                    json = json & "{"
                    json = json & """local_dependency_key"":" & MsJsonString(key) & ","
                    json = json & """predecessor_task_id"":" & MsJsonNullableString(MsTaskId(pred)) & ","
                    json = json & """predecessor_local_task_uid"":" & MsJsonString(CStr(pred.UniqueID)) & ","
                    json = json & """successor_task_id"":" & MsJsonNullableString(MsTaskId(t)) & ","
                    json = json & """successor_local_task_uid"":" & MsJsonString(CStr(t.UniqueID)) & ","
                    json = json & """dependency_type"":""FS"","
                    json = json & """lag_minutes"":0,"
                    json = json & """is_active"":true"
                    json = json & "}"
                    first = False
                End If
            Next pred
        End If
    Next t
    On Error GoTo 0

    json = json & "]"
    MsDependenciesJsonArray = json
End Function

Public Function MsBuildProjectPayload(ByVal isNewProject As Boolean) As String
    Dim projectId As String
    Dim revisionNo As Long
    Dim json As String

    projectId = MsGetProjectId()
    revisionNo = MsGetProjectRevisionNo()

    json = "{"
    json = json & """project"":{"
    If Not isNewProject Then
        json = json & """project_id"":" & MsJsonString(projectId) & ","
        json = json & """last_known_revision_no"":" & CStr(revisionNo) & ","
    End If
    json = json & """project_name"":" & MsJsonString(ActiveProject.Title) & ","
    json = json & """description"":null,"
    json = json & """status"":""ACTIVE"","
    json = json & """updated_by"":""ms-project-vba"""
    json = json & "},"
    json = json & """project_resources"":" & MsResourceJsonArrayFromSheet() & ","
    json = json & """tasks"":" & MsTasksJsonArray(isNewProject) & ","
    json = json & """assignments"":" & MsAssignmentsJsonArray(isNewProject) & ","
    json = json & """dependencies"":" & MsDependenciesJsonArray(isNewProject)
    json = json & "}"

    MsBuildProjectPayload = json
End Function
