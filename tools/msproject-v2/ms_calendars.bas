Attribute VB_Name = "ms_calendars"
Option Explicit

Private Function MsCalText(ByVal item As Object, ByVal key As String, Optional ByVal fallback As String = "") As String
    On Error Resume Next
    If Not item Is Nothing Then
        If item.Exists(key) Then MsCalText = CStr(item(key))
    End If
    If Len(MsCalText) = 0 Then MsCalText = fallback
    On Error GoTo 0
End Function

Private Function MsCalNumber(ByVal item As Object, ByVal key As String, Optional ByVal fallback As Double = 0) As Double
    On Error Resume Next
    MsCalNumber = fallback
    If Not item Is Nothing Then
        If item.Exists(key) Then
            If IsNumeric(item(key)) Then MsCalNumber = CDbl(item(key))
        End If
    End If
    On Error GoTo 0
End Function

Private Function MsCalBool(ByVal item As Object, ByVal key As String, Optional ByVal fallback As Boolean = False) As Boolean
    On Error Resume Next
    MsCalBool = fallback
    If Not item Is Nothing Then
        If item.Exists(key) Then MsCalBool = CBool(item(key))
    End If
    On Error GoTo 0
End Function

Private Function MsTimeValueSafe(ByVal value As Variant) As Variant
    Dim text As String
    text = Trim$(CStr(value & ""))
    If Len(text) = 0 Then
        MsTimeValueSafe = Empty
    ElseIf IsDate(text) Then
        MsTimeValueSafe = TimeValue(CDate(text))
    ElseIf IsDate("2000-01-01 " & text) Then
        MsTimeValueSafe = TimeValue(CDate("2000-01-01 " & text))
    Else
        MsTimeValueSafe = Empty
    End If
End Function

Private Function MsCalendarDayKey(ByVal dayOfWeek As Long) As String
    Select Case dayOfWeek
        Case 1
            MsCalendarDayKey = "Mon"
        Case 2
            MsCalendarDayKey = "Tue"
        Case 3
            MsCalendarDayKey = "Wed"
        Case 4
            MsCalendarDayKey = "Thu"
        Case 5
            MsCalendarDayKey = "Fri"
        Case 6
            MsCalendarDayKey = "Sat"
        Case 7
            MsCalendarDayKey = "Sun"
        Case Else
            MsCalendarDayKey = "Mon"
    End Select
End Function

Private Function MsEnsureBaseCalendar(ByVal calendarName As String) As Object
    On Error Resume Next
    Set MsEnsureBaseCalendar = ActiveProject.BaseCalendars(calendarName)
    If Err.Number <> 0 Then
        Err.Clear
        Set MsEnsureBaseCalendar = Nothing
    End If

    If MsEnsureBaseCalendar Is Nothing Then
        Application.BaseCalendarCreate Name:=calendarName
        If Err.Number <> 0 Then
            Err.Clear
            Set MsEnsureBaseCalendar = Nothing
        Else
            Set MsEnsureBaseCalendar = ActiveProject.BaseCalendars(calendarName)
        End If
    End If
    On Error GoTo 0
End Function

Private Function MsWorkingTimesByDay(ByVal calendarDetail As Object) As Object
    Dim byDay As Object
    Dim item As Variant
    Dim dayKey As String
    Dim segments As Collection

    Set byDay = CreateObject("Scripting.Dictionary")
    If calendarDetail.Exists("working_times") Then
        For Each item In calendarDetail("working_times")
            If Not item Is Nothing Then
                dayKey = CStr(CLng(MsCalNumber(item, "day_of_week", 0)))
                If Not byDay.Exists(dayKey) Then
                    Set segments = New Collection
                    byDay.Add dayKey, segments
                End If
                byDay(dayKey).Add item
            End If
        Next item
    End If

    Set MsWorkingTimesByDay = byDay
End Function

