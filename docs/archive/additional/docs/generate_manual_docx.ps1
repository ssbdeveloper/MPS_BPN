$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$MarkdownPath = Join-Path $Root 'docs\manualbook_mps2_end_user.md'
$OutputPath = Join-Path $Root 'docs\Manual_Book_MPS2_End_User.docx'
$WorkDir = Join-Path $env:TEMP ('mps2_manual_docx_' + [guid]::NewGuid().ToString('N'))
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8File {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, $Utf8NoBom)
}

function Escape-XmlText {
  param([string]$Text)
  if ($null -eq $Text) { return '' }
  return [System.Security.SecurityElement]::Escape($Text)
}

function New-ParagraphXml {
  param(
    [string]$Text,
    [string]$Style = '',
    [bool]$Bold = $false,
    [int]$FontSize = 22
  )

  $styleXml = ''
  if ($Style) {
    $styleXml = '<w:pPr><w:pStyle w:val="' + $Style + '"/></w:pPr>'
  }

  $boldXml = ''
  if ($Bold) {
    $boldXml = '<w:b/>'
  }

  $escaped = Escape-XmlText $Text
  return '<w:p>' + $styleXml + '<w:r><w:rPr>' + $boldXml + '<w:sz w:val="' + $FontSize + '"/><w:szCs w:val="' + $FontSize + '"/></w:rPr><w:t xml:space="preserve">' + $escaped + '</w:t></w:r></w:p>'
}

function New-ScreenshotPlaceholderXml {
  param([string]$Text)
  $escaped = Escape-XmlText $Text
  return @"
<w:tbl>
  <w:tblPr>
    <w:tblW w:w="0" w:type="auto"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="8" w:space="0" w:color="94A3B8"/>
      <w:left w:val="single" w:sz="8" w:space="0" w:color="94A3B8"/>
      <w:bottom w:val="single" w:sz="8" w:space="0" w:color="94A3B8"/>
      <w:right w:val="single" w:sz="8" w:space="0" w:color="94A3B8"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
    </w:tblBorders>
    <w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/>
  </w:tblPr>
  <w:tr>
    <w:trPr><w:trHeight w:val="2200" w:hRule="atLeast"/></w:trPr>
    <w:tc>
      <w:tcPr><w:tcW w:w="9200" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>
      <w:p>
        <w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r><w:rPr><w:b/><w:color w:val="64748B"/><w:sz w:val="22"/></w:rPr><w:t>$escaped</w:t></w:r>
      </w:p>
      <w:p>
        <w:pPr><w:jc w:val="center"/></w:pPr>
        <w:r><w:rPr><w:color w:val="94A3B8"/><w:sz w:val="18"/></w:rPr><w:t>Sisipkan screenshot UI pada area ini.</w:t></w:r>
      </w:p>
    </w:tc>
  </w:tr>
</w:tbl>
<w:p/>
"@
}

New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $WorkDir '_rels') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $WorkDir 'word\_rels') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $WorkDir 'word') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $WorkDir 'docProps') | Out-Null

$body = New-Object System.Collections.Generic.List[string]
$lines = [System.IO.File]::ReadAllLines($MarkdownPath, [System.Text.Encoding]::UTF8)

foreach ($line in $lines) {
  $trim = $line.TrimEnd()

  if ($trim -eq '') {
    $body.Add('<w:p/>')
  } elseif ($trim -match '^# (.+)$') {
    $body.Add((New-ParagraphXml -Text $Matches[1] -Style 'Title' -Bold $true -FontSize 40))
  } elseif ($trim -match '^## (.+)$') {
    $body.Add((New-ParagraphXml -Text $Matches[1] -Style 'Heading1' -Bold $true -FontSize 30))
  } elseif ($trim -match '^### (.+)$') {
    $body.Add((New-ParagraphXml -Text $Matches[1] -Style 'Heading2' -Bold $true -FontSize 26))
  } elseif ($trim -match '^\[TEMPAT SCREENSHOT: (.+)\]$') {
    $body.Add((New-ScreenshotPlaceholderXml -Text $Matches[1]))
  } elseif ($trim -match '^- (.+)$') {
    $body.Add((New-ParagraphXml -Text ('- ' + $Matches[1]) -FontSize 22))
  } else {
    $body.Add((New-ParagraphXml -Text $trim -FontSize 22))
  }
}

$bodyXml = [string]::Join("`n", $body)
$created = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

Write-Utf8File -Path (Join-Path $WorkDir '[Content_Types].xml') -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>
'@

Write-Utf8File -Path (Join-Path $WorkDir '_rels\.rels') -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>
'@

Write-Utf8File -Path (Join-Path $WorkDir 'word\_rels\document.xml.rels') -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
'@

Write-Utf8File -Path (Join-Path $WorkDir 'word\styles.xml') -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="40"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="360" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="075985"/><w:sz w:val="30"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="334155"/><w:sz w:val="26"/></w:rPr>
  </w:style>
</w:styles>
'@

$coreXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Manual Book MPS2 End User</dc:title>
  <dc:subject>Manual UI aplikasi MPS2</dc:subject>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">$created</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">$created</dcterms:modified>
</cp:coreProperties>
"@
Write-Utf8File -Path (Join-Path $WorkDir 'docProps\core.xml') -Content $coreXml

Write-Utf8File -Path (Join-Path $WorkDir 'docProps\app.xml') -Content @'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Word</Application>
</Properties>
'@

$documentXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    $bodyXml
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>
"@
Write-Utf8File -Path (Join-Path $WorkDir 'word\document.xml') -Content $documentXml

if (Test-Path $OutputPath) {
  Remove-Item -LiteralPath $OutputPath -Force
}

$ZipPath = [System.IO.Path]::ChangeExtension($OutputPath, '.zip')
if (Test-Path $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}

Compress-Archive -Path (Join-Path $WorkDir '*') -DestinationPath $ZipPath -Force
Move-Item -LiteralPath $ZipPath -Destination $OutputPath -Force
Remove-Item -LiteralPath $WorkDir -Recurse -Force

Get-Item $OutputPath
