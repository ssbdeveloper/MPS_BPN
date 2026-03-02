Option Explicit

Const OUTPUT_FOLDER      As String = "D:\mpp\"
Const TEMPLATE_PATH      As String = "D:\MPS2\ms project\master.mpt"
Const RESOURCE_POOL_PATH As String = "D:\MPS2\ms project\5051_RESOURCES.mpp"
Const FAKTOR_KOREKSI     As Double = 1
Const API_URL_GET_NEW    As String = "https://100.80.101.53/fastapi/sow/get-new"
Const API_URL_UPD_SYNC   As String = "https://100.80.101.53/fastapi/sow/update-sync"

' ============================================================================
' HELPER: HTTP POST — returns response text or ""
' ============================================================================
Private Function HttpPost(url As String, jsonBody As String) As String
    On Error GoTo ErrorHandler

    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.Open "POST", Trim(url), False
    http.Option(4) = 13056
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Accept", "application/json"
    http.SetTimeouts 5000, 5000, 15000, 15000
    http.Send jsonBody
    http.WaitForResponse

    Debug.Print "POST " & url
    Debug.Print "STATUS: " & http.Status & " " & http.StatusText

    If http.Status = 200 Then
        HttpPost = http.ResponseText
    Else
        MsgBox "API Error: " & http.Status & " - " & http.StatusText, vbCritical
        HttpPost = ""
    End If

    Set http = Nothing
    Exit Function

ErrorHandler:
    Debug.Print "ERROR HTTP: " & Err.Description
    HttpPost = ""
End Function

' ============================================================================
' HELPER: Extract value dari JSON object string
' ============================================================================
Private Function ExtractValueFromJSON(jsonStr As String, fieldName As String) As String
    Dim searchPattern As String
    Dim startPos      As Long
    Dim valueStart    As Long
    Dim endPos        As Long
    Dim char          As String

    searchPattern = """" & fieldName & """:"
    startPos = InStr(jsonStr, searchPattern)
    If startPos = 0 Then
        ExtractValueFromJSON = ""
        Exit Function
    End If

    valueStart = startPos + Len(searchPattern)
    Do While Mid(jsonStr, valueStart, 1) = " "
        valueStart = valueStart + 1
    Loop

    char = Mid(jsonStr, valueStart, 1)

    If char = """" Then
        valueStart = valueStart + 1
        endPos = InStr(valueStart, jsonStr, """")
        ExtractValueFromJSON = Mid(jsonStr, valueStart, endPos - valueStart)
    ElseIf char = "n" Then  ' null
        ExtractValueFromJSON = ""
    Else
        endPos = valueStart
        Do While endPos <= Len(jsonStr)
            char = Mid(jsonStr, endPos, 1)
            If char = "," Or char = "}" Or char = "]" Then Exit Do
            endPos = endPos + 1
        Loop
        ExtractValueFromJSON = Trim(Mid(jsonStr, valueStart, endPos - valueStart))
    End If
End Function

