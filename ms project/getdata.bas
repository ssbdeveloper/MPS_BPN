
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
    response = HttpPostBulks("https://10.169.1.12/fastapi/sow/get-actual", json)

    ' ============================================
    ' 3. PARSE JSON
    ' ============================================

    Set dict = JsonConverter.ParseJson(response)

    ' ============================================
    ' 4. UPDATE TASK
    ' ============================================

    For Each item In dict("data")

        Dim codenumber As String
        codenumber = item("codenumber")

        For Each t In ActiveProject.Tasks

            If Not t Is Nothing Then

                If t.Text1 & t.Text2 = codenumber Then

                    ' Progress 0-1 ? Physical % (0-100)
                    ' t.PercentComplete
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


