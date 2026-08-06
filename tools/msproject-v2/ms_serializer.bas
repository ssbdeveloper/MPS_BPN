Attribute VB_Name = "ms_serializer"
Option Explicit

Private Function MsTaskParentLocalUid(ByVal t As Task) As String
    Dim parentTask As Object
    If MsObjNumber(t, "OutlineLevel", 1) > 1 Then
        Set parentTask = MsObjObject(t, "OutlineParent")
        If Not parentTask Is Nothing Then MsTaskParentLocalUid = MsObjText(parentTask, "UniqueID")
    End If
End Function

Private Function MsTaskParentId(ByVal t As Task) As String
    Dim parentTask As Object
    If MsObjNumber(t, "OutlineLevel", 1) > 1 Then
        Set parentTask = MsObjObject(t, "OutlineParent")
        If Not parentTask Is Nothing Then MsTaskParentId = MsTaskId(parentTask)
    End If
End Function

Private Function MsNormalizedAssignmentUnits(ByVal a As Object) As Double
    MsNormalizedAssignmentUnits = MsObjNumber(a, "Units", 1)
    If MsNormalizedAssignmentUnits <= 0 Then MsNormalizedAssignmentUnits = 1
    If MsNormalizedAssignmentUnits > 10 Then MsNormalizedAssignmentUnits = MsNormalizedAssignmentUnits / 100
End Function

Private Function MsObjText(ByVal obj As Object, ByVal propertyName As String, Optional ByVal fallback As String = "") As String
    On Error Resume Next
    Dim value As Variant
    value = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Or IsNull(value) Or IsEmpty(value) Then
        Err.Clear
        MsObjText = fallback
    Else
        MsObjText = CStr(value)
    End If
    On Error GoTo 0
End Function

Private Function MsObjNumber(ByVal obj As Object, ByVal propertyName As String, Optional ByVal fallback As Double = 0) As Double
    On Error Resume Next
    Dim value As Variant
    value = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Or IsNull(value) Or IsEmpty(value) Or Not IsNumeric(value) Then
        Err.Clear
        MsObjNumber = fallback
    Else
        MsObjNumber = CDbl(value)
    End If
    On Error GoTo 0
End Function

Private Function MsObjDate(ByVal obj As Object, ByVal propertyName As String) As Variant
    On Error Resume Next
    Dim value As Variant
    value = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Or IsNull(value) Or IsEmpty(value) Or Not IsDate(value) Then
        Err.Clear
        MsObjDate = Empty
    Else
        MsObjDate = value
    End If
    On Error GoTo 0
End Function

Private Function MsObjBool(ByVal obj As Object, ByVal propertyName As String, Optional ByVal fallback As Boolean = False) As Boolean
    On Error Resume Next
    Dim value As Variant
    value = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Or IsNull(value) Or IsEmpty(value) Then
        Err.Clear
        MsObjBool = fallback
    Else
        MsObjBool = CBool(value)
    End If
    On Error GoTo 0
End Function

Private Function MsObjObject(ByVal obj As Object, ByVal propertyName As String) As Object
    On Error Resume Next
    Set MsObjObject = CallByName(obj, propertyName, VbGet)
    If Err.Number <> 0 Then
        Err.Clear
        Set MsObjObject = Nothing
    End If
    On Error GoTo 0
End Function

Private Function MsSafeProjectName() As String
    On Error Resume Next
    MsSafeProjectName = Trim$(ActiveProject.Name)
    If Len(MsSafeProjectName) = 0 Then MsSafeProjectName = Trim$(ActiveProject.ProjectSummaryTask.Name)
    If Len(MsSafeProjectName) = 0 Then MsSafeProjectName = "MS Project Plan"
    If LCase$(Right$(MsSafeProjectName, 4)) = ".mpp" Then
        MsSafeProjectName = Left$(MsSafeProjectName, Len(MsSafeProjectName) - 4)
    End If
    MsSafeProjectName = Trim$(MsSafeProjectName)
    If Len(MsSafeProjectName) = 0 Then MsSafeProjectName = "MS Project Plan"
    On Error GoTo 0
