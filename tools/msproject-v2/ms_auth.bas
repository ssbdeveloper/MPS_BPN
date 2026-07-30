Attribute VB_Name = "ms_auth"
Option Explicit

' =====================================================================================
' ms_auth.bas - login + identitas user (ADITIF; realisasi Fase 1 identitas plan).
'
' Verifikasi ke API POST /api/auth/login (tabel public.users, argon2id). Username sesi
' disimpan -> dipakai sebagai "actor"/"updated_by" saat checkout/sync/checkin/publish
' supaya transaksi ter-record OLEH SIAPA. Belum login -> fallback "ms-project-vba"
' (perilaku lama tak berubah => aman rollback).
'
' Butuh UserForm bernama "frmLogin" (dibuat di VBE, lihat panduan) dengan kontrol:
'   txtUsername, txtPassword (PasswordChar), lblStatus, cmdLogin, cmdCancel.
' Ms_Login memanggil form secara LATE-BIND -> modul ini tetap compile walau form
' belum ada (aman untuk "import semua .bas").
'
' CATATAN URL: base_url config = .../api/ms-project, tetapi login ada di
' .../api/auth/login (SIBLING, bukan child). MsTryLogin men-strip "/ms-project".
' =====================================================================================

' Username yang sedang login (kosong = belum login). Diisi oleh frmLogin.cmdLogin_Click.
Public gCurrentUser As String

' Actor untuk payload. Login -> username; belum login -> fallback lama.
Public Function MsCurrentActor() As String
    If Len(gCurrentUser) > 0 Then
        MsCurrentActor = gCurrentUser
    Else
        MsCurrentActor = "ms-project-vba"
    End If
End Function

' (Payload memakai idiom yang ada: MsJsonString(MsCurrentActor()) -> "username" ter-quote & escape.)

' Tampilkan form login (late-bind: tak butuh frmLogin saat compile).
Public Sub Ms_Login()
    On Error GoTo NoForm
    Dim f As Object
    Set f = UserForms.Add("frmLogin")
    f.Show                       ' modal; cmdLogin mengisi gCurrentUser lalu Me.Hide
    Unload f
    Exit Sub
NoForm:
    MsgBox "UserForm 'frmLogin' belum dibuat / gagal dibuka." & vbCrLf & _
           "Buat dulu di VBE (lihat panduan). Detail: " & Err.Description, vbExclamation
End Sub

Public Sub Ms_Logout()
    gCurrentUser = ""
    MsgBox "Sudah logout. Actor kembali ke fallback 'ms-project-vba'.", vbInformation
End Sub

Public Sub Ms_WhoAmI()
    If Len(gCurrentUser) > 0 Then
        MsgBox "Login sebagai: " & gCurrentUser, vbInformation
    Else
        MsgBox "Belum login (actor = ms-project-vba). Jalankan Ms_Login.", vbExclamation
    End If
End Sub

' Guard: pastikan sudah login sebelum aksi. Kalau belum, tampilkan form login.
' Return True kalau (sudah/berhasil) login; False kalau user batal (aksi harus dibatalkan).
' Panggil di awal tiap aksi tulis: If Not MsEnsureLoggedIn() Then Exit Sub
Public Function MsEnsureLoggedIn() As Boolean
    If Len(gCurrentUser) > 0 Then
        MsEnsureLoggedIn = True
        Exit Function
    End If
    Ms_Login                                  ' tampilkan frmLogin; sukses -> isi gCurrentUser
    MsEnsureLoggedIn = (Len(gCurrentUser) > 0)
    If Not MsEnsureLoggedIn Then _
        MsgBox "Aksi dibatalkan - belum login.", vbExclamation
End Function

' Verifikasi kredensial ke /api/auth/login.
' True  = sukses (outUser = username terverifikasi).
' False = gagal (outMsg = alasan yang bisa ditampilkan ke user).
Public Function MsTryLogin(ByVal username As String, ByVal password As String, _
                           ByRef outUser As String, ByRef outMsg As String) As Boolean
    On Error GoTo Fail
    Dim d As Object
    Dim resp As String
    Dim root As Object
    Dim u As Object
    Dim authUrl As String

    ' base_url = .../api/ms-project ; login ada di .../api/auth/login (sibling, bukan child).
    authUrl = MsCfgBaseUrl()
    If Right$(authUrl, 11) = "/ms-project" Then authUrl = Left$(authUrl, Len(authUrl) - 11)
    authUrl = authUrl & "/auth/login"

    Set d = CreateObject("Scripting.Dictionary")
    d.Add "username", username
    d.Add "password", password

    resp = MsHttpRequest("POST", authUrl, JsonConverter.ConvertToJson(d))  ' URL penuh, bypass /ms-project
    Set root = JsonConverter.ParseJson(resp)

    If root("success") = True Then
        Set u = root("user")
        outUser = CStr(u("username"))
        MsTryLogin = True
    Else
        outMsg = "Login gagal."
        MsTryLogin = False
    End If
    Exit Function

Fail:
    If InStr(Err.Description, "HTTP 401") > 0 Then
        outMsg = "Username atau password salah."
    ElseIf InStr(Err.Description, "HTTP 400") > 0 Then
        outMsg = "Username & password wajib diisi."
    Else
        outMsg = "Tak bisa konek ke server: " & Err.Description
    End If
    MsTryLogin = False
End Function