Private Sub MsClearWeekdayShifts(ByVal weekdayObj As Object)
    Dim i As Long
    Dim shiftObj As Object

    On Error Resume Next
    For i = 1 To 5
        Set shiftObj = CallByName(weekdayObj, "Shift" & CStr(i), VbGet)
        If Err.Number = 0 And Not shiftObj Is Nothing Then
            CallByName shiftObj, "Clear", VbMethod
        End If
        Err.Clear
    Next i
    On Error GoTo 0
End Sub

Private Function MsApplyShiftSegment(ByVal weekdayObj As Object, ByVal segmentNo As Long, ByVal startValue As Variant, ByVal finishValue As Variant) As Boolean
    Dim shiftObj As Object
    Dim startTime As Variant
    Dim finishTime As Variant

    startTime = MsTimeValueSafe(startValue)
    finishTime = MsTimeValueSafe(finishValue)
    If IsEmpty(startTime) Or IsEmpty(finishTime) Then Exit Function

    On Error Resume Next
    Set shiftObj = CallByName(weekdayObj, "Shift" & CStr(segmentNo), VbGet)
    If Err.Number = 0 And Not shiftObj Is Nothing Then
        CallByName shiftObj, "Start", VbLet, startTime
        CallByName shiftObj, "Finish", VbLet, finishTime
        MsApplyShiftSegment = (Err.Number = 0)
    End If
    If Err.Number <> 0 Then Err.Clear
    On Error GoTo 0
End Function

Private Function MsApplyWeekdaysToCalendar(ByVal calendarObj As Object, ByVal calendarDetail As Object, ByRef skippedCrossMidnight As Long) As Long
    Dim byDay As Object
    Dim weekdayItem As Variant
    Dim segmentItem As Variant
    Dim dayOfWeek As Long
    Dim weekdayObj As Object
    Dim dayKey As String
    Dim segmentNo As Long
    Dim applied As Long

    Set byDay = MsWorkingTimesByDay(calendarDetail)

    If Not calendarDetail.Exists("weekdays") Then
        MsApplyWeekdaysToCalendar = 0
        Exit Function
    End If

    For Each weekdayItem In calendarDetail("weekdays")
        If Not weekdayItem Is Nothing Then
            dayOfWeek = CLng(MsCalNumber(weekdayItem, "day_of_week", 0))
            dayKey = CStr(dayOfWeek)
            On Error Resume Next
            Set weekdayObj = calendarObj.WeekDays(MsCalendarDayKey(dayOfWeek))
            If Err.Number <> 0 Then
                Err.Clear
                Set weekdayObj = Nothing
            End If
            On Error GoTo 0

            If Not weekdayObj Is Nothing Then
                On Error Resume Next
                weekdayObj.Working = (UCase$(MsCalText(weekdayItem, "day_type", "WORKING")) <> "NON_WORKING")
                If Err.Number <> 0 Then Err.Clear
                On Error GoTo 0

                MsClearWeekdayShifts weekdayObj
                If byDay.Exists(dayKey) Then
                    For Each segmentItem In byDay(dayKey)
                        segmentNo = CLng(MsCalNumber(segmentItem, "segment_no", 1))
                        If segmentNo >= 1 And segmentNo <= 5 Then
                            If MsCalBool(segmentItem, "crosses_midnight", False) Then
                                skippedCrossMidnight = skippedCrossMidnight + 1
                            ElseIf MsApplyShiftSegment(weekdayObj, segmentNo, segmentItem("start_time"), segmentItem("end_time")) Then
                                applied = applied + 1
                            End If
                        End If
                    Next segmentItem
                End If
            End If
        End If
    Next weekdayItem

    MsApplyWeekdaysToCalendar = applied
End Function