End Function

Private Function MsCalendarPropertyName(ByVal obj As Object, ByVal propertyName As String) As String
    Dim calObj As Object
    Set calObj = MsObjObject(obj, propertyName)
    If Not calObj Is Nothing Then
        MsCalendarPropertyName = Trim$(MsObjText(calObj, "Name"))
    Else
        MsCalendarPropertyName = Trim$(MsObjText(obj, propertyName))
    End If
End Function

Private Function MsProjectCalendarName() As String
    On Error Resume Next
    MsProjectCalendarName = MsCalendarPropertyName(ActiveProject, "Calendar")
    On Error GoTo 0
End Function

Private Function MsSafeTaskUniqueId(ByVal t As Task) As String
    MsSafeTaskUniqueId = MsObjText(t, "UniqueID")
End Function

Private Function MsSafeTaskWorkcenter(ByVal t As Task) As String
    MsSafeTaskWorkcenter = Trim$(MsObjText(t, "Notes"))
End Function

Private Function MsSafeAssignmentLocalUid(ByVal a As Object, ByVal taskObj As Object, ByVal resourceObj As Object) As String
    MsSafeAssignmentLocalUid = MsAssignmentLocalUid(a)
    If Len(MsSafeAssignmentLocalUid) = 0 Then
        MsSafeAssignmentLocalUid = MsObjText(taskObj, "UniqueID") & "-" & MsObjText(resourceObj, "UniqueID")
    End If
    If Len(MsSafeAssignmentLocalUid) = 1 Then MsSafeAssignmentLocalUid = ""
End Function

Private Function MsDependencyTypeCode(ByVal typeValue As Variant) As String
    ' pjTaskLinkType (MS Project): 0=FF, 1=FS, 2=SS, 3=SF
    Select Case CLng(Val(typeValue))
        Case 0
            MsDependencyTypeCode = "FF"
        Case 1
            MsDependencyTypeCode = "FS"
        Case 2
            MsDependencyTypeCode = "SS"
        Case 3
            MsDependencyTypeCode = "SF"
        Case Else
            MsDependencyTypeCode = "FS"
    End Select
End Function

