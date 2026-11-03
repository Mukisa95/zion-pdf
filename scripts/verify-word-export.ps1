param([string]$Folder = (Join-Path $PSScriptRoot '../release/smoke/word-layout'))
$ErrorActionPreference='Stop'
$folderPath=[IO.Path]::GetFullPath($Folder)
$wordApp=$null
$testDoc=$null
$owned=$false
try {
  $wordApp=New-Object -ComObject Word.Application
  if($wordApp.Documents.Count -ne 0){throw 'The verification instance has open documents; leaving it untouched.'}
  $owned=$true
  $wordApp.Visible=$false
  $wordApp.DisplayAlerts=0
  $wordApp.AutomationSecurity=3
  foreach($file in @('complete','appearance','range')){
    $inputPath=Join-Path $folderPath "$file.docx"
    $testDoc=$wordApp.Documents.Open($inputPath,$false,$false,$false)
    $testDoc.Repaginate()
    if($file -eq 'complete'){
      if($testDoc.Tables.Count -lt 3){throw 'The reconstructed tables are not in the Word document body.'}
      if($testDoc.Content.Text -notmatch 'This paragraph must remain one editable paragraph in Word'){throw 'The paragraph is missing from normal Word text.'}
      $originalPages=$testDoc.ComputeStatistics(2)
      $testDoc.ExportAsFixedFormat((Join-Path $folderPath 'complete-word.pdf'),17)
      $range=$testDoc.Content.Duplicate
      if(-not $range.Find.Execute('one editable paragraph')){throw 'Cannot edit the paragraph in Word.'}
      $range.Text='one freely editable paragraph with additional words'
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)
      $cell=$testDoc.Tables.Item(1).Cell(2,1).Range
      $cell.End=$cell.End-1
      $cell.Text='Books revised in Word'
      [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)
      $testDoc.SaveAs2((Join-Path $folderPath 'edited-in-word.docx'))
      $testDoc.ExportAsFixedFormat((Join-Path $folderPath 'edited-in-word.pdf'),17)
      Write-Output "PASS: Word body contains $($testDoc.Tables.Count) tables; paragraph and table-cell editing succeeded ($originalPages pages before editing)."
    }else{
      $testDoc.ExportAsFixedFormat((Join-Path $folderPath "$file-word.pdf"),17)
    }
    $testDoc.Close(0)
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($testDoc)
    $testDoc=$null
  }
}finally{
  if($null -ne $testDoc){$testDoc.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($testDoc)}
  if($null -ne $wordApp){if($owned -and $wordApp.Documents.Count -eq 0){$wordApp.Quit(0)};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp)}
}
