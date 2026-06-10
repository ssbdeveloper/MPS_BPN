Attribute VB_Name = "senddata"
Sub SendPlanToAPI()
    Dim t As Task
    Dim body As String
    Dim resourceName As String
    Dim workcenter_clean As String
    
    For Each t In ActiveProject.Tasks
        If Not t Is Nothing Then
            If t.Text1 <> "" And t.Text2 <> "" Then
                ' Ambil resource name (handle jika kosong)
                resourceName = ""
                If t.ResourceNames <> "" Then
                    resourceName = t.ResourceNames
                End If
                
                'Parsing karakter "[" supaya Clean
                resourceName = Split(resourceName, "[")(0)
                
                
                ' Build JSON body
                body = "{"
                body = body & """order_no"":""" & t.Text1 & ""","
                body = body & """operation_no"":""" & t.Text2 & ""","
                body = body & """workcenter"":""" & resourceName & ""","
                body = body & """plan_start"":""" & Format(t.Start, "yyyy-mm-dd hh:nn:ss") & ""","
                body = body & """plan_finish"":""" & Format(t.Finish, "yyyy-mm-dd hh:nn:ss") & """"
                body = body & "}"
                '100.80.101.53
                Call HttpPostBulk("https://100.80.101.53/fastapi/sow/update-plan", body)
            End If
        End If
    Next t
    
    MsgBox "Send Plan Selesai!", vbInformation
End Sub
