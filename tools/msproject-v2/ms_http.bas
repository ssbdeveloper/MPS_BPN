Attribute VB_Name = "ms_http"
Option Explicit

' ms_http v2 — perubahan dari v1:
'  - Base URL / timeout / verifikasi TLS / tz suffix dibaca dari ms_config (config.ini).
'  - Option(4)=13056 (abaikan error sertifikat) hanya dipakai bila verify_tls=false.

Public Function MsApiUrl(ByVal path As String) As String
    If Left$(path, 1) <> "/" Then path = "/" & path
    MsApiUrl = MsCfgBaseUrl() & path
End Function

Private Sub MsHttpApplyOptions(ByVal http As Object)
    If Not MsCfgVerifyTls() Then http.Option(4) = 13056
    http.SetTimeouts 5000, 5000, MsCfgTimeoutMs(), MsCfgTimeoutMs()
End Sub

Public Function MsHttpRequest(ByVal method As String, ByVal url As String, Optional ByVal body As String = "") As String
    On Error GoTo ErrHandler

    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    http.Open UCase$(method), url, False
    MsHttpApplyOptions http
    http.SetRequestHeader "Accept", "application/json"
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Cache-Control", "no-cache"

    If Len(body) > 0 Then
        http.Send body
    Else
        http.Send
    End If
    http.WaitForResponse

    If http.Status < 200 Or http.Status >= 300 Then
        Err.Raise vbObjectError + http.Status, "MsHttpRequest", _
            "HTTP " & http.Status & " " & http.StatusText & vbCrLf & Left$(http.ResponseText, 1000)
    End If

    MsHttpRequest = http.ResponseText
    Exit Function

ErrHandler:
    Err.Raise Err.Number, Err.Source, Err.Description
End Function

Public Function MsHttpGet(ByVal path As String) As String
    MsHttpGet = MsHttpRequest("GET", MsApiUrl(path))
End Function

Public Function MsHttpPost(ByVal path As String, ByVal body As String) As String
    MsHttpPost = MsHttpRequest("POST", MsApiUrl(path), body)
End Function

Public Function MsHttpPut(ByVal path As String, ByVal body As String) As String
    MsHttpPut = MsHttpRequest("PUT", MsApiUrl(path), body)
End Function

Public Function MsHttpDelete(ByVal path As String) As String
    MsHttpDelete = MsHttpRequest("DELETE", MsApiUrl(path))
End Function

Private Sub MsStreamWriteAscii(ByVal stream As Object, ByVal text As String)
    Dim bytes() As Byte
    bytes = StrConv(text, vbFromUnicode)
    stream.Write bytes
End Sub

Private Sub MsHttpDebugLog(ByVal message As String)
    Debug.Print Format$(Now, "yyyy-mm-dd hh:nn:ss") & " | " & message
End Sub