Private Function MsDependencyLagMinutes(ByVal dependency As Object) As Long
    Dim value As Variant
    On Error Resume Next
    value = CallByName(dependency, "Lag", VbGet)
    If Err.Number <> 0 Or IsNull(value) Or IsEmpty(value) Or Not IsNumeric(value) Then
        Err.Clear
        MsDependencyLagMinutes = 0
    Else
        MsDependencyLagMinutes = CLng(CDbl(value))
    End If
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
    json = json & """local_task_uid"":" & MsJsonString(MsSafeTaskUniqueId(t)) & ","
    json = json & """parent_task_id"":" & MsJsonNullableString(parentId) & ","
    json = json & """parent_local_task_uid"":" & MsJsonNullableString(MsTaskParentLocalUid(t)) & ","
    json = json & """task_name"":" & MsJsonString(MsObjText(t, "Name", "Untitled Task")) & ","
    json = json & """outline_level"":" & CStr(MsObjNumber(t, "OutlineLevel", 1)) & ","
    json = json & """outline_number"":" & MsJsonNullableString(MsObjText(t, "OutlineNumber")) & ","
    ' Tasks emit ONLY Text1/Text2/Text3 (order/op/ssbr) back to the server.
    ' Task.Text4 (MPS Area) and Task.Text5 (MPS Bay) are WEB-AUTHORITATIVE display
    ' fields set by import - DO NOT add them here, or a Save/Sync would clobber the
    ' web-set Area/Bay. Area/Bay are owned by the web scheduler, not MS Project.
    json = json & """order_no"":" & MsJsonNullableString(MsObjText(t, "Text1")) & ","
    json = json & """operation_no"":" & MsJsonNullableString(MsObjText(t, "Text2")) & ","
    json = json & """ssbr_id"":" & MsJsonNullableString(MsObjText(t, "Text3")) & ","
    json = json & """workcenter"":" & MsJsonNullableString(MsSafeTaskWorkcenter(t)) & ","
    json = json & """plan_start"":" & MsJsonNullableDate(MsObjDate(t, "Start")) & ","
    json = json & """plan_finish"":" & MsJsonNullableDate(MsObjDate(t, "Finish")) & ","
    json = json & """duration_minutes"":" & MsJsonNumber(MsObjNumber(t, "Duration", 0), "null") & ","
    json = json & """planned_work_minutes"":" & MsJsonNumber(MsObjNumber(t, "Work", 0), "null") & ","
    json = json & """calendar_id"":" & MsJsonNullableString(MsTaskCalendarId(t)) & ","
    json = json & """calendar_name"":" & MsJsonNullableString(MsCalendarPropertyName(t, "Calendar")) & ","
    json = json & """ignore_resource_calendar"":" & MsJsonBool(MsObjBool(t, "IgnoreResourceCalendar", False)) & ","
    json = json & """is_summary"":" & MsJsonBool(MsObjBool(t, "Summary", False)) & ","
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
            If Len(MsObjText(t, "Name")) > 0 Then
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
    On Error GoTo ErrHandler

    Dim t As Task
    Dim a As Object
    Dim taskAssignments As Object
    Dim json As String
    Dim first As Boolean
    Dim taskId As String
    Dim resourceId As String
    Dim assignmentId As String
    Dim taskObj As Object
    Dim resourceObj As Object

    first = True
    json = "["

    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            Set taskAssignments = MsObjObject(t, "Assignments")
            If Not taskAssignments Is Nothing Then
                For Each a In taskAssignments
                    If Not a Is Nothing Then
                        Set taskObj = MsObjObject(a, "Task")
                        If taskObj Is Nothing Then Set taskObj = t
                        Set resourceObj = MsObjObject(a, "Resource")
                        If resourceObj Is Nothing Then GoTo NextAssignment

                        taskId = MsTaskId(taskObj)
                        resourceId = MsResourceId(resourceObj)
                        assignmentId = MsAssignmentId(a)

                        If Len(resourceId) > 0 Then
                            If Not first Then json = json & ","
                            json = json & "{"
                            If Not isNewProject And Len(assignmentId) > 0 Then json = json & """assignment_id"":" & MsJsonString(assignmentId) & ","
                            json = json & """local_assignment_uid"":" & MsJsonString(MsSafeAssignmentLocalUid(a, taskObj, resourceObj)) & ","
                            json = json & """task_id"":" & MsJsonNullableString(taskId) & ","
                            json = json & """local_task_uid"":" & MsJsonString(MsObjText(taskObj, "UniqueID")) & ","
                            json = json & """resource_id"":" & MsJsonString(resourceId) & ","
                            json = json & """assignment_units"":" & MsJsonNumber(MsNormalizedAssignmentUnits(a), "1") & ","
                            json = json & """planned_work_minutes"":" & MsJsonNumber(MsObjNumber(a, "Work", 0), "null") & ","
                            json = json & """assignment_start"":" & MsJsonNullableDate(MsObjDate(a, "Start")) & ","
                            json = json & """assignment_finish"":" & MsJsonNullableDate(MsObjDate(a, "Finish")) & ","
                            json = json & """is_active"":true"
                            json = json & "}"
                            first = False
                        End If
                    End If
NextAssignment:
                Next a
            End If
        End If
    Next t

    json = json & "]"
    MsAssignmentsJsonArray = json
    Exit Function

ErrHandler:
    Err.Raise Err.Number, "MsAssignmentsJsonArray", "assignment serialize: " & Err.Description
End Function