' ============================================================================
' HELPER: Parse JSON -> Collection of Dictionary
' ============================================================================
Private Function ParseNewOperations(jsonText As String) As Collection
    Dim result    As Collection
    Dim opDict    As Object
    Dim pos       As Long
    Dim dataStart As Long
    Dim dataEnd   As Long
    Dim objStart  As Long
    Dim objEnd    As Long
    Dim objStr    As String

    Set result = New Collection

    dataStart = InStr(jsonText, """data"":[")
    If dataStart = 0 Then
        Debug.Print "ERROR: 'data' array tidak ditemukan"
        Set ParseNewOperations = result
        Exit Function
    End If
    dataStart = InStr(dataStart, jsonText, "[") + 1
    dataEnd = InStr(dataStart, jsonText, "]")
    If dataEnd = 0 Then dataEnd = Len(jsonText)

    pos = dataStart
    Do While pos < dataEnd
        objStart = InStr(pos, jsonText, "{")
        If objStart = 0 Or objStart >= dataEnd Then Exit Do
        objEnd = InStr(objStart, jsonText, "}")
        If objEnd = 0 Then Exit Do

        objStr = Mid(jsonText, objStart, objEnd - objStart + 1)

        Set opDict = CreateObject("Scripting.Dictionary")
        opDict("order_no") = ExtractValueFromJSON(objStr, "order_no")
        opDict("operation_no") = ExtractValueFromJSON(objStr, "operation_no")  ' angka asli, tanpa padding
        opDict("workcenter") = ExtractValueFromJSON(objStr, "workcenter")
        opDict("planhours") = CDbl(ExtractValueFromJSON(objStr, "planhours"))
        opDict("operationtext") = ExtractValueFromJSON(objStr, "operationtext")
        opDict("plan_start") = ExtractValueFromJSON(objStr, "plan_start")
        opDict("plan_finish") = ExtractValueFromJSON(objStr, "plan_finish")
        opDict("ssbr_id") = ExtractValueFromJSON(objStr, "ssbr_id")
        opDict("part_name") = ExtractValueFromJSON(objStr, "part_name")

        result.Add opDict
        pos = objEnd + 1
    Loop

    Debug.Print "Total operasi parsed: " & result.Count
    Set ParseNewOperations = result
End Function

' ============================================================================
' HELPER: Group Collection by order_no -> Dictionary of Collections
' ============================================================================
Private Function GroupByOrderNo(operations As Collection) As Object
    Dim groups  As Object
    Dim opDict  As Object
    Dim i       As Long
    Dim oNo     As String

    Set groups = CreateObject("Scripting.Dictionary")

    For i = 1 To operations.Count
        Set opDict = operations(i)
        oNo = opDict("order_no")
        If Not groups.Exists(oNo) Then
            Set groups(oNo) = New Collection
        End If
        groups(oNo).Add opDict
    Next i

    Set GroupByOrderNo = groups
End Function

' ============================================================================
' HELPER: Kirim update sync = "scheduled" untuk list order_no
' ============================================================================
Private Sub UpdateSyncScheduled(successOrders As Collection)
    Dim i          As Long
    Dim jsonArray  As String
    Dim jsonBody   As String

    If successOrders.Count = 0 Then Exit Sub

    ' Build JSON array ["ord1","ord2",...]
    jsonArray = ""
    For i = 1 To successOrders.Count
        If jsonArray <> "" Then jsonArray = jsonArray & ","
        jsonArray = jsonArray & """" & successOrders(i) & """"
    Next i

    jsonBody = "{""order_nos"":[" & jsonArray & "],""sync_status"":""scheduled""}"

    Debug.Print ""
    Debug.Print "UPDATE SYNC -> scheduled"
    Debug.Print "BODY: " & jsonBody

    Dim resp As String
    resp = HttpPost(API_URL_UPD_SYNC, jsonBody)

    If resp <> "" Then
        Debug.Print "Update sync berhasil: " & resp
    End If
End Sub

' ============================================================================
' MAIN
' ============================================================================
Sub ConvertAPI_To_MPP_And_Inserts2()
    Dim fso             As Object
    Dim jsonResponse    As String
    Dim operations      As Collection
    Dim groups          As Object
    Dim orderKey        As Variant
    Dim orderOps        As Collection
    Dim opDict          As Object
    Dim subProj         As Project
    Dim t               As Task
    Dim masterProj      As Project
    Dim masterProjName  As String
    Dim mppPath         As String
    Dim hoursVal        As Double
    Dim useResourcePool As Boolean
    Dim i               As Long
    Dim ssbrId          As String
    Dim partName        As String
    Dim successOrders   As Collection  ' untuk update sync di akhir

    Set fso = CreateObject("Scripting.FileSystemObject")
    Set successOrders = New Collection
    
    If Not fso.FolderExists(OUTPUT_FOLDER) Then fso.CreateFolder OUTPUT_FOLDER

    Debug.Print ""
    Debug.Print "###############################################"
    Debug.Print "# CONVERT API -> MPP - START : " & Now()
    Debug.Print "###############################################"

    useResourcePool = fso.FileExists(RESOURCE_POOL_PATH)
    Debug.Print IIf(useResourcePool, "Resource pool OK", "Resource pool NOT FOUND") & " : " & RESOURCE_POOL_PATH

    Set masterProj = ActiveProject
    masterProjName = masterProj.FullName

    ' 1. Fetch dari API
    Application.StatusBar = "Mengambil data dari API..."
    jsonResponse = HttpPost(API_URL_GET_NEW, "{""order_no"":null}")

    If jsonResponse = "" Then
        MsgBox "Gagal menghubungi API.", vbCritical
        Exit Sub
    End If

    ' 2. Parse & group
    Set operations = ParseNewOperations(jsonResponse)
    If operations.Count = 0 Then
        MsgBox "Tidak ada operasi dengan status 'new'.", vbInformation
        Exit Sub
    End If

    Set groups = GroupByOrderNo(operations)
    Debug.Print "Total order_no: " & groups.Count & " | Total ops: " & operations.Count

    Application.ScreenUpdating = False
    Application.Calculation = pjManual
    SelectTaskField Row:=1, Column:="Name"
    SendKeys "^{DOWN}", True
    SendKeys "{DOWN}", True
    
    ' 3. Loop per order_no
    For Each orderKey In groups.keys
        Set orderOps = groups(orderKey)

        ' Ambil ssbr_id & part_name dari ops pertama (sama per order)
        Set opDict = orderOps(1)
        ssbrId = Trim(opDict("ssbr_id"))
        partName = Trim(opDict("part_name"))

        ' Nama file: order_no ssbr_id part_name.mpp
        mppPath = OUTPUT_FOLDER & orderKey & " " & ssbrId & " " & partName & ".mpp"

        Debug.Print "--------------------------------------------"
        Debug.Print "Order : " & orderKey & " | SSBR: " & ssbrId & " | Part: " & partName
        Debug.Print "File  : " & mppPath

        ' Buat project dari template
        On Error Resume Next
        FileOpen Name:=TEMPLATE_PATH, ReadOnly:=True
        If Err.Number <> 0 Then
            Err.Clear
            FileNew
        End If
        On Error GoTo 0

        Set subProj = ActiveProject
        subProj.Title = orderKey & " " & ssbrId & " " & partName

        ' Set resource pool
        If useResourcePool Then
            On Error Resume Next
            ResourceSharing Share:=True, Name:=RESOURCE_POOL_PATH
            If Err.Number <> 0 Then
                Debug.Print "Warning resource pool: " & Err.Description
                Err.Clear
            End If
            On Error GoTo 0
        End If

        ' Insert tasks
        For i = 1 To orderOps.Count
            Set opDict = orderOps(i)
            hoursVal = opDict("planhours") * FAKTOR_KOREKSI

            Set t = subProj.Tasks.Add(opDict("operationtext"))
            t.Type = pjFixedWork
            t.Text1 = opDict("order_no")
            t.Text2 = opDict("operation_no")  ' angka asli: "10", "20", dst
            t.Text3 = opDict("ssbr_id")

            If hoursVal > 0 Then
                t.Duration = hoursVal & "h"
                t.Work = hoursVal * 60

                If Trim(opDict("workcenter")) <> "" Then
                    On Error Resume Next
                    t.ResourceNames = opDict("workcenter")
                    If Err.Number <> 0 Then
                        Debug.Print "Warning resource assign: " & opDict("workcenter")
                        Err.Clear
                    End If
                    On Error GoTo 0
                End If
            End If

            If opDict("plan_start") <> "" And opDict("plan_start") <> "None" Then
                On Error Resume Next
                t.Start = CDate(opDict("plan_start"))
                On Error GoTo 0
            End If
            If opDict("plan_finish") <> "" And opDict("plan_finish") <> "None" Then
                On Error Resume Next
                t.Finish = CDate(opDict("plan_finish"))
                On Error GoTo 0
            End If

            Debug.Print "  [OK] op=" & opDict("operation_no") & " " & opDict("operationtext")
        Next i

        ' Save & close
        FileSaveAs Name:=mppPath, FormatID:="MSProject.mpp"
        FileClose pjSave

        ' Buka kembali master
        On Error Resume Next
        FileOpen Name:=masterProjName
        If Err.Number <> 0 Then
            MsgBox "Error membuka master: " & Err.Description, vbCritical
            Exit Sub
        End If
        On Error GoTo 0
        Set masterProj = ActiveProject

        ' Insert ke master
        On Error Resume Next
        ConsolidateProjects Filenames:=mppPath, NewWindow:=False, HideSubtasks:=True
        If Err.Number <> 0 Then
            Debug.Print "Error ConsolidateProjects: " & Err.Description
            Err.Clear
        Else
            Debug.Print "Success: subproject inserted - " & orderKey
            successOrders.Add CStr(orderKey)  ' catat order yang sukses
        End If
        On Error GoTo 0

    Next orderKey

    Application.Calculation = pjAutomatic
    Application.ScreenUpdating = True

    ' 4. Update sync = "scheduled" untuk semua order yang sukses
    Application.StatusBar = "Update sync status..."
    UpdateSyncScheduled successOrders

    Application.StatusBar = ""
    MsgBox "Selesai!" & vbCrLf & _
           "Order berhasil : " & successOrders.Count & "/" & groups.Count & vbCrLf & _
           "Total operasi  : " & operations.Count, vbInformation
End Sub

