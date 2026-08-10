Attribute VB_Name = "ms_config"
Option Explicit

' =============================================================================
' ms_config v2 - konfigurasi dari file eksternal, dengan fallback default.
'
' File config : %APPDATA%\mps-msproject\config.ini
' Format      : key=value per baris, baris diawali ';' atau '#' = komentar.
' Key yang didukung:
'   base_url   = https://100.80.101.53/api/ms-project
'   timeout_ms = 30000
'   verify_tls = false        ' true = WinHttp memverifikasi sertifikat server
'   tz_suffix  = +08:00       ' timezone tanggal yang dikirim ke server (WITA)
'
' Tanpa file config, nilai DEFAULT di bawah yang dipakai - modul tetap jalan.
' =============================================================================

Private Const MS_DEFAULT_BASE_URL As String = "https://10.16.1.103/api/ms-project"
Private Const MS_DEFAULT_TIMEOUT_MS As Long = 30000
Private Const MS_DEFAULT_VERIFY_TLS As Boolean = False
' Server MPS2 berjalan di Asia/Makassar (+08 WITA) - terverifikasi 2026-07-07.
' Versi lama memakai +07:00 (WIB); kalau tanggal lama terlihat bergeser 1 jam,
' itu sebabnya. Override lewat config.ini bila plant memakai zona lain.
Private Const MS_DEFAULT_TZ_SUFFIX As String = "+08:00"

' --- Custom field mapping MS Project (tidak berubah dari v1) -----------------
Public Const MS_PROJECT_ID_FIELD As String = "ProjectSummaryTask.Text30"
Public Const MS_PROJECT_REVISION_FIELD As String = "ProjectSummaryTask.Text29"
Public Const MS_PROJECT_MODE_FIELD As String = "ProjectSummaryTask.Text28"
Public Const MS_PROJECT_LOCK_TOKEN_FIELD As String = "ProjectSummaryTask.Text27"
Public Const MS_PROJECT_CALENDAR_ID_FIELD As String = "ProjectSummaryTask.Text26"

Public Const MS_TASK_ID_FIELD As String = "Task.Text10"
Public Const MS_TASK_PROJECT_ID_FIELD As String = "Task.Text11"
Public Const MS_TASK_PARENT_ID_FIELD As String = "Task.Text12"
Public Const MS_TASK_CALENDAR_ID_FIELD As String = "Task.Text13"

Public Const MS_RESOURCE_CALENDAR_ID_FIELD As String = "Resource.Text8"
Public Const MS_RESOURCE_ID_FIELD As String = "Resource.Text9"
Public Const MS_ASSIGNMENT_ID_FIELD As String = "Assignment.Text10"

Public Const MS_MODE_SINGLE_PROJECT As String = "SINGLE_PROJECT_EDITOR"
Public Const MS_MODE_MASTER_PORTFOLIO As String = "MASTER_PORTFOLIO_VIEW"

' --- Loader ------------------------------------------------------------------
Private mCfgLoaded As Boolean
Private mCfgBaseUrl As String
Private mCfgTimeoutMs As Long
Private mCfgVerifyTls As Boolean
Private mCfgTzSuffix As String

Private Function MsCfgFilePath() As String
    MsCfgFilePath = Environ$("APPDATA") & "\mps-msproject\config.ini"
End Function

Private Sub MsCfgEnsureLoaded()
    If mCfgLoaded Then Exit Sub

    mCfgBaseUrl = MS_DEFAULT_BASE_URL
    mCfgTimeoutMs = MS_DEFAULT_TIMEOUT_MS
    mCfgVerifyTls = MS_DEFAULT_VERIFY_TLS
    mCfgTzSuffix = MS_DEFAULT_TZ_SUFFIX

    On Error GoTo Done
    Dim fso As Object
    Dim stream As Object
    Dim lineText As String
    Dim eqPos As Long
    Dim key As String
    Dim value As String

    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FileExists(MsCfgFilePath()) Then GoTo Done

    Set stream = fso.OpenTextFile(MsCfgFilePath(), 1)
    Do While Not stream.AtEndOfStream
        lineText = Trim$(stream.ReadLine)
        If Len(lineText) > 0 And Left$(lineText, 1) <> ";" And Left$(lineText, 1) <> "#" Then
            eqPos = InStr(1, lineText, "=")
            If eqPos > 1 Then
                key = LCase$(Trim$(Left$(lineText, eqPos - 1)))
                value = Trim$(Mid$(lineText, eqPos + 1))
                Select Case key
                    Case "base_url"
                        If Len(value) > 0 Then
                            If Right$(value, 1) = "/" Then value = Left$(value, Len(value) - 1)
                            mCfgBaseUrl = value
                        End If
                    Case "timeout_ms"
                        If IsNumeric(value) Then mCfgTimeoutMs = CLng(value)
                    Case "verify_tls"
                        mCfgVerifyTls = (LCase$(value) = "true" Or value = "1")
                    Case "tz_suffix"
                        If Len(value) > 0 Then mCfgTzSuffix = value
                End Select
            End If
        End If
    Loop
    stream.Close

Done:
    On Error GoTo 0
    mCfgLoaded = True
End Sub

' Panggil ini setelah mengubah config.ini tanpa restart MS Project.
Public Sub Ms_ReloadConfig()
    mCfgLoaded = False
    MsCfgEnsureLoaded
    MsgBox "Config dimuat ulang." & vbCrLf & _
           "Base URL : " & MsCfgBaseUrl() & vbCrLf & _
           "Timeout  : " & CStr(MsCfgTimeoutMs()) & " ms" & vbCrLf & _
           "VerifyTLS: " & CStr(MsCfgVerifyTls()) & vbCrLf & _
           "TZ suffix: " & MsCfgTzSuffix() & vbCrLf & _
           "File     : " & MsCfgFilePath(), vbInformation
End Sub

Public Function MsCfgBaseUrl() As String
    MsCfgEnsureLoaded
    MsCfgBaseUrl = mCfgBaseUrl
End Function

Public Function MsCfgTimeoutMs() As Long
    MsCfgEnsureLoaded
    MsCfgTimeoutMs = mCfgTimeoutMs
End Function

Public Function MsCfgVerifyTls() As Boolean
    MsCfgEnsureLoaded
    MsCfgVerifyTls = mCfgVerifyTls
End Function

Public Function MsCfgTzSuffix() As String
    MsCfgEnsureLoaded
    MsCfgTzSuffix = mCfgTzSuffix
End Function
