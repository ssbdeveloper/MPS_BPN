Sub CREATEUYE()
    
    ' Select baris pertama kolom Task Name
    SelectTaskField Row:=1, Column:="Name"
    
    
    SendKeys "^{UP}", True
    SendKeys "^{DOWN}", True
    
    
    'SendKeys "{DOWN}", True
    
    ' Delay 1 detik
    DoEvents
    
     '==== Delay 1 detik =====
    t = Timer
    Do While Timer < t + 1
        DoEvents
    Loop
    
    MsgBox "Generator Dijalankan"
    
    ' Jalankan procedure berikutnya
    Call ConvertAPI_To_MPP_And_Inserts2

End Sub
