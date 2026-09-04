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
    ' Workcenter TETAP diketik planner di kolom Resource Names (keputusan 2026-08-07 tidak
    ' dicabut) — yang berubah cara membacanya.
    '
    ' JANGAN baca string t.ResourceNames. Itu teks HASIL RENDER: MS Project menyusunnya dari
    ' daftar assignment dengan format "Nama[units%]", digabung koma untuk multi-resource.
    ' Units = Work / Duration, dan import men-set Work setelah resource menempel, jadi task
    ' dengan Work 2x Duration otomatis jadi 200% — itulah asal "C5100FAB[200%]" yang tersimpan
    ' ke ms_project_task.workcenter (290 baris tercemar di CKP per 2026-09-03).
    ' a.Resource.Name selalu bersih dari suffix. Pola iterasi ini sama dengan
    ' MsAssignmentsJsonArray di bawah.
    '
    ' Fallback ke Notes DIHAPUS 2026-09-03: import dulu menulis workcenter ke Notes sementara
    ' planner juga memakai Notes untuk catatan sungguhan, sehingga catatan itu naik pangkat
    ' jadi "workcenter" (ditemukan catatan pengadaan satu paragraf di kolom workcenter prod).
    ' Task tanpa assignment sekarang mengembalikan string kosong — itu memang jawaban jujurnya.
    '
    ' Detail & keputusan: docs/prd/MSPROJECT_RESOURCE_MANAGEMENT_PLAN.md
    Dim taskAssignments As Object
    Dim a As Object
    Dim resourceObj As Object
    Dim resourceName As String

    Set taskAssignments = MsObjObject(t, "Assignments")
    If taskAssignments Is Nothing Then Exit Function

    On Error Resume Next
    For Each a In taskAssignments
        If Not a Is Nothing Then
            Set resourceObj = MsObjObject(a, "Resource")
            If Not resourceObj Is Nothing Then
                resourceName = Trim$(MsObjText(resourceObj, "Name"))
                If Len(resourceName) > 0 Then
                    ' Assignment pertama yang punya nama resource. Selama cakupan resource =
                    ' workcenter saja, task tidak pernah punya assignment lain. Kalau nanti
                    ' orang/mesin ikut di-assign, di sinilah aturan pemilihan harus ditambah.
                    MsSafeTaskWorkcenter = resourceName
                    Err.Clear
                    On Error GoTo 0
                    Exit Function
                End If
            End If
        End If
    Next a
    Err.Clear
    On Error GoTo 0
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

' --- Propagasi DELETE (blok "deactivate") ------------------------------------
' MS Project tidak menyimpan jejak baris yang dihapus: begitu sebuah task dihapus,
' Text10 (task_id server) ikut lenyap bersama barisnya. Jadi satu-satunya cara
' mengetahui APA yang dihapus adalah membandingkan isi plan sekarang dengan daftar
' AKTIF di server (GET /projects/<id>/package hanya mengembalikan is_active = true).
'
' Server memproses blok ini di applyExplicitDeactivate dengan urutan assignment ->
' dependency -> task dalam SATU transaksi. Karena itu ketiganya WAJIB dikirim
' bersama: mengirim task_ids saja ditolak 409 TASK_DEACTIVATE_BLOCKED kalau task
' tersebut masih punya assignment/dependency aktif di server.
Private Function MsPkgText(ByVal item As Object, ByVal key As String) As String
    On Error Resume Next
    If item.Exists(key) Then MsPkgText = Trim$(CStr(item(key)))
    On Error GoTo 0
End Function

Private Function MsPkgBool(ByVal item As Object, ByVal key As String, Optional ByVal fallback As Boolean = False) As Boolean
    On Error Resume Next
    MsPkgBool = fallback
    If item.Exists(key) Then MsPkgBool = CBool(item(key))
    On Error GoTo 0
End Function

Private Function MsPkgLong(ByVal item As Object, ByVal key As String) As Long
    On Error Resume Next
    If item.Exists(key) Then
        If IsNumeric(item(key)) Then MsPkgLong = CLng(item(key))
    End If
    On Error GoTo 0
