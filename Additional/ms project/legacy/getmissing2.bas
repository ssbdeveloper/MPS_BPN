Attribute VB_Name = "getmissing2"
Option Explicit

' Konstanta API
Private Const API_URL As String = "https://10.169.1.12/fastapi/sow/get-missing"

' ============================================================================
' MAIN PROCEDURE
' ============================================================================
Sub SyncMissingOperations()
    On Error GoTo ErrorHandler
    
    Dim selectedTask As Task
    Dim orderNo As String
    Dim codenumbers() As String
    Dim jsonResponse As String
    Dim missingOps As Collection
    Dim insertProject As Project
    Dim insertPosition As Long
    
    ' ========================================================================
    ' DEBUG: Clear Immediate Window dan mulai logging
    ' ========================================================================
    Debug.Print ""
    Debug.Print "###############################################"
    Debug.Print "# SYNC MISSING OPERATIONS - START"
    Debug.Print "# " & Now()
    Debug.Print "###############################################"
    Debug.Print ""
    
    ' 1. Validasi task yang dipilih
    Set selectedTask = ActiveCell.Task
    If selectedTask Is Nothing Then
        Debug.Print "ERROR: Tidak ada task yang dipilih"
        Debug.Print ""
        MsgBox "Silakan pilih salah satu task operasi terlebih dahulu.", vbExclamation
        Exit Sub
    End If
    
    Debug.Print "Task yang dipilih: " & selectedTask.Name
    Debug.Print "  ID: " & selectedTask.ID
    Debug.Print "  Outline Level: " & selectedTask.OutlineLevel
    
    ' 2. Ambil order_no
    orderNo = Trim(selectedTask.Text1)
    If orderNo = "" Then
        Debug.Print "ERROR: Task tidak memiliki Order No (Text1)"
        Debug.Print ""
        MsgBox "Task yang dipilih tidak memiliki Order No (Text1).", vbExclamation
        Exit Sub
    End If
    
    Debug.Print "  Order No (Text1): " & orderNo
    Debug.Print ""
    
    ' 3. Kumpulkan semua codenumber
    Debug.Print "Mengumpulkan codenumber yang sudah ada..."
    codenumbers = CollectCodenumbers(orderNo)
    If UBound(codenumbers) < 0 Then
        Debug.Print "ERROR: Tidak ditemukan task dengan Order No: " & orderNo
        Debug.Print ""
        MsgBox "Tidak ditemukan task dengan Order No: " & orderNo, vbInformation
        Exit Sub
    End If
    
    Debug.Print "Total codenumber ditemukan: " & (UBound(codenumbers) + 1)
    Dim i As Integer
    For i = LBound(codenumbers) To UBound(codenumbers)
        Debug.Print "  [" & (i + 1) & "] " & codenumbers(i)
    Next i
    Debug.Print ""
    
    ' 4. Kirim request ke API
    Application.StatusBar = "Mengirim data ke API..."
    jsonResponse = SendToAPI(orderNo, codenumbers)
    
    If jsonResponse = "" Then
        Debug.Print "ERROR: Gagal menghubungi API"
        Debug.Print ""
        MsgBox "Gagal menghubungi API atau tidak ada response.", vbCritical
        Exit Sub
    End If
    
    ' 5. Parse response
    Set missingOps = ParseAPIResponse(jsonResponse)
    
    If missingOps.Count = 0 Then
        Debug.Print "INFO: Tidak ada operasi yang missing"
        Debug.Print ""
        MsgBox "Tidak ada operasi yang missing. Semua operasi sudah ada di MS Project.", vbInformation
        Exit Sub
    End If
    
    ' 6. Tentukan lokasi insert
Debug.Print "Menentukan lokasi insert..."
insertPosition = FindInsertPosition(selectedTask, orderNo)
Debug.Print "  Insert setelah Task ID: " & insertPosition
Debug.Print ""

If insertPosition = 0 Then
    Debug.Print "ERROR: Tidak dapat menentukan posisi insert"
    Debug.Print ""
    MsgBox "Tidak dapat menentukan posisi insert.", vbCritical
    Exit Sub
