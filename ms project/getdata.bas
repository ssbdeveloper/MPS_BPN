
Private Function HttpPostBulks(url As String, body As String) As String
    On Error GoTo ErrHandler
    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.Open "POST", url, False
    http.Option(4) = 13056
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Accept", "application/json"
    http.SetTimeouts 5000, 5000, 15000, 15000
    http.Send body
    http.WaitForResponse
    If http.Status = 200 Then
        HttpPostBulks = http.ResponseText
    Else
        MsgBox "HTTP Error: " & http.Status & " - " & http.StatusText, vbCritical
        HttpPostBulks = ""
    End If
    Exit Function
ErrHandler:
    MsgBox "Connection Error: " & Err.Description, vbCritical
    HttpPostBulks = ""
End Function

Sub SyncActualFromAPI()

    Dim t As Task
    Dim keys As String
    Dim json As String
    Dim response As String
    Dim dict As Object
    Dim item As Object
    Dim key As String

    ' ============================================
    ' 1. KUMPULKAN KEY DARI TASK
    ' ============================================

    keys = "["

    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then

            If t.Text1 <> "" And t.Text2 <> "" Then
                key = t.Text1 & t.Text2
                keys = keys & """" & key & ""","
            End If

        End If
    Next t

    If Right(keys, 1) = "," Then
        keys = Left(keys, Len(keys) - 1)
    End If

    keys = keys & "]"

    json = "{""keys"":" & keys & "}"

    ' ============================================
    ' 2. HIT API
    ' ============================================
    '10.16.1.103
    '
    response = HttpPostBulks("https://100.80.101.53/fastapi/sow/get-actual", json)

    ' ============================================
    ' 3. PARSE JSON
    ' ============================================

    On Error GoTo JsonError
    Set dict = JsonConverter.ParseJson(response)
    On Error GoTo 0
    GoTo AfterJsonParse
JsonError:
    MsgBox "JsonConverter tidak ditemukan. Import VBA-JSON (JsonConverter.bas) ke project ini." & vbCrLf & Err.Description, vbCritical
    Exit Sub
AfterJsonParse:

    ' ============================================
    ' 4. UPDATE TASK
    ' ============================================

    For Each item In dict("data")

        Dim codenumber As String
        codenumber = item("codenumber")

        For Each t In ActiveProject.Tasks

            If Not t Is Nothing Then

                If t.Text1 & t.Text2 = codenumber Then

                    ' actual_progress sudah dalam skala 0-100 di DB
                    t.PhysicalPercentComplete = _
                        CDbl(item("actual_progress")) * 100
                    
                    ' Actual hours
                    t.ActualWork = _
                        CDbl(item("actual_hours")) * 60   ' jam ? menit

                End If

            End If

        Next t

    Next item

    MsgBox "Sync Actual Selesai!", vbInformation

End Sub