End Function

' Kunci pencocokan dependency = kunci yang dipakai server saat dependency_id tidak
' dikirim (upsertDependencies): predecessor + successor + type + lag. Dependency yang
' salah satu ujungnya task BARU (belum punya task_id) mustahil ada di server —
' kembalikan kosong supaya tidak ikut dibandingkan.
Private Function MsDependencyMatchKey(ByVal predTaskId As String, ByVal succTaskId As String, _
                                      ByVal depType As String, ByVal lagMinutes As Long) As String
    If Len(predTaskId) = 0 Or Len(succTaskId) = 0 Then Exit Function
    If Len(depType) = 0 Then depType = "FS"
    MsDependencyMatchKey = predTaskId & "|" & succTaskId & "|" & depType & "|" & CStr(lagMinutes)
End Function

Private Sub MsCollectPlanIds(ByVal planTasks As Object, ByVal planAssignments As Object, _
                             ByVal planAssignmentPairs As Object, ByVal planDeps As Object)
    Dim t As Task
    Dim a As Object
    Dim taskAssignments As Object
    Dim dependencies As Object
    Dim dependency As Object
    Dim pred As Object
    Dim succ As Object
    Dim resourceObj As Object
    Dim taskId As String
    Dim assignmentId As String
    Dim resourceId As String
    Dim depKey As String

    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            taskId = MsTaskId(t)
            If Len(taskId) > 0 Then planTasks(taskId) = True

            Set taskAssignments = MsObjObject(t, "Assignments")
            If Not taskAssignments Is Nothing Then
                For Each a In taskAssignments
                    If Not a Is Nothing Then
                        assignmentId = MsAssignmentId(a)
                        If Len(assignmentId) > 0 Then planAssignments(assignmentId) = True

                        ' Jaring kedua: pasangan (task, resource). Jalur fallback di
                        ' import (ResourceNames, saat Assignments.Add gagal) memasang
                        ' resource TANPA menulis assignment_id — tanpa jaring ini
                        ' assignment yang masih hidup akan terbaca sebagai dihapus.
                        Set resourceObj = MsObjObject(a, "Resource")
                        If Not resourceObj Is Nothing Then
                            resourceId = MsResourceId(resourceObj)
                            If Len(taskId) > 0 And Len(resourceId) > 0 Then
                                planAssignmentPairs(taskId & "|" & resourceId) = True
                            End If
                        End If
                    End If
                Next a
            End If
        End If
    Next t

    On Error Resume Next
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            Set dependencies = MsObjObject(t, "TaskDependencies")
            If Not dependencies Is Nothing Then
                For Each dependency In dependencies
                    Set pred = MsObjObject(dependency, "From")
                    Set succ = MsObjObject(dependency, "To")
                    If Not (pred Is Nothing Or succ Is Nothing) Then
                        If MsObjText(succ, "UniqueID") = MsObjText(t, "UniqueID") Then
                            depKey = MsDependencyMatchKey(MsTaskId(pred), MsTaskId(succ), _
                                                          MsDependencyTypeCode(MsObjNumber(dependency, "Type", 1)), _
                                                          MsDependencyLagMinutes(dependency))
                            If Len(depKey) > 0 Then planDeps(depKey) = True
                        End If
                    End If
                Next dependency
            End If
        End If
    Next t
    On Error GoTo 0
End Sub

