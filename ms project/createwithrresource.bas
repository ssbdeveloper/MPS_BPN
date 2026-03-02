Option Explicit
Const CSV_FOLDER As String = "D:\csv project\"
Const OUTPUT_FOLDER As String = "D:\mpp\"
Const FAKTOR_KOREKSI As Double = 0.1
Const TEMPLATE_PATH As String = "D:\MPS2\ms project\master.mpt"
Const RESOURCE_POOL_PATH As String = "D:\MPS2\ms project\5051_RESOURCES.mpp"


' ===============================
' Helper
' ===============================
Function ToDouble(val As String) As Double
    val = Trim(val)
    val = Replace(val, ".", ",")
    If IsNumeric(val) Then
        ToDouble = CDbl(val)
    Else
        ToDouble = 0
    End If
End Function

Function CleanFileName(ByVal fName As String) As String
    Dim tmp As String
    tmp = Replace(fName, ".csv", "", , , vbTextCompare)
    tmp = Replace(tmp, "_", " ")
    CleanFileName = tmp
End Function

' ===============================
' MAIN
' ===============================
Sub ConvertCSV_To_MPP_And_Inserts()
    Dim fso As Object
    Dim fileName As String
    Dim cleanName As String
    Dim csvPath As String
    Dim mppPath As String
    Dim ts As Object
    Dim line As String
    Dim arr() As String
    Dim subProj As Project
    Dim t As Task
    Dim hoursVal As Double
    Dim masterProj As Project
    Dim masterProjName As String
    Dim useResourcePool As Boolean
    
    Set fso = CreateObject("Scripting.FileSystemObject")
    
    If Not fso.FolderExists(OUTPUT_FOLDER) Then
        fso.CreateFolder OUTPUT_FOLDER
    End If
    
    ' ===============================
    ' CEK APAKAH RESOURCE POOL FILE ADA
    ' ===============================
    If fso.FileExists(RESOURCE_POOL_PATH) Then
        useResourcePool = True
        Debug.Print "Resource pool ditemukan: " & RESOURCE_POOL_PATH
    Else
        useResourcePool = False
        Debug.Print "Resource pool TIDAK ditemukan: " & RESOURCE_POOL_PATH
    End If
    
    ' Simpan reference Master Project
    Set masterProj = ActiveProject
    masterProjName = masterProj.FullName
    
    Application.ScreenUpdating = False
    Application.Calculation = pjManual
    
    fileName = Dir(CSV_FOLDER & "*.csv")
    
    Do While fileName <> ""
        
        cleanName = CleanFileName(fileName)
        
        csvPath = CSV_FOLDER & fileName
        mppPath = OUTPUT_FOLDER & cleanName & ".mpp"
        
        ' ===============================
        ' CREATE PROJECT FROM TEMPLATE
        ' ===============================
        On Error Resume Next
        FileOpen Name:=TEMPLATE_PATH, ReadOnly:=True
        If Err.Number <> 0 Then
            Err.Clear
            FileNew
        End If
        On Error GoTo 0
        
        Set subProj = ActiveProject
        subProj.Title = cleanName
        
        ' ===============================
        ' SET RESOURCE POOL
        ' ===============================
        If useResourcePool Then
            On Error Resume Next
            ResourceSharing Share:=True, Name:=RESOURCE_POOL_PATH
            If Err.Number <> 0 Then
                Debug.Print "Warning: Gagal set resource pool untuk " & cleanName & " - Error: " & Err.Description
                Err.Clear
            Else
                Debug.Print "Success: Resource pool linked untuk " & cleanName
            End If
            On Error GoTo 0
        End If
        
        ' ===============================
        ' READ CSV
        ' ===============================
        Set ts = fso.OpenTextFile(csvPath, 1)
        ts.ReadLine ' skip header
        
        Do While Not ts.AtEndOfStream
            line = Trim(ts.ReadLine)
            
            If line <> "" Then
                arr = Split(line, ",")
                
                If UBound(arr) >= 5 Then
                    hoursVal = ToDouble(arr(4)) * FAKTOR_KOREKSI
                    
                    Set t = subProj.Tasks.Add(arr(2)) ' operationtext
                    t.Type = pjFixedWork
                    t.Text1 = arr(0)   ' order_no
                    t.Text2 = arr(3)   ' operation_no
                    t.Text3 = arr(1)   ' ssbr_id
                    
                    If hoursVal > 0 Then
                        t.Duration = hoursVal & "h"
                        t.Work = hoursVal * 60   ' minutes
                        
                        ' Assign resource
                        If Trim(arr(5)) <> "" Then
                            On Error Resume Next
                            t.ResourceNames = arr(5)
                            If Err.Number <> 0 Then
                                Debug.Print "Warning: Resource '" & arr(5) & "' gagal di-assign untuk task: " & arr(2)
                                Err.Clear
                            End If
                            On Error GoTo 0
                        End If
                    End If
                End If
            End If
        Loop
        
        ts.Close
        
        ' ===============================
        ' SAVE DAN CLOSE SUBPROJECT
        ' ===============================
        FileSaveAs Name:=mppPath, FormatID:="MSProject.mpp"
        FileClose pjSave  ' PENTING: Close dulu
        
        ' ===============================
        ' BUKA KEMBALI MASTER PROJECT
        ' ===============================
        On Error Resume Next
        FileOpen Name:=masterProjName
        If Err.Number <> 0 Then
            MsgBox "Error membuka master project: " & Err.Description, vbCritical
            Exit Sub
        End If
        On Error GoTo 0
        
        Set masterProj = ActiveProject
        
        ' ===============================
        ' INSERT SUBPROJECT
        ' ===============================
        On Error Resume Next
        ConsolidateProjects Filenames:=mppPath, NewWindow:=False, HideSubtasks:=True
        
        If Err.Number <> 0 Then
            Debug.Print "Error ConsolidateProjects untuk " & cleanName & ": " & Err.Description
            Err.Clear
        Else
            Debug.Print "Success: Subproject inserted - " & cleanName
        End If
        On Error GoTo 0
        
        fileName = Dir
    Loop
    
    Application.Calculation = pjAutomatic
    Application.ScreenUpdating = True
    
    MsgBox "Proses selesai!" & vbCrLf & _
           "Semua CSV berhasil dikonversi menjadi subproject.", vbInformation
End Sub