End If

' 7. Insert task baru
Application.StatusBar = "Membuat task baru..."
InsertMissingOperations missingOps, insertPosition, orderNo
    
    Debug.Print "========================================"
    Debug.Print "? BERHASIL!"
    Debug.Print "Total operasi baru ditambahkan: " & missingOps.Count
    Debug.Print "========================================"
    Debug.Print ""
    
    Application.StatusBar = ""
    MsgBox "Berhasil menambahkan " & missingOps.Count & " operasi baru.", vbInformation
    
    Exit Sub
    
ErrorHandler:
    Application.StatusBar = ""
    Debug.Print "========================================"
    Debug.Print "? ERROR:"
    Debug.Print Err.Description
    Debug.Print "Number: " & Err.Number
    Debug.Print "========================================"
    Debug.Print ""
    MsgBox "Error: " & Err.Description & vbCrLf & "Number: " & Err.Number, vbCritical
End Sub

' ============================================================================
' FUNCTION: Kumpulkan semua codenumber
' ============================================================================
Private Function CollectCodenumbers(orderNo As String) As String()
    Dim t As Task
    Dim codenumberList As Collection
    Dim codenumber As String
    Dim result() As String
    Dim i As Long
    
    Set codenumberList = New Collection
    
    ' Loop semua task di semua project (termasuk subproject)
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            If Trim(t.Text1) = orderNo And Trim(t.Text2) <> "" Then
                codenumber = Trim(t.Text1) & Trim(t.Text2)
                
                ' Cek duplikat
                On Error Resume Next
                codenumberList.Add codenumber, codenumber
                On Error GoTo 0
            End If
        End If
    Next t
    
    ' Convert collection ke array
    If codenumberList.Count > 0 Then
        ReDim result(codenumberList.Count - 1)
        For i = 1 To codenumberList.Count
            result(i - 1) = codenumberList(i)
        Next i
    Else
        ReDim result(-1 To -1) ' Empty array
    End If
    
    CollectCodenumbers = result
End Function