' Menghasilkan blok deactivate untuk payload sync. summary diisi ringkasan yang bisa
' ditampilkan ke user (kosong = tidak ada yang dihapus).
' Sengaja TIDAK menelan error: kalau daftar server gagal diambil, save harus gagal —
' save yang "sukses" tapi menyisakan task terhapus di DB persis bug yang diperbaiki.
Public Function MsBuildDeactivateJson(ByRef summary As String) As String
    Dim projectId As String
    Dim root As Object
    Dim data As Object
    Dim serverTasks As Object
    Dim serverAssignments As Object
    Dim serverDependencies As Object
    Dim serverResources As Object
    Dim planTasks As Object
    Dim planAssignments As Object
    Dim planAssignmentPairs As Object
    Dim planDeps As Object
    Dim planResources As Object
    Dim item As Object
    Dim res As Resource
    Dim pairKey As String
    Dim taskIds As String
    Dim assignmentIds As String
    Dim dependencyIds As String
    Dim resourceIds As String
    Dim taskCount As Long
    Dim assignmentCount As Long
    Dim dependencyCount As Long
    Dim resourceCount As Long
    Dim serverTaskCount As Long
    Dim serverResourceCount As Long
    Dim idValue As String
    Dim depKey As String

    summary = ""
    MsBuildDeactivateJson = ""

    projectId = MsGetProjectId()
    If Len(projectId) = 0 Then Exit Function

    Set root = MsParseSuccess(MsHttpGet("/projects/" & projectId & "/package"))
    Set data = root("data")
    Set serverTasks = data("tasks")
    Set serverAssignments = data("assignments")
    Set serverDependencies = data("dependencies")
    Set serverResources = data("project_resources")

    Set planTasks = CreateObject("Scripting.Dictionary")
    Set planAssignments = CreateObject("Scripting.Dictionary")
    Set planAssignmentPairs = CreateObject("Scripting.Dictionary")
    Set planDeps = CreateObject("Scripting.Dictionary")
    MsCollectPlanIds planTasks, planAssignments, planAssignmentPairs, planDeps

    For Each item In serverTasks
        serverTaskCount = serverTaskCount + 1
        idValue = MsPkgText(item, "task_id")
        If Len(idValue) > 0 Then
            If Not planTasks.Exists(idValue) Then
                If taskCount > 0 Then taskIds = taskIds & ","
                taskIds = taskIds & MsJsonString(idValue)
                taskCount = taskCount + 1
            End If
        End If
    Next item

    ' Rem pengaman: plan tanpa SATU PUN task ber-ID server sementara server penuh isi
    ' hampir pasti file yang salah / Text10 terhapus — bukan penghapusan yang disengaja.
    If serverTaskCount > 0 And planTasks.Count = 0 Then
        Err.Raise vbObjectError + 9101, "MsBuildDeactivateJson", _
            "Plan ini tidak punya satu pun task ber-ID server, sedangkan server punya " & _
            CStr(serverTaskCount) & " task aktif. Save dibatalkan supaya tidak menonaktifkan " & _
            "seluruh task. Jalankan Ms_OpenFromServer untuk memuat ulang plan."
    End If

    ' Dianggap dihapus hanya bila DUA-DUANYA tak ketemu: assignment_id-nya maupun
    ' pasangan (task, resource)-nya. Satu resource hanya bisa di-assign sekali ke
    ' sebuah task di MS Project, jadi pasangan itu identitas yang sah.
    For Each item In serverAssignments
        idValue = MsPkgText(item, "assignment_id")
        pairKey = MsPkgText(item, "task_id") & "|" & MsPkgText(item, "resource_id")
        If Len(idValue) > 0 Then
            If Not planAssignments.Exists(idValue) And Not planAssignmentPairs.Exists(pairKey) Then
                If assignmentCount > 0 Then assignmentIds = assignmentIds & ","
                assignmentIds = assignmentIds & MsJsonString(idValue)
                assignmentCount = assignmentCount + 1
            End If
        End If
    Next item

    ' Catatan: mengUBAH lag/type sebuah link juga muncul di sini sebagai "dependency
    ' dihapus" + link baru dibuat. Itu memang benar — server mencocokkan dependency
    ' lewat (pred, succ, type, lag), jadi tanpa menonaktifkan yang lama, link versi
    ' lama akan menumpuk sebagai baris aktif kedua.
    For Each item In serverDependencies
        idValue = MsPkgText(item, "dependency_id")
        depKey = MsDependencyMatchKey(MsPkgText(item, "predecessor_task_id"), _
                                      MsPkgText(item, "successor_task_id"), _
                                      MsPkgText(item, "dependency_type"), _
                                      MsPkgLong(item, "lag_minutes"))
        If Len(idValue) > 0 And Len(depKey) > 0 Then
            If Not planDeps.Exists(depKey) Then
                If dependencyCount > 0 Then dependencyIds = dependencyIds & ","
                dependencyIds = dependencyIds & MsJsonString(idValue)
                dependencyCount = dependencyCount + 1
            End If
        End If
    Next item

    ' Resource yang dibuang dari Resource Sheet: hilang dari project_resources payload,
    ' dan seperti yang lain itu tidak berarti apa-apa bagi server tanpa blok ini.
    Set planResources = CreateObject("Scripting.Dictionary")
    For Each res In ActiveProject.Resources
        If Not res Is Nothing Then
            idValue = MsResourceId(res)
            If Len(idValue) > 0 Then planResources(idValue) = True
        End If
    Next res

    ' BEDA dengan tasks/assignments/dependencies: package mengembalikan project_resources
    ' TANPA filter is_active (statusnya ada di field project_resource_is_active). Tanpa
    ' saringan ini, resource yang sudah non-aktif akan dihitung "dihapus" di SETIAP save.
    For Each item In serverResources
        idValue = MsPkgText(item, "resource_id")
        If Len(idValue) > 0 And MsPkgBool(item, "project_resource_is_active", True) Then
            serverResourceCount = serverResourceCount + 1
            If Not planResources.Exists(idValue) Then
                If resourceCount > 0 Then resourceIds = resourceIds & ","
                resourceIds = resourceIds & MsJsonString(idValue)
                resourceCount = resourceCount + 1
            End If
        End If
    Next item

    ' Rem pengaman yang sama seperti task: sheet kosong / Text9 hilang bukan alasan
    ' membubarkan seluruh tim proyek di server.
    If serverResourceCount > 0 And planResources.Count = 0 Then
        Err.Raise vbObjectError + 9102, "MsBuildDeactivateJson", _
            "Resource Sheet plan ini tidak punya satu pun resource ber-ID server, sedangkan " & _
            "server punya " & CStr(serverResourceCount) & " resource aktif. Save dibatalkan. " & _
            "Jalankan Ms_OpenFromServer untuk memuat ulang plan."
    End If

    If taskCount = 0 And assignmentCount = 0 And dependencyCount = 0 And resourceCount = 0 Then Exit Function

    If taskCount > 0 Then summary = summary & "- Task: " & CStr(taskCount) & vbCrLf
    If assignmentCount > 0 Then summary = summary & "- Assignment (resource di task): " & CStr(assignmentCount) & vbCrLf
    If dependencyCount > 0 Then summary = summary & "- Dependency (link antar task): " & CStr(dependencyCount) & vbCrLf
    If resourceCount > 0 Then summary = summary & "- Resource (anggota tim proyek): " & CStr(resourceCount) & vbCrLf

    MsBuildDeactivateJson = "{""task_ids"":[" & taskIds & "]," & _
                            """assignment_ids"":[" & assignmentIds & "]," & _
                            """dependency_ids"":[" & dependencyIds & "]," & _
                            """resource_ids"":[" & resourceIds & "]}"
End Function

Public Function MsBuildProjectPayload(ByVal isNewProject As Boolean, Optional ByVal deactivateJson As String = "") As String
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
    ' Propagasi delete hanya untuk sync (project baru tidak punya baris server untuk dihapus).
    If Not isNewProject And Len(deactivateJson) > 0 Then
        payloadPhase = "deactivate"
        json = json & "," & """deactivate"":" & deactivateJson
    End If
    json = json & "}"

    MsBuildProjectPayload = json
    Exit Function

ErrHandler:
    Err.Raise Err.Number, "MsBuildProjectPayload", "payload phase [" & payloadPhase & "]: " & Err.Description
End Function
