Attribute VB_Name = "ms_config"
Option Explicit

' Express API through nginx.
Public Const MS_API_BASE_URL As String = "https://100.80.101.53/api/ms-project"

' Microsoft Project custom field mapping.
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

Public Const MS_DEFAULT_TIMEZONE_SUFFIX As String = "+07:00"
Public Const MS_HTTP_TIMEOUT_MS As Long = 30000

Public Const MS_MODE_SINGLE_PROJECT As String = "SINGLE_PROJECT_EDITOR"
Public Const MS_MODE_MASTER_PORTFOLIO As String = "MASTER_PORTFOLIO_VIEW"
