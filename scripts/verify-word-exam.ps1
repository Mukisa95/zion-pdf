param([string]$Folder = (Join-Path $PSScriptRoot '../release/smoke/word-exam'))
$ErrorActionPreference='Stop'
$folderPath=[IO.Path]::GetFullPath($Folder)
$wordApp=$null;$testDoc=$null;$owned=$false
try {
  $wordApp=New-Object -ComObject Word.Application
  if($wordApp.Documents.Count -ne 0){throw 'The verification instance has open documents; leaving it untouched.'}
  $owned=$true;$wordApp.Visible=$false;$wordApp.DisplayAlerts=0;$wordApp.AutomationSecurity=3
  $copy=Join-Path $folderPath 'verification-copy.docx'
  Copy-Item -LiteralPath (Join-Path $folderPath 'improved.docx') -Destination $copy -Force
  $testDoc=$wordApp.Documents.Open($copy,$false,$false,$false)
  $testDoc.Repaginate()
  if($testDoc.ComputeStatistics(2) -ne 9){throw "The nine-page exam became $($testDoc.ComputeStatistics(2)) pages."}
  if($testDoc.Tables.Count -ne 3){throw 'The cover forms, marking table and timetable must remain Word tables.'}
  $pdfOutput=Join-Path $folderPath 'exam-word.pdf'
  if(Test-Path -LiteralPath $pdfOutput){Remove-Item -LiteralPath $pdfOutput -Force}
  $testDoc.ExportAsFixedFormat($pdfOutput,17)
  $range=$testDoc.Content.Duplicate
  if(-not $range.Find.Execute('All the residents who are 18')){throw 'The reading passage is missing.'}
  if($range.Frames.Count -ne 0){throw 'An ordinary reading passage must not be inside a positioned frame.'}
  $range.Text='All the local residents who are 18'
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)
  $cell=$testDoc.Tables.Item(3).Cell(2,1).Range
  if(-not $cell.Find.Execute('Soroti 4.00am')){throw 'The departure entries are not in an editable table cell.'}
  $cell.Text='Soroti 4.15am'
  [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($cell)
  $testDoc.SaveAs2((Join-Path $folderPath 'edited-in-word.docx'))
  Write-Output 'PASS: Microsoft Word renders 9 pages and 3 native tables; ordinary paragraph and timetable-cell editing both succeed.'
}finally{
  if($null -ne $testDoc){$testDoc.Close(0);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($testDoc)}
  if($null -ne $wordApp){if($owned -and $wordApp.Documents.Count -eq 0){$wordApp.Quit(0)};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($wordApp)}
}