Public Function MsHttpUploadFile(ByVal path As String, ByVal fieldName As String, ByVal filePath As String) As String
    On Error GoTo ErrHandler

    Dim fso As Object
    Dim boundary As String
    Dim body As Object
    Dim fileStream As Object
    Dim http As Object
    Dim fileName As String
    Dim uploadUrl As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FileExists(filePath) Then
        Err.Raise vbObjectError + 9101, "MsHttpUploadFile", "File tidak ditemukan: " & filePath
    End If

    fileName = fso.GetFileName(filePath)
    boundary = "----MPSMSProject" & Format$(Now, "yyyymmddhhnnss") & CStr(Int(Rnd() * 1000000))

    Set body = CreateObject("ADODB.Stream")
    body.Type = 1
    body.Open

    MsStreamWriteAscii body, "--" & boundary & vbCrLf
    MsStreamWriteAscii body, "Content-Disposition: form-data; name=""" & fieldName & """; filename=""" & fileName & """" & vbCrLf
    MsStreamWriteAscii body, "Content-Type: application/vnd.ms-project" & vbCrLf & vbCrLf

    Set fileStream = CreateObject("ADODB.Stream")
    fileStream.Type = 1
    fileStream.Open
    fileStream.LoadFromFile filePath
    fileStream.Position = 0
    body.Write fileStream.Read
    fileStream.Close

    MsStreamWriteAscii body, vbCrLf & "--" & boundary & "--" & vbCrLf
    body.Position = 0

    uploadUrl = MsApiUrl(path)
    MsHttpDebugLog "HTTP upload start"
    MsHttpDebugLog "URL: " & uploadUrl
    MsHttpDebugLog "File: " & filePath
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
    http.Open "POST", uploadUrl, False
    MsHttpApplyOptions http
    http.SetRequestHeader "Accept", "application/json"
    http.SetRequestHeader "Content-Type", "multipart/form-data; boundary=" & boundary
    http.SetRequestHeader "Cache-Control", "no-cache"
    http.Send body.Read
    http.WaitForResponse
    body.Close

    MsHttpDebugLog "HTTP upload status: " & CStr(http.Status) & " " & http.StatusText
    If http.Status < 200 Or http.Status >= 300 Then
        MsHttpDebugLog "HTTP upload response: " & Left$(http.ResponseText, 1000)
        Err.Raise vbObjectError + http.Status, "MsHttpUploadFile", _
            "HTTP " & http.Status & " " & http.StatusText & vbCrLf & _
            "URL: " & uploadUrl & vbCrLf & _
            "File: " & filePath & vbCrLf & _
            Left$(http.ResponseText, 1000)
    End If

    MsHttpDebugLog "HTTP upload response: " & Left$(http.ResponseText, 1000)
    MsHttpUploadFile = http.ResponseText
    Exit Function

ErrHandler:
    Dim uploadErrNo As Long
    Dim uploadErrSource As String
    Dim uploadErrDescription As String

    uploadErrNo = Err.Number
    uploadErrSource = Err.Source
    uploadErrDescription = Err.Description

    MsHttpDebugLog "HTTP upload gagal: " & uploadErrDescription & " | Source: " & uploadErrSource
    On Error Resume Next
    If Not fileStream Is Nothing Then fileStream.Close
    If Not body Is Nothing Then body.Close
    On Error GoTo 0
    Err.Raise uploadErrNo, uploadErrSource, uploadErrDescription & vbCrLf & _
        "URL: " & uploadUrl & vbCrLf & _
        "File: " & filePath
End Function

Public Function MsParseSuccess(ByVal responseText As String) As Object
    Dim root As Object
    Set root = JsonConverter.ParseJson(responseText)

    If root.Exists("success") Then
        If CBool(root("success")) = False Then
            Dim msg As String
            msg = "API error"
            If root.Exists("code") Then msg = msg & " [" & CStr(root("code")) & "]"
            If root.Exists("message") Then msg = msg & ": " & CStr(root("message"))
            Err.Raise vbObjectError + 9001, "MsParseSuccess", msg
        End If
    End If

    Set MsParseSuccess = root
End Function

Public Function MsJsonEscape(ByVal value As String) As String
    value = Replace(value, "\", "\\")
    value = Replace(value, """", "\""")
    value = Replace(value, vbCrLf, "\n")
    value = Replace(value, vbCr, "\n")
    value = Replace(value, vbLf, "\n")
    MsJsonEscape = value
End Function

Public Function MsJsonString(ByVal value As String) As String
    MsJsonString = """" & MsJsonEscape(value) & """"
End Function

Public Function MsJsonNullableString(ByVal value As String) As String
    value = Trim$(value)
    If Len(value) = 0 Then
        MsJsonNullableString = "null"
    Else
        MsJsonNullableString = MsJsonString(value)
    End If
End Function

Public Function MsJsonNumber(ByVal value As Variant, Optional ByVal fallback As String = "null") As String
    If IsEmpty(value) Or IsNull(value) Then
        MsJsonNumber = fallback
    ElseIf IsNumeric(value) Then
        MsJsonNumber = Replace(CStr(value), ",", ".")
    Else
        MsJsonNumber = fallback
    End If
End Function

Public Function MsJsonBool(ByVal value As Boolean) As String
    If value Then
        MsJsonBool = "true"
    Else
        MsJsonBool = "false"
    End If
End Function

Public Function MsDateToIso(ByVal value As Variant) As String
    If IsDate(value) Then
        MsDateToIso = Format$(CDate(value), "yyyy-mm-dd\Thh:nn:ss") & MsCfgTzSuffix()
    Else
        MsDateToIso = ""
    End If
End Function

Public Function MsJsonNullableDate(ByVal value As Variant) As String
    Dim text As String
    text = MsDateToIso(value)
    If Len(text) = 0 Then
        MsJsonNullableDate = "null"
    Else
        MsJsonNullableDate = MsJsonString(text)
    End If
End Function

Public Function MsUrlEncode(ByVal value As String) As String
    Dim i As Long
    Dim ch As String
    Dim code As Integer
    Dim result As String

    For i = 1 To Len(value)
        ch = Mid$(value, i, 1)
        code = Asc(ch)
        Select Case code
            Case 48 To 57, 65 To 90, 97 To 122
                result = result & ch
            Case 45, 46, 95, 126
                result = result & ch
            Case 32
                result = result & "%20"
            Case Else
                result = result & "%" & Right$("0" & Hex$(code), 2)
        End Select
    Next i

    MsUrlEncode = result
End Function