Private Function MsDependenciesJsonArray(ByVal isNewProject As Boolean) As String
    Dim t As Task
    Dim dependency As Object
    Dim dependencies As Object
    Dim pred As Object
    Dim succ As Object
    Dim json As String
    Dim first As Boolean
    Dim key As String
    Dim dependencyType As String
    Dim lagMinutes As Long
    Dim seen As Object

    Set seen = CreateObject("Scripting.Dictionary")

    first = True
    json = "["

    On Error Resume Next
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            Set dependencies = MsObjObject(t, "TaskDependencies")
            If Not dependencies Is Nothing Then
                For Each dependency In dependencies
                    Set pred = MsObjObject(dependency, "From")
                    Set succ = MsObjObject(dependency, "To")
                    If pred Is Nothing Or succ Is Nothing Then GoTo NextDependency
                    If MsObjText(succ, "UniqueID") <> MsObjText(t, "UniqueID") Then GoTo NextDependency

                    dependencyType = MsDependencyTypeCode(MsObjNumber(dependency, "Type", 1))
                    lagMinutes = MsDependencyLagMinutes(dependency)
                    key = MsObjText(pred, "UniqueID") & "|" & MsObjText(succ, "UniqueID") & "|" & dependencyType & "|" & CStr(lagMinutes)
                    If seen.Exists(key) Then GoTo NextDependency
                    seen.Add key, True

                    If Not first Then json = json & ","
                    json = json & "{"
                    json = json & """local_dependency_key"":" & MsJsonString(key) & ","
                    json = json & """predecessor_task_id"":" & MsJsonNullableString(MsTaskId(pred)) & ","
                    json = json & """predecessor_local_task_uid"":" & MsJsonString(MsObjText(pred, "UniqueID")) & ","
                    json = json & """successor_task_id"":" & MsJsonNullableString(MsTaskId(succ)) & ","
                    json = json & """successor_local_task_uid"":" & MsJsonString(MsObjText(succ, "UniqueID")) & ","
                    json = json & """dependency_type"":" & MsJsonString(dependencyType) & ","
                    json = json & """lag_minutes"":" & CStr(lagMinutes) & ","
                    json = json & """is_active"":true"
                    json = json & "}"
                    first = False
NextDependency:
                Next dependency
            End If
        End If
    Next t
    On Error GoTo 0

    json = json & "]"
    MsDependenciesJsonArray = json
End Function

Public Function MsBuildProjectPayload(ByVal isNewProject As Boolean) As String
    On Error GoTo ErrHandler

    Dim projectId As String
    Dim revisionNo As Long
    Dim json As String
    Dim payloadPhase As String

    payloadPhase = "project ids"
    projectId = MsGetProjectId()
    revisionNo = MsGetProjectRevisionNo()

    payloadPhase = "project header"
    json = "{"
    json = json & """project"":{"
    If Not isNewProject Then
        json = json & """project_id"":" & MsJsonString(projectId) & ","
        json = json & """last_known_revision_no"":" & CStr(revisionNo) & ","
        json = json & """lock_token"":" & MsJsonString(MsGetProjectLockToken()) & ","
    End If
    json = json & """project_name"":" & MsJsonString(MsSafeProjectName()) & ","
    json = json & """description"":null,"
    json = json & """status"":""ACTIVE""," 
    json = json & """calendar_id"":" & MsJsonNullableString(MsGetProjectCalendarId()) & ","
    json = json & """calendar_name"":" & MsJsonNullableString(MsProjectCalendarName()) & ","
    json = json & """updated_by"":" & MsJsonString(MsCurrentActor())
    json = json & "},"
    payloadPhase = "project resources"
    json = json & """project_resources"":" & MsResourceJsonArrayFromSheet() & ","
    payloadPhase = "tasks"
    json = json & """tasks"":" & MsTasksJsonArray(isNewProject) & ","
    payloadPhase = "assignments"
    json = json & """assignments"":" & MsAssignmentsJsonArray(isNewProject) & ","
    payloadPhase = "dependencies"
    json = json & """dependencies"":" & MsDependenciesJsonArray(isNewProject)
    json = json & "}"

    MsBuildProjectPayload = json
    Exit Function

ErrHandler:
    Err.Raise Err.Number, "MsBuildProjectPayload", "payload phase [" & payloadPhase & "]: " & Err.Description
End Function
