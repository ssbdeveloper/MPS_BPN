Attribute VB_Name = "ms_import"
Option Explicit

Private Function MsApiDateToVba(ByVal value As Variant) As Variant
    Dim text As String
    text = CStr(value & "")
    If Len(Trim$(text)) = 0 Then
        MsApiDateToVba = Empty
        Exit Function
    End If
    text = Replace(text, "T", " ")
    If InStr(text, "+") > 0 Then text = Left$(text, InStr(text, "+") - 1)
    If InStr(text, "Z") > 0 Then text = Replace(text, "Z", "")
    If IsDate(text) Then
        MsApiDateToVba = CDate(text)
    Else
        MsApiDateToVba = Empty
    End If
End Function

Private Function MsItemText(ByVal item As Object, ByVal key As String, Optional ByVal fallback As String = "") As String
    On Error Resume Next
    If item.Exists(key) Then MsItemText = CStr(item(key))
    If Len(MsItemText) = 0 Then MsItemText = fallback
    On Error GoTo 0
End Function

Private Function MsItemNumber(ByVal item As Object, ByVal key As String, Optional ByVal fallback As Double = 0) As Double
    On Error Resume Next
    MsItemNumber = fallback
    If item.Exists(key) Then
        If IsNumeric(item(key)) Then MsItemNumber = CDbl(item(key))
    End If
    On Error GoTo 0
End Function

Private Function MsItemBool(ByVal item As Object, ByVal key As String, Optional ByVal fallback As Boolean = False) As Boolean
    On Error Resume Next
    MsItemBool = fallback
    If item.Exists(key) Then MsItemBool = CBool(item(key))
    On Error GoTo 0
End Function

Private Sub MsSetTaskOutlineLevel(ByVal t As Task, ByVal desiredLevel As Long)
    On Error Resume Next
    SelectTaskField Row:=t.ID, Column:="Name", RowRelative:=False
    Do While t.OutlineLevel < desiredLevel
        Application.OutlineIndent
    Loop
    Do While t.OutlineLevel > desiredLevel
        Application.OutlineOutdent
    Loop
    On Error GoTo 0
End Sub

Public Sub MsImportProjectPackage(ByVal projectId As String)
    On Error GoTo ErrHandler

    If Len(Trim$(projectId)) = 0 Then
        MsgBox "Project ID kosong.", vbExclamation
        Exit Sub
    End If

    If MsgBox("Buat file MS Project baru untuk import package ini?", vbQuestion + vbYesNo) = vbYes Then
        FileNew
    End If

    Application.ScreenUpdating = False
    Application.Calculation = pjManual

    Dim responseText As String
    Dim root As Object
    Dim data As Object
    Dim project As Object
    Dim projectResources As Object
    Dim tasks As Object
    Dim assignments As Object
    Dim dependencies As Object
    Dim item As Variant
    Dim t As Task
    Dim r As Resource
    Dim a As Object
    Dim taskById As Object
    Dim resourceById As Object

    Set taskById = CreateObject("Scripting.Dictionary")
    Set resourceById = CreateObject("Scripting.Dictionary")

    responseText = MsHttpGet("/projects/" & projectId & "/package")
    Set root = MsParseSuccess(responseText)
    Set data = root("data")
    Set project = data("project")
    Set projectResources = data("project_resources")
    Set tasks = data("tasks")
    Set assignments = data("assignments")
    Set dependencies = data("dependencies")

    ActiveProject.Title = MsItemText(project, "project_name", "MS Project Package")
    MsSetProjectId MsItemText(project, "project_id")
    MsSetProjectRevisionNo MsItemNumber(project, "revision_no", 1)
    MsSetProjectMode MS_MODE_SINGLE_PROJECT

    For Each item In projectResources
        Set r = MsEnsureResourceFromApi(item)
        If Not r Is Nothing Then resourceById(MsResourceId(r)) = r.ID
    Next item

    For Each item In tasks
        Set t = ActiveProject.Tasks.Add(MsItemText(item, "task_name", "Untitled Task"))
        MsSetTaskId t, MsItemText(item, "task_id")
        MsSetTaskProjectId t, projectId
        MsSetTaskParentId t, MsItemText(item, "parent_task_id")
        t.Text1 = MsItemText(item, "order_no")
        t.Text2 = MsItemText(item, "operation_no")
        t.Text3 = MsItemText(item, "ssbr_id")
        t.Notes = MsItemText(item, "workcenter")

        If MsItemNumber(item, "duration_minutes", 0) > 0 Then t.Duration = CStr(MsItemNumber(item, "duration_minutes", 0)) & "m"
        If MsItemNumber(item, "planned_work_minutes", 0) > 0 Then t.Work = CStr(MsItemNumber(item, "planned_work_minutes", 0)) & "m"
        If IsDate(MsApiDateToVba(item("plan_start"))) Then t.Start = MsApiDateToVba(item("plan_start"))
        If IsDate(MsApiDateToVba(item("plan_finish"))) Then t.Finish = MsApiDateToVba(item("plan_finish"))

        Call MsSetTaskOutlineLevel(t, CLng(MsItemNumber(item, "outline_level", 1)))
        taskById(MsItemText(item, "task_id")) = t.ID
    Next item

    For Each item In assignments
        Dim taskId As String
        Dim resourceId As String
        taskId = MsItemText(item, "task_id")
        resourceId = MsItemText(item, "resource_id")
        If taskById.Exists(taskId) And resourceById.Exists(resourceId) Then
            On Error Resume Next
            Set a = ActiveProject.Assignments.Add(taskById(taskId), resourceById(resourceId), MsItemNumber(item, "assignment_units", 1))
            If Err.Number = 0 Then
                MsSetAssignmentId a, MsItemText(item, "assignment_id")
            Else
                Err.Clear
                ActiveProject.Tasks(taskById(taskId)).ResourceNames = ActiveProject.Resources(resourceById(resourceId)).Name
            End If
            On Error GoTo ErrHandler
        End If
    Next item

    For Each item In dependencies
        Dim predId As String
        Dim succId As String
        predId = MsItemText(item, "predecessor_task_id")
        succId = MsItemText(item, "successor_task_id")
        If taskById.Exists(predId) And taskById.Exists(succId) Then
            Dim succTask As Task
            Set succTask = ActiveProject.Tasks(taskById(succId))
            If Len(succTask.Predecessors) = 0 Then
                succTask.Predecessors = CStr(taskById(predId))
            Else
                succTask.Predecessors = succTask.Predecessors & "," & CStr(taskById(predId))
            End If
        End If
    Next item

    Application.Calculation = pjAutomatic
    Application.ScreenUpdating = True

    MsgBox "Import selesai: " & ActiveProject.Title & vbCrLf & _
           "Tasks: " & tasks.Count & vbCrLf & _
           "Resources: " & projectResources.Count & vbCrLf & _
           "Assignments: " & assignments.Count, vbInformation
    Exit Sub

ErrHandler:
    Application.Calculation = pjAutomatic
    Application.ScreenUpdating = True
    MsgBox "Import package gagal: " & Err.Description, vbCritical
End Sub