Public Function MsApplyCalendarDetailToProject(ByVal calendarDetail As Object, Optional ByVal makeProjectCalendar As Boolean = True) As Boolean
    Dim calendarId As String
    Dim calendarName As String
    Dim calendarObj As Object
    Dim skippedCrossMidnight As Long
    Dim appliedSegments As Long

    calendarId = MsCalText(calendarDetail, "calendar_id")
    calendarName = MsCalText(calendarDetail, "calendar_name", MsCalText(calendarDetail, "calendar_code"))
    If Len(calendarName) = 0 Then Exit Function

    Set calendarObj = MsEnsureBaseCalendar(calendarName)
    If calendarObj Is Nothing Then Exit Function

    appliedSegments = MsApplyWeekdaysToCalendar(calendarObj, calendarDetail, skippedCrossMidnight)

    If makeProjectCalendar Then
        MsSetProjectCalendarId calendarId
        On Error Resume Next
        CallByName ActiveProject, "Calendar", VbLet, calendarName
        If Err.Number <> 0 Then Err.Clear
        On Error GoTo 0
    End If

    If skippedCrossMidnight > 0 Then
        MsgBox "Calendar '" & calendarName & "' loaded, tetapi " & skippedCrossMidnight & _
               " cross-midnight segment belum diset otomatis di MS Project. Metadata tetap tersimpan di server.", vbExclamation
    End If

    MsApplyCalendarDetailToProject = (appliedSegments >= 0)
End Function

Public Sub Ms_ListCalendars()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim item As Variant
    Dim msg As String

    Set root = MsParseSuccess(MsHttpGet("/calendars?limit=50"))
    msg = "Enterprise calendars:" & vbCrLf
    For Each item In root("data")
        msg = msg & CStr(item("calendar_code")) & " | " & CStr(item("calendar_name")) & _
              " | " & CStr(item("calendar_id")) & vbCrLf
    Next item

    Debug.Print msg
    MsgBox msg, vbInformation
    Exit Sub
ErrHandler:
    MsgBox "List calendars gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_RefreshCalendarsFromShifts()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim summary As Object
    Dim msg As String

    Set root = MsParseSuccess(MsHttpPost("/calendars/refresh-from-shifts", "{""actor"":" & MsJsonString(MsCurrentActor()) & "}"))
    Set summary = root("summary")
    msg = "Refresh calendar dari shift selesai." & vbCrLf & _
          "Created: " & CStr(summary("created")) & vbCrLf & _
          "Updated: " & CStr(summary("updated")) & vbCrLf & _
          "Skipped date overrides: " & CStr(summary("skipped"))
    MsgBox msg, vbInformation
    Exit Sub
ErrHandler:
    MsgBox "Refresh calendar gagal: " & Err.Description, vbCritical
End Sub

Public Sub Ms_SetProjectCalendarFromServer()
    On Error GoTo ErrHandler
    Dim root As Object
    Dim item As Variant
    Dim index As Object
    Dim prompt As String
    Dim choice As String
    Dim calendarId As String
    Dim detailRoot As Object

    Set root = MsParseSuccess(MsHttpGet("/calendars?limit=50"))
    Set index = CreateObject("Scripting.Dictionary")
    prompt = "Pilih calendar_code atau calendar_id:" & vbCrLf

    For Each item In root("data")
        If Not item Is Nothing Then
            index(UCase$(CStr(item("calendar_code")))) = CStr(item("calendar_id"))
            index(CStr(item("calendar_id"))) = CStr(item("calendar_id"))
            prompt = prompt & CStr(item("calendar_code")) & " | " & CStr(item("calendar_name")) & vbCrLf
        End If
    Next item

    choice = Trim$(InputBox(prompt, "Set Project Calendar", "STANDARD"))
    If Len(choice) = 0 Then Exit Sub
    If Not index.Exists(UCase$(choice)) And Not index.Exists(choice) Then
        MsgBox "Calendar tidak ditemukan: " & choice, vbExclamation
        Exit Sub
    End If

    If index.Exists(choice) Then
        calendarId = index(choice)
    Else
        calendarId = index(UCase$(choice))
    End If

    Set detailRoot = MsParseSuccess(MsHttpGet("/calendars/" & calendarId))
    If MsApplyCalendarDetailToProject(detailRoot("data"), True) Then
        MsgBox "Project calendar diset: " & CStr(detailRoot("data")("calendar_name")), vbInformation
    Else
        MsgBox "Project calendar gagal diset.", vbExclamation
    End If
    Exit Sub
ErrHandler:
    MsgBox "Set project calendar gagal: " & Err.Description, vbCritical
End Sub
