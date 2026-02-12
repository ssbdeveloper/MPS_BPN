Attribute VB_Name = "senddatabulk"
Sub SendPlanToAPI_Bulk()

    Dim t As Task
    Dim body As String
    Dim resourceName As String
    Dim jsonItems As String
    Dim firstItem As Boolean
    
    jsonItems = ""
    firstItem = True

    For Each t In ActiveProject.Tasks
        
        If Not t Is Nothing Then
            
            If t.Text1 <> "" And t.Text2 <> "" Then
                
                resourceName = ""
                If t.ResourceNames <> "" Then
                    resourceName = Split(t.ResourceNames, "[")(0)
                End If
                
                If Not firstItem Then
                    jsonItems = jsonItems & ","
                End If
                
                jsonItems = jsonItems & "{"
                jsonItems = jsonItems & """order_no"":""" & JsonEscape(t.Text1) & ""","
                jsonItems = jsonItems & """operation_no"":""" & JsonEscape(t.Text2) & ""","
                jsonItems = jsonItems & """workcenter"":""" & JsonEscape(resourceName) & ""","
                jsonItems = jsonItems & """plan_start"":""" & Format(t.Start, "yyyy-mm-dd hh:nn:ss") & ""","
                jsonItems = jsonItems & """plan_finish"":""" & Format(t.Finish, "yyyy-mm-dd hh:nn:ss") & """"
                jsonItems = jsonItems & "}"
                
                firstItem = False
                
            End If
            
        End If
        
    Next t

    body = "{""items"":[" & jsonItems & "]}"
    
    Debug.Print body
    Call HttpPostBulk("https://100.80.101.53/fastapi/sow/update-plan-bulk", body)

    MsgBox "Bulk Send Plan Selesai!", vbInformation

End Sub
Function JsonEscape(str As String) As String
    str = Replace(str, "\", "\\")
    str = Replace(str, """", "\""")
    str = Replace(str, vbCrLf, "\n")
    str = Replace(str, vbCr, "\n")
    str = Replace(str, vbLf, "\n")
    JsonEscape = str
End Function