' ============================================================================
' FUNCTION: Kirim data ke API (DENGAN DEBUG OUTPUT)
' ============================================================================
Private Function SendToAPI(orderNo As String, codenumbers() As String) As String
    On Error GoTo ErrorHandler
    
    Dim http As Object
    Dim jsonBody As String
    Dim i As Long
    Dim codenumberArray As String
    
    ' Buat JSON array untuk codenumber
    codenumberArray = ""
    For i = LBound(codenumbers) To UBound(codenumbers)
        If codenumberArray <> "" Then codenumberArray = codenumberArray & ","
        codenumberArray = codenumberArray & """" & codenumbers(i) & """"
    Next i
    
    ' Buat JSON body
    jsonBody = "{""order_no"":""" & orderNo & """,""codenumber"":[" & codenumberArray & "]}"
    
    ' ========================================================================
    ' DEBUG: Print JSON yang DIKIRIM
    ' ========================================================================
    Debug.Print "========================================"
    Debug.Print "JSON DIKIRIM KE API:"
    Debug.Print "URL: " & API_URL
    Debug.Print "----------------------------------------"
    Debug.Print jsonBody
    Debug.Print "========================================"
    Debug.Print ""
    
    ' Create HTTP object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    
    http.Open "POST", Trim(API_URL), False
    
    ' Ignore SSL error (internal only)
    http.Option(4) = 13056
    
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Accept", "application/json"
    http.SetRequestHeader "Cache-Control", "no-cache"
    
    ' Timeout (recommended)
    http.SetTimeouts 5000, 5000, 10000, 10000
    
    http.Send jsonBody
    http.WaitForResponse
    ' ========================================================================
    ' DEBUG: Print Response yang DITERIMA
    ' ========================================================================
    Debug.Print "========================================"
    Debug.Print "RESPONSE DARI API:"
    Debug.Print "Status: " & http.Status & " - " & http.StatusText
    Debug.Print "----------------------------------------"
    
    ' Check response
    If http.Status = 200 Then
        Debug.Print http.ResponseText
        Debug.Print "========================================"
        Debug.Print ""
        SendToAPI = http.ResponseText
    Else
        Debug.Print "ERROR: " & http.Status & " - " & http.StatusText
        Debug.Print "Response Body:"
        Debug.Print http.ResponseText
        Debug.Print "========================================"
        Debug.Print ""
        MsgBox "API Error: " & http.Status & " - " & http.StatusText, vbCritical
        SendToAPI = ""
    End If
    
    Set http = Nothing
    Exit Function
    
ErrorHandler:
    Debug.Print "========================================"
    Debug.Print "ERROR SAAT KIRIM KE API:"
    Debug.Print Err.Description
    Debug.Print "========================================"
    Debug.Print ""
    SendToAPI = ""
    MsgBox "Error saat mengirim ke API: " & Err.Description, vbCritical
End Function

' ============================================================================
' FUNCTION: Parse JSON response (DENGAN DEBUG OUTPUT)
' ============================================================================
' ============================================================================
' FUNCTION: Parse JSON response - ROBUST VERSION (minified JSON)
' ============================================================================
Private Function ParseAPIResponse(jsonText As String) As Collection
    On Error GoTo ErrorHandler
    
    Dim result As Collection
    Dim opDict As Object
    Dim pos As Long
    Dim dataStart As Long
    Dim dataEnd As Long
    Dim objStart As Long
    Dim objEnd As Long
    Dim parseCount As Integer
    
    Set result = New Collection
    parseCount = 0
    
    ' ========================================================================
    ' DEBUG: Print proses parsing
    ' ========================================================================
    Debug.Print "========================================"
    Debug.Print "PARSING JSON RESPONSE:"
    Debug.Print "----------------------------------------"
    Debug.Print "JSON Length: " & Len(jsonText) & " characters"
    Debug.Print ""
    
    ' Cari posisi "data":[
    dataStart = InStr(jsonText, """data"":[")
    If dataStart = 0 Then
        Debug.Print "ERROR: 'data' array tidak ditemukan"
        GoTo ExitFunction
    End If
    
    dataStart = InStr(dataStart, jsonText, "[") + 1
    Debug.Print "Data array dimulai di posisi: " & dataStart
    
    ' Cari akhir array data
    dataEnd = InStr(dataStart, jsonText, "]")
    If dataEnd = 0 Then dataEnd = Len(jsonText)
    
    Debug.Print "Data array berakhir di posisi: " & dataEnd
    Debug.Print ""
    
    ' Loop untuk setiap object dalam array
    pos = dataStart
    Do While pos < dataEnd
        ' Cari start object "{"
        objStart = InStr(pos, jsonText, "{")
        If objStart = 0 Or objStart >= dataEnd Then Exit Do
        
        ' Cari end object "}"
        objEnd = InStr(objStart, jsonText, "}")
        If objEnd = 0 Then Exit Do
        
        ' Extract object string
        Dim objStr As String
        objStr = Mid(jsonText, objStart, objEnd - objStart + 1)
        
        parseCount = parseCount + 1
        Debug.Print "Operasi #" & parseCount & ":"
        Debug.Print "  Raw: " & Left(objStr, 100) & "..."
        
        ' Parse object
        Set opDict = CreateObject("Scripting.Dictionary")
        
        ' Extract order_no
        opDict("order_no") = ExtractValueFromJSON(objStr, "order_no")
        Debug.Print "  order_no: " & opDict("order_no")
        
        ' Extract operation_no (bisa string atau number)
        Dim opNo As String
        opNo = ExtractValueFromJSON(objStr, "operation_no")
        ' Pad dengan leading zeros jika perlu (20 -> "0020")
        If IsNumeric(opNo) Then
            opNo = Format(CLng(opNo), "0000")
        End If
        opDict("operation_no") = opNo
        Debug.Print "  operation_no: " & opDict("operation_no")
        
        ' Extract workcenter
        opDict("workcenter") = ExtractValueFromJSON(objStr, "workcenter")
        Debug.Print "  workcenter: " & opDict("workcenter")
        
        ' Extract planhours
        Dim planHoursStr As String
        planHoursStr = ExtractValueFromJSON(objStr, "planhours")
        opDict("planhours") = CDbl(planHoursStr)
        Debug.Print "  planhours: " & opDict("planhours")
        
        opDict("operationtext") = ExtractValueFromJSON(objStr, "operation_text")
Debug.Print "  operationtext: " & opDict("operationtext")

' Tambahkan ke collection
If opDict.Count = 5 Then  ' ? UBAH DARI 4 JADI 5
    result.Add opDict
    Debug.Print "  ? Operasi berhasil di-parse"
Else
    Debug.Print "  ? Operasi tidak lengkap (field: " & opDict.Count & ")"
End If
        Debug.Print ""
        
        ' Move ke object berikutnya
        pos = objEnd + 1
    Loop
    
ExitFunction:
    Debug.Print "----------------------------------------"
    Debug.Print "Total operasi yang berhasil di-parse: " & result.Count
    Debug.Print "========================================"
    Debug.Print ""
    
    Set ParseAPIResponse = result
    Exit Function
    
ErrorHandler:
    Debug.Print "========================================"
    Debug.Print "ERROR SAAT PARSING:"
    Debug.Print Err.Description
    Debug.Print "Line: " & Erl
    Debug.Print "========================================"
    Debug.Print ""
    Set ParseAPIResponse = New Collection
End Function

' ============================================================================
' HELPER: Extract value dari JSON minified
' ============================================================================
Private Function ExtractValueFromJSON(jsonStr As String, fieldName As String) As String
    Dim searchPattern As String
    Dim startPos As Long
    Dim endPos As Long
    Dim valueStart As Long
    Dim result As String
    Dim char As String
    Dim isString As Boolean
    
    ' Cari pattern "fieldName":
    searchPattern = """" & fieldName & """:"
    startPos = InStr(jsonStr, searchPattern)
    
    If startPos = 0 Then
        ExtractValueFromJSON = ""
        Exit Function
    End If
    
    ' Skip past the pattern
    valueStart = startPos + Len(searchPattern)
    
    ' Skip whitespace
    Do While Mid(jsonStr, valueStart, 1) = " "
        valueStart = valueStart + 1
    Loop
    
    ' Check if value is string (starts with ")
    char = Mid(jsonStr, valueStart, 1)
    isString = (char = """")
    
    If isString Then
        ' String value - extract between quotes
        valueStart = valueStart + 1
        endPos = InStr(valueStart, jsonStr, """")
        result = Mid(jsonStr, valueStart, endPos - valueStart)
    Else
        ' Number or boolean - extract until comma or }
        endPos = valueStart
        Do While endPos <= Len(jsonStr)
            char = Mid(jsonStr, endPos, 1)
            If char = "," Or char = "}" Or char = "]" Then
                Exit Do
            End If
            endPos = endPos + 1
        Loop
        result = Trim(Mid(jsonStr, valueStart, endPos - valueStart))
    End If
    
    ExtractValueFromJSON = result
End Function

' ============================================================================
' HELPER: Extract string value dari JSON
' ============================================================================
Private Function ExtractJSONValue(line As String) As String
    Dim startPos As Long, endPos As Long
    startPos = InStr(line, ":") + 1
    startPos = InStr(startPos, line, """") + 1
    endPos = InStr(startPos, line, """")
    ExtractJSONValue = Mid(line, startPos, endPos - startPos)
End Function

' ============================================================================
' HELPER: Extract number value dari JSON
' ============================================================================
Private Function ExtractJSONNumber(line As String) As String
    Dim startPos As Long, endPos As Long
    Dim result As String
    startPos = InStr(line, ":") + 1
    line = Trim(Mid(line, startPos))
    endPos = InStr(line, ",")
    If endPos = 0 Then endPos = InStr(line, "}")
    If endPos > 0 Then
        result = Trim(Left(line, endPos - 1))
    Else
        result = Trim(line)
    End If
    ExtractJSONNumber = result
End Function

' ============================================================================
' FUNCTION: Dapatkan subproject dari task
' ============================================================================
' ============================================================================
' FUNCTION: Cari posisi insert (HANYA 2 PARAMETER)
' ============================================================================
' ============================================================================
' FUNCTION: Cari posisi insert (SIMPLIFIED - NO SUBPROJECT CHECK)
' ============================================================================
Private Function FindInsertPosition(selectedTask As Task, orderNo As String) As Long
    Dim t As Task
    Dim lastTaskID As Long
    Dim searchStartID As Long
    Dim searchEndID As Long
    
    lastTaskID = 0
    
    Debug.Print "Mencari posisi insert..."
    Debug.Print "  Selected Task ID: " & selectedTask.ID
    Debug.Print "  Selected Task Name: " & selectedTask.Name
    Debug.Print "  Order No: " & orderNo
    Debug.Print ""
    
    ' Strategi: Cari task terakhir dengan order_no yang sama
    ' di sekitar area task yang dipilih (�50 tasks)
    searchStartID = selectedTask.ID - 50
    If searchStartID < 1 Then searchStartID = 1
    
    searchEndID = selectedTask.ID + 50
    If searchEndID > ActiveProject.Tasks.Count Then searchEndID = ActiveProject.Tasks.Count
    
    Debug.Print "  Searching dari Task ID " & searchStartID & " sampai " & searchEndID
    Debug.Print ""
    
    ' Cari task terakhir dengan order_no yang sama
    Dim i As Long
    For i = searchStartID To searchEndID
        Set t = ActiveProject.Tasks(i)
        If Not t Is Nothing Then
            If Trim(t.Text1) = orderNo Then
                lastTaskID = t.ID
                Debug.Print "  Task ditemukan: ID=" & t.ID & ", Name=" & t.Name
            End If
        End If
    Next i
    
    ' Jika tidak ditemukan dalam range, gunakan posisi selected task
    If lastTaskID = 0 Then
        lastTaskID = selectedTask.ID
        Debug.Print "  Tidak ada task lain ditemukan dalam range"
        Debug.Print "  Gunakan selected task ID: " & lastTaskID
    Else
        Debug.Print ""
        Debug.Print "  Task terakhir dengan order_no yang sama: ID=" & lastTaskID
    End If
    Debug.Print ""
    
    FindInsertPosition = lastTaskID
End Function

' ============================================================================
' SUB: Insert missing operations
' ============================================================================
' ============================================================================
' SUB: Insert missing operations (HANYA 3 PARAMETER)
' ============================================================================
Private Sub InsertMissingOperations(operations As Collection, afterTaskID As Long, orderNo As String)

    Dim i As Long
    Dim opDict As Object

    Debug.Print "========================================"
    Debug.Print "MEMBUAT TASK BARU (MODE FIND + INSERT):"
    Debug.Print "----------------------------------------"

    ' ===== ANCHOR DENGAN FIND =====
    SelectTaskField Row:=0, Column:="Text1"
    Find Field:="Text1", Test:="equals", Value:=orderNo
    SelectTaskField Row:=0, Column:="Name"
    ' ===============================

    For i = 1 To operations.Count
        
        Set opDict = operations(i)

        InsertTask

        SetTaskField Field:="Name", Value:=opDict("operationtext")
        SetTaskField Field:="Text1", Value:=orderNo
        SetTaskField Field:="Text2", Value:=CDbl(opDict("operation_no"))
        SetTaskField Field:="Work", Value:=CDbl(opDict("planhours"))

        If Trim(opDict("workcenter")) <> "" Then
            On Error Resume Next
            SetTaskField Field:="Resource Names", Value:=opDict("workcenter")
            On Error GoTo 0
        End If

        SelectTaskField Row:=1, Column:="Name"

    Next i
    
    
    Sort Key1:="Text2", Renumber:=False
End Sub



