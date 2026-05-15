Attribute VB_Name = "httphelper"
Function HttpPost22(url As String, json As String) As String

    If url = "" Then
        MsgBox "URL kosong!", vbCritical
        Exit Function
    End If

    If InStr(url, "http") = 0 Then
        MsgBox "URL salah format: " & url, vbCritical
        Exit Function
    End If

    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    http.Open "POST", url, False
    http.SetRequestHeader "Content-Type", "application/json"

    http.Send json

    HttpPost = http.ResponseText

End Function

Sub HttpPost(url As String, body As String)

    Dim http As Object
    Set http = CreateObject("MSXML2.ServerXMLHTTP")

    http.Open "POST", url, False
    http.SetRequestHeader "Content-Type", "application/json"
    
    http.SetTimeouts 5000, 5000, 10000, 10000
    
    ' Kalau SSL self-signed:
    http.Option(4) = 13056
    
    http.Send body

    Debug.Print http.ResponseText

End Sub


Sub HttpPostBulk(url As String, body As String)

    Dim http As Object
    Dim response As String
    
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    http.Open "POST", url, False
    
    ' Ignore SSL errors (internal only)
    http.Option(4) = 13056
    
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Accept", "application/json"
    http.SetRequestHeader "Cache-Control", "no-cache"

    ' Timeout (optional but recommended)
    http.SetTimeouts 5000, 5000, 10000, 10000

    http.Send body
    http.WaitForResponse

    If http.Status = 200 Then
        response = http.ResponseText
        Debug.Print response
        
        'MsgBox "Bulk Update Success!", vbInformation
    Else
        MsgBox "Error: " & http.Status & " - " & http.StatusText, vbCritical
    End If

End Sub

Function HttpPostBulks(url As String, body As String) As String

    On Error GoTo ErrHandler

    Dim http As Object
    
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    http.Open "POST", url, False
    
    ' Ignore SSL errors (internal only)
    http.Option(4) = 13056
    
    http.SetRequestHeader "Content-Type", "application/json"
    http.SetRequestHeader "Accept", "application/json"
    http.SetRequestHeader "Cache-Control", "no-cache"

    ' Timeout (resolve, connect, send, receive)
    http.SetTimeouts 5000, 5000, 10000, 10000

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

