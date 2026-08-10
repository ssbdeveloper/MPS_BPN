Attribute VB_Name = "ms_import"
Option Explicit

' Error dependency pertama saat import (untuk diagnosa kalau Add gagal).
Private mDepFirstError As String

Private Function MsApiDateToVba(ByVal value As Variant) As Variant
    If IsEmpty(value) Or IsNull(value) Then
        MsApiDateToVba = Empty
        Exit Function
    End If

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

Private Sub MsSetProjectTitleSafe(ByVal title As String)
    On Error Resume Next
    ActiveProject.Title = title
    If Err.Number <> 0 Then Err.Clear
    ActiveProject.ProjectSummaryTask.Name = title
    If Err.Number <> 0 Then Err.Clear
    On Error GoTo 0
End Sub

Private Function MsSafeFileName(ByVal value As String, Optional ByVal fallback As String = "MS Project Package") As String
    Dim invalidChars As Variant
    Dim ch As Variant

    MsSafeFileName = Trim$(value)
    If Len(MsSafeFileName) = 0 Then MsSafeFileName = fallback

    invalidChars = Array("\", "/", ":", "*", "?", """", "<", ">", "|")
    For Each ch In invalidChars
        MsSafeFileName = Replace(MsSafeFileName, CStr(ch), "_")
    Next ch

    Do While InStr(MsSafeFileName, "  ") > 0
        MsSafeFileName = Replace(MsSafeFileName, "  ", " ")
    Loop

    MsSafeFileName = Trim$(MsSafeFileName)
    Do While Right$(MsSafeFileName, 1) = "."
        MsSafeFileName = Left$(MsSafeFileName, Len(MsSafeFileName) - 1)
    Loop

    If Len(MsSafeFileName) = 0 Then MsSafeFileName = fallback
End Function

Private Function MsImportLocalFilePath(ByVal project As Object) As String
    Dim baseName As String
    baseName = MsItemText(project, "project_name", "MS Project Package")
    MsImportLocalFilePath = Environ$("TEMP") & "\" & MsSafeFileName(baseName) & ".mpp"
End Function

Private Sub MsTrySetObjectTextProperty(ByVal obj As Object, ByVal propertyName As String, ByVal value As String)
    If Len(Trim$(value)) = 0 Then Exit Sub
    On Error Resume Next
    CallByName obj, propertyName, VbLet, value
    If Err.Number <> 0 Then Err.Clear
    On Error GoTo 0
End Sub

Private Sub MsTrySetObjectBoolProperty(ByVal obj As Object, ByVal propertyName As String, ByVal value As Boolean)
    On Error Resume Next
    CallByName obj, propertyName, VbLet, value
    If Err.Number <> 0 Then Err.Clear
    On Error GoTo 0
End Sub

Private Function MsLinkTypeValue(ByVal dependencyType As String) As Long
    ' pjTaskLinkType (MS Project): FF=0, FS=1, SS=2, SF=3
    Select Case UCase$(Trim$(dependencyType))
        Case "FF"
            MsLinkTypeValue = 0
        Case "FS"
            MsLinkTypeValue = 1
        Case "SS"
            MsLinkTypeValue = 2
        Case "SF"
            MsLinkTypeValue = 3
        Case Else
            MsLinkTypeValue = 1
    End Select
End Function

Private Function MsTryAddTaskDependency(ByVal succTask As Task, ByVal predTask As Task, ByVal dependencyType As String, ByVal lagMinutes As Long) As Boolean
    On Error Resume Next
    Dim dependencies As TaskDependencies
    Set dependencies = succTask.TaskDependencies
    If Err.Number <> 0 Then
        If Len(mDepFirstError) = 0 Then mDepFirstError = "get TaskDependencies: " & Err.Description
        Err.Clear
        Set dependencies = Nothing
    End If

    If Not dependencies Is Nothing Then
        ' Early binding (typed TaskDependencies) — CallByName/Object late-bound
        ' menerjemahkan argumen Task/Type/Lag tidak andal dan menolak dengan
        ' "The argument value is not valid" (fix 2026-08-06).
        ' Lag dikirim sebagai string durasi ("0m", "3600m") mengikuti contoh
        ' resmi MS Project Add(From, Type, Lag); fallback bertahap:
        '   1) dengan lag string   2) tanpa lag (default FS, 0)
        dependencies.Add predTask, MsLinkTypeValue(dependencyType), CStr(lagMinutes) & "m"
        If Err.Number <> 0 Then
            Dim errWithLag As String
            errWithLag = Err.Description
            Err.Clear
            dependencies.Add predTask, MsLinkTypeValue(dependencyType)
            If Err.Number <> 0 Then
                If Len(mDepFirstError) = 0 Then _
                    mDepFirstError = "Add(" & predTask.Name & " -> " & succTask.Name & "): with-lag=[" & errWithLag & "] no-lag=[" & Err.Description & "]"
                Err.Clear
            Else
                MsTryAddTaskDependency = True
            End If
        Else
            MsTryAddTaskDependency = True
        End If
    Else
        If Len(mDepFirstError) = 0 Then mDepFirstError = "TaskDependencies kosong untuk task " & succTask.Name
    End If
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

    ' No = batal (import ke ActiveProject yang tak dikosongkan bikin Planning Wizard/overwrite
    ' tersembunyi -> "Not Responding"). Selalu ke file baru; kalau batal, keluar bersih.
    If MsgBox("Import project ini ke file MS Project BARU?" & vbCrLf & _
              "(Yes = lanjut, No = batal)", vbQuestion + vbYesNo) <> vbYes Then Exit Sub
    FileNew

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
    Dim planStart As Variant
    Dim planFinish As Variant
    Dim dependencyKey As String
    Dim dependencyByKey As Object
    Dim dependencySkipped As Long
    Dim dependencyFailed As Long

    Set taskById = CreateObject("Scripting.Dictionary")
    Set resourceById = CreateObject("Scripting.Dictionary")
    Set dependencyByKey = CreateObject("Scripting.Dictionary")
    mDepFirstError = ""

    responseText = MsHttpGet("/projects/" & projectId & "/package")
    Set root = MsParseSuccess(responseText)
    Set data = root("data")
    Set project = data("project")
    Set projectResources = data("project_resources")
    Set tasks = data("tasks")
    Set assignments = data("assignments")
    Set dependencies = data("dependencies")

    MsSetProjectTitleSafe MsItemText(project, "project_name", "MS Project Package")
    MsSetProjectId MsItemText(project, "project_id")
    MsSetProjectRevisionNo MsItemNumber(project, "revision_no", 1)
    MsSetProjectMode MS_MODE_SINGLE_PROJECT
    MsSetProjectLockToken ""
    MsSetProjectCalendarId MsItemText(project, "calendar_id")
    MsTrySetObjectTextProperty ActiveProject, "Calendar", MsItemText(project, "calendar_name")

    For Each item In projectResources
        Set r = MsEnsureResourceFromApi(item)
        If Not r Is Nothing Then resourceById(MsResourceId(r)) = r.ID
    Next item

    For Each item In tasks
        Set t = ActiveProject.Tasks.Add(MsItemText(item, "task_name", "Untitled Task"))
        MsSetTaskId t, MsItemText(item, "task_id")
        MsSetTaskProjectId t, projectId
        MsSetTaskParentId t, MsItemText(item, "parent_task_id")
        MsSetTaskCalendarId t, MsItemText(item, "calendar_id")
        MsTrySetObjectTextProperty t, "Calendar", MsItemText(item, "calendar_name")
        MsTrySetObjectBoolProperty t, "IgnoreResourceCalendar", MsItemBool(item, "ignore_resource_calendar", False)
        t.Text1 = MsItemText(item, "order_no")
        t.Text2 = MsItemText(item, "operation_no")
        t.Text3 = MsItemText(item, "ssbr_id")
        ' Workcenter dari server disimpan ke Resource Names (bukan Notes) supaya
        ' kolom Resource Names di MS Project terisi & terkirim balik sebagai
        ' workcenter (keputusan 2026-08-07). Notes tetap diisi sebagai cadangan
        ' untuk task yang Resource Names-nya kosong (data lama).
        Dim workcenterValue As String
        workcenterValue = MsItemText(item, "workcenter")
        t.Notes = workcenterValue
        If Len(workcenterValue) > 0 Then
            On Error Resume Next
            t.ResourceNames = workcenterValue
            If Err.Number <> 0 Then Err.Clear
            On Error GoTo ErrHandler
        End If
        ' Web-authoritative Area/Bay for this task (display-only; never sent back on sync).
        MsSetTaskArea t, MsItemText(item, "area_code")
        MsSetTaskBay t, MsItemText(item, "bay_codes")

        If MsItemNumber(item, "duration_minutes", 0) > 0 Then t.Duration = CStr(MsItemNumber(item, "duration_minutes", 0)) & "m"
        If MsItemNumber(item, "planned_work_minutes", 0) > 0 Then t.Work = CStr(MsItemNumber(item, "planned_work_minutes", 0)) & "m"
        planStart = MsApiDateToVba(item("plan_start"))
        planFinish = MsApiDateToVba(item("plan_finish"))
        If IsDate(planStart) Then t.Start = planStart
        If IsDate(planFinish) Then t.Finish = planFinish

        Call MsSetTaskOutlineLevel(t, CLng(MsItemNumber(item, "outline_level", 1)))
        ' Simpan OBJECT Task (bukan t.ID) — ID nomor baris bisa bergeser setelah
        ' OutlineIndent/Outdent, sehingga referensi dependency jadi salah/kosong.
        Set taskById(MsItemText(item, "task_id")) = t
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
                taskById(taskId).ResourceNames = ActiveProject.Resources(resourceById(resourceId)).Name
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
            Dim predTask As Task
            Dim depType As String
            Dim depLag As Long
            dependencyKey = predId & "|" & succId & "|" & MsItemText(item, "dependency_type", "FS") & "|" & CStr(MsItemNumber(item, "lag_minutes", 0))
            If dependencyByKey.Exists(dependencyKey) Then
                dependencySkipped = dependencySkipped + 1
                GoTo NextDependency
            End If
            dependencyByKey.Add dependencyKey, True

            Set succTask = taskById(succId)
            Set predTask = taskById(predId)
            depType = MsItemText(item, "dependency_type", "FS")
            depLag = CLng(MsItemNumber(item, "lag_minutes", 0))

            If Not MsTryAddTaskDependency(succTask, predTask, depType, depLag) Then
                dependencyFailed = dependencyFailed + 1
            End If
        End If
NextDependency:
    Next item

    Dim importedFilePath As String
    importedFilePath = MsImportLocalFilePath(project)
    FileSaveAs Name:=importedFilePath, FormatID:="MSProject.mpp"

    Application.Calculation = pjAutomatic
    Application.ScreenUpdating = True

    MsgBox "Import selesai: " & MsItemText(project, "project_name", "MS Project Package") & vbCrLf & _
           "File: " & importedFilePath & vbCrLf & _
           "Tasks: " & tasks.Count & vbCrLf & _
           "Resources: " & projectResources.Count & vbCrLf & _
           "Assignments: " & assignments.Count & vbCrLf & _
           "Dependencies skipped duplicate: " & dependencySkipped & vbCrLf & _
           "Dependencies failed: " & dependencyFailed & _
           IIf(dependencyFailed > 0 And Len(mDepFirstError) > 0, vbCrLf & vbCrLf & "Error pertama: " & mDepFirstError, ""), vbInformation
    Exit Sub

ErrHandler:
    Application.Calculation = pjAutomatic
    Application.ScreenUpdating = True
    MsgBox "Import package gagal: " & Err.Description, vbCritical
End Sub
